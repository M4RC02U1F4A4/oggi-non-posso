package domain

import "time"

// The two states of an event.
const (
	StatusOpen   = "open"
	StatusClosed = "closed"
)

// Pair is a (date, slot) pair. Date is a plain calendar date, YYYY-MM-DD:
// it is never an instant and no time zone is ever applied to it.
type Pair struct {
	Date string
	Slot Slot
}

// Day is a candidate day with the slots in play on it.
type Day struct {
	Date  string
	Slots []Slot
}

// Participant is a person who joined an event, with the pairs they can NOT
// make.
type Participant struct {
	ID        string
	Name      string
	Organiser bool
	Absences  []Pair // sorted by date, then slot order
}

// Event is an event as it is stored: nothing about the result is in it.
type Event struct {
	ID, Title, Status string // Status: "open" | "closed"
	Version           int64
	Days              []Day         // ascending by date, slots in canonical order
	Participants      []Participant // in joining order
	CreatedAt         time.Time
	ClosedAt          *time.Time
}

// IsCandidate reports whether p is one of the event's candidate pairs.
func (e Event) IsCandidate(p Pair) bool {
	for _, d := range e.Days {
		if d.Date != p.Date {
			continue
		}
		for _, s := range d.Slots {
			if s == p.Slot {
				return true
			}
		}
		return false
	}
	return false
}

// UnionSlots returns the slots in play on at least one day, in canonical
// order.
func (e Event) UnionSlots() []Slot {
	used := make(map[Slot]bool, len(Slots))
	for _, d := range e.Days {
		for _, s := range d.Slots {
			used[s] = true
		}
	}
	out := make([]Slot, 0, len(Slots))
	for _, s := range Slots {
		if used[s] {
			out = append(out, s)
		}
	}
	return out
}
