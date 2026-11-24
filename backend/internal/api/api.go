// Package api is the HTTP face of the service: the JSON API of the design
// document. It holds no interface text and returns no HTML.
package api

import (
	"log/slog"
	"net/http"
	"path"

	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/hub"
	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/store"
)

// Update is what the API publishes after every change to an event.
type Update = hub.Update

// Notifier receives an Update after every successful change.
type Notifier interface {
	Publish(eventID string, u Update)
}

// Options is what the API is built from.
type Options struct {
	Store store.Store
	// Notifier may be nil: changes are then not announced.
	Notifier Notifier
	// MaxParticipants is the most participants an event can hold.
	MaxParticipants int
	// Logger may be nil: nothing is logged then.
	Logger *slog.Logger
}

type api struct {
	store           store.Store
	notifier        Notifier
	maxParticipants int
	log             *slog.Logger
}

// New returns the handler of the service.
func New(o Options) http.Handler {
	a := &api{
		store:           o.Store,
		notifier:        o.Notifier,
		maxParticipants: o.MaxParticipants,
		log:             o.Logger,
	}
	if a.log == nil {
		a.log = slog.New(slog.DiscardHandler)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/events", a.createEvent)
	mux.HandleFunc("GET /api/events/{id}", a.getEvent)
	mux.HandleFunc("POST /api/events/{id}/participants", a.join)
	mux.HandleFunc("PUT /api/events/{id}/absences", a.changeAbsences)
	mux.HandleFunc("POST /api/events/{id}/close", a.setStatus)
	mux.HandleFunc("POST /api/events/{id}/reopen", a.setStatus)
	mux.HandleFunc("DELETE /api/events/{id}/participants/{pid}", a.removeParticipant)
	// Everything else, a known path with another method included, is a
	// JSON 404: with this catch-all the mux never answers on its own.
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) { notFound(w) })

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// The mux would answer a path that is not in its clean form with a
		// redirect and a line of HTML.
		if path.Clean(r.URL.Path) != r.URL.Path {
			notFound(w)
			return
		}
		mux.ServeHTTP(w, r)
	})
}

// publish announces a change. by is the participant who caused it, or nil.
func (a *api) publish(eventID string, version int64, kind string, by *string) {
	if a.notifier != nil {
		a.notifier.Publish(eventID, Update{Version: version, Kind: kind, By: by})
	}
}
