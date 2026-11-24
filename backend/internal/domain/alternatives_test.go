package domain

import (
	"reflect"
	"testing"
)

// event builds an event from days and, per participant, the pairs they are
// absent on. Participant ids are their names, to keep expectations readable.
func event(days []Day, names []string, absences map[string][]Pair) Event {
	e := Event{ID: "k7Qm2xVd9LpA", Title: "Cena di dicembre", Status: "closed", Days: days}
	for i, n := range names {
		e.Participants = append(e.Participants, Participant{
			ID: n, Name: n, Organiser: i == 0, Absences: absences[n],
		})
	}
	return e
}

func alt(date string, missing []string, slots ...Slot) Alternative {
	if missing == nil {
		missing = []string{}
	}
	return Alternative{Date: date, Slots: slots, Missing: missing}
}

// specExample is the fixture of the implementation plan (December 2026).
func specExample() Event {
	all := []Slot{Morning, Lunch, Afternoon, Dinner, AfterDinner}
	friday := []Slot{Afternoon, Dinner, AfterDinner}
	days := []Day{
		{"2026-12-11", friday},
		{"2026-12-12", all},
		{"2026-12-13", all},
		{"2026-12-18", friday},
		{"2026-12-19", all},
		{"2026-12-20", all},
	}
	// The plan's table, cell by cell: who is absent on each pair.
	table := []struct {
		date   string
		slot   Slot
		absent []string
	}{
		{"2026-12-11", Afternoon, []string{"Luca", "Paolo", "Marta"}},
		{"2026-12-11", Dinner, []string{"Luca"}},
		{"2026-12-12", Morning, []string{"Anna", "Paolo"}},
		{"2026-12-12", Lunch, []string{"Anna"}},
		{"2026-12-12", AfterDinner, []string{"Marta"}},
		{"2026-12-13", Morning, []string{"Giulia", "Luca", "Anna"}},
		{"2026-12-13", Lunch, []string{"Luca"}},
		{"2026-12-13", Afternoon, []string{"Luca"}},
		{"2026-12-13", Dinner, []string{"Paolo", "Marta"}},
		{"2026-12-13", AfterDinner, []string{"Paolo", "Marta", "Giulia"}},
		{"2026-12-18", Afternoon, []string{"Luca", "Paolo", "Marta", "Anna"}},
		{"2026-12-18", Dinner, []string{"Anna"}},
		{"2026-12-18", AfterDinner, []string{"Anna"}},
		{"2026-12-19", Morning, []string{"Giulia", "Luca", "Paolo"}},
		{"2026-12-19", Lunch, []string{"Giulia", "Luca"}},
		{"2026-12-19", Afternoon, []string{"Giulia", "Luca"}},
		{"2026-12-19", Dinner, []string{"Giulia", "Luca"}},
		{"2026-12-19", AfterDinner, []string{"Giulia", "Luca", "Marta"}},
		{"2026-12-20", Morning, []string{"Marta"}},
		{"2026-12-20", Dinner, []string{"Paolo"}},
		{"2026-12-20", AfterDinner, []string{"Paolo", "Anna"}},
	}
	absences := map[string][]Pair{}
	for _, row := range table {
		for _, name := range row.absent {
			absences[name] = append(absences[name], Pair{row.date, row.slot})
		}
	}
	return event(days, []string{"Giulia", "Luca", "Anna", "Marta", "Paolo"}, absences)
}

func TestAlternatives(t *testing.T) {
	all := []Slot{Morning, Lunch, Afternoon, Dinner, AfterDinner}

	cases := []struct {
		name  string
		event Event
		want  []Alternative
	}{
		{
			name:  "the spec example",
			event: specExample(),
			want: []Alternative{
				alt("2026-12-11", nil, AfterDinner),
				alt("2026-12-12", nil, Afternoon, Dinner),
				alt("2026-12-20", nil, Lunch, Afternoon),
				alt("2026-12-11", []string{"Luca"}, Dinner),
				alt("2026-12-12", []string{"Anna"}, Lunch),
				alt("2026-12-12", []string{"Marta"}, AfterDinner),
				alt("2026-12-13", []string{"Luca"}, Lunch, Afternoon),
				alt("2026-12-18", []string{"Anna"}, Dinner, AfterDinner),
				alt("2026-12-20", []string{"Marta"}, Morning),
				alt("2026-12-20", []string{"Paolo"}, Dinner),
			},
		},
		{
			name: "no everyone-free and no one-missing group: only the smallest tier",
			event: event(
				[]Day{{"2026-12-11", []Slot{Lunch, Dinner}}, {"2026-12-12", []Slot{Dinner}}},
				[]string{"Giulia", "Luca", "Anna"},
				map[string][]Pair{
					"Giulia": {{"2026-12-11", Lunch}, {"2026-12-11", Dinner}, {"2026-12-12", Dinner}},
					"Luca":   {{"2026-12-11", Lunch}, {"2026-12-11", Dinner}, {"2026-12-12", Dinner}},
					"Anna":   {{"2026-12-11", Dinner}},
				},
			),
			want: []Alternative{
				alt("2026-12-11", []string{"Giulia", "Luca"}, Lunch),
				alt("2026-12-12", []string{"Giulia", "Luca"}, Dinner),
			},
		},
		{
			name: "one participant, no absences: one group per day with all its slots",
			event: event(
				[]Day{{"2026-12-11", []Slot{Afternoon, Dinner, AfterDinner}}, {"2026-12-12", all}},
				[]string{"Giulia"},
				nil,
			),
			want: []Alternative{
				alt("2026-12-11", nil, Afternoon, Dinner, AfterDinner),
				alt("2026-12-12", nil, Morning, Lunch, Afternoon, Dinner, AfterDinner),
			},
		},
		{
			name: "neighbours with equal counts but different people are not merged",
			event: event(
				[]Day{{"2026-12-11", []Slot{Lunch, Afternoon}}},
				[]string{"Giulia", "Luca"},
				map[string][]Pair{
					"Giulia": {{"2026-12-11", Afternoon}},
					"Luca":   {{"2026-12-11", Lunch}},
				},
			),
			want: []Alternative{
				alt("2026-12-11", []string{"Luca"}, Lunch),
				alt("2026-12-11", []string{"Giulia"}, Afternoon),
			},
		},
		{
			name: "same absent set across a slot that is not a candidate is not merged",
			event: event(
				[]Day{{"2026-12-11", []Slot{Lunch, Dinner}}},
				[]string{"Giulia", "Luca"},
				map[string][]Pair{"Luca": {{"2026-12-11", Lunch}, {"2026-12-11", Dinner}}},
			),
			want: []Alternative{
				alt("2026-12-11", []string{"Luca"}, Lunch),
				alt("2026-12-11", []string{"Luca"}, Dinner),
			},
		},
		{
			name: "missing people are listed in joining order",
			event: event(
				[]Day{{"2026-12-11", []Slot{Dinner}}},
				[]string{"Giulia", "Luca", "Anna"},
				map[string][]Pair{
					"Anna": {{"2026-12-11", Dinner}},
					"Luca": {{"2026-12-11", Dinner}},
				},
			),
			want: []Alternative{alt("2026-12-11", []string{"Luca", "Anna"}, Dinner)},
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := Alternatives(c.event)
			if !reflect.DeepEqual(got, c.want) {
				t.Fatalf("Alternatives:\n got %v\nwant %v", got, c.want)
			}
		})
	}
}
