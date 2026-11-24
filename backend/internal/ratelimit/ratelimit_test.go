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
