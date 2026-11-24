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

func TestRedactPath(t *testing.T) {
	const (
		id  = "3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10"
		key = "5a1f0c9e-3b7d-4e2a-9c48-6d0f1e2a3b4c"
	)
	for in, want := range map[string]string{
		"/e/" + id + "/o/" + key:           "/e/" + id + "/o/<redacted>",
		"/e/" + id + "/o/" + key + "/":     "/e/" + id + "/o/<redacted>",
		"/e/" + id + "/o/" + key + "/more": "/e/" + id + "/o/<redacted>",
		"/e/" + id + "/o//" + key:          "/e/" + id + "/o/<redacted>",
		"/e/" + id + "/O/" + key:           "/e/" + id + "/O/<redacted>", // routes may match without case
		"/e/" + id + "/o/not-even-a-uuid":  "/e/" + id + "/o/<redacted>",
		"/o/" + key:                        "/o/<redacted>",
		"//e/" + id + "/./o/" + key:        "//e/" + id + "/./o/<redacted>",
		"/e/" + id:                         "/e/" + id,
		"/e/" + id + "/":                   "/e/" + id + "/",
		"/e/" + id + "/o":                  "/e/" + id + "/o",
		"/e/" + id + "/o/":                 "/e/" + id + "/o/",
		"/e/" + id + "/oo/" + id:           "/e/" + id + "/oo/" + id,
		"/api/events/" + id + "/close":     "/api/events/" + id + "/close",
		"/api/events/" + id + "/stream":    "/api/events/" + id + "/stream",
		"/assets/app-3f9a1c.js":            "/assets/app-3f9a1c.js",
		"/":                                "/",
		"":                                 "",
	} {
		got := redactPath(in)
		if got != want {
			t.Errorf("redactPath(%q) = %q, want %q", in, got, want)
		}
		if strings.Contains(in, "/o/"+key) && strings.Contains(got, key) {
			t.Errorf("redactPath(%q) = %q still holds the key", in, got)
		}
	}
}

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

func TestPanicIsLoggedWithoutTheOrganiserKey(t *testing.T) {
	const (
		id  = "3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10"
		key = "5a1f0c9e-3b7d-4e2a-9c48-6d0f1e2a3b4c"
	)
	var out logBuffer
	a := &api{log: out.logger()}
	handler := a.recovered(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("something is broken")
	}))

	req := httptest.NewRequest("GET", "/e/"+id+"/o/"+key+"?x="+key, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	res := &response{t: t, status: rec.Code, header: rec.Header(), body: rec.Body.Bytes()}
	res.wantError(http.StatusInternalServerError, "internal")

	logged := out.String()
	if strings.Contains(logged, key) {
		t.Fatalf("the organiser key is in the log:\n%s", logged)
	}
	for _, want := range []string{"something is broken", "/e/" + id + "/o/<redacted>", `"level":"ERROR"`, `"method":"GET"`} {
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

func TestOrganiserKeyNeverReachesTheLog(t *testing.T) {
	// Everything the service logs while it serves the organiser link and
	// the requests that carry the key, failures and panics included.
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

	// A failure and a panic while the key is on the request.
	broken.set(true, false)
	h.do("GET", "/api/events/"+id, nil, organiser).wantError(http.StatusInternalServerError, "internal")
	h.do("POST", "/api/events/"+id+"/close", nil, organiser).wantError(http.StatusInternalServerError, "internal")
	broken.set(false, true)
	h.do("GET", "/api/events/"+id, nil, organiser).wantError(http.StatusInternalServerError, "internal")
	h.do("POST", "/api/events/"+id+"/close", nil, organiser).wantError(http.StatusInternalServerError, "internal")

	logged := out.String()
	for _, secret := range []string{key, strings.ToUpper(key), created.ParticipantToken} {
		if strings.Contains(logged, secret) {
			t.Fatalf("a credential is in the log:\n%s", logged)
		}
	}
	// The log was listening: the failures and the panics are there.
	for _, want := range []string{"request failed", "the database is gone", "panic serving a request", "the store is broken"} {
		if !strings.Contains(logged, want) {
			t.Fatalf("the log does not hold %q:\n%s", want, logged)
		}
	}
}
