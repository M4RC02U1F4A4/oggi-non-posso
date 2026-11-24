package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/store"
	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/token"
)

// Credentials travel in headers only. A participant token carries a
// prefix; an organiser key is a bare UUID.
const (
	organiserKeyHeader = "X-Organiser-Key"
	participantPrefix  = "p_"
)

// caller is who a request comes from, as far as one event is concerned.
type caller struct {
	me        *string // the caller's participant id in this event, or nil
	canManage bool    // the request carried this event's organiser key
}

// identify works out the caller from the request's credentials. A missing,
// unknown or foreign credential is not an error: the caller is simply
// nobody. Handlers that need a credential check the result.
func (a *api) identify(r *http.Request, eventID string) (caller, error) {
	var c caller

	if secret, ok := bearer(r); ok && strings.HasPrefix(secret, participantPrefix) {
		id, err := a.store.ParticipantByToken(r.Context(), eventID, token.Hash(secret))
		switch {
		case err == nil:
			c.me = &id
		case !errors.Is(err, store.ErrNotFound):
			return caller{}, err
		}
	}

	// A key that is not written as a UUID can not be a key: it counts as
	// absent and nothing is looked up.
	if key := r.Header.Get(organiserKeyHeader); token.IsUUID(key) {
		ok, err := a.store.IsOrganiserKey(r.Context(), eventID, token.Hash(key))
		switch {
		case err == nil:
			c.canManage = ok
		case !errors.Is(err, store.ErrNotFound):
			return caller{}, err
		}
	}
	return c, nil
}

// bearer returns the credential of an "Authorization: Bearer ..." header.
func bearer(r *http.Request) (string, bool) {
	scheme, secret, ok := strings.Cut(r.Header.Get("Authorization"), " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") {
		return "", false
	}
	return strings.TrimSpace(secret), true
}
