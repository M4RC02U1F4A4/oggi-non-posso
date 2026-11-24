package cleanup

import (
	"context"
	"errors"
	"log/slog"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/domain"
	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/store"
	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/store/sqlite"
)

var quiet = slog.New(slog.DiscardHandler)

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *clock) set(t time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = t
}

func open(t *testing.T) *sqlite.Store {
	t.Helper()
	s, err := sqlite.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

// create stores an event whose last candidate day is lastDay.
func create(t *testing.T, s store.Store, id, lastDay string) {
	t.Helper()
	_, err := s.CreateEvent(context.Background(), store.NewEvent{
		ID: id, Title: "Cena di dicembre", OrganiserKeyHash: "hash-of-key-" + id,
		Days: []domain.Day{
			{Date: "2026-12-01", Slots: []domain.Slot{domain.Dinner}},
			{Date: lastDay, Slots: []domain.Slot{domain.Dinner}},
		},
		Organiser: store.NewParticipant{ID: "giulia-" + id, Name: "Giulia", NameKey: "giulia", TokenHash: "hash-of-giulia-" + id},
	})
	if err != nil {
		t.Fatalf("CreateEvent: %v", err)
	}
}

func exists(t *testing.T, s store.Store, id string) bool {
	t.Helper()
	_, err := s.GetEvent(context.Background(), id)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("GetEvent: %v", err)
	}
	return err == nil
}

// eventually waits for cond, which the job makes true from its goroutine.
func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("never happened: %s", what)
		}
		time.Sleep(2 * time.Millisecond)
	}
}

func TestRunDeletesOnlyExpired(t *testing.T) {
	s := open(t)
	create(t, s, "event0000001", "2026-12-20") // 31 days before 2027-01-20
	create(t, s, "event0000002", "2026-12-21") // 30 days before: not yet
	create(t, s, "event0000003", "2027-02-14")

	// Half past midnight UTC: the day that counts is the UTC one.
	c := &clock{t: time.Date(2027, 1, 20, 0, 30, 0, 0, time.UTC)}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		Run(ctx, s, 30, 5*time.Millisecond, c.now, quiet)
	}()

	// At start.
	eventually(t, "the expired event is deleted", func() bool { return !exists(t, s, "event0000001") })
	if !exists(t, s, "event0000002") || !exists(t, s, "event0000003") {
		t.Fatal("an event that has not expired was deleted")
	}

	// And again later: one day on, the second event has expired too.
	c.set(time.Date(2027, 1, 21, 9, 0, 0, 0, time.UTC))
	eventually(t, "the second event is deleted a day later", func() bool { return !exists(t, s, "event0000002") })
	if !exists(t, s, "event0000003") {
		t.Fatal("an event that has not expired was deleted")
	}

	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not return when its context ended")
	}
}

func TestRunWithZeroRetentionDoesNothing(t *testing.T) {
	s := open(t)
	create(t, s, "event0000001", "2026-12-20")

	c := &clock{t: time.Date(2030, 1, 1, 12, 0, 0, 0, time.UTC)}
	done := make(chan struct{})
	go func() {
		defer close(done)
		Run(context.Background(), s, 0, time.Millisecond, c.now, quiet)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Run with retention 0 did not return")
	}
	if !exists(t, s, "event0000001") {
		t.Fatal("retention 0 deleted an event")
	}
}

func TestCutoffUsesTheUTCDay(t *testing.T) {
	// 23:30 on the 19th in UTC is already the 20th further east: the
	// cutoff must not move with the zone of the clock.
	east := time.FixedZone("east", 14*60*60)
	now := time.Date(2027, 1, 19, 23, 30, 0, 0, time.UTC).In(east)
	if got := cutoff(now, 30); got != "2026-12-20" {
		t.Fatalf("cutoff = %s, want 2026-12-20", got)
	}
	if got := cutoff(time.Date(2027, 3, 1, 0, 0, 0, 0, time.UTC), 1); got != "2027-02-28" {
		t.Fatalf("cutoff = %s, want 2027-02-28", got)
	}
}
