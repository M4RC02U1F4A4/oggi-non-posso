// Package ratelimit counts requests per key in fixed windows.
package ratelimit

import (
	"sync"
	"time"
)

// MaxKeys is the most keys a Limiter follows at one time. It bounds the
// memory a limiter can take, whatever the number of keys it is shown.
const MaxKeys = 100_000

// Bounds on the streams of live updates open at the same time. Each one
// holds a connection and a goroutine for as long as its client stays, so
// these protect the process itself: they are not a quota and are always
// on, whatever the setting of the rate limits.
const (
	// MaxStreamsPerKey is the most streams one client key holds open.
	MaxStreamsPerKey = 20
	// MaxStreams is the most streams open in all.
	MaxStreams = 2000
)

// Limiter allows a number of requests per key in each window. The window
// of a key begins with its first request and is not moved by the requests
// that follow, refused ones included.
//
// A limiter follows at most MaxKeys keys. While it is full a key it does
// not follow yet is refused, as if it were over its limit, until a window
// ends and makes room: it neither grows without bound nor lets through
// what it can not count.
type Limiter struct {
	limit   int
	window  time.Duration
	now     func() time.Time
	maxKeys int

	mu      sync.Mutex
	windows map[string]*window
	// sweepAt is when the windows that are over are dropped next, so that
	// they go even if nobody asks about their keys again.
	sweepAt time.Time
	// oldestEnds is when the oldest window found by the last sweep ends:
	// before that moment another sweep can not free anything.
	oldestEnds time.Time
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
	return &Limiter{
		limit:   limit,
		window:  per,
		now:     now,
		maxKeys: MaxKeys,
		windows: make(map[string]*window),
	}
}

// Allow counts a request for key and reports whether it is within the
// limit. When it is not, retryAfter is the time left in the key's window
// or, for a new key refused because the limiter is full, the time until
// the oldest window ends.
func (l *Limiter) Allow(key string) (ok bool, retryAfter time.Duration) {
	now := l.now()

	l.mu.Lock()
	defer l.mu.Unlock()
	if !now.Before(l.sweepAt) {
		l.sweep(now)
	}

	w := l.windows[key]
	if w != nil && now.Sub(w.start) >= l.window {
		delete(l.windows, key)
		w = nil
	}
	if w == nil {
		if len(l.windows) >= l.maxKeys {
			// Full. Sweeping costs a pass over every key, so it is done
			// only when it can free something.
			if !now.Before(l.oldestEnds) {
				l.sweep(now)
			}
			if len(l.windows) >= l.maxKeys {
				return false, l.oldestEnds.Sub(now)
			}
		}
		w = &window{start: now}
		l.windows[key] = w
	}
	if w.count >= l.limit {
		return false, w.start.Add(l.window).Sub(now)
	}
	w.count++
	return true, 0
}

// sweep forgets the keys whose window is over and notes when the oldest
// of the others ends.
func (l *Limiter) sweep(now time.Time) {
	var oldest time.Time
	for key, w := range l.windows {
		if now.Sub(w.start) >= l.window {
			delete(l.windows, key)
			continue
		}
		if oldest.IsZero() || w.start.Before(oldest) {
			oldest = w.start
		}
	}
	l.sweepAt = now.Add(l.window)
	l.oldestEnds = oldest.Add(l.window)
}
