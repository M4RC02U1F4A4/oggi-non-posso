package api

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/domain"
	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/hub"
	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/store"
	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/token"
)

// Lengths of the random identifiers.
const (
	eventIDLength       = 12
	participantIDLength = 10
)

// ---- the event object -------------------------------------------------

type eventJSON struct {
	ID           string            `json:"id"`
	Title        string            `json:"title"`
	Status       string            `json:"status"`
	Version      int64             `json:"version"`
	Slots        []domain.Slot     `json:"slots"`
	Days         []dayJSON         `json:"days"`
	Participants []participantJSON `json:"participants"`
	Me           *string           `json:"me"`
	CanManage    bool              `json:"can_manage"`
	CreatedAt    string            `json:"created_at"`
	ClosedAt     *string           `json:"closed_at"`
	Alternatives []alternativeJSON `json:"alternatives"` // null while open
}

type dayJSON struct {
	Date  string        `json:"date"`
	Slots []domain.Slot `json:"slots"`
}

type participantJSON struct {
	ID        string                   `json:"id"`
	Name      string                   `json:"name"`
	Organiser bool                     `json:"organiser"`
	Absences  map[string][]domain.Slot `json:"absences"` // only dates with at least one slot
}

type alternativeJSON struct {
	Date    string        `json:"date"`
	Slots   []domain.Slot `json:"slots"`
	Missing []string      `json:"missing"`
}

// view writes an event for one caller. The alternatives are derived here,
// on every read, and only for a closed event.
func view(ev domain.Event, c caller) eventJSON {
	out := eventJSON{
		ID:           ev.ID,
		Title:        ev.Title,
		Status:       ev.Status,
		Version:      ev.Version,
		Slots:        ev.UnionSlots(),
		Days:         make([]dayJSON, 0, len(ev.Days)),
		Participants: make([]participantJSON, 0, len(ev.Participants)),
		Me:           c.me,
		CanManage:    c.canManage,
		CreatedAt:    timestamp(ev.CreatedAt),
	}
	for _, d := range ev.Days {
		out.Days = append(out.Days, dayJSON{Date: d.Date, Slots: d.Slots})
	}
	for _, p := range ev.Participants {
		absences := make(map[string][]domain.Slot)
		for _, a := range p.Absences {
			absences[a.Date] = append(absences[a.Date], a.Slot)
		}
		out.Participants = append(out.Participants, participantJSON{
			ID: p.ID, Name: p.Name, Organiser: p.Organiser, Absences: absences,
		})
	}
	if ev.ClosedAt != nil {
		closed := timestamp(*ev.ClosedAt)
		out.ClosedAt = &closed
	}
	if ev.Status == domain.StatusClosed {
		out.Alternatives = []alternativeJSON{}
		for _, alt := range domain.Alternatives(ev) {
			out.Alternatives = append(out.Alternatives, alternativeJSON(alt))
		}
	}
	return out
}

// timestamp writes an instant as RFC 3339 in UTC, to the second.
func timestamp(t time.Time) string { return t.UTC().Format(time.RFC3339) }

// ---- handlers ---------------------------------------------------------

type dayInput struct {
	Date  string   `json:"date"`
	Slots []string `json:"slots"`
}

func (a *api) createEvent(w http.ResponseWriter, r *http.Request) {
	if !a.allow(w, r, a.creations) {
		return
	}
	var body struct {
		Title         string     `json:"title"`
		OrganiserName string     `json:"organiser_name"`
		Days          []dayInput `json:"days"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		a.fail(w, r, err)
		return
	}

	title, err := domain.NormalizeTitle(body.Title)
	if err != nil {
		a.fail(w, r, validation(err, ""))
		return
	}
	name, nameKey, err := domain.NormalizeName(body.OrganiserName)
	if err != nil {
		a.fail(w, r, validation(err, "organiser_name"))
		return
	}
	days := make([]domain.Day, 0, len(body.Days))
	for _, d := range body.Days {
		day := domain.Day{Date: d.Date}
		for _, s := range d.Slots {
			day.Slots = append(day.Slots, domain.Slot(s)) // checked by NormalizeDays
		}
		days = append(days, day)
	}
	days, err = domain.NormalizeDays(days)
	if err != nil {
		a.fail(w, r, validation(err, ""))
		return
	}

	participantToken := token.NewSecret(participantPrefix)
	organiserKey := token.NewSecret(organiserPrefix)
	ev, err := a.store.CreateEvent(r.Context(), store.NewEvent{
		ID:               token.NewID(eventIDLength),
		Title:            title,
		OrganiserKeyHash: token.Hash(organiserKey),
		Days:             days,
		Organiser: store.NewParticipant{
			ID:        token.NewID(participantIDLength),
			Name:      name,
			NameKey:   nameKey,
			TokenHash: token.Hash(participantToken),
		},
	})
	if err != nil {
		a.fail(w, r, err)
		return
	}

	// The caller is the organiser and now holds both credentials.
	me := ev.Participants[0].ID
	writeJSON(w, http.StatusCreated, struct {
		Event            eventJSON `json:"event"`
		ParticipantToken string    `json:"participant_token"`
		OrganiserKey     string    `json:"organiser_key"`
	}{view(ev, caller{me: &me, canManage: true}), participantToken, organiserKey})
}

func (a *api) getEvent(w http.ResponseWriter, r *http.Request) {
	ev, c, ok := a.load(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, view(ev, c))
}

func (a *api) join(w http.ResponseWriter, r *http.Request) {
	if !a.allow(w, r, a.joins) {
		return
	}
	_, c, ok := a.load(w, r)
	if !ok {
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		a.fail(w, r, err)
		return
	}
	name, nameKey, err := domain.NormalizeName(body.Name)
	if err != nil {
		a.fail(w, r, validation(err, ""))
		return
	}

	id := token.NewID(participantIDLength)
	participantToken := token.NewSecret(participantPrefix)
	ev, err := a.store.AddParticipant(r.Context(), r.PathValue("id"), store.NewParticipant{
		ID: id, Name: name, NameKey: nameKey, TokenHash: token.Hash(participantToken),
	}, a.maxParticipants)
	if err != nil {
		a.fail(w, r, storeError(err))
		return
	}
	a.publish(ev.ID, ev.Version, hub.KindParticipants, &id)

	c.me = &id
	writeJSON(w, http.StatusCreated, struct {
		Event            eventJSON `json:"event"`
		ParticipantToken string    `json:"participant_token"`
	}{view(ev, c), participantToken})
}

type pairInput struct {
	Date string `json:"date"`
	Slot string `json:"slot"`
}

func (a *api) changeAbsences(w http.ResponseWriter, r *http.Request) {
	ev, c, ok := a.load(w, r)
	if !ok {
		return
	}
	if c.me == nil {
		unauthorized(w, "marking absences needs the token of a participant of this event")
		return
	}
	var body struct {
		Set   []pairInput `json:"set"`
		Clear []pairInput `json:"clear"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		a.fail(w, r, err)
		return
	}
	set, err := candidatePairs(ev, "set", body.Set)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	clear, err := candidatePairs(ev, "clear", body.Clear)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	inSet := make(map[domain.Pair]bool, len(set))
	for _, p := range set {
		inSet[p] = true
	}
	for _, p := range clear {
		if inSet[p] {
			a.fail(w, r, invalid("set, clear: %s %s is in both", p.Date, p.Slot))
			return
		}
	}

	ev, err = a.store.ChangeAbsences(r.Context(), ev.ID, *c.me, set, clear)
	if errors.Is(err, store.ErrNotFound) {
		// The event was there a moment ago: the participant was removed
		// between the check of the token and the change.
		unauthorized(w, "the participant is no longer in this event")
		return
	}
	if err != nil {
		a.fail(w, r, storeError(err))
		return
	}
	a.publish(ev.ID, ev.Version, hub.KindAbsences, c.me)
	writeJSON(w, http.StatusOK, view(ev, c))
}

// candidatePairs checks that every pair of a list is a candidate of the
// event and returns the list without repetitions.
func candidatePairs(ev domain.Event, field string, in []pairInput) ([]domain.Pair, error) {
	out := make([]domain.Pair, 0, len(in))
	seen := make(map[domain.Pair]bool, len(in))
	for _, p := range in {
		pair := domain.Pair{Date: p.Date, Slot: domain.Slot(p.Slot)}
		if !ev.IsCandidate(pair) {
			return nil, invalid("%s: %q %q is not a candidate of this event", field, p.Date, p.Slot)
		}
		if !seen[pair] {
			seen[pair] = true
			out = append(out, pair)
		}
	}
	return out, nil
}

// setStatus serves both close and reopen.
func (a *api) setStatus(w http.ResponseWriter, r *http.Request) {
	_, c, ok := a.load(w, r)
	if !ok {
		return
	}
	if !c.canManage {
		unauthorized(w, "closing and reopening need the organiser key of this event")
		return
	}
	status := domain.StatusClosed
	if strings.HasSuffix(r.URL.Path, "/reopen") {
		status = domain.StatusOpen
	}
	ev, changed, err := a.store.SetStatus(r.Context(), r.PathValue("id"), status)
	if err != nil {
		a.fail(w, r, storeError(err))
		return
	}
	if changed {
		a.publish(ev.ID, ev.Version, hub.KindStatus, c.me)
	}
	writeJSON(w, http.StatusOK, view(ev, c))
}

func (a *api) removeParticipant(w http.ResponseWriter, r *http.Request) {
	_, c, ok := a.load(w, r)
	if !ok {
		return
	}
	if !c.canManage {
		unauthorized(w, "removing a participant needs the organiser key of this event")
		return
	}
	removed := r.PathValue("pid")
	ev, err := a.store.RemoveParticipant(r.Context(), r.PathValue("id"), removed)
	if err != nil {
		a.fail(w, r, storeError(err))
		return
	}
	a.publish(ev.ID, ev.Version, hub.KindParticipants, c.me)
	if c.me != nil && *c.me == removed {
		c.me = nil
	}
	writeJSON(w, http.StatusOK, view(ev, c))
}

// load reads the event of the request's path and works out the caller. It
// answers the request itself, and reports false, when the event does not
// exist or can not be read.
func (a *api) load(w http.ResponseWriter, r *http.Request) (domain.Event, caller, bool) {
	ev, err := a.store.GetEvent(r.Context(), r.PathValue("id"))
	if err != nil {
		a.fail(w, r, storeError(err))
		return domain.Event{}, caller{}, false
	}
	c, err := a.identify(r, ev.ID)
	if err != nil {
		a.fail(w, r, err)
		return domain.Event{}, caller{}, false
	}
	return ev, c, true
}

// ---- errors -----------------------------------------------------------

func invalid(format string, args ...any) error {
	return &apiError{http.StatusUnprocessableEntity, codeValidationFailed, fmt.Sprintf(format, args...)}
}

// validation turns a domain validation error into a 422 whose message
// starts with the name of the field. field, when given, replaces the name
// the domain uses with the one the request uses.
func validation(err error, field string) error {
	var ve *domain.ValidationError
	if !errors.As(err, &ve) {
		return err
	}
	if field == "" {
		field = ve.Field
	}
	return invalid("%s: %s", field, ve.Message)
}

// storeError gives the store's outcomes their place in the contract.
func storeError(err error) error {
	switch {
	case errors.Is(err, store.ErrNotFound):
		return &apiError{http.StatusNotFound, codeNotFound, "not found"}
	case errors.Is(err, store.ErrClosed):
		return &apiError{http.StatusConflict, codeEventClosed, "the event is closed"}
	case errors.Is(err, store.ErrNameTaken):
		return &apiError{http.StatusConflict, codeNameTaken, "this name is already in the event"}
	case errors.Is(err, store.ErrTooManyParticipants):
		return &apiError{http.StatusConflict, codeTooManyParticipants, "the event is full"}
	case errors.Is(err, store.ErrIsOrganiser):
		return &apiError{http.StatusConflict, codeCannotRemoveOrganiser, "the organiser can not be removed"}
	}
	return err
}
