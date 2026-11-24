// Package api is the HTTP face of the service: the JSON API of the design
// document, its stream of live updates, the health check and, when a
// directory is configured, the files of the built frontend. It holds no
// interface text and produces no HTML of its own.
package api

import (
	"log/slog"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/hub"
	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/ratelimit"
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
	// Updates feeds the streams. It may be nil: there is no stream then.
	Updates Subscriber
	// PingInterval is the time between two comment lines on an idle
	// stream; zero means 25 seconds.
	PingInterval time.Duration
	// RateLimit turns on the limits on creating events and joining.
	RateLimit bool
	// ClientIPHeader names the header that holds the client address behind
	// a trusted proxy; empty uses the address of the connection.
	ClientIPHeader string
	// StaticDir is the directory of the built frontend; empty serves the
	// API only.
	StaticDir string
}

type api struct {
	store           store.Store
	notifier        Notifier
	maxParticipants int
	log             *slog.Logger
	updates         Subscriber
	pingInterval    time.Duration
	clientIPHeader  string
	staticDir       string
	creations       *ratelimit.Limiter // nil when rate limits are off
	joins           *ratelimit.Limiter // nil when rate limits are off
	streams         *ratelimit.Gate    // bounds the open streams; always on
	mux             *http.ServeMux     // the routes under /api
	handler         http.Handler       // everything, behind the middleware
}

// New returns the handler of the service: the API under /api, the health
// check, and the built frontend when there is one.
func New(o Options) http.Handler { return build(o, time.Now).handler }

// build makes the API of New, with the clock of the rate limits given.
func build(o Options, now func() time.Time) *api {
	a := &api{
		store:           o.Store,
		notifier:        o.Notifier,
		maxParticipants: o.MaxParticipants,
		log:             o.Logger,
		updates:         o.Updates,
		pingInterval:    o.PingInterval,
		clientIPHeader:  o.ClientIPHeader,
		staticDir:       o.StaticDir,
		streams:         ratelimit.NewGate(ratelimit.MaxStreamsPerKey, ratelimit.MaxStreams),
	}
	if a.log == nil {
		a.log = slog.New(slog.DiscardHandler)
	}
	if a.pingInterval <= 0 {
		a.pingInterval = defaultPingInterval
	}
	if o.RateLimit {
		a.creations = ratelimit.New(creationsPerWindow, rateWindow, now)
		a.joins = ratelimit.New(joinsPerWindow, rateWindow, now)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/events", a.createEvent)
	mux.HandleFunc("GET /api/events/{id}", a.getEvent)
	mux.HandleFunc("POST /api/events/{id}/participants", a.join)
	mux.HandleFunc("PUT /api/events/{id}/absences", a.changeAbsences)
	mux.HandleFunc("POST /api/events/{id}/close", a.setStatus)
	mux.HandleFunc("POST /api/events/{id}/reopen", a.setStatus)
	mux.HandleFunc("DELETE /api/events/{id}/participants/{pid}", a.removeParticipant)
	if a.updates != nil {
		mux.HandleFunc("GET /api/events/{id}/stream", a.stream)
	}
	// Everything else under /api, a known path with another method
	// included, is a JSON 404: with this catch-all the mux never answers on
	// its own.
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) { notFound(w) })
	a.mux = mux

	a.handler = securityHeaders(a.recovered(http.HandlerFunc(a.route)))
	return a
}

// isAPIPath reports whether a path belongs to the API.
func isAPIPath(p string) bool { return p == "/api" || strings.HasPrefix(p, "/api/") }

// The names requests are logged under when no pattern of the API matched.
const (
	routeHealth    = "healthz"
	routeStatic    = "static"
	routeUnmatched = "unmatched"
)

// routeName returns the name a request is logged under: the pattern of the
// API route that served it ("PUT /api/events/{id}/absences") or a fixed
// word for everything else.
//
// It is never the path, or a part of it. Both unique links are paths, and
// both are capabilities: the event id opens the event to whoever has it,
// the organiser key manages it. Neither may be in a log, so no log line of
// this package carries a request path, a query or an id of an event.
func (a *api) routeName(r *http.Request) string {
	p := r.URL.Path
	switch {
	case isAPIPath(p):
		// The mux leaves the pattern it matched on the request; "/" is its
		// catch-all, and before the mux has run there is none.
		if r.Pattern != "" && r.Pattern != "/" {
			return r.Pattern
		}
		return routeUnmatched
	case p == "/healthz":
		return routeHealth
	case a.staticDir != "":
		return routeStatic
	default:
		return routeUnmatched
	}
}

// route sends a request to the API, the health check or the frontend.
func (a *api) route(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Path
	switch {
	case isAPIPath(p):
		// The mux would answer a path that is not in its clean form with a
		// redirect and a line of HTML.
		if path.Clean(p) != p {
			notFound(w)
			return
		}
		a.mux.ServeHTTP(w, r)
	case p == "/healthz" && (r.Method == http.MethodGet || r.Method == http.MethodHead):
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("ok"))
	case a.staticDir != "" && p != "/healthz":
		a.serveStatic(w, r)
	default:
		notFound(w)
	}
}

// publish announces a change. by is the participant who caused it, or nil.
func (a *api) publish(eventID string, version int64, kind string, by *string) {
	if a.notifier != nil {
		a.notifier.Publish(eventID, Update{Version: version, Kind: kind, By: by})
	}
}
