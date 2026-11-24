package ratelimit

import "sync"

// Gate bounds how many things are open at the same time: per key and in
// all. Unlike a Limiter it knows nothing of time: a place is taken on
// entering and given back on leaving.
type Gate struct {
	perKey int
	total  int

	mu   sync.Mutex
	open map[string]int // by key; a key with nothing open has no entry
	all  int
}

// NewGate returns a gate that lets in perKey for each key and total in
// all.
func NewGate(perKey, total int) *Gate {
	return &Gate{perKey: perKey, total: total, open: make(map[string]int)}
}

// Enter takes a place for key. When there is one, ok is true and leave
// gives the place back; leave may be called more than once. When the key
// or the gate is full, ok is false and nothing is taken.
func (g *Gate) Enter(key string) (leave func(), ok bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.all >= g.total || g.open[key] >= g.perKey {
		return func() {}, false
	}
	g.open[key]++
	g.all++

	var once sync.Once
	return func() {
		once.Do(func() {
			g.mu.Lock()
			defer g.mu.Unlock()
			g.all--
			if g.open[key]--; g.open[key] <= 0 {
				delete(g.open, key)
			}
		})
	}, true
}
