package api

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/hub"
)

// countingHub is a hub that knows how many subscriptions are open.
type countingHub struct {
	*hub.Hub
	open       atomic.Int32 // subscriptions open now
	subscribed atomic.Int32 // subscriptions ever made
}

func (c *countingHub) Subscribe(eventID string) (<-chan Update, func()) {
	ch, cancel := c.Hub.Subscribe(eventID)
	c.open.Add(1)
	c.subscribed.Add(1)
	var once atomic.Bool
	return ch, func() {
		if once.CompareAndSwap(false, true) {
			c.open.Add(-1)
		}
		cancel()
	}
}

// streamHarness serves the API on a real listener, wired to a real hub.
type streamHarness struct {
	t      *testing.T
	server *httptest.Server
	hub    *countingHub
}

func newStreamHarness(t *testing.T, ping time.Duration, change ...func(*Options)) *streamHarness {
	t.Helper()
	live := &countingHub{Hub: hub.New()}
	h := newHarness(t, append([]func(*Options){func(o *Options) {
		o.Notifier = live
		o.Updates = live
		o.PingInterval = ping
	}}, change...)...)
	server := httptest.NewServer(h.handler)
	t.Cleanup(server.Close)
	return &streamHarness{t: t, server: server, hub: live}
}

func (s *streamHarness) request(method, path string, body any, c creds) *http.Response {
	s.t.Helper()
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			s.t.Fatalf("marshal: %v", err)
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, s.server.URL+path, reader)
	if err != nil {
		s.t.Fatalf("request: %v", err)
	}
	if reader != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	res, err := s.server.Client().Do(req)
	if err != nil {
		s.t.Fatalf("%s %s: %v", method, path, err)
	}
	return res
}

func (s *streamHarness) create() createdView {
	s.t.Helper()
	res := s.request("POST", "/api/events", dinner(), creds{})
	defer res.Body.Close()
	var out createdView
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil || res.StatusCode != http.StatusCreated {
		s.t.Fatalf("create: status %d, %v", res.StatusCode, err)
	}
	return out
}

// stream is an open connection to an event's stream.
type stream struct {
	t      *testing.T
	res    *http.Response
	lines  chan string
	cancel context.CancelFunc
}

// open connects to an event's stream. forwarded, when given, is the value
// of the X-Forwarded-For header of the request.
func (s *streamHarness) open(eventID string, forwarded ...string) *stream {
	s.t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	req, err := http.NewRequestWithContext(ctx, "GET", s.server.URL+"/api/events/"+eventID+"/stream", nil)
	if err != nil {
		cancel()
		s.t.Fatalf("request: %v", err)
	}
	for _, f := range forwarded {
		req.Header.Set("X-Forwarded-For", f)
	}
	res, err := s.server.Client().Do(req)
	if err != nil {
		cancel()
		s.t.Fatalf("open the stream: %v", err)
	}
	st := &stream{t: s.t, res: res, lines: make(chan string, 64), cancel: cancel}
	s.t.Cleanup(st.close)
	go func() {
		defer close(st.lines)
		scanner := bufio.NewScanner(res.Body)
		for scanner.Scan() {
			st.lines <- scanner.Text()
		}
	}()
	return st
}

func (st *stream) close() {
	st.cancel()
	st.res.Body.Close()
}

func (st *stream) line() string {
	st.t.Helper()
	select {
	case l, ok := <-st.lines:
		if !ok {
			st.t.Fatal("the stream ended")
		}
		return l
	case <-time.After(5 * time.Second):
		st.t.Fatal("nothing arrived on the stream")
		return ""
	}
}

// update reads the next "update" event and returns its data line as sent,
// skipping the pings before it.
func (st *stream) update() string {
	st.t.Helper()
	for {
		l := st.line()
		if l == "" || strings.HasPrefix(l, ":") {
			continue
		}
		if l != "event: update" {
			st.t.Fatalf("line %q, want %q", l, "event: update")
		}
		data, ok := strings.CutPrefix(st.line(), "data: ")
		if !ok {
			st.t.Fatalf("no data line after the event line")
		}
		if end := st.line(); end != "" {
			st.t.Fatalf("line %q after the data, want the blank line that ends the event", end)
		}
		return data
	}
}

func TestStream(t *testing.T) {
	s := newStreamHarness(t, time.Hour)
	created := s.create()
	id := created.Event.ID
	me := created.Event.Participants[0].ID

	st := s.open(id)
	if st.res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", st.res.StatusCode)
	}
	if got := st.res.Header.Get("Content-Type"); got != "text/event-stream" {
		t.Fatalf("Content-Type = %q", got)
	}
	if got := st.res.Header.Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q", got)
	}

	// On connect: where the event is now.
	if got, want := st.update(), `{"version":1,"kind":"status","by":null}`; got != want {
		t.Fatalf("first update = %s, want %s", got, want)
	}

	res := s.request("PUT", "/api/events/"+id+"/absences",
		change{Set: []pair{{"2026-12-12", "dinner"}}}, creds{token: created.ParticipantToken})
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("mark: status %d", res.StatusCode)
	}
	if got, want := st.update(), `{"version":2,"kind":"absences","by":"`+me+`"}`; got != want {
		t.Fatalf("second update = %s, want %s", got, want)
	}

	// A change to another event does not reach this stream.
	other := s.create()
	res = s.request("POST", "/api/events/"+other.Event.ID+"/participants", map[string]string{"name": "Luca"}, creds{})
	res.Body.Close()
	res = s.request("POST", "/api/events/"+id+"/participants", map[string]string{"name": "Luca"}, creds{})
	var joined joinedView
	if err := json.NewDecoder(res.Body).Decode(&joined); err != nil {
		t.Fatalf("decode: %v", err)
	}
	res.Body.Close()
	if got, want := st.update(), `{"version":3,"kind":"participants","by":"`+*joined.Event.Me+`"}`; got != want {
		t.Fatalf("third update = %s, want %s", got, want)
	}
}

func TestStreamPing(t *testing.T) {
	s := newStreamHarness(t, 10*time.Millisecond)
	st := s.open(s.create().Event.ID)
	st.update()
	for range 3 {
		for st.line() != ": ping" {
		}
	}
}

func TestStreamUnknownEvent(t *testing.T) {
	s := newStreamHarness(t, time.Hour)
	res := s.request("GET", "/api/events/9d2c7f40-5b1e-4c3a-a6f8-0e1d2c3b4a59/stream", nil, creds{})
	defer res.Body.Close()

	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", res.StatusCode)
	}
	if got := res.Header.Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Fatalf("Content-Type = %q", got)
	}
	var e errorView
	if err := json.NewDecoder(res.Body).Decode(&e); err != nil || e.Error.Code != "not_found" {
		t.Fatalf("error = %+v, %v", e, err)
	}
	if got := s.hub.open.Load(); got != 0 {
		t.Fatalf("%d subscriptions left open by a 404", got)
	}
}

func TestStreamOfAnIDThatIsNotAUUID(t *testing.T) {
	s := newStreamHarness(t, time.Hour)
	res := s.request("GET", "/api/events/k7Qm2xVd9LpA/stream", nil, creds{})
	defer res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", res.StatusCode)
	}
	if got := s.hub.subscribed.Load(); got != 0 {
		t.Fatalf("%d subscriptions were made for an id that is not a UUID", got)
	}
}

func TestStreamEndsWithTheRequest(t *testing.T) {
	s := newStreamHarness(t, time.Hour)
	id := s.create().Event.ID

	first, second := s.open(id), s.open(id)
	first.update()
	second.update()
	if got := s.hub.open.Load(); got != 2 {
		t.Fatalf("%d subscriptions open, want 2", got)
	}

	first.close()
	deadline := time.Now().Add(5 * time.Second)
	for s.hub.open.Load() != 1 {
		if time.Now().After(deadline) {
			t.Fatalf("%d subscriptions open after one client left, want 1", s.hub.open.Load())
		}
		time.Sleep(5 * time.Millisecond)
	}

	// The one still connected keeps receiving.
	res := s.request("POST", "/api/events/"+id+"/participants", map[string]string{"name": "Luca"}, creds{})
	res.Body.Close()
	if got := second.update(); !strings.HasPrefix(got, `{"version":2,"kind":"participants"`) {
		t.Fatalf("update = %s", got)
	}
}

func TestNoStreamWithoutUpdates(t *testing.T) {
	h := newHarness(t)
	id := h.create().Event.ID
	h.do("GET", "/api/events/"+id+"/stream", nil, creds{}).wantError(http.StatusNotFound, "not_found")
}

func TestStreamsPerClientAreBounded(t *testing.T) {
	// Rate limits are off in this harness: the bound on streams protects
	// the process and is always on.
	s := newStreamHarness(t, time.Hour, func(o *Options) { o.ClientIPHeader = "X-Forwarded-For" })
	id := s.create().Event.ID

	// Requests that open no stream hold no place.
	for range 25 {
		res := s.open(unknownEvent, "192.0.2.7").res
		if res.StatusCode != http.StatusNotFound {
			t.Fatalf("stream of an unknown event: status %d", res.StatusCode)
		}
		res.Body.Close()
	}

	var streams []*stream
	for i := range 20 {
		st := s.open(id, "192.0.2.7")
		if st.res.StatusCode != http.StatusOK {
			t.Fatalf("stream %d: status %d", i+1, st.res.StatusCode)
		}
		st.update()
		streams = append(streams, st)
	}

	refused := func() {
		t.Helper()
		st := s.open(id, "192.0.2.7")
		defer st.close()
		if st.res.StatusCode != http.StatusTooManyRequests {
			t.Fatalf("stream over the bound: status %d, want 429", st.res.StatusCode)
		}
		if got := st.res.Header.Get("Retry-After"); got != "30" {
			t.Fatalf("Retry-After = %q, want 30", got)
		}
		if got := st.res.Header.Get("Content-Type"); got != "application/json; charset=utf-8" {
			t.Fatalf("Content-Type = %q", got)
		}
		// The body is one line of JSON, read by the stream's own reader.
		var e errorView
		if err := json.Unmarshal([]byte(st.line()), &e); err != nil || e.Error.Code != "rate_limited" {
			t.Fatalf("error = %+v, %v", e, err)
		}
	}
	refused()
	refused() // a refusal takes no place and frees none

	// The same client by another spelling of its address is refused too;
	// another client is not.
	if st := s.open(id, "::ffff:192.0.2.7"); st.res.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("the same address in its mapped form: status %d, want 429", st.res.StatusCode)
	}
	other := s.open(id, "192.0.2.8")
	if other.res.StatusCode != http.StatusOK {
		t.Fatalf("another client: status %d", other.res.StatusCode)
	}
	other.update()

	// One closes: one is accepted again, as soon as the server has seen
	// the client leave, and then the client is at its bound again.
	streams[3].close()
	deadline := time.Now().Add(5 * time.Second)
	for {
		st := s.open(id, "192.0.2.7")
		if st.res.StatusCode == http.StatusOK {
			st.update()
			break
		}
		st.close()
		if time.Now().After(deadline) {
			t.Fatalf("still refused after a stream closed: status %d", st.res.StatusCode)
		}
		time.Sleep(10 * time.Millisecond)
	}
	refused()

	// The streams that stayed open still receive.
	res := s.request("POST", "/api/events/"+id+"/participants", map[string]string{"name": "Luca"}, creds{})
	res.Body.Close()
	for _, st := range []*stream{streams[0], streams[19], other} {
		if got := st.update(); !strings.HasPrefix(got, `{"version":2,"kind":"participants"`) {
			t.Fatalf("update = %s", got)
		}
	}
}
