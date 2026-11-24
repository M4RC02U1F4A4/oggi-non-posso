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
		h.do("POST", "/api/events", dinner(), creds{from: "192.0.2.107:40000"}).wantStatus(http.StatusCreated)
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
	join(30, creds{from: "192.0.2.107:40000"}).wantStatus(http.StatusCreated)

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
		if status := create(via(fmt.Sprintf("192.0.2.2%d, 192.0.2.107", i))); status != http.StatusCreated {
			t.Fatalf("creation %d: status %d", i+1, status)
		}
	}
	if status := create(via("192.0.2.99 ,192.0.2.107 ")); status != http.StatusTooManyRequests {
		t.Fatalf("eleventh creation from 192.0.2.107: status %d, want 429", status)
	}
	if status := create(via("192.0.2.107, 192.0.2.108")); status != http.StatusCreated {
		t.Fatalf("first creation from 192.0.2.108: status %d", status)
	}
	if status := create(via("192.0.2.109")); status != http.StatusCreated {
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
		c := creds{headers: map[string]string{"X-Forwarded-For": fmt.Sprintf("192.0.2.2%d", i)}}
		if res := h.do("POST", "/api/events", dinner(), c); res.status != http.StatusCreated {
			t.Fatalf("creation %d: status %d", i+1, res.status)
		}
	}
	c := creds{headers: map[string]string{"X-Forwarded-For": "192.0.2.200"}}
	h.do("POST", "/api/events", dinner(), c).wantError(http.StatusTooManyRequests, "rate_limited")
}

func TestAddressKey(t *testing.T) {
	for in, want := range map[string]string{
		"192.0.2.7":                   "192.0.2.7",
		"::ffff:192.0.2.7":            "192.0.2.7",
		"::ffff:c000:207":             "192.0.2.7",
		"2001:db8:0:1::1":             "2001:db8:0:1::/64",
		"2001:db8:0:1:ffff:ffff:0:2":  "2001:db8:0:1::/64",
		"2001:0db8:0000:0001:0:0:0:3": "2001:db8:0:1::/64",
		"2001:db8:0:2::1":             "2001:db8:0:2::/64",
		"2001:db8:0:1::1%eth0":        "2001:db8:0:1::/64",
		"2001:db8::":                  "2001:db8::/64",
	} {
		if got, ok := addressKey(in); !ok || got != want {
			t.Errorf("addressKey(%q) = %q, %v; want %q", in, got, ok, want)
		}
	}
	for _, in := range []string{"", "garbage", "not-an-ip", "192.0.2.7:1234", "192.0.2", "192.0.2.7/24", "[2001:db8::1]", " 192.0.2.7"} {
		if got, ok := addressKey(in); ok {
			t.Errorf("addressKey(%q) = %q, want it refused", in, got)
		}
	}
}

// creations makes n creations and returns the status of the last one.
func creations(h *harness, n int, c creds) int {
	status := 0
	for range n {
		status = h.do("POST", "/api/events", dinner(), c).status
	}
	return status
}

func TestRateLimitCountsAnIPv6Network(t *testing.T) {
	h := newHarness(t, limited)

	// One subscriber owns a whole /64 and can rotate through it.
	for i := range 10 {
		from := fmt.Sprintf("[2001:db8:0:1:%x::%x]:40000", i+1, i+1)
		if status := creations(h, 1, creds{from: from}); status != http.StatusCreated {
			t.Fatalf("creation %d from %s: status %d", i+1, from, status)
		}
	}
	if status := creations(h, 1, creds{from: "[2001:db8:0:1:ffff:ffff:ffff:ffff]:40000"}); status != http.StatusTooManyRequests {
		t.Fatalf("eleventh creation from the same /64: status %d, want 429", status)
	}
	if status := creations(h, 1, creds{from: "[2001:db8:0:1::1%eth0]:40000"}); status != http.StatusTooManyRequests {
		t.Fatalf("the same /64 with a zone: status %d, want 429", status)
	}
	// Another /64 has its own budget.
	if status := creations(h, 10, creds{from: "[2001:db8:0:2::1]:40000"}); status != http.StatusCreated {
		t.Fatalf("tenth creation from another /64: status %d", status)
	}
	if status := creations(h, 1, creds{from: "[2001:db8:0:2::2]:40000"}); status != http.StatusTooManyRequests {
		t.Fatalf("eleventh creation from the other /64: status %d, want 429", status)
	}
}

func TestRateLimitCountsMappedIPv4AsIPv4(t *testing.T) {
	h := newHarness(t, limited)
	if status := creations(h, 5, creds{from: "192.0.2.7:40000"}); status != http.StatusCreated {
		t.Fatalf("status %d", status)
	}
	if status := creations(h, 5, creds{from: "[::ffff:192.0.2.7]:40000"}); status != http.StatusCreated {
		t.Fatalf("status %d", status)
	}
	for _, from := range []string{"192.0.2.7:40001", "[::ffff:192.0.2.7]:40001"} {
		if status := creations(h, 1, creds{from: from}); status != http.StatusTooManyRequests {
			t.Fatalf("eleventh creation, from %s: status %d, want 429", from, status)
		}
	}
	// Its neighbour is someone else.
	if status := creations(h, 1, creds{from: "192.0.2.8:40000"}); status != http.StatusCreated {
		t.Fatalf("another IPv4 address: status %d", status)
	}
}

func TestClientIPHeaderIsNormalised(t *testing.T) {
	h := newHarness(t, limited, func(o *Options) { o.ClientIPHeader = "X-Forwarded-For" })
	via := func(forwarded string) creds {
		return creds{from: "192.0.2.10:5000", headers: map[string]string{"X-Forwarded-For": forwarded}}
	}

	if status := creations(h, 4, via("2001:db8:0:1::1")); status != http.StatusCreated {
		t.Fatalf("status %d", status)
	}
	if status := creations(h, 3, via("192.0.2.50, 2001:db8:0:1:a:b:c:d")); status != http.StatusCreated {
		t.Fatalf("status %d", status)
	}
	if status := creations(h, 3, via("2001:0DB8:0:1::2 ")); status != http.StatusCreated {
		t.Fatalf("status %d", status)
	}
	if status := creations(h, 1, via("2001:db8:0:1::3")); status != http.StatusTooManyRequests {
		t.Fatalf("eleventh creation from the same /64: status %d, want 429", status)
	}
	if status := creations(h, 5, via("::ffff:192.0.2.7")); status != http.StatusCreated {
		t.Fatalf("status %d", status)
	}
	if status := creations(h, 5, via("192.0.2.7")); status != http.StatusCreated {
		t.Fatalf("status %d", status)
	}
	if status := creations(h, 1, via("192.0.2.7")); status != http.StatusTooManyRequests {
		t.Fatalf("eleventh creation from 192.0.2.7 in two spellings: status %d, want 429", status)
	}
}

func TestClientIPHeaderThatIsNotAnAddress(t *testing.T) {
	h := newHarness(t, limited, func(o *Options) { o.ClientIPHeader = "X-Forwarded-For" })
	proxy := func(port int, forwarded string) creds {
		return creds{from: fmt.Sprintf("192.0.2.10:%d", port), headers: map[string]string{"X-Forwarded-For": forwarded}}
	}

	// None of these is used as a key: each falls back to the address of
	// the connection, so together they share its budget.
	values := []string{
		"garbage",
		"192.0.2.4, not-an-ip",
		"192.0.2.5,",
		"",
		"192.0.2.6:1234",
		"garbage-1", "garbage-2", "garbage-3", "garbage-4", "garbage-5",
	}
	for i, v := range values {
		if status := creations(h, 1, proxy(5000+i, v)); status != http.StatusCreated {
			t.Fatalf("creation %d (%q): status %d", i+1, v, status)
		}
	}
	if status := creations(h, 1, proxy(6000, "garbage-6")); status != http.StatusTooManyRequests {
		t.Fatalf("eleventh creation with a header that is not an address: status %d, want 429", status)
	}
	// The same connection address without the header is the same key.
	if status := creations(h, 1, creds{from: "192.0.2.10:7000"}); status != http.StatusTooManyRequests {
		t.Fatalf("the connection address itself: status %d, want 429", status)
	}
	// "192.0.2.4, not-an-ip" did not count for 192.0.2.4.
	if status := creations(h, 10, proxy(5000, "192.0.2.4")); status != http.StatusCreated {
		t.Fatalf("tenth creation from 192.0.2.4: status %d", status)
	}
}
