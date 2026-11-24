// Package store defines what the service needs from its database. The
// implementations live in sub-packages and are the only code that speaks
// SQL.
package store

import (
	"context"
	"errors"

	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/domain"
)

// Errors a Store returns for the outcomes callers tell apart. Anything else
// is a failure of the database.
var (
	// ErrNotFound: the event, or the participant inside it, does not exist.
	ErrNotFound = errors.New("store: not found")
	// ErrNameTaken: the event already has a participant with this name key.
	ErrNameTaken = errors.New("store: name taken")
	// ErrClosed: the event is closed and the change needs it open.
	ErrClosed = errors.New("store: event closed")
	// ErrTooManyParticipants: the event is full.
	ErrTooManyParticipants = errors.New("store: too many participants")
	// ErrIsOrganiser: the organiser's own participant can not be removed.
	ErrIsOrganiser = errors.New("store: participant is the organiser")
)

// NewEvent is an event to create, already validated: Days come from
// domain.NormalizeDays.
type NewEvent struct {
	ID, Title, OrganiserKeyHash string
	Days                        []domain.Day
	Organiser                   NewParticipant
}

// NewParticipant is a participant to add, already validated: Name and
// NameKey come from domain.NormalizeName.
type NewParticipant struct{ ID, Name, NameKey, TokenHash string }

// Store keeps events. Every method that changes an event runs in one
// transaction, bumps the event's version and returns the event as it is
// after the change.
type Store interface {
	// CreateEvent stores a new open event with its organiser as the first
	// participant.
	CreateEvent(ctx context.Context, e NewEvent) (domain.Event, error)
	// GetEvent returns an event, or ErrNotFound.
	GetEvent(ctx context.Context, id string) (domain.Event, error)
	// AddParticipant joins p to an open event that holds fewer than max
	// participants. It can return ErrNotFound, ErrClosed, ErrNameTaken and
	// ErrTooManyParticipants.
	AddParticipant(ctx context.Context, eventID string, p NewParticipant, max int) (domain.Event, error)
	// ParticipantByToken returns the id of the participant of the event
	// whose token has this hash, or ErrNotFound.
	ParticipantByToken(ctx context.Context, eventID, tokenHash string) (id string, err error)
	// IsOrganiserKey reports whether keyHash is the hash of the event's
	// organiser key. An unknown event is ErrNotFound.
	IsOrganiserKey(ctx context.Context, eventID, keyHash string) (bool, error)
	// ChangeAbsences marks the pairs in set and unmarks the pairs in clear
	// for a participant of an open event. Marking what is marked and
	// clearing what is clear change nothing and are not errors. Every pair
	// must be a candidate of the event. It can return ErrNotFound (event or
	// participant) and ErrClosed.
	ChangeAbsences(ctx context.Context, eventID, participantID string, set, clear []domain.Pair) (domain.Event, error)
	// SetStatus opens or closes an event. Setting the status it already has
	// changes nothing, version included, and reports changed false.
	SetStatus(ctx context.Context, eventID, status string) (ev domain.Event, changed bool, err error)
	// RemoveParticipant deletes a participant and their absences. It can
	// return ErrNotFound (event or participant) and ErrIsOrganiser.
	RemoveParticipant(ctx context.Context, eventID, participantID string) (domain.Event, error)
	// DeleteExpired deletes, with everything that belongs to them, the
	// events whose last candidate day is before lastDayBefore (YYYY-MM-DD)
	// and returns how many they were.
	DeleteExpired(ctx context.Context, lastDayBefore string) (int, error)
	// Close releases the database.
	Close() error
}
