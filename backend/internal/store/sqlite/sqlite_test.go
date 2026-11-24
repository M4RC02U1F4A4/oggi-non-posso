package sqlite

import (
	"context"
	"errors"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/domain"
	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/store"
)

var ctx = context.Background()

func open(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

// newEvent is "Cena di dicembre" organised by Giulia: Friday without
// morning and lunch, Saturday whole.
func newEvent(id string) store.NewEvent {
	return store.NewEvent{
		ID:               id,
		Title:            "Cena di dicembre",
		OrganiserKeyHash: "hash-of-key-" + id,
		Days: []domain.Day{
			{Date: "2026-12-11", Slots: []domain.Slot{domain.Afternoon, domain.Dinner, domain.AfterDinner}},
			{Date: "2026-12-12", Slots: []domain.Slot{domain.Morning, domain.Lunch, domain.Afternoon, domain.Dinner, domain.AfterDinner}},
		},
		Organiser: store.NewParticipant{ID: "giulia-" + id, Name: "Giulia", NameKey: "giulia", TokenHash: "hash-of-giulia-" + id},
	}
}

func participant(name, key, eventID string) store.NewParticipant {
	return store.NewParticipant{ID: key + "-" + eventID, Name: name, NameKey: key, TokenHash: "hash-of-" + key + "-" + eventID}
}

func mustCreate(t *testing.T, s *Store, id string) domain.Event {
	t.Helper()
	ev, err := s.CreateEvent(ctx, newEvent(id))
	if err != nil {
		t.Fatalf("CreateEvent: %v", err)
	}
	return ev
}

func mustJoin(t *testing.T, s *Store, eventID, name, key string) domain.Event {
	t.Helper()
	ev, err := s.AddParticipant(ctx, eventID, participant(name, key, eventID), 50)
	if err != nil {
		t.Fatalf("AddParticipant(%s): %v", name, err)
	}
	return ev
}

func count(t *testing.T, s *Store, table, eventID string) int {
	t.Helper()
	var n int
	if err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table+" WHERE event_id = $1", eventID).Scan(&n); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return n
}

func wantErr(t *testing.T, err, want error) {
	t.Helper()
	if !errors.Is(err, want) {
		t.Fatalf("error = %v, want %v", err, want)
	}
}

func TestCreateAndGetEvent(t *testing.T) {
	s := open(t)
	created := time.Date(2026, 11, 24, 13, 5, 0, 0, time.UTC)
	s.now = func() time.Time { return created }

	in := newEvent("event0000001")
	// The store keeps days by date whatever order they arrive in.
	in.Days[0], in.Days[1] = in.Days[1], in.Days[0]
	got, err := s.CreateEvent(ctx, in)
	if err != nil {
		t.Fatalf("CreateEvent: %v", err)
	}

	want := domain.Event{
		ID:      "event0000001",
		Title:   "Cena di dicembre",
		Status:  domain.StatusOpen,
		Version: 1,
		Days: []domain.Day{
			{Date: "2026-12-11", Slots: []domain.Slot{domain.Afternoon, domain.Dinner, domain.AfterDinner}},
			{Date: "2026-12-12", Slots: []domain.Slot{domain.Morning, domain.Lunch, domain.Afternoon, domain.Dinner, domain.AfterDinner}},
		},
		Participants: []domain.Participant{
			{ID: "giulia-event0000001", Name: "Giulia", Organiser: true, Absences: []domain.Pair{}},
		},
		CreatedAt: created,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("created:\n got %+v\nwant %+v", got, want)
	}

	read, err := s.GetEvent(ctx, "event0000001")
	if err != nil {
		t.Fatalf("GetEvent: %v", err)
	}
	if !reflect.DeepEqual(read, want) {
		t.Fatalf("read:\n got %+v\nwant %+v", read, want)
	}

	_, err = s.GetEvent(ctx, "nosuchevent0")
	wantErr(t, err, store.ErrNotFound)
}

func TestAddParticipant(t *testing.T) {
	s := open(t)
	mustCreate(t, s, "event0000001")

	ev := mustJoin(t, s, "event0000001", "Luca", "luca")
	if ev.Version != 2 {
		t.Fatalf("version = %d, want 2", ev.Version)
	}
	// Several joins inside one second keep the joining order.
	mustJoin(t, s, "event0000001", "Anna", "anna")
	mustJoin(t, s, "event0000001", "Marta", "marta")
	ev = mustJoin(t, s, "event0000001", "Paolo", "paolo")

	var names []string
	for _, p := range ev.Participants {
		names = append(names, p.Name)
	}
	if want := []string{"Giulia", "Luca", "Anna", "Marta", "Paolo"}; !reflect.DeepEqual(names, want) {
		t.Fatalf("participants = %v, want %v", names, want)
	}
	if ev.Participants[1].Organiser || !ev.Participants[0].Organiser {
		t.Fatalf("organiser flags are wrong: %+v", ev.Participants)
	}

	t.Run("name taken", func(t *testing.T) {
		again := store.NewParticipant{ID: "other", Name: "LUCA", NameKey: "luca", TokenHash: "hash-of-other"}
		_, err := s.AddParticipant(ctx, "event0000001", again, 50)
		wantErr(t, err, store.ErrNameTaken)
	})
	t.Run("the same name in another event is free", func(t *testing.T) {
		mustCreate(t, s, "event0000002")
		mustJoin(t, s, "event0000002", "Luca", "luca")
	})
	t.Run("too many participants", func(t *testing.T) {
		_, err := s.AddParticipant(ctx, "event0000001", participant("Sara", "sara", "event0000001"), 5)
		wantErr(t, err, store.ErrTooManyParticipants)
	})
	t.Run("unknown event", func(t *testing.T) {
		_, err := s.AddParticipant(ctx, "nosuchevent0", participant("Sara", "sara", "nosuchevent0"), 50)
		wantErr(t, err, store.ErrNotFound)
	})
	t.Run("closed", func(t *testing.T) {
		if _, _, err := s.SetStatus(ctx, "event0000001", domain.StatusClosed); err != nil {
			t.Fatalf("SetStatus: %v", err)
		}
		_, err := s.AddParticipant(ctx, "event0000001", participant("Sara", "sara", "event0000001"), 50)
		wantErr(t, err, store.ErrClosed)
	})

	after, err := s.GetEvent(ctx, "event0000001")
	if err != nil {
		t.Fatalf("GetEvent: %v", err)
	}
	if len(after.Participants) != 5 {
		t.Fatalf("refused joins left %d participants, want 5", len(after.Participants))
	}
}

func TestParticipantByToken(t *testing.T) {
	s := open(t)
	mustCreate(t, s, "event0000001")
	mustCreate(t, s, "event0000002")
	mustJoin(t, s, "event0000001", "Luca", "luca")

	id, err := s.ParticipantByToken(ctx, "event0000001", "hash-of-luca-event0000001")
	if err != nil || id != "luca-event0000001" {
		t.Fatalf("ParticipantByToken = %q, %v", id, err)
	}
	_, err = s.ParticipantByToken(ctx, "event0000002", "hash-of-luca-event0000001")
	wantErr(t, err, store.ErrNotFound)
	_, err = s.ParticipantByToken(ctx, "event0000001", "hash-of-nobody")
	wantErr(t, err, store.ErrNotFound)
	_, err = s.ParticipantByToken(ctx, "nosuchevent0", "hash-of-luca-event0000001")
	wantErr(t, err, store.ErrNotFound)
}

func TestIsOrganiserKey(t *testing.T) {
	s := open(t)
	mustCreate(t, s, "event0000001")
	mustCreate(t, s, "event0000002")

	ok, err := s.IsOrganiserKey(ctx, "event0000001", "hash-of-key-event0000001")
	if err != nil || !ok {
		t.Fatalf("own key: %v, %v", ok, err)
	}
	ok, err = s.IsOrganiserKey(ctx, "event0000001", "hash-of-key-event0000002")
	if err != nil || ok {
		t.Fatalf("key of another event: %v, %v", ok, err)
	}
	// A participant token is not an organiser key.
	ok, err = s.IsOrganiserKey(ctx, "event0000001", "hash-of-giulia-event0000001")
	if err != nil || ok {
		t.Fatalf("participant token: %v, %v", ok, err)
	}
	_, err = s.IsOrganiserKey(ctx, "nosuchevent0", "hash-of-key-event0000001")
	wantErr(t, err, store.ErrNotFound)
}

func TestChangeAbsences(t *testing.T) {
	s := open(t)
	mustCreate(t, s, "event0000001")
	mustCreate(t, s, "event0000002")
	mustJoin(t, s, "event0000001", "Luca", "luca")
	const luca = "luca-event0000001"

	absencesOf := func(ev domain.Event, id string) []domain.Pair {
		for _, p := range ev.Participants {
			if p.ID == id {
				return p.Absences
			}
		}
		t.Fatalf("participant %s is not in the event", id)
		return nil
	}

	set := []domain.Pair{
		{Date: "2026-12-12", Slot: domain.Dinner},
		{Date: "2026-12-12", Slot: domain.Morning},
		{Date: "2026-12-11", Slot: domain.AfterDinner},
		{Date: "2026-12-11", Slot: domain.Afternoon},
	}
	ev, err := s.ChangeAbsences(ctx, "event0000001", luca, set, nil)
	if err != nil {
		t.Fatalf("ChangeAbsences: %v", err)
	}
	if ev.Version != 3 {
		t.Fatalf("version = %d, want 3", ev.Version)
	}
	sorted := []domain.Pair{
		{Date: "2026-12-11", Slot: domain.Afternoon},
		{Date: "2026-12-11", Slot: domain.AfterDinner},
		{Date: "2026-12-12", Slot: domain.Morning},
		{Date: "2026-12-12", Slot: domain.Dinner},
	}
	if got := absencesOf(ev, luca); !reflect.DeepEqual(got, sorted) {
		t.Fatalf("absences = %v, want %v", got, sorted)
	}
	if got := absencesOf(ev, "giulia-event0000001"); len(got) != 0 {
		t.Fatalf("the organiser got absences: %v", got)
	}

	t.Run("setting what is set changes nothing", func(t *testing.T) {
		ev, err := s.ChangeAbsences(ctx, "event0000001", luca, set[:2], nil)
		if err != nil {
			t.Fatalf("ChangeAbsences: %v", err)
		}
		if got := absencesOf(ev, luca); !reflect.DeepEqual(got, sorted) {
			t.Fatalf("absences = %v, want %v", got, sorted)
		}
	})
	t.Run("clear, and clearing what is clear", func(t *testing.T) {
		clear := []domain.Pair{
			{Date: "2026-12-11", Slot: domain.Afternoon},
			{Date: "2026-12-11", Slot: domain.Dinner}, // never set
		}
		for range 2 {
			ev, err := s.ChangeAbsences(ctx, "event0000001", luca, nil, clear)
			if err != nil {
				t.Fatalf("ChangeAbsences: %v", err)
			}
			if got := absencesOf(ev, luca); !reflect.DeepEqual(got, sorted[1:]) {
				t.Fatalf("absences = %v, want %v", got, sorted[1:])
			}
		}
	})
	t.Run("set and clear in one change", func(t *testing.T) {
		ev, err := s.ChangeAbsences(ctx, "event0000001", luca,
			[]domain.Pair{{Date: "2026-12-12", Slot: domain.Lunch}},
			[]domain.Pair{{Date: "2026-12-12", Slot: domain.Morning}})
		if err != nil {
			t.Fatalf("ChangeAbsences: %v", err)
		}
		want := []domain.Pair{
			{Date: "2026-12-11", Slot: domain.AfterDinner},
			{Date: "2026-12-12", Slot: domain.Lunch},
			{Date: "2026-12-12", Slot: domain.Dinner},
		}
		if got := absencesOf(ev, luca); !reflect.DeepEqual(got, want) {
			t.Fatalf("absences = %v, want %v", got, want)
		}
	})
	t.Run("a pair that is not a candidate is refused and changes nothing", func(t *testing.T) {
		before, _ := s.GetEvent(ctx, "event0000001")
		_, err := s.ChangeAbsences(ctx, "event0000001", luca, []domain.Pair{
			{Date: "2026-12-12", Slot: domain.Afternoon},
			{Date: "2026-12-11", Slot: domain.Morning}, // Friday has no morning
		}, nil)
		if err == nil {
			t.Fatal("no error for a pair that is not a candidate")
		}
		after, _ := s.GetEvent(ctx, "event0000001")
		if !reflect.DeepEqual(before, after) {
			t.Fatalf("a refused change left a trace:\n before %+v\n after  %+v", before, after)
		}
	})
	t.Run("unknown event", func(t *testing.T) {
		_, err := s.ChangeAbsences(ctx, "nosuchevent0", luca, set, nil)
		wantErr(t, err, store.ErrNotFound)
	})
	t.Run("unknown participant", func(t *testing.T) {
		_, err := s.ChangeAbsences(ctx, "event0000001", "nobody", set, nil)
		wantErr(t, err, store.ErrNotFound)
	})
	t.Run("participant of another event", func(t *testing.T) {
		_, err := s.ChangeAbsences(ctx, "event0000002", luca, set, nil)
		wantErr(t, err, store.ErrNotFound)
	})
	t.Run("closed", func(t *testing.T) {
		if _, _, err := s.SetStatus(ctx, "event0000001", domain.StatusClosed); err != nil {
			t.Fatalf("SetStatus: %v", err)
		}
		_, err := s.ChangeAbsences(ctx, "event0000001", luca, set, nil)
		wantErr(t, err, store.ErrClosed)
	})
}

func TestSetStatus(t *testing.T) {
	s := open(t)
	closedAt := time.Date(2026, 12, 1, 9, 30, 0, 0, time.UTC)
	s.now = func() time.Time { return closedAt }
	mustCreate(t, s, "event0000001")

	ev, changed, err := s.SetStatus(ctx, "event0000001", domain.StatusClosed)
	if err != nil || !changed {
		t.Fatalf("close: changed %v, %v", changed, err)
	}
	if ev.Status != domain.StatusClosed || ev.Version != 2 || ev.ClosedAt == nil || !ev.ClosedAt.Equal(closedAt) {
		t.Fatalf("closed event: %+v", ev)
	}

	ev, changed, err = s.SetStatus(ctx, "event0000001", domain.StatusClosed)
	if err != nil || changed {
		t.Fatalf("close twice: changed %v, %v", changed, err)
	}
	if ev.Status != domain.StatusClosed || ev.Version != 2 {
		t.Fatalf("closing twice changed the event: %+v", ev)
	}

	ev, changed, err = s.SetStatus(ctx, "event0000001", domain.StatusOpen)
	if err != nil || !changed {
		t.Fatalf("reopen: changed %v, %v", changed, err)
	}
	if ev.Status != domain.StatusOpen || ev.Version != 3 || ev.ClosedAt != nil {
		t.Fatalf("reopened event: %+v", ev)
	}

	ev, changed, err = s.SetStatus(ctx, "event0000001", domain.StatusOpen)
	if err != nil || changed || ev.Version != 3 {
		t.Fatalf("reopen twice: changed %v, version %d, %v", changed, ev.Version, err)
	}

	_, _, err = s.SetStatus(ctx, "nosuchevent0", domain.StatusClosed)
	wantErr(t, err, store.ErrNotFound)

	if _, _, err = s.SetStatus(ctx, "event0000001", "paused"); err == nil {
		t.Fatal("an unknown status was accepted")
	}
}

func TestRemoveParticipant(t *testing.T) {
	s := open(t)
	mustCreate(t, s, "event0000001")
	mustCreate(t, s, "event0000002")
	mustJoin(t, s, "event0000001", "Luca", "luca")
	mustJoin(t, s, "event0000001", "Anna", "anna")
	const luca, anna = "luca-event0000001", "anna-event0000001"

	for _, id := range []string{luca, anna} {
		if _, err := s.ChangeAbsences(ctx, "event0000001", id, []domain.Pair{
			{Date: "2026-12-11", Slot: domain.Dinner},
			{Date: "2026-12-12", Slot: domain.Lunch},
		}, nil); err != nil {
			t.Fatalf("ChangeAbsences: %v", err)
		}
	}
	if got := count(t, s, "absences", "event0000001"); got != 4 {
		t.Fatalf("absences before = %d, want 4", got)
	}

	ev, err := s.RemoveParticipant(ctx, "event0000001", luca)
	if err != nil {
		t.Fatalf("RemoveParticipant: %v", err)
	}
	if ev.Version != 6 {
		t.Fatalf("version = %d, want 6", ev.Version)
	}
	if len(ev.Participants) != 2 || ev.Participants[0].Name != "Giulia" || ev.Participants[1].Name != "Anna" {
		t.Fatalf("participants after removal: %+v", ev.Participants)
	}
	if got := count(t, s, "absences", "event0000001"); got != 2 {
		t.Fatalf("absences after = %d, want 2 (Anna's)", got)
	}
	_, err = s.ParticipantByToken(ctx, "event0000001", "hash-of-luca-event0000001")
	wantErr(t, err, store.ErrNotFound)

	t.Run("the name is free again and joins last", func(t *testing.T) {
		p := store.NewParticipant{ID: "luca-again", Name: "Luca", NameKey: "luca", TokenHash: "hash-of-luca-again"}
		ev, err := s.AddParticipant(ctx, "event0000001", p, 50)
		if err != nil {
			t.Fatalf("AddParticipant: %v", err)
		}
		if last := ev.Participants[len(ev.Participants)-1]; last.ID != "luca-again" || len(last.Absences) != 0 {
			t.Fatalf("last participant: %+v", last)
		}
	})
	t.Run("organiser", func(t *testing.T) {
		_, err := s.RemoveParticipant(ctx, "event0000001", "giulia-event0000001")
		wantErr(t, err, store.ErrIsOrganiser)
	})
	t.Run("unknown participant", func(t *testing.T) {
		_, err := s.RemoveParticipant(ctx, "event0000001", "nobody")
		wantErr(t, err, store.ErrNotFound)
	})
	t.Run("unknown event", func(t *testing.T) {
		_, err := s.RemoveParticipant(ctx, "nosuchevent0", anna)
		wantErr(t, err, store.ErrNotFound)
	})
	t.Run("participant of another event", func(t *testing.T) {
		_, err := s.RemoveParticipant(ctx, "event0000002", anna)
		wantErr(t, err, store.ErrNotFound)
	})
}

func TestDeleteExpired(t *testing.T) {
	s := open(t)

	old := newEvent("event0000001")
	old.Days = []domain.Day{
		{Date: "2026-12-19", Slots: []domain.Slot{domain.Dinner}},
		{Date: "2026-12-20", Slots: []domain.Slot{domain.Lunch, domain.Dinner}},
	}
	kept := newEvent("event0000002")
	kept.Days = []domain.Day{
		{Date: "2026-12-01", Slots: []domain.Slot{domain.Dinner}},
		{Date: "2026-12-21", Slots: []domain.Slot{domain.Dinner}},
	}
	for _, e := range []store.NewEvent{old, kept} {
		if _, err := s.CreateEvent(ctx, e); err != nil {
			t.Fatalf("CreateEvent: %v", err)
		}
		mustJoin(t, s, e.ID, "Luca", "luca")
		if _, err := s.ChangeAbsences(ctx, e.ID, "luca-"+e.ID, []domain.Pair{{Date: e.Days[0].Date, Slot: domain.Dinner}}, nil); err != nil {
			t.Fatalf("ChangeAbsences: %v", err)
		}
	}

	n, err := s.DeleteExpired(ctx, "2026-12-21")
	if err != nil || n != 1 {
		t.Fatalf("DeleteExpired = %d, %v, want 1", n, err)
	}
	_, err = s.GetEvent(ctx, "event0000001")
	wantErr(t, err, store.ErrNotFound)
	for _, table := range []string{"candidates", "participants", "absences"} {
		if got := count(t, s, table, "event0000001"); got != 0 {
			t.Errorf("%d rows of the deleted event left in %s", got, table)
		}
		if got := count(t, s, table, "event0000002"); got == 0 {
			t.Errorf("the rows of the kept event are gone from %s", table)
		}
	}
	if _, err := s.GetEvent(ctx, "event0000002"); err != nil {
		t.Fatalf("the event whose last day is 2026-12-21 is gone: %v", err)
	}

	n, err = s.DeleteExpired(ctx, "2026-12-21")
	if err != nil || n != 0 {
		t.Fatalf("second DeleteExpired = %d, %v, want 0", n, err)
	}
}

func TestReopenKeepsData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	first, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	want := mustCreate(t, first, "event0000001")
	if err := first.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	second, err := Open(path)
	if err != nil {
		t.Fatalf("second Open: %v", err)
	}
	defer second.Close()

	got, err := second.GetEvent(ctx, "event0000001")
	if err != nil {
		t.Fatalf("GetEvent after reopening: %v", err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("after reopening:\n got %+v\nwant %+v", got, want)
	}

	files, err := migrations()
	if err != nil {
		t.Fatalf("migrations: %v", err)
	}
	var applied int
	if err := second.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM schema_migrations").Scan(&applied); err != nil {
		t.Fatalf("count schema_migrations: %v", err)
	}
	if applied != len(files) || applied == 0 {
		t.Fatalf("schema_migrations has %d rows, want %d", applied, len(files))
	}
	n, err := migrate(ctx, second.db)
	if err != nil || n != 0 {
		t.Fatalf("migrate on an up-to-date database applied %d, %v", n, err)
	}
}

func TestForeignKeysOnEveryConnection(t *testing.T) {
	s := open(t)
	// Hold several connections at once so the pool has to open new ones.
	for range 4 {
		conn, err := s.db.Conn(ctx)
		if err != nil {
			t.Fatalf("Conn: %v", err)
		}
		defer conn.Close()
		var on int
		// SQLite-only: reads the per-connection setting.
		if err := conn.QueryRowContext(ctx, "PRAGMA foreign_keys").Scan(&on); err != nil {
			t.Fatalf("PRAGMA foreign_keys: %v", err)
		}
		if on != 1 {
			t.Fatal("a connection has foreign keys off")
		}
	}
}
