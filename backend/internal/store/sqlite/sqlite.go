// Package sqlite is the SQLite implementation of store.Store, and the only
// package of the service that contains SQL.
//
// PostgreSQL may replace SQLite later, so the queries stay in the subset
// both accept: numbered placeholders ($1), INSERT ... ON CONFLICT DO
// NOTHING, no SQLite functions, no rowid. What is SQLite-only is in Open
// and says so.
package sqlite

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"time"

	_ "modernc.org/sqlite" // the database/sql driver, pure Go

	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/domain"
	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/store"
)

// Store is a store.Store on a SQLite file.
type Store struct {
	db  *sql.DB
	now func() time.Time
}

var _ store.Store = (*Store)(nil)

// Open opens the database file at path, creating it when missing, and
// brings its schema up to date.
func Open(path string) (*Store, error) {
	// SQLite-only: the connection settings. Each is applied to every
	// connection of the pool.
	//   - journal_mode WAL: readers do not wait for the writer.
	//   - foreign_keys: SQLite leaves them off unless asked.
	//   - busy_timeout: a writer waits for the other writer instead of
	//     failing at once.
	//   - _txlock immediate: a writing transaction takes the write lock
	//     when it begins, so two of them queue up instead of failing when
	//     both try to upgrade from reading. Read-only transactions are not
	//     affected.
	q := url.Values{}
	q.Add("_pragma", "busy_timeout(5000)")
	q.Add("_pragma", "journal_mode(WAL)")
	q.Add("_pragma", "foreign_keys(1)")
	q.Set("_txlock", "immediate")
	dsn := "file:" + (&url.URL{Path: path}).EscapedPath() + "?" + q.Encode()

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	if _, err := migrate(ctx, db); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("migrate %s: %w", path, err)
	}
	return &Store{db: db, now: time.Now}, nil
}

// Close releases the database.
func (s *Store) Close() error { return s.db.Close() }

// querier is what *sql.DB and *sql.Tx have in common.
type querier interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// write runs fn in a writing transaction and commits when fn succeeds.
func (s *Store) write(ctx context.Context, fn func(tx *sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

// CreateEvent implements store.Store.
func (s *Store) CreateEvent(ctx context.Context, e store.NewEvent) (domain.Event, error) {
	if len(e.Days) == 0 {
		return domain.Event{}, errors.New("create event: no days")
	}
	lastDay := e.Days[0].Date
	for _, d := range e.Days {
		lastDay = max(lastDay, d.Date) // YYYY-MM-DD compares as text
	}
	now := s.now().Unix()

	var ev domain.Event
	err := s.write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO events (id, title, status, organiser_key_hash, version, last_day, created_at, closed_at)
			 VALUES ($1, $2, $3, $4, 1, $5, $6, NULL)`,
			e.ID, e.Title, domain.StatusOpen, e.OrganiserKeyHash, lastDay, now); err != nil {
			return err
		}
		for _, d := range e.Days {
			for _, slot := range d.Slots {
				if _, err := tx.ExecContext(ctx,
					`INSERT INTO candidates (event_id, day, slot) VALUES ($1, $2, $3)`,
					e.ID, d.Date, string(slot)); err != nil {
					return err
				}
			}
		}
		if err := insertParticipant(ctx, tx, e.ID, e.Organiser, true, 1, now); err != nil {
			return err
		}
		var err error
		ev, err = loadEvent(ctx, tx, e.ID)
		return err
	})
	if err != nil {
		return domain.Event{}, fmt.Errorf("create event: %w", err)
	}
	return ev, nil
}

// GetEvent implements store.Store.
func (s *Store) GetEvent(ctx context.Context, id string) (domain.Event, error) {
	// One read-only transaction, so the four reads see the same version.
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return domain.Event{}, fmt.Errorf("get event: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	ev, err := loadEvent(ctx, tx, id)
	if err != nil {
		return domain.Event{}, wrap("get event", err)
	}
	return ev, nil
}

// AddParticipant implements store.Store.
func (s *Store) AddParticipant(ctx context.Context, eventID string, p store.NewParticipant, max int) (domain.Event, error) {
	var ev domain.Event
	err := s.write(ctx, func(tx *sql.Tx) error {
		status, err := eventStatus(ctx, tx, eventID)
		if err != nil {
			return err
		}
		if status != domain.StatusOpen {
			return store.ErrClosed
		}

		// The writing transaction holds the write lock, so nobody can take
		// the name or the last place between these checks and the insert.
		// On a database with concurrent writers the unique constraint on
		// (event_id, name_key) is what guarantees it.
		var taken int
		if err := tx.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM participants WHERE event_id = $1 AND name_key = $2`,
			eventID, p.NameKey).Scan(&taken); err != nil {
			return err
		}
		if taken > 0 {
			return store.ErrNameTaken
		}

		var count, lastOrder int
		if err := tx.QueryRowContext(ctx,
			`SELECT COUNT(*), COALESCE(MAX(join_order), 0) FROM participants WHERE event_id = $1`,
			eventID).Scan(&count, &lastOrder); err != nil {
			return err
		}
		if count >= max {
			return store.ErrTooManyParticipants
		}

		if err := insertParticipant(ctx, tx, eventID, p, false, lastOrder+1, s.now().Unix()); err != nil {
			return err
		}
		if err := bumpVersion(ctx, tx, eventID); err != nil {
			return err
		}
		ev, err = loadEvent(ctx, tx, eventID)
		return err
	})
	if err != nil {
		return domain.Event{}, wrap("add participant", err)
	}
	return ev, nil
}

// ParticipantByToken implements store.Store.
func (s *Store) ParticipantByToken(ctx context.Context, eventID, tokenHash string) (string, error) {
	var id string
	err := s.db.QueryRowContext(ctx,
		`SELECT id FROM participants WHERE event_id = $1 AND token_hash = $2`,
		eventID, tokenHash).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", store.ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("participant by token: %w", err)
	}
	return id, nil
}

// IsOrganiserKey implements store.Store.
func (s *Store) IsOrganiserKey(ctx context.Context, eventID, keyHash string) (bool, error) {
	var stored string
	err := s.db.QueryRowContext(ctx,
		`SELECT organiser_key_hash FROM events WHERE id = $1`, eventID).Scan(&stored)
	if errors.Is(err, sql.ErrNoRows) {
		return false, store.ErrNotFound
	}
	if err != nil {
		return false, fmt.Errorf("organiser key: %w", err)
	}
	return subtle.ConstantTimeCompare([]byte(stored), []byte(keyHash)) == 1, nil
}

// ChangeAbsences implements store.Store.
func (s *Store) ChangeAbsences(ctx context.Context, eventID, participantID string, set, clear []domain.Pair) (domain.Event, error) {
	var ev domain.Event
	err := s.write(ctx, func(tx *sql.Tx) error {
		status, err := eventStatus(ctx, tx, eventID)
		if err != nil {
			return err
		}
		if status != domain.StatusOpen {
			return store.ErrClosed
		}
		if _, err := participantIsOrganiser(ctx, tx, eventID, participantID); err != nil {
			return err
		}

		for _, p := range set {
			// The foreign key to candidates refuses a pair that is not a
			// candidate of this event.
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO absences (participant_id, event_id, day, slot) VALUES ($1, $2, $3, $4)
				 ON CONFLICT (participant_id, day, slot) DO NOTHING`,
				participantID, eventID, p.Date, string(p.Slot)); err != nil {
				return fmt.Errorf("set %s %s: %w", p.Date, p.Slot, err)
			}
		}
		for _, p := range clear {
			if _, err := tx.ExecContext(ctx,
				`DELETE FROM absences WHERE participant_id = $1 AND day = $2 AND slot = $3`,
				participantID, p.Date, string(p.Slot)); err != nil {
				return fmt.Errorf("clear %s %s: %w", p.Date, p.Slot, err)
			}
		}
		if err := bumpVersion(ctx, tx, eventID); err != nil {
			return err
		}
		ev, err = loadEvent(ctx, tx, eventID)
		return err
	})
	if err != nil {
		return domain.Event{}, wrap("change absences", err)
	}
	return ev, nil
}

// SetStatus implements store.Store.
func (s *Store) SetStatus(ctx context.Context, eventID, status string) (domain.Event, bool, error) {
	if status != domain.StatusOpen && status != domain.StatusClosed {
		return domain.Event{}, false, fmt.Errorf("set status: unknown status %q", status)
	}
	var (
		ev      domain.Event
		changed bool
	)
	err := s.write(ctx, func(tx *sql.Tx) error {
		current, err := eventStatus(ctx, tx, eventID)
		if err != nil {
			return err
		}
		if current != status {
			var closedAt any // NULL while open
			if status == domain.StatusClosed {
				closedAt = s.now().Unix()
			}
			if _, err := tx.ExecContext(ctx,
				`UPDATE events SET status = $1, closed_at = $2, version = version + 1 WHERE id = $3`,
				status, closedAt, eventID); err != nil {
				return err
			}
			changed = true
		}
		ev, err = loadEvent(ctx, tx, eventID)
		return err
	})
	if err != nil {
		return domain.Event{}, false, wrap("set status", err)
	}
	return ev, changed, nil
}

// RemoveParticipant implements store.Store.
func (s *Store) RemoveParticipant(ctx context.Context, eventID, participantID string) (domain.Event, error) {
	var ev domain.Event
	err := s.write(ctx, func(tx *sql.Tx) error {
		organiser, err := participantIsOrganiser(ctx, tx, eventID, participantID)
		if err != nil {
			return err
		}
		if organiser {
			return store.ErrIsOrganiser
		}
		// The participant's absences go with them (ON DELETE CASCADE).
		if _, err := tx.ExecContext(ctx, `DELETE FROM participants WHERE id = $1`, participantID); err != nil {
			return err
		}
		if err := bumpVersion(ctx, tx, eventID); err != nil {
			return err
		}
		ev, err = loadEvent(ctx, tx, eventID)
		return err
	})
	if err != nil {
		return domain.Event{}, wrap("remove participant", err)
	}
	return ev, nil
}

// DeleteExpired implements store.Store.
func (s *Store) DeleteExpired(ctx context.Context, lastDayBefore string) (int, error) {
	var deleted int64
	err := s.write(ctx, func(tx *sql.Tx) error {
		// Candidates, participants and absences go with their event (ON
		// DELETE CASCADE).
		res, err := tx.ExecContext(ctx, `DELETE FROM events WHERE last_day < $1`, lastDayBefore)
		if err != nil {
			return err
		}
		deleted, err = res.RowsAffected()
		return err
	})
	if err != nil {
		return 0, fmt.Errorf("delete expired: %w", err)
	}
	return int(deleted), nil
}

// wrap adds what was being done to a database failure and leaves the
// errors callers tell apart as they are.
func wrap(doing string, err error) error {
	for _, known := range []error{
		store.ErrNotFound, store.ErrNameTaken, store.ErrClosed,
		store.ErrTooManyParticipants, store.ErrIsOrganiser,
	} {
		if errors.Is(err, known) {
			return err
		}
	}
	return fmt.Errorf("%s: %w", doing, err)
}

func insertParticipant(ctx context.Context, q querier, eventID string, p store.NewParticipant, organiser bool, joinOrder int, now int64) error {
	_, err := q.ExecContext(ctx,
		`INSERT INTO participants (id, event_id, name, name_key, token_hash, organiser, join_order, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		p.ID, eventID, p.Name, p.NameKey, p.TokenHash, organiser, joinOrder, now)
	return err
}

func bumpVersion(ctx context.Context, q querier, eventID string) error {
	_, err := q.ExecContext(ctx, `UPDATE events SET version = version + 1 WHERE id = $1`, eventID)
	return err
}

// eventStatus returns the status of an event, or store.ErrNotFound.
func eventStatus(ctx context.Context, q querier, eventID string) (string, error) {
	var status string
	err := q.QueryRowContext(ctx, `SELECT status FROM events WHERE id = $1`, eventID).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		return "", store.ErrNotFound
	}
	return status, err
}

// participantIsOrganiser reports whether a participant of the event is its
// organiser. A participant that is not in the event (which covers an event
// that does not exist) is store.ErrNotFound.
func participantIsOrganiser(ctx context.Context, q querier, eventID, participantID string) (bool, error) {
	var organiser bool
	err := q.QueryRowContext(ctx,
		`SELECT organiser FROM participants WHERE id = $1 AND event_id = $2`,
		participantID, eventID).Scan(&organiser)
	if errors.Is(err, sql.ErrNoRows) {
		return false, store.ErrNotFound
	}
	return organiser, err
}

// loadEvent reads an event with its days, participants and absences.
func loadEvent(ctx context.Context, q querier, id string) (domain.Event, error) {
	ev := domain.Event{ID: id}
	var (
		createdAt int64
		closedAt  sql.NullInt64
	)
	err := q.QueryRowContext(ctx,
		`SELECT title, status, version, created_at, closed_at FROM events WHERE id = $1`, id).
		Scan(&ev.Title, &ev.Status, &ev.Version, &createdAt, &closedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Event{}, store.ErrNotFound
	}
	if err != nil {
		return domain.Event{}, err
	}
	ev.CreatedAt = time.Unix(createdAt, 0).UTC()
	if closedAt.Valid {
		t := time.Unix(closedAt.Int64, 0).UTC()
		ev.ClosedAt = &t
	}

	// Days by date. Slots are put in canonical order here: as text they
	// would sort alphabetically.
	pairs, err := queryPairs(ctx, q, `SELECT day, slot FROM candidates WHERE event_id = $1 ORDER BY day`, id)
	if err != nil {
		return domain.Event{}, err
	}
	for _, p := range pairs {
		if n := len(ev.Days); n == 0 || ev.Days[n-1].Date != p.Date {
			ev.Days = append(ev.Days, domain.Day{Date: p.Date})
		}
		day := &ev.Days[len(ev.Days)-1]
		day.Slots = append(day.Slots, p.Slot)
	}
	for _, d := range ev.Days {
		sort.Slice(d.Slots, func(i, j int) bool { return domain.SlotIndex(d.Slots[i]) < domain.SlotIndex(d.Slots[j]) })
	}

	rows, err := q.QueryContext(ctx,
		`SELECT id, name, organiser FROM participants WHERE event_id = $1 ORDER BY join_order`, id)
	if err != nil {
		return domain.Event{}, err
	}
	defer rows.Close()
	index := make(map[string]int)
	for rows.Next() {
		p := domain.Participant{Absences: []domain.Pair{}}
		if err := rows.Scan(&p.ID, &p.Name, &p.Organiser); err != nil {
			return domain.Event{}, err
		}
		index[p.ID] = len(ev.Participants)
		ev.Participants = append(ev.Participants, p)
	}
	if err := rows.Err(); err != nil {
		return domain.Event{}, err
	}

	absences, err := q.QueryContext(ctx,
		`SELECT participant_id, day, slot FROM absences WHERE event_id = $1 ORDER BY day`, id)
	if err != nil {
		return domain.Event{}, err
	}
	defer absences.Close()
	for absences.Next() {
		var participantID, day, slot string
		if err := absences.Scan(&participantID, &day, &slot); err != nil {
			return domain.Event{}, err
		}
		i, ok := index[participantID]
		if !ok {
			continue
		}
		ev.Participants[i].Absences = append(ev.Participants[i].Absences, domain.Pair{Date: day, Slot: domain.Slot(slot)})
	}
	if err := absences.Err(); err != nil {
		return domain.Event{}, err
	}
	for _, p := range ev.Participants {
		a := p.Absences
		sort.SliceStable(a, func(i, j int) bool {
			if a[i].Date != a[j].Date {
				return a[i].Date < a[j].Date
			}
			return domain.SlotIndex(a[i].Slot) < domain.SlotIndex(a[j].Slot)
		})
	}
	return ev, nil
}

func queryPairs(ctx context.Context, q querier, query, eventID string) ([]domain.Pair, error) {
	rows, err := q.QueryContext(ctx, query, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Pair
	for rows.Next() {
		var day, slot string
		if err := rows.Scan(&day, &slot); err != nil {
			return nil, err
		}
		out = append(out, domain.Pair{Date: day, Slot: domain.Slot(slot)})
	}
	return out, rows.Err()
}
