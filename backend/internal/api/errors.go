package api

import (
	"context"
	"errors"
	"net/http"
)

// The error codes of the API contract. The frontend maps them to its own
// text; the message that goes with them is for logs and curl.
const (
	codeInvalidRequest        = "invalid_request"
	codeUnauthorized          = "unauthorized"
	codeNotFound              = "not_found"
	codeEventClosed           = "event_closed"
	codeNameTaken             = "name_taken"
	codeTooManyParticipants   = "too_many_participants"
	codeCannotRemoveOrganiser = "cannot_remove_organiser"
	codePayloadTooLarge       = "payload_too_large"
	codeValidationFailed      = "validation_failed"
	codeRateLimited           = "rate_limited"
	codeInternal              = "internal"
)

// apiError is a failure that has a place in the contract's table.
type apiError struct {
	status  int
	code    string
	message string
}

func (e *apiError) Error() string { return e.code + ": " + e.message }

type errorBody struct {
	Error errorDetail `json:"error"`
}

type errorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorBody{Error: errorDetail{Code: code, Message: message}})
}

func notFound(w http.ResponseWriter) {
	writeError(w, http.StatusNotFound, codeNotFound, "not found")
}

func unauthorized(w http.ResponseWriter, message string) {
	writeError(w, http.StatusUnauthorized, codeUnauthorized, message)
}

// fail answers a request that could not be served. An apiError is written
// as it is; anything else is a 500 that says nothing to the client and
// everything to the log.
func (a *api) fail(w http.ResponseWriter, r *http.Request, err error) {
	var ae *apiError
	if errors.As(err, &ae) {
		writeError(w, ae.status, ae.code, ae.message)
		return
	}
	// The pattern, not the path: the path holds the event id, and the id is
	// what the share link is made of. Where a path does go to a log, it
	// goes through redactPath.
	if errors.Is(err, context.Canceled) {
		a.log.Debug("request abandoned by the client", "route", r.Pattern)
	} else {
		a.log.Error("request failed", "route", r.Pattern, "error", err)
	}
	writeError(w, http.StatusInternalServerError, codeInternal, "internal error")
}
