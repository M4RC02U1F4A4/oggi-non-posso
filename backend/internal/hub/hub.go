package hub

import "sync"

// Hub fans the updates of each event out to the subscribers of that event.
// It starts no goroutine and keeps nothing for an event nobody watches.
type Hub struct {
	mu          sync.Mutex
	subscribers map[string]map[*subscriber]struct{} // by event id
}

// Pending is how many updates a subscriber that has not read yet keeps. A
// burst of marks by different people stays whole, so each one is reported
// with its own `by`; a subscriber further behind loses the oldest ones,
// which is harmless: a client refetches on the newest version it sees.
const Pending = 16

// subscriber holds the updates it has not read yet, at most Pending.
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
	s := &subscriber{ch: make(chan Update, Pending)}

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
// subscriber whose queue is full loses its oldest pending update.
func (h *Hub) Publish(eventID string, u Update) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for s := range h.subscribers[eventID] {
		for {
			select {
			case s.ch <- u:
			default:
				// Full. Publishers are serialised by the lock, so only the
				// subscriber can be emptying the queue meanwhile.
				select {
				case <-s.ch:
				default:
				}
				continue
			}
			break
		}
	}
}
