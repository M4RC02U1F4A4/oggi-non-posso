package domain

import (
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// Limits on what a request may carry.
const (
	MaxTitleLength = 80
	MaxNameLength  = 30
	MaxDays        = 62
)

// ValidationError says that a value is well formed but not acceptable.
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string { return e.Field + ": " + e.Message }

func invalid(field, format string, args ...any) error {
	return &ValidationError{Field: field, Message: fmt.Sprintf(format, args...)}
}

// NormalizeTitle trims s and checks that 1 to 80 characters are left.
func NormalizeTitle(s string) (string, error) {
	s = strings.TrimSpace(s)
	if n := utf8.RuneCountInString(s); n < 1 || n > MaxTitleLength {
		return "", invalid("title", "must be 1 to %d characters", MaxTitleLength)
	}
	return s, nil
}

// NormalizeName trims s and checks that 1 to 30 characters are left. The key
// is what makes two names the same inside an event: the name without case.
func NormalizeName(s string) (name, key string, err error) {
	name = strings.TrimSpace(s)
	if n := utf8.RuneCountInString(name); n < 1 || n > MaxNameLength {
		return "", "", invalid("name", "must be 1 to %d characters", MaxNameLength)
	}
	return name, strings.ToLower(name), nil
}

// ValidDate reports whether s is a calendar date written YYYY-MM-DD. The
// date is only checked: it is never turned into an instant.
func ValidDate(s string) bool {
	const layout = "2006-01-02"
	t, err := time.Parse(layout, s)
	return err == nil && t.Format(layout) == s
}

// DateWindow is the range of candidate dates a new event may use, given the
// current instant: from the day before today to a year and a day after it,
// both counted in UTC. The extra day on each side lets every time zone pick
// its own today and a year ahead. Without an upper bound an event could sit
// far in the future and never reach its retention date.
func DateWindow(now time.Time) (first, last string) {
	const layout = "2006-01-02"
	today := now.UTC()
	return today.AddDate(0, 0, -1).Format(layout), today.AddDate(1, 0, 1).Format(layout)
}

// CheckDateWindow checks that every day of a new event falls inside the
// DateWindow of now. Days must already be valid dates.
func CheckDateWindow(days []Day, now time.Time) error {
	first, last := DateWindow(now)
	for _, d := range days {
		// YYYY-MM-DD compares as text in calendar order.
		if d.Date < first || d.Date > last {
			return invalid("days", "%s is outside %s to %s", d.Date, first, last)
		}
	}
	return nil
}

// NormalizeDays checks the candidate days of a new event (1 to 62 distinct
// valid dates, each with 1 to 5 distinct slots of the closed set) and
// returns them sorted by date, each with its slots in canonical order. The
// input is not modified.
func NormalizeDays(in []Day) ([]Day, error) {
	if len(in) < 1 || len(in) > MaxDays {
		return nil, invalid("days", "must hold 1 to %d days", MaxDays)
	}
	seen := make(map[string]bool, len(in))
	out := make([]Day, 0, len(in))
	for _, d := range in {
		if !ValidDate(d.Date) {
			return nil, invalid("days", "%q is not a date (YYYY-MM-DD)", d.Date)
		}
		if seen[d.Date] {
			return nil, invalid("days", "%s appears more than once", d.Date)
		}
		seen[d.Date] = true

		if len(d.Slots) == 0 {
			return nil, invalid("days", "%s has no slots", d.Date)
		}
		picked := make(map[Slot]bool, len(Slots))
		for _, s := range d.Slots {
			if SlotIndex(s) < 0 {
				return nil, invalid("days", "%s has an unknown slot %q", d.Date, string(s))
			}
			if picked[s] {
				return nil, invalid("days", "%s has the slot %s more than once", d.Date, s)
			}
			picked[s] = true
		}
		slots := make([]Slot, 0, len(picked))
		for _, s := range Slots {
			if picked[s] {
				slots = append(slots, s)
			}
		}
		out = append(out, Day{Date: d.Date, Slots: slots})
	}
	// YYYY-MM-DD sorts as text in calendar order.
	sort.Slice(out, func(i, j int) bool { return out[i].Date < out[j].Date })
	return out, nil
}
