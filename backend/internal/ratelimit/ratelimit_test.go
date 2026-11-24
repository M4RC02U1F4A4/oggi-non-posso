package ratelimit

import (
	"sync"
	"testing"
	"time"
)

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *clock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

func newClock() *clock {
	return &clock{t: time.Date(2026, 11, 24, 13, 5, 0, 0, time.UTC)}
}

func TestAllowWithinTheWindow(t *testing.T) {
	c := newClock()
	l := New(3, time.Hour, c.now)

	for i := range 3 {
		if ok, retry := l.Allow("a"); !ok || retry != 0 {
			t.Fatalf("request %d: ok %v, retry %v", i+1, ok, retry)
		}
		c.advance(time.Minute)
	}
	// Three minutes into a window that began with the first request.
	if ok, retry := l.Allow("a"); ok || retry != 57*time.Minute {
		t.Fatalf("fourth request: ok %v, retry %v, want refused for 57m", ok, retry)
	}
	c.advance(56 * time.Minute)
	if ok, retry := l.Allow("a"); ok || retry != time.Minute {
		t.Fatalf("at 59m: ok %v, retry %v, want refused for 1m", ok, retry)
	}

	// Another key has its own window.
	if ok, _ := l.Allow("b"); !ok {
		t.Fatal("another key was refused")
	}
}

func TestAllowAfterTheWindow(t *testing.T) {
	c := newClock()
	l := New(2, time.Hour, c.now)
	l.Allow("a")
	l.Allow("a")
	if ok, _ := l.Allow("a"); ok {
		t.Fatal("third request allowed")
	}

	c.advance(time.Hour)
	for i := range 2 {
		if ok, _ := l.Allow("a"); !ok {
			t.Fatalf("request %d of the new window refused", i+1)
		}
	}
	if ok, retry := l.Allow("a"); ok || retry != time.Hour {
		t.Fatalf("third request of the new window: ok %v, retry %v", ok, retry)
	}
}

func TestRefusedRequestsDoNotExtendTheWindow(t *testing.T) {
	c := newClock()
	l := New(1, time.Hour, c.now)
	l.Allow("a")
	for range 10 {
		c.advance(5 * time.Minute)
		l.Allow("a")
	}
	c.advance(10 * time.Minute) // one hour after the first request
	if ok, _ := l.Allow("a"); !ok {
		t.Fatal("still refused one window after the first request")
	}
}

func TestOldKeysAreForgotten(t *testing.T) {
	c := newClock()
	l := New(1, time.Hour, c.now)
	for _, key := range []string{"a", "b", "c"} {
		l.Allow(key)
	}
	c.advance(2 * time.Hour)
	l.Allow("d")
	if got := len(l.windows); got != 1 {
		t.Fatalf("%d keys kept, want only the live one", got)
	}
}

func TestConcurrentAllow(t *testing.T) {
	l := New(100, time.Hour, nil)
	var (
		wg      sync.WaitGroup
		mu      sync.Mutex
		allowed int
	)
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range 50 {
				if ok, _ := l.Allow("a"); ok {
					mu.Lock()
					allowed++
					mu.Unlock()
				}
			}
		}()
	}
	wg.Wait()
	if allowed != 100 {
		t.Fatalf("%d requests allowed, want 100", allowed)
	}
}

func TestTheNumberOfKeysIsCapped(t *testing.T) {
	c := newClock()
	l := New(2, time.Hour, c.now)
	l.maxKeys = 3

	// Three keys, ten minutes apart, fill the limiter.
	for _, key := range []string{"a", "b", "c"} {
		if ok, _ := l.Allow(key); !ok {
			t.Fatalf("key %s refused", key)
		}
		c.advance(10 * time.Minute)
	}

	// A fourth key is refused, not let through, until the oldest window
	// ends: 30 minutes into the hour of "a".
	if ok, retry := l.Allow("d"); ok || retry != 30*time.Minute {
		t.Fatalf("key over the cap: ok %v, retry %v, want refused for 30m", ok, retry)
	}
	if got := len(l.windows); got != 3 {
		t.Fatalf("%d keys kept, want 3", got)
	}
	// The keys that are in keep their own budget.
	if ok, _ := l.Allow("b"); !ok {
		t.Fatal("a key that is in was refused because the limiter is full")
	}
	if ok, _ := l.Allow("b"); ok {
		t.Fatal("a key that is in went over its own limit")
	}
	c.advance(29 * time.Minute)
	if ok, retry := l.Allow("e"); ok || retry != time.Minute {
		t.Fatalf("one minute before a window ends: ok %v, retry %v", ok, retry)
	}

	// The window of "a" ends: there is room for one new key, not for two.
	c.advance(time.Minute)
	if ok, _ := l.Allow("d"); !ok {
		t.Fatal("refused after a window expired")
	}
	if ok, retry := l.Allow("e"); ok || retry != 10*time.Minute {
		t.Fatalf("second new key: ok %v, retry %v, want refused for 10m (the window of b)", ok, retry)
	}
	if got := len(l.windows); got != 3 {
		t.Fatalf("%d keys kept, want 3", got)
	}

	// Once every window has expired the limiter is empty again.
	c.advance(2 * time.Hour)
	for _, key := range []string{"e", "f", "g"} {
		if ok, _ := l.Allow(key); !ok {
			t.Fatalf("key %s refused after every window expired", key)
		}
	}
	if ok, _ := l.Allow("h"); ok {
		t.Fatal("a fourth key was accepted")
	}
}

func TestAKeyWhoseWindowEndedTakesItsPlaceAgain(t *testing.T) {
	c := newClock()
	l := New(1, time.Hour, c.now)
	l.maxKeys = 2
	l.Allow("a")
	c.advance(30 * time.Minute)
	l.Allow("b")
	c.advance(30 * time.Minute)

	// "a" is over; it comes back and the limiter is full again.
	if ok, _ := l.Allow("a"); !ok {
		t.Fatal("a key whose window ended was refused")
	}
	if ok, retry := l.Allow("c"); ok || retry != 30*time.Minute {
		t.Fatalf("new key: ok %v, retry %v, want refused for 30m (the window of b)", ok, retry)
	}
}

func TestDefaultCap(t *testing.T) {
	if l := New(1, time.Hour, nil); l.maxKeys != MaxKeys || MaxKeys != 100_000 {
		t.Fatalf("maxKeys = %d, MaxKeys = %d", l.maxKeys, MaxKeys)
	}
}
