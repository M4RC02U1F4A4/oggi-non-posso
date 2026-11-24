package domain

import (
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"
)

func wantValidationError(t *testing.T, err error, field string) {
	t.Helper()
	var ve *ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("error = %v, want a *ValidationError", err)
	}
	if ve.Field != field {
		t.Fatalf("field = %q, want %q", ve.Field, field)
	}
	if !strings.Contains(ve.Error(), field) {
		t.Fatalf("message %q does not name the field %q", ve.Error(), field)
	}
}

func TestNormalizeTitle(t *testing.T) {
	got, err := NormalizeTitle("  Cena di dicembre\n")
	if err != nil || got != "Cena di dicembre" {
		t.Fatalf("NormalizeTitle = %q, %v", got, err)
	}
	if _, err := NormalizeTitle(strings.Repeat("è", 80)); err != nil {
		t.Fatalf("80 characters rejected: %v", err)
	}
	for _, in := range []string{"", "   ", strings.Repeat("è", 81)} {
		_, err := NormalizeTitle(in)
		wantValidationError(t, err, "title")
	}
}

func TestNormalizeName(t *testing.T) {
	name, key, err := NormalizeName("  Giulia ")
	if err != nil || name != "Giulia" || key != "giulia" {
		t.Fatalf("NormalizeName = %q, %q, %v", name, key, err)
	}

	thirty := strings.Repeat("è", 30)
	name, key, err = NormalizeName(thirty)
	if err != nil || name != thirty || key != thirty {
		t.Fatalf("30 characters of è: %q, %q, %v", name, key, err)
	}

	_, upper, _ := NormalizeName("GIULIA")
	_, spaced, _ := NormalizeName(" giulia ")
	if upper != "giulia" || spaced != "giulia" {
		t.Fatalf("keys differ: %q, %q", upper, spaced)
	}

	for _, in := range []string{"", " \t ", strings.Repeat("a", 31), strings.Repeat("è", 31)} {
		_, _, err := NormalizeName(in)
		wantValidationError(t, err, "name")
	}
}

func TestNormalizeDays(t *testing.T) {
	in := []Day{
		{Date: "2026-12-12", Slots: []Slot{AfterDinner, Dinner}},
		{Date: "2026-12-11", Slots: []Slot{Dinner, Morning, Afternoon}},
	}
	got, err := NormalizeDays(in)
	if err != nil {
		t.Fatalf("NormalizeDays: %v", err)
	}
	want := []Day{
		{Date: "2026-12-11", Slots: []Slot{Morning, Afternoon, Dinner}},
		{Date: "2026-12-12", Slots: []Slot{Dinner, AfterDinner}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	if in[0].Date != "2026-12-12" || in[0].Slots[0] != AfterDinner {
		t.Fatalf("input was modified: %v", in)
	}

	many := func(n int) []Day {
		days := make([]Day, n)
		for i := range days {
			// 2027-01-01 .. 2027-03-04: all valid, all distinct.
			month, day := 1, i+1
			if day > 31 {
				month, day = 2, day-31
			}
			if month == 2 && day > 28 {
				month, day = 3, day-28
			}
			days[i] = Day{Date: fmt.Sprintf("2027-%02d-%02d", month, day), Slots: []Slot{Dinner}}
		}
		return days
	}
	if _, err := NormalizeDays(many(62)); err != nil {
		t.Fatalf("62 days rejected: %v", err)
	}
	if _, err := NormalizeDays([]Day{{Date: "2028-02-29", Slots: []Slot{Lunch}}}); err != nil {
		t.Fatalf("leap day rejected: %v", err)
	}

	bad := map[string][]Day{
		"duplicate date": {{Date: "2026-12-11", Slots: []Slot{Dinner}}, {Date: "2026-12-11", Slots: []Slot{Lunch}}},
		"invalid date":   {{Date: "2026-02-30", Slots: []Slot{Dinner}}},
		"short date":     {{Date: "2026-2-3", Slots: []Slot{Dinner}}},
		"not a date":     {{Date: "tomorrow", Slots: []Slot{Dinner}}},
		"with a time":    {{Date: "2026-12-11T00:00:00Z", Slots: []Slot{Dinner}}},
		"no slots":       {{Date: "2026-12-11", Slots: nil}},
		"unknown slot":   {{Date: "2026-12-11", Slots: []Slot{"brunch"}}},
		"repeated slot":  {{Date: "2026-12-11", Slots: []Slot{Dinner, Dinner}}},
		"zero days":      {},
		"63 days":        many(63),
	}
	for name, days := range bad {
		t.Run(name, func(t *testing.T) {
			_, err := NormalizeDays(days)
			wantValidationError(t, err, "days")
		})
	}
}

func TestEventCandidatesAndUnion(t *testing.T) {
	e := Event{Days: []Day{
		{Date: "2026-12-11", Slots: []Slot{Afternoon, Dinner}},
		{Date: "2026-12-12", Slots: []Slot{Lunch, Dinner}},
	}}
	if !e.IsCandidate(Pair{"2026-12-11", Afternoon}) {
		t.Error("2026-12-11 afternoon should be a candidate")
	}
	for _, p := range []Pair{{"2026-12-11", Lunch}, {"2026-12-13", Dinner}, {"2026-12-12", "brunch"}} {
		if e.IsCandidate(p) {
			t.Errorf("%v should not be a candidate", p)
		}
	}
	want := []Slot{Lunch, Afternoon, Dinner}
	if got := e.UnionSlots(); !reflect.DeepEqual(got, want) {
		t.Errorf("UnionSlots = %v, want %v", got, want)
	}
}

func TestDateWindow(t *testing.T) {
	// 23:30 in UTC is already the next day in Italy, and 14 h ahead of UTC
	// is two calendar days later than 10 h behind it: the window takes both.
	now := time.Date(2026, 11, 24, 23, 30, 0, 0, time.UTC)
	first, last := DateWindow(now)
	if first != "2026-11-23" || last != "2027-11-25" {
		t.Fatalf("DateWindow = %s, %s; want 2026-11-23, 2027-11-25", first, last)
	}
	ok := []Day{{Date: "2026-11-23"}, {Date: "2026-11-25"}, {Date: "2027-11-25"}}
	if err := CheckDateWindow(ok, now); err != nil {
		t.Fatalf("days inside the window refused: %v", err)
	}
	for _, d := range []string{"2026-11-22", "2027-11-26", "9999-12-31", "0001-01-01"} {
		if err := CheckDateWindow([]Day{{Date: d}}, now); err == nil {
			t.Errorf("%s accepted, want refused", d)
		}
	}
}
