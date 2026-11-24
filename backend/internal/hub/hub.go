package hub

import "sync"

// Hub fans the updates of each event out to the subscribers of that event.
// It starts no goroutine and keeps nothing for an event nobody watches.
type Hub struct {
	mu          sync.Mutex
	subscribers map[string]map[*subscriber]struct{} // by event id
}

// subscriber holds at most one pending update: the newest.
type subscriber struct {
	ch chan Update
}

// New returns an empty hub.
func New() *Hub {
	return &Hub{subscribers: make(map[string]map[*subscriber]struct{})}
}

// Subscribe returns a channel with the updates of an event from now on, and
// the function that ends the subscription. The channel is never closed:
// after cancel it simply receives nothing more. cancel may be called more
// than once.
func (h *Hub) Subscribe(eventID string) (<-chan Update, func()) {
	s := &subscriber{ch: make(chan Update, 1)}

	h.mu.Lock()
	set := h.subscribers[eventID]
	if set == nil {
		set = make(map[*subscriber]struct{})
		h.subscribers[eventID] = set
	}
	set[s] = struct{}{}
	h.mu.Unlock()

	cancel := func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		set := h.subscribers[eventID]
		delete(set, s)
		if len(set) == 0 {
			delete(h.subscribers, eventID)
		}
	}
	return s.ch, cancel
}

// Publish hands u to every subscriber of the event. It never blocks: a
// subscriber that has not read its pending update keeps only the newest of
// the two, the one with the higher version.
func (h *Hub) Publish(eventID string, u Update) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for s := range h.subscribers[eventID] {
		select {
		case s.ch <- u:
			continue
		default:
		}
		// The slot is taken. Publishers are serialised by the lock, so
		// between these two steps the subscriber can only empty it.
		newest := u
		select {
		case pending := <-s.ch:
			if pending.Version > newest.Version {
				newest = pending
			}
		default:
		}
		s.ch <- newest
	}
}
