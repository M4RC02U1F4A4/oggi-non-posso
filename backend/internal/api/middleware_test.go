package api

import (
	"fmt"
	"net/http"
	"testing"
	"time"
)

const wantCSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'"

func wantSecurityHeaders(t *testing.T, res *response) {
	t.Helper()
	for name, want := range map[string]string{
		"X-Content-Type-Options":  "nosniff",
		"Referrer-Policy":         "no-referrer",
		"Content-Security-Policy": wantCSP,
	} {
		if got := res.header.Get(name); got != want {
			t.Errorf("%s = %q, want %q", name, got, want)
		}
	}
}

func TestSecurityHeadersOnTheAPI(t *testing.T) {
	h := newHarness(t)
	id := h.create().Event.ID
	for _, req := range []struct {
		method, path string
		status       int
	}{
		{"GET", "/api/events/" + id, 200},
		{"GET", "/api/events/nosuchevent0", 404},
		{"POST", "/api/events", 400},
		{"GET", "/api/nope", 404},
		{"GET", "/healthz", 200},
		{"GET", "/", 404},
	} {
		t.Run(req.method+" "+req.path, func(t *testing.T) {
			res := h.do(req.method, req.path, nil, creds{})
			if res.status != req.status {
				t.Fatalf("status = %d, want %d", res.status, req.status)
			}
			wantSecurityHeaders(t, res)
		})
	}
}

func TestHealthz(t *testing.T) {
	h := newHarness(t)
	res := h.do("GET", "/healthz", nil, creds{})
	if res.status != http.StatusOK || string(res.body) != "ok" {
		t.Fatalf("GET /healthz = %d %q", res.status, res.body)
	}
	if got := res.header.Get("Content-Type"); got != "text/plain; charset=utf-8" {
		t.Fatalf("Content-Type = %q", got)
	}
	h.do("POST", "/healthz", nil, creds{}).wantError(http.StatusNotFound, "not_found")
}

func limited(o *Options) { o.RateLimit = true }

func TestRateLimitOnCreation(t *testing.T) {
	h := newHarness(t, limited)

	for i := range 10 {
		if res := h.do("POST", "/api/events", dinner(), creds{}); res.status != http.StatusCreated {
			t.Fatalf("creation %d: status %d", i+1, res.status)
		}
		h.clock.advance(time.Minute)
	}

	// The eleventh in the hour, ten minutes after the first.
	res := h.do("POST", "/api/events", dinner(), creds{})
	res.wantError(http.StatusTooManyRequests, "rate_limited")
	if got := res.header.Get("Retry-After"); got != "3000" {
		t.Fatalf("Retry-After = %q, want 3000 (50 minutes)", got)
	}
	wantSecurityHeaders(t, res)
	if got := res.header.Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q", got)
	}

	t.Run("requests that would fail anyway are counted and refused too", func(t *testing.T) {
		h.do("POST", "/api/events", `{`, creds{}).wantError(http.StatusTooManyRequests, "rate_limited")
	})
	t.Run("another address is not affected", func(t *testing.T) {
		h.do("POST", "/api/events", dinner(), creds{from: "198.51.100.7:40000"}).wantStatus(http.StatusCreated)
	})
	t.Run("the port is not part of the address", func(t *testing.T) {
		h.do("POST", "/api/events", dinner(), creds{from: "192.0.2.1:9"}).wantError(http.StatusTooManyRequests, "rate_limited")
	})
	t.Run("reading is not limited", func(t *testing.T) {
		h.do("GET", "/api/events/nosuchevent0", nil, creds{}).wantError(http.StatusNotFound, "not_found")
	})
	t.Run("Retry-After is rounded up to a whole second", func(t *testing.T) {
		h.clock.advance(50*time.Minute - 1500*time.Millisecond)
		res := h.do("POST", "/api/events", dinner(), creds{})
		res.wantError(http.StatusTooManyRequests, "rate_limited")
		if got := res.header.Get("Retry-After"); got != "2" {
			t.Fatalf("Retry-After = %q, want 2", got)
		}
	})
	t.Run("one more after the window passes", func(t *testing.T) {
		h.clock.advance(1500 * time.Millisecond)
		h.do("POST", "/api/events", dinner(), creds{}).wantStatus(http.StatusCreated)
	})
}

func TestRateLimitOnJoining(t *testing.T) {
	h := newHarness(t, limited)
	id := h.create().Event.ID
	join := func(i int, c creds) *response {
		return h.do("POST", "/api/events/"+id+"/participants", map[string]string{"name": fmt.Sprintf("Luca %d", i)}, c)
	}

	for i := range 30 {
		if res := join(i, creds{}); res.status != http.StatusCreated {
			t.Fatalf("join %d: status %d: %s", i+1, res.status, res.body)
		}
	}
	res := join(30, creds{})
	res.wantError(http.StatusTooManyRequests, "rate_limited")
	if got := res.header.Get("Retry-After"); got != "3600" {
		t.Fatalf("Retry-After = %q, want 3600", got)
	}

	// Joining has its own count: this address can still create events.
	h.do("POST", "/api/events", dinner(), creds{}).wantStatus(http.StatusCreated)
	// And someone else can still join.
	join(30, creds{from: "198.51.100.7:40000"}).wantStatus(http.StatusCreated)

	h.clock.advance(time.Hour)
	join(31, creds{}).wantStatus(http.StatusCreated)
}

func TestRateLimitOff(t *testing.T) {
	h := newHarness(t) // Options.RateLimit is false
	for i := range 12 {
		if res := h.do("POST", "/api/events", dinner(), creds{}); res.status != http.StatusCreated {
			t.Fatalf("creation %d: status %d", i+1, res.status)
		}
	}
}

func TestClientIPHeader(t *testing.T) {
	h := newHarness(t, limited, func(o *Options) { o.ClientIPHeader = "X-Forwarded-For" })
	// Every request arrives from the same proxy.
	via := func(forwarded string) creds {
		c := creds{from: "192.0.2.10:5000"}
		if forwarded != "" {
			c.headers = map[string]string{"X-Forwarded-For": forwarded}
		}
		return c
	}
	create := func(c creds) int { return h.do("POST", "/api/events", dinner(), c).status }

	// The last element is the one the proxy added: what comes before it is
	// whatever the client sent.
	for i := range 10 {
		if status := create(via(fmt.Sprintf("203.0.113.%d, 198.51.100.7", i))); status != http.StatusCreated {
			t.Fatalf("creation %d: status %d", i+1, status)
		}
	}
	if status := create(via("203.0.113.99 ,198.51.100.7 ")); status != http.StatusTooManyRequests {
		t.Fatalf("eleventh creation from 198.51.100.7: status %d, want 429", status)
	}
	if status := create(via("198.51.100.7, 198.51.100.8")); status != http.StatusCreated {
		t.Fatalf("first creation from 198.51.100.8: status %d", status)
	}
	if status := create(via("198.51.100.9")); status != http.StatusCreated {
		t.Fatalf("a single element: status %d", status)
	}
	// Without the header the connection's address counts.
	for i := range 10 {
		if status := create(via("")); status != http.StatusCreated {
			t.Fatalf("creation %d without the header: status %d", i+1, status)
		}
	}
	if status := create(via("")); status != http.StatusTooManyRequests {
		t.Fatalf("eleventh creation without the header: status %d, want 429", status)
	}
}

func TestClientIPHeaderIgnoredWhenNotConfigured(t *testing.T) {
	h := newHarness(t, limited)
	for i := range 10 {
		c := creds{headers: map[string]string{"X-Forwarded-For": fmt.Sprintf("203.0.113.%d", i)}}
		if res := h.do("POST", "/api/events", dinner(), c); res.status != http.StatusCreated {
			t.Fatalf("creation %d: status %d", i+1, res.status)
		}
	}
	c := creds{headers: map[string]string{"X-Forwarded-For": "203.0.113.200"}}
	h.do("POST", "/api/events", dinner(), c).wantError(http.StatusTooManyRequests, "rate_limited")
}
