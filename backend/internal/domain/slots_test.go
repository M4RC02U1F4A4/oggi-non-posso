package domain

import (
	"slices"
	"testing"
)

func TestSlotsOrder(t *testing.T) {
	want := []Slot{"morning", "lunch", "afternoon", "dinner", "after_dinner"}
	if !slices.Equal(Slots, want) {
		t.Fatalf("Slots = %v, want %v", Slots, want)
	}
	for i, s := range want {
		if got := SlotIndex(s); got != i {
			t.Errorf("SlotIndex(%q) = %d, want %d", s, got, i)
		}
	}
	if got := SlotIndex("brunch"); got != -1 {
		t.Errorf("SlotIndex(brunch) = %d, want -1", got)
	}
}

func TestParseSlot(t *testing.T) {
	if s, ok := ParseSlot("after_dinner"); !ok || s != AfterDinner {
		t.Errorf("ParseSlot(after_dinner) = %q, %v", s, ok)
	}
	for _, in := range []string{"", "brunch", "Morning", " lunch"} {
		if _, ok := ParseSlot(in); ok {
			t.Errorf("ParseSlot(%q) accepted", in)
		}
	}
}
