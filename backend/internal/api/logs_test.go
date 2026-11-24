package api

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/domain"
	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/store"
)

// logBuffer collects what a logger writes, at every level.
type logBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *logBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *logBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func (b *logBuffer) logger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(b, &slog.HandlerOptions{Level: slog.LevelDebug}))
}

func TestRouteName(t *testing.T) {
	const (
		id  = "3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10"
		key = "5a1f0c9e-3b7d-4e2a-9c48-6d0f1e2a3b4c"
	)
	// The name of the route each request is logged under, taken after the
	// request was served. It never holds a part of the path.
	cases := []struct {
		method, path string
		static       string // with the frontend
		apiOnly      string // without
	}{
		{"GET", "/api/events/" + id, "GET /api/events/{id}", "GET /api/events/{id}"},
		{"PUT", "/api/events/" + id + "/absences", "PUT /api/events/{id}/absences", "PUT /api/events/{id}/absences"},
		{"POST", "/api/events/" + id + "/close", "POST /api/events/{id}/close", "POST /api/events/{id}/close"},
		{"DELETE", "/api/events/" + id + "/participants/Zr4h1TqPwm", "DELETE /api/events/{id}/participants/{pid}", "DELETE /api/events/{id}/participants/{pid}"},
		{"POST", "/api/events", "POST /api/events", "POST /api/events"},
		{"GET", "/api/events/" + id + "/o/" + key, "unmatched", "unmatched"},
		{"PATCH", "/api/events/" + id, "unmatched", "unmatched"},
		{"GET", "/api//events/" + id, "unmatched", "unmatched"},
		{"GET", "/api", "unmatched", "unmatched"},
		{"GET", "/healthz", "healthz", "healthz"},
		{"GET", "/e/" + id, "static", "unmatched"},
		{"GET", "/e/" + id + "/o/" + key, "static", "unmatched"},
		{"GET", "/assets/app-3f9a1c.js", "static", "unmatched"},
		{"GET", "/", "static", "unmatched"},
	}
	for _, withStatic := range []bool{true, false} {
		h := newHarness(t)
		if withStatic {
			h = staticHarness(t)
		}
		for _, c := range cases {
			want := c.apiOnly
			if withStatic {
				want = c.static
			}
			// Serve the request, then ask for its name as a log call would.
			req := httptest.NewRequest(c.method, c.path, nil)
			h.handler.ServeHTTP(httptest.NewRecorder(), req)
			got := h.api.routeName(req)
			if got != want {
				t.Errorf("static %v: %s %s is logged as %q, want %q", withStatic, c.method, c.path, got, want)
			}
			if strings.Contains(got, id) || strings.Contains(got, key) {
				t.Errorf("the route name %q holds a part of the path", got)
			}
		}
	}
}

func TestPanicIsLoggedWithoutIDOrKey(t *testing.T) {
	const (
		id  = "3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10"
		key = "5a1f0c9e-3b7d-4e2a-9c48-6d0f1e2a3b4c"
	)
	// A handler that panics while serving the organiser link itself.
	var out logBuffer
	a := &api{log: out.logger(), staticDir: t.TempDir()}
	handler := a.recovered(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("something is broken")
	}))

	req := httptest.NewRequest("GET", "/e/"+id+"/o/"+key+"?x="+key, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	res := &response{t: t, status: rec.Code, header: rec.Header(), body: rec.Body.Bytes()}
	res.wantError(http.StatusInternalServerError, "internal")

	logged := out.String()
	for _, secret := range []string{id, key} {
		if strings.Contains(logged, secret) {
			t.Fatalf("%s is in the log:\n%s", secret, logged)
		}
	}
	for _, want := range []string{"something is broken", `"route":"static"`, `"level":"ERROR"`, `"method":"GET"`} {
		if !strings.Contains(logged, want) {
			t.Fatalf("the log does not hold %q:\n%s", want, logged)
		}
	}
}

func TestAbortedHandlerIsNotSwallowed(t *testing.T) {
	var out logBuffer
	a := &api{log: out.logger()}
	handler := a.recovered(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic(http.ErrAbortHandler)
	}))

	defer func() {
		if v := recover(); v != http.ErrAbortHandler {
			t.Fatalf("recovered %v, want http.ErrAbortHandler to pass through", v)
		}
		if out.String() != "" {
			t.Fatalf("an aborted handler was logged:\n%s", out.String())
		}
	}()
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))
}

// brokenStore fails or panics on demand when an event is read.
type brokenStore struct {
	store.Store
	mu    sync.Mutex
	fail  bool
	panic bool
}

func (b *brokenStore) set(fail, panics bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.fail, b.panic = fail, panics
}

func (b *brokenStore) GetEvent(ctx context.Context, id string) (domain.Event, error) {
	b.mu.Lock()
	fail, panics := b.fail, b.panic
	b.mu.Unlock()
	if panics {
		panic("the store is broken")
	}
	if fail {
		return domain.Event{}, errors.New("the database is gone")
	}
	return b.Store.GetEvent(ctx, id)
}

func TestNoLinkReachesTheLog(t *testing.T) {
	// Both unique links are capabilities: the event id opens the event,
	// the organiser key manages it. Neither may be in anything the service
	// logs while it serves the links and the requests that follow from
	// them, failures and panics included.
	var out logBuffer
	broken := &brokenStore{}
	h := staticHarness(t, func(o *Options) {
		broken.Store = o.Store
		o.Store = broken
		o.Logger = out.logger()
	})
	created := h.create()
	id, key := created.Event.ID, created.OrganiserKey
	organiser := creds{token: created.ParticipantToken, key: key}
	link := "/e/" + id + "/o/" + key

	// The organiser link, as the browser asks for it and in the shapes a
	// path can take.
	for _, path := range []string{link, link + "/", link + "?from=chat", "/e/" + id + "/O/" + key, "/e/" + id + "/o//" + key} {
		if res := h.do("GET", path, nil, creds{}); res.status != http.StatusOK || string(res.body) != indexHTML {
			t.Fatalf("GET %s = %d", path, res.status)
		}
	}
	h.do("POST", link, nil, creds{}).wantError(http.StatusNotFound, "not_found")
	h.do("GET", "/api/events/"+id+"/o/"+key, nil, creds{}).wantError(http.StatusNotFound, "not_found")

	// The requests the page makes with the key.
	h.do("GET", "/api/events/"+id, nil, organiser).event(http.StatusOK)
	h.do("POST", "/api/events/"+id+"/close", nil, organiser).event(http.StatusOK)
	h.do("POST", "/api/events/"+id+"/reopen", nil, organiser).event(http.StatusOK)
	h.do("DELETE", "/api/events/"+id+"/participants/nobody", nil, organiser).wantError(http.StatusNotFound, "not_found")

	// A failure and a panic while the id is in the path and the key on
	// the request.
	mark := change{Set: []pair{{"2026-12-12", "dinner"}}}
	broken.set(true, false)
	h.do("GET", "/api/events/"+id, nil, organiser).wantError(http.StatusInternalServerError, "internal")
	h.do("POST", "/api/events/"+id+"/close", nil, organiser).wantError(http.StatusInternalServerError, "internal")
	broken.set(false, true)
	h.do("GET", "/api/events/"+id, nil, organiser).wantError(http.StatusInternalServerError, "internal")
	h.do("PUT", "/api/events/"+id+"/absences", mark, organiser).wantError(http.StatusInternalServerError, "internal")

	logged := out.String()
	for _, secret := range []string{id, strings.ToUpper(id), key, strings.ToUpper(key), created.ParticipantToken} {
		if strings.Contains(logged, secret) {
			t.Fatalf("%s is in the log:\n%s", secret, logged)
		}
	}
	// The log was listening: the failures and the panics are there, under
	// the pattern of their route.
	for _, want := range []string{
		"request failed", "the database is gone", "panic serving a request", "the store is broken",
		`"route":"GET /api/events/{id}"`, `"route":"POST /api/events/{id}/close"`,
		`"route":"PUT /api/events/{id}/absences"`, `"method":"PUT"`,
	} {
		if !strings.Contains(logged, want) {
			t.Fatalf("the log does not hold %q:\n%s", want, logged)
		}
	}
}
