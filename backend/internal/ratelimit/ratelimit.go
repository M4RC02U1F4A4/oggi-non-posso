// Package ratelimit counts requests per key in fixed windows.
package ratelimit

import (
	"sync"
	"time"
)

// Limiter allows a number of requests per key in each window. The window
// of a key begins with its first request and is not moved by the requests
// that follow, refused ones included.
type Limiter struct {
	limit  int
	window time.Duration
	now    func() time.Time

	mu      sync.Mutex
	windows map[string]*window
	sweepAt time.Time // when to drop the windows that are over
}

type window struct {
	start time.Time
	count int
}

// New returns a limiter of limit requests in each window of length per,
// for each key. now is the clock; nil means time.Now.
func New(limit int, per time.Duration, now func() time.Time) *Limiter {
	if now == nil {
		now = time.Now
	}
	return &Limiter{limit: limit, window: per, now: now, windows: make(map[string]*window)}
}

// Allow counts a request for key and reports whether it is within the
// limit. When it is not, retryAfter is the time left in the key's window.
func (l *Limiter) Allow(key string) (ok bool, retryAfter time.Duration) {
	now := l.now()

	l.mu.Lock()
	defer l.mu.Unlock()
	l.sweep(now)

	w := l.windows[key]
	if w == nil || now.Sub(w.start) >= l.window {
		w = &window{start: now}
		l.windows[key] = w
	}
	if w.count >= l.limit {
		return false, w.start.Add(l.window).Sub(now)
	}
	w.count++
	return true, 0
}

// sweep forgets, once per window, the keys whose window is over, so the
// map does not grow with every address ever seen.
func (l *Limiter) sweep(now time.Time) {
	if now.Before(l.sweepAt) {
		return
	}
	for key, w := range l.windows {
		if now.Sub(w.start) >= l.window {
			delete(l.windows, key)
		}
	}
	l.sweepAt = now.Add(l.window)
}
