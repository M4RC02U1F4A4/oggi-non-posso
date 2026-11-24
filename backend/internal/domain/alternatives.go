package domain

import (
	"slices"
	"sort"
)

// Alternative is a run of neighbouring slots of one day that miss the same
// people. Missing holds participant ids, in joining order.
type Alternative struct {
	Date    string
	Slots   []Slot
	Missing []string
}

// Alternatives derives the result of an event from its absences:
//
//  1. for every candidate pair, the participants absent on it;
//  2. on each day, runs of slots that are neighbours in the canonical order
//     and have the same absent set are merged into one group;
//  3. only the groups missing at most max(1, the smallest number missing in
//     any group) people are kept;
//  4. ordered by number missing, then date, then first slot.
//
// Nothing of this is stored: it is computed on every read.
func Alternatives(e Event) []Alternative {
	absent := make(map[Pair][]string)
	for _, p := range e.Participants {
		for _, a := range p.Absences {
			if e.IsCandidate(a) {
				absent[a] = append(absent[a], p.ID)
			}
		}
	}

	groups := []Alternative{}
	for _, d := range e.Days {
		prev := -2 // canonical index of the previous candidate slot of this day
		for _, s := range d.Slots {
			idx := SlotIndex(s)
			missing := absent[Pair{Date: d.Date, Slot: s}]
			if last := len(groups) - 1; idx == prev+1 && slices.Equal(groups[last].Missing, missing) {
				groups[last].Slots = append(groups[last].Slots, s)
			} else {
				groups = append(groups, Alternative{
					Date:    d.Date,
					Slots:   []Slot{s},
					Missing: append([]string{}, missing...),
				})
			}
			prev = idx
		}
	}
	if len(groups) == 0 {
		return groups
	}

	limit := len(groups[0].Missing)
	for _, g := range groups {
		limit = min(limit, len(g.Missing))
	}
	limit = max(1, limit)
	kept := groups[:0]
	for _, g := range groups {
		if len(g.Missing) <= limit {
			kept = append(kept, g)
		}
	}

	// Groups were built by date and then by slot, so a stable sort on the
	// number missing gives the whole order.
	sort.SliceStable(kept, func(i, j int) bool { return len(kept[i].Missing) < len(kept[j].Missing) })
	return kept
}
