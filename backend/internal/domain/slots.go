// Package domain holds the rules of Oggi non posso that do not depend on
// HTTP or on a database: slots, validation and the alternatives.
package domain

// Slot is one of the five named parts of a day.
type Slot string

// The closed set of slots.
const (
	Morning     Slot = "morning"
	Lunch       Slot = "lunch"
	Afternoon   Slot = "afternoon"
	Dinner      Slot = "dinner"
	AfterDinner Slot = "after_dinner"
)

// Slots is the closed set in its canonical order. Behaviour depends on the
// order: do not sort it and do not append to it.
var Slots = []Slot{Morning, Lunch, Afternoon, Dinner, AfterDinner}

// ParseSlot reports whether s names a slot of the closed set.
func ParseSlot(s string) (Slot, bool) {
	slot := Slot(s)
	if SlotIndex(slot) < 0 {
		return "", false
	}
	return slot, true
}

// SlotIndex returns the position of s in the canonical order, or -1 when s
// is not a slot.
func SlotIndex(s Slot) int {
	for i, known := range Slots {
		if known == s {
			return i
		}
	}
	return -1
}
