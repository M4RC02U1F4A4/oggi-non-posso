package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/hub"
	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/store"
	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/store/sqlite"
)

// ---- harness ----------------------------------------------------------

// recorder is a Notifier that keeps what it is told.
type recorder struct {
	mu      sync.Mutex
	updates []published
}

type published struct {
	EventID string
	Update  Update
}

func (r *recorder) Publish(eventID string, u Update) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.updates = append(r.updates, published{eventID, u})
}

func (r *recorder) all() []published {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]published(nil), r.updates...)
}

func (r *recorder) last(t *testing.T) published {
	t.Helper()
	all := r.all()
	if len(all) == 0 {
		t.Fatal("nothing was published")
	}
	return all[len(all)-1]
}

type harness struct {
	t       *testing.T
	handler http.Handler
	store   *sqlite.Store
	notes   *recorder
	clock   *clock // the clock of the rate limits
}

// clock is a clock that moves only when told.
type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *clock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

func newHarness(t *testing.T, change ...func(*Options)) *harness {
	t.Helper()
	st, err := sqlite.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open the store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	notes := &recorder{}
	o := Options{
		Store:           st,
		Notifier:        notes,
		MaxParticipants: 50,
		Logger:          slog.New(slog.DiscardHandler),
	}
	for _, f := range change {
		f(&o)
	}
	c := &clock{t: time.Date(2026, 11, 24, 13, 5, 0, 0, time.UTC)}
	return &harness{t: t, handler: newAPI(o, c.now), store: st, notes: notes, clock: c}
}

// The JSON of the contract, as a client reads it.
type eventView struct {
	ID           string            `json:"id"`
	Title        string            `json:"title"`
	Status       string            `json:"status"`
	Version      int64             `json:"version"`
	Slots        []string          `json:"slots"`
	Days         []dayView         `json:"days"`
	Participants []participantView `json:"participants"`
	Me           *string           `json:"me"`
	CanManage    bool              `json:"can_manage"`
	CreatedAt    string            `json:"created_at"`
	ClosedAt     *string           `json:"closed_at"`
	Alternatives []alternativeView `json:"alternatives"`
}

type dayView struct {
	Date  string   `json:"date"`
	Slots []string `json:"slots"`
}

type participantView struct {
	ID        string              `json:"id"`
	Name      string              `json:"name"`
	Organiser bool                `json:"organiser"`
	Absences  map[string][]string `json:"absences"`
}

type alternativeView struct {
	Date    string   `json:"date"`
	Slots   []string `json:"slots"`
	Missing []string `json:"missing"`
}

type createdView struct {
	Event            eventView `json:"event"`
	ParticipantToken string    `json:"participant_token"`
	OrganiserKey     string    `json:"organiser_key"`
}

type joinedView struct {
	Event            eventView `json:"event"`
	ParticipantToken string    `json:"participant_token"`
}

type errorView struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

type response struct {
	t      *testing.T
	status int
	header http.Header
	body   []byte
}

// creds are the headers a request carries, and where it comes from.
type creds struct {
	token   string            // participant token
	key     string            // organiser key
	from    string            // address of the connection; empty for the default
	headers map[string]string // any other header
}

func (h *harness) do(method, path string, body any, c creds) *response {
	h.t.Helper()
	var reader io.Reader
	switch b := body.(type) {
	case nil:
	case string:
		reader = strings.NewReader(b)
	case []byte:
		reader = bytes.NewReader(b)
	default:
		raw, err := json.Marshal(b)
		if err != nil {
			h.t.Fatalf("marshal the request body: %v", err)
		}
		reader = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, path, reader)
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	if c.key != "" {
		req.Header.Set("X-Organiser-Key", c.key)
	}
	if c.from != "" {
		req.RemoteAddr = c.from
	}
	for name, value := range c.headers {
		req.Header.Set(name, value)
	}
	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, req)
	return &response{t: h.t, status: rec.Code, header: rec.Header(), body: rec.Body.Bytes()}
}

func (r *response) decode(dst any) {
	r.t.Helper()
	dec := json.NewDecoder(bytes.NewReader(r.body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		r.t.Fatalf("decode %T from %s: %v", dst, r.body, err)
	}
}

func (r *response) wantStatus(status int) *response {
	r.t.Helper()
	if r.status != status {
		r.t.Fatalf("status = %d, want %d; body: %s", r.status, status, r.body)
	}
	if got := r.header.Get("Content-Type"); got != "application/json; charset=utf-8" {
		r.t.Fatalf("Content-Type = %q", got)
	}
	return r
}

func (r *response) event(status int) eventView {
	r.t.Helper()
	var ev eventView
	r.wantStatus(status).decode(&ev)
	return ev
}

func (r *response) wantError(status int, code string) errorView {
	r.t.Helper()
	var e errorView
	r.wantStatus(status).decode(&e)
	if e.Error.Code != code {
		r.t.Fatalf("error code = %q, want %q; body: %s", e.Error.Code, code, r.body)
	}
	if e.Error.Message == "" {
		r.t.Fatalf("error without a message: %s", r.body)
	}
	return e
}

type pair struct {
	Date string `json:"date"`
	Slot string `json:"slot"`
}

type change struct {
	Set   []pair `json:"set,omitempty"`
	Clear []pair `json:"clear,omitempty"`
}

// dinner is the request that creates "Cena di dicembre": Friday without
// morning and lunch, Saturday and Sunday whole. Days and slots are given
// out of order on purpose.
func dinner() map[string]any {
	return map[string]any{
		"title":          "  Cena di dicembre ",
		"organiser_name": " Giulia",
		"days": []map[string]any{
			{"date": "2026-12-12", "slots": []string{"dinner", "morning", "lunch", "after_dinner", "afternoon"}},
			{"date": "2026-12-11", "slots": []string{"after_dinner", "afternoon", "dinner"}},
			{"date": "2026-12-13", "slots": []string{"morning", "lunch", "afternoon", "dinner", "after_dinner"}},
		},
	}
}

func (h *harness) create() createdView {
	h.t.Helper()
	var out createdView
	h.do("POST", "/api/events", dinner(), creds{}).wantStatus(http.StatusCreated).decode(&out)
	return out
}

func (h *harness) join(eventID, name string) joinedView {
	h.t.Helper()
	var out joinedView
	h.do("POST", "/api/events/"+eventID+"/participants", map[string]string{"name": name}, creds{}).
		wantStatus(http.StatusCreated).decode(&out)
	return out
}

func deref(s *string) string {
	if s == nil {
		return "<null>"
	}
	return *s
}

// Well-formed identifiers that belong to nothing.
const (
	unknownEvent = "9d2c7f40-5b1e-4c3a-a6f8-0e1d2c3b4a59"
	unknownKey   = "5a1f0c9e-3b7d-4e2a-9c48-6d0f1e2a3b4c"
)

// ---- shape ------------------------------------------------------------

func TestCreateEvent(t *testing.T) {
	h := newHarness(t)
	res := h.do("POST", "/api/events", dinner(), creds{}).wantStatus(http.StatusCreated)

	// The exact keys of the contract, nulls included.
	var raw struct {
		Event map[string]json.RawMessage `json:"event"`
	}
	if err := json.Unmarshal(res.body, &raw); err != nil {
		t.Fatalf("decode: %v", err)
	}
	wantKeys := []string{"id", "title", "status", "version", "slots", "days", "participants",
		"me", "can_manage", "created_at", "closed_at", "alternatives"}
	if len(raw.Event) != len(wantKeys) {
		t.Fatalf("the event has %d keys, want %d: %s", len(raw.Event), len(wantKeys), res.body)
	}
	for _, k := range wantKeys {
		if _, ok := raw.Event[k]; !ok {
			t.Fatalf("the event has no %q: %s", k, res.body)
		}
	}
	for _, k := range []string{"closed_at", "alternatives"} {
		if string(raw.Event[k]) != "null" {
			t.Fatalf("%s = %s, want null", k, raw.Event[k])
		}
	}

	var out createdView
	res.decode(&out)
	ev := out.Event

	uuid := regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	if !uuid.MatchString(ev.ID) {
		t.Errorf("id = %q, want a version 4 UUID", ev.ID)
	}
	if !regexp.MustCompile(`^p_[A-Za-z0-9_-]{43}$`).MatchString(out.ParticipantToken) {
		t.Errorf("participant_token = %q", out.ParticipantToken)
	}
	if !uuid.MatchString(out.OrganiserKey) || out.OrganiserKey == ev.ID {
		t.Errorf("organiser_key = %q, want a version 4 UUID of its own", out.OrganiserKey)
	}
	if ev.Title != "Cena di dicembre" || ev.Status != "open" || ev.Version != 1 {
		t.Errorf("title %q, status %q, version %d", ev.Title, ev.Status, ev.Version)
	}
	allSlots := []string{"morning", "lunch", "afternoon", "dinner", "after_dinner"}
	if !reflect.DeepEqual(ev.Slots, allSlots) {
		t.Errorf("slots = %v", ev.Slots)
	}
	wantDays := []dayView{
		{"2026-12-11", []string{"afternoon", "dinner", "after_dinner"}},
		{"2026-12-12", allSlots},
		{"2026-12-13", allSlots},
	}
	if !reflect.DeepEqual(ev.Days, wantDays) {
		t.Errorf("days = %v, want %v", ev.Days, wantDays)
	}
	if len(ev.Participants) != 1 {
		t.Fatalf("participants = %v", ev.Participants)
	}
	p := ev.Participants[0]
	if p.Name != "Giulia" || !p.Organiser || p.ID == "" || p.Absences == nil || len(p.Absences) != 0 {
		t.Errorf("organiser = %+v", p)
	}
	if string(mustRaw(t, raw.Event["participants"])[0]["absences"]) != "{}" {
		t.Errorf("empty absences are not {}: %s", raw.Event["participants"])
	}
	if deref(ev.Me) != p.ID || !ev.CanManage {
		t.Errorf("me = %s, can_manage = %v; want the organiser", deref(ev.Me), ev.CanManage)
	}
	created, err := time.Parse(time.RFC3339, ev.CreatedAt)
	if err != nil || !strings.HasSuffix(ev.CreatedAt, "Z") || time.Since(created) > time.Minute {
		t.Errorf("created_at = %q (%v)", ev.CreatedAt, err)
	}
	if got := res.header.Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q", got)
	}
}

func mustRaw(t *testing.T, raw json.RawMessage) []map[string]json.RawMessage {
	t.Helper()
	var out []map[string]json.RawMessage
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("decode %s: %v", raw, err)
	}
	return out
}

func TestCreateEventUnionOfSlots(t *testing.T) {
	h := newHarness(t)
	body := map[string]any{
		"title": "Cena di dicembre", "organiser_name": "Giulia",
		"days": []map[string]any{
			{"date": "2026-12-12", "slots": []string{"after_dinner", "dinner"}},
			{"date": "2026-12-11", "slots": []string{"dinner", "afternoon"}},
		},
	}
	var out createdView
	h.do("POST", "/api/events", body, creds{}).wantStatus(http.StatusCreated).decode(&out)
	if want := []string{"afternoon", "dinner", "after_dinner"}; !reflect.DeepEqual(out.Event.Slots, want) {
		t.Fatalf("slots = %v, want %v", out.Event.Slots, want)
	}
}

func TestCreateEventValidation(t *testing.T) {
	h := newHarness(t)
	day := func(date string, slots ...string) map[string]any {
		return map[string]any{"date": date, "slots": slots}
	}
	cases := []struct {
		name  string
		field string
		edit  func(body map[string]any)
	}{
		{"empty title", "title", func(b map[string]any) { b["title"] = "   " }},
		{"missing title", "title", func(b map[string]any) { delete(b, "title") }},
		{"long title", "title", func(b map[string]any) { b["title"] = strings.Repeat("è", 81) }},
		{"empty name", "organiser_name", func(b map[string]any) { b["organiser_name"] = "" }},
		{"long name", "organiser_name", func(b map[string]any) { b["organiser_name"] = strings.Repeat("è", 31) }},
		{"no days", "days", func(b map[string]any) { b["days"] = []map[string]any{} }},
		{"missing days", "days", func(b map[string]any) { delete(b, "days") }},
		{"bad date", "days", func(b map[string]any) { b["days"] = []map[string]any{day("2026-02-30", "dinner")} }},
		{"duplicate date", "days", func(b map[string]any) {
			b["days"] = []map[string]any{day("2026-12-11", "dinner"), day("2026-12-11", "lunch")}
		}},
		{"no slots", "days", func(b map[string]any) { b["days"] = []map[string]any{day("2026-12-11")} }},
		{"unknown slot", "days", func(b map[string]any) { b["days"] = []map[string]any{day("2026-12-11", "brunch")} }},
		{"repeated slot", "days", func(b map[string]any) { b["days"] = []map[string]any{day("2026-12-11", "dinner", "dinner")} }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			body := dinner()
			c.edit(body)
			e := h.do("POST", "/api/events", body, creds{}).wantError(http.StatusUnprocessableEntity, "validation_failed")
			if !strings.HasPrefix(e.Error.Message, c.field+":") {
				t.Fatalf("message %q does not name the field %q", e.Error.Message, c.field)
			}
		})
	}

	t.Run("limits are in characters", func(t *testing.T) {
		body := dinner()
		body["title"] = strings.Repeat("è", 80)
		body["organiser_name"] = strings.Repeat("è", 30)
		h.do("POST", "/api/events", body, creds{}).wantStatus(http.StatusCreated)
	})
}

func TestGetEvent(t *testing.T) {
	h := newHarness(t)
	created := h.create()
	other := h.create()
	id := created.Event.ID
	organiser := created.Event.Participants[0].ID
	luca := h.join(id, "Luca")

	t.Run("anonymous", func(t *testing.T) {
		ev := h.do("GET", "/api/events/"+id, nil, creds{}).event(http.StatusOK)
		if ev.Me != nil || ev.CanManage {
			t.Fatalf("me = %s, can_manage = %v", deref(ev.Me), ev.CanManage)
		}
		if ev.ID != id || ev.Version != 2 || len(ev.Participants) != 2 || ev.Alternatives != nil {
			t.Fatalf("event = %+v", ev)
		}
	})
	t.Run("participant", func(t *testing.T) {
		ev := h.do("GET", "/api/events/"+id, nil, creds{token: luca.ParticipantToken}).event(http.StatusOK)
		if deref(ev.Me) != *luca.Event.Me || ev.CanManage {
			t.Fatalf("me = %s, can_manage = %v", deref(ev.Me), ev.CanManage)
		}
	})
	t.Run("organiser on their own device", func(t *testing.T) {
		ev := h.do("GET", "/api/events/"+id, nil, creds{token: created.ParticipantToken, key: created.OrganiserKey}).event(http.StatusOK)
		if deref(ev.Me) != organiser || !ev.CanManage {
			t.Fatalf("me = %s, can_manage = %v", deref(ev.Me), ev.CanManage)
		}
	})
	t.Run("organiser key alone", func(t *testing.T) {
		ev := h.do("GET", "/api/events/"+id, nil, creds{key: created.OrganiserKey}).event(http.StatusOK)
		if ev.Me != nil || !ev.CanManage {
			t.Fatalf("me = %s, can_manage = %v", deref(ev.Me), ev.CanManage)
		}
	})
	t.Run("foreign and unknown credentials are ignored", func(t *testing.T) {
		for _, c := range []creds{
			{token: other.ParticipantToken, key: other.OrganiserKey},
			{token: "p_unknown", key: unknownKey},
			{key: "o_unknown"},
			{key: strings.ToUpper(created.OrganiserKey)},
			{key: "{" + created.OrganiserKey + "}"},
			{key: id},                                                    // the event id is not the key
			{token: created.OrganiserKey, key: created.ParticipantToken}, // swapped
			{token: "nonsense", key: "nonsense"},
		} {
			ev := h.do("GET", "/api/events/"+id, nil, c).event(http.StatusOK)
			if ev.Me != nil || ev.CanManage {
				t.Fatalf("%+v: me = %s, can_manage = %v", c, deref(ev.Me), ev.CanManage)
			}
		}
	})
	t.Run("credentials never appear in an event", func(t *testing.T) {
		res := h.do("GET", "/api/events/"+id, nil, creds{token: created.ParticipantToken, key: created.OrganiserKey})
		for _, secret := range []string{created.ParticipantToken, created.OrganiserKey, luca.ParticipantToken} {
			if bytes.Contains(res.body, []byte(secret)) {
				t.Fatalf("the event carries a credential: %s", res.body)
			}
		}
	})
}

func TestJoin(t *testing.T) {
	h := newHarness(t)
	created := h.create()
	id := created.Event.ID

	var out joinedView
	h.do("POST", "/api/events/"+id+"/participants", map[string]string{"name": "  Luca "}, creds{}).
		wantStatus(http.StatusCreated).decode(&out)

	if !strings.HasPrefix(out.ParticipantToken, "p_") || out.ParticipantToken == created.ParticipantToken {
		t.Fatalf("participant_token = %q", out.ParticipantToken)
	}
	ev := out.Event
	if ev.Version != 2 || len(ev.Participants) != 2 {
		t.Fatalf("event = %+v", ev)
	}
	luca := ev.Participants[1]
	if luca.Name != "Luca" || luca.Organiser || len(luca.Absences) != 0 {
		t.Fatalf("joined participant = %+v", luca)
	}
	if deref(ev.Me) != luca.ID || ev.CanManage {
		t.Fatalf("me = %s, can_manage = %v", deref(ev.Me), ev.CanManage)
	}

	note := h.notes.last(t)
	if note.EventID != id || note.Update.Version != 2 || note.Update.Kind != "participants" || deref(note.Update.By) != luca.ID {
		t.Fatalf("published %+v by %s", note, deref(note.Update.By))
	}

	t.Run("validation", func(t *testing.T) {
		for _, name := range []string{"", "   ", strings.Repeat("è", 31)} {
			e := h.do("POST", "/api/events/"+id+"/participants", map[string]string{"name": name}, creds{}).
				wantError(http.StatusUnprocessableEntity, "validation_failed")
			if !strings.HasPrefix(e.Error.Message, "name:") {
				t.Fatalf("message %q does not name the field", e.Error.Message)
			}
		}
		h.do("POST", "/api/events/"+id+"/participants", map[string]string{"name": strings.Repeat("è", 30)}, creds{}).
			wantStatus(http.StatusCreated)
	})
}

func TestJoinNameTaken(t *testing.T) {
	h := newHarness(t)
	id := h.create().Event.ID
	before := len(h.notes.all())

	for _, name := range []string{" giulia ", "GIULIA", "Giulia"} {
		h.do("POST", "/api/events/"+id+"/participants", map[string]string{"name": name}, creds{}).
			wantError(http.StatusConflict, "name_taken")
	}
	if got := len(h.notes.all()); got != before {
		t.Fatalf("a refused join published %d updates", got-before)
	}
	if ev := h.do("GET", "/api/events/"+id, nil, creds{}).event(http.StatusOK); ev.Version != 1 || len(ev.Participants) != 1 {
		t.Fatalf("a refused join changed the event: %+v", ev)
	}
}

func TestJoinClosed(t *testing.T) {
	h := newHarness(t)
	created := h.create()
	id := created.Event.ID
	h.do("POST", "/api/events/"+id+"/close", nil, creds{key: created.OrganiserKey}).wantStatus(http.StatusOK)

	h.do("POST", "/api/events/"+id+"/participants", map[string]string{"name": "Luca"}, creds{}).
		wantError(http.StatusConflict, "event_closed")
}

func TestJoinTooManyParticipants(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.MaxParticipants = 3 })
	id := h.create().Event.ID
	h.join(id, "Luca")
	h.join(id, "Anna")
	h.do("POST", "/api/events/"+id+"/participants", map[string]string{"name": "Marta"}, creds{}).
		wantError(http.StatusConflict, "too_many_participants")
}

func TestMark(t *testing.T) {
	h := newHarness(t)
	created := h.create()
	id := created.Event.ID
	luca := h.join(id, "Luca")
	lucaID := *luca.Event.Me
	c := creds{token: luca.ParticipantToken}

	ev := h.do("PUT", "/api/events/"+id+"/absences", change{Set: []pair{
		{"2026-12-12", "dinner"}, {"2026-12-12", "morning"}, {"2026-12-11", "afternoon"},
	}}, c).event(http.StatusOK)

	if ev.Version != 3 || deref(ev.Me) != lucaID || ev.CanManage {
		t.Fatalf("version %d, me %s, can_manage %v", ev.Version, deref(ev.Me), ev.CanManage)
	}
	want := map[string][]string{"2026-12-11": {"afternoon"}, "2026-12-12": {"morning", "dinner"}}
	if got := ev.Participants[1].Absences; !reflect.DeepEqual(got, want) {
		t.Fatalf("absences = %v, want %v", got, want)
	}
	if got := ev.Participants[0].Absences; len(got) != 0 {
		t.Fatalf("the organiser has absences: %v", got)
	}
	note := h.notes.last(t)
	if note.EventID != id || note.Update.Version != 3 || note.Update.Kind != "absences" || deref(note.Update.By) != lucaID {
		t.Fatalf("published %+v by %s", note, deref(note.Update.By))
	}

	t.Run("clearing a whole date drops it from the map", func(t *testing.T) {
		ev := h.do("PUT", "/api/events/"+id+"/absences", change{
			Set:   []pair{{"2026-12-13", "lunch"}},
			Clear: []pair{{"2026-12-12", "dinner"}, {"2026-12-12", "morning"}},
		}, c).event(http.StatusOK)
		want := map[string][]string{"2026-12-11": {"afternoon"}, "2026-12-13": {"lunch"}}
		if got := ev.Participants[1].Absences; !reflect.DeepEqual(got, want) {
			t.Fatalf("absences = %v, want %v", got, want)
		}
	})
	t.Run("setting what is set and clearing what is clear are not errors", func(t *testing.T) {
		ev := h.do("PUT", "/api/events/"+id+"/absences", change{
			Set:   []pair{{"2026-12-11", "afternoon"}, {"2026-12-11", "afternoon"}},
			Clear: []pair{{"2026-12-12", "dinner"}},
		}, c).event(http.StatusOK)
		want := map[string][]string{"2026-12-11": {"afternoon"}, "2026-12-13": {"lunch"}}
		if got := ev.Participants[1].Absences; !reflect.DeepEqual(got, want) {
			t.Fatalf("absences = %v, want %v", got, want)
		}
	})
	t.Run("the organiser key rides along", func(t *testing.T) {
		ev := h.do("PUT", "/api/events/"+id+"/absences", change{Set: []pair{{"2026-12-11", "dinner"}}},
			creds{token: created.ParticipantToken, key: created.OrganiserKey}).event(http.StatusOK)
		if deref(ev.Me) != created.Event.Participants[0].ID || !ev.CanManage {
			t.Fatalf("me %s, can_manage %v", deref(ev.Me), ev.CanManage)
		}
	})
}

func TestMarkNeedsParticipant(t *testing.T) {
	h := newHarness(t)
	created := h.create()
	other := h.create()
	path := "/api/events/" + created.Event.ID + "/absences"
	body := change{Set: []pair{{"2026-12-11", "dinner"}}}

	for name, c := range map[string]creds{
		"no header":               {},
		"organiser key only":      {key: created.OrganiserKey},
		"token of another event":  {token: other.ParticipantToken},
		"unknown token":           {token: "p_unknown"},
		"organiser key as bearer": {token: created.OrganiserKey},
	} {
		t.Run(name, func(t *testing.T) {
			h.do("PUT", path, body, c).wantError(http.StatusUnauthorized, "unauthorized")
		})
	}
	if ev := h.do("GET", "/api/events/"+created.Event.ID, nil, creds{}).event(http.StatusOK); ev.Version != 1 {
		t.Fatalf("a refused mark changed the event: version %d", ev.Version)
	}
}

func TestMarkNotCandidate(t *testing.T) {
	h := newHarness(t)
	created := h.create()
	path := "/api/events/" + created.Event.ID + "/absences"
	c := creds{token: created.ParticipantToken}

	for name, body := range map[string]change{
		"slot off on that day": {Set: []pair{{"2026-12-11", "morning"}}},
		"day not in the event": {Set: []pair{{"2026-12-14", "dinner"}}},
		"unknown slot":         {Set: []pair{{"2026-12-12", "brunch"}}},
		"not a date":           {Set: []pair{{"tomorrow", "dinner"}}},
		"clear":                {Clear: []pair{{"2026-12-11", "lunch"}}},
		"one bad among good":   {Set: []pair{{"2026-12-12", "dinner"}, {"2026-12-11", "lunch"}}},
	} {
		t.Run(name, func(t *testing.T) {
			h.do("PUT", path, body, c).wantError(http.StatusUnprocessableEntity, "validation_failed")
		})
	}
	ev := h.do("GET", "/api/events/"+created.Event.ID, nil, creds{}).event(http.StatusOK)
	if ev.Version != 1 || len(ev.Participants[0].Absences) != 0 {
		t.Fatalf("a refused mark changed the event: %+v", ev)
	}
}

func TestMarkSetAndClearSamePair(t *testing.T) {
	h := newHarness(t)
	created := h.create()
	body := change{
		Set:   []pair{{"2026-12-12", "dinner"}, {"2026-12-12", "lunch"}},
		Clear: []pair{{"2026-12-12", "lunch"}},
	}
	h.do("PUT", "/api/events/"+created.Event.ID+"/absences", body, creds{token: created.ParticipantToken}).
		wantError(http.StatusUnprocessableEntity, "validation_failed")
}

func TestMarkClosed(t *testing.T) {
	h := newHarness(t)
	created := h.create()
	id := created.Event.ID
	h.do("POST", "/api/events/"+id+"/close", nil, creds{key: created.OrganiserKey}).wantStatus(http.StatusOK)

	h.do("PUT", "/api/events/"+id+"/absences", change{Set: []pair{{"2026-12-12", "dinner"}}},
		creds{token: created.ParticipantToken}).wantError(http.StatusConflict, "event_closed")
}

func TestCloseAndReopen(t *testing.T) {
	h := newHarness(t)
	created := h.create()
	id := created.Event.ID
	organiser := created.Event.Participants[0].ID
	luca := h.join(id, "Luca")
	lucaID := *luca.Event.Me

	// Luca misses Friday dinner and the whole of Sunday; Giulia misses
	// Saturday morning and Sunday.
	h.do("PUT", "/api/events/"+id+"/absences", change{Set: []pair{
		{"2026-12-11", "dinner"},
		{"2026-12-13", "morning"}, {"2026-12-13", "lunch"}, {"2026-12-13", "afternoon"}, {"2026-12-13", "dinner"}, {"2026-12-13", "after_dinner"},
	}}, creds{token: luca.ParticipantToken}).wantStatus(http.StatusOK)
	h.do("PUT", "/api/events/"+id+"/absences", change{Set: []pair{
		{"2026-12-12", "morning"},
		{"2026-12-13", "morning"}, {"2026-12-13", "lunch"}, {"2026-12-13", "afternoon"}, {"2026-12-13", "dinner"}, {"2026-12-13", "after_dinner"},
	}}, creds{token: created.ParticipantToken}).wantStatus(http.StatusOK)

	ev := h.do("POST", "/api/events/"+id+"/close", nil, creds{key: created.OrganiserKey}).event(http.StatusOK)
	if ev.Status != "closed" || ev.Version != 5 || !ev.CanManage || ev.Me != nil {
		t.Fatalf("closed event: %+v", ev)
	}
	if ev.ClosedAt == nil {
		t.Fatal("closed_at is null on a closed event")
	}
	if _, err := time.Parse(time.RFC3339, *ev.ClosedAt); err != nil || !strings.HasSuffix(*ev.ClosedAt, "Z") {
		t.Fatalf("closed_at = %q (%v)", *ev.ClosedAt, err)
	}
	want := []alternativeView{
		{"2026-12-11", []string{"afternoon"}, []string{}},
		{"2026-12-11", []string{"after_dinner"}, []string{}},
		{"2026-12-12", []string{"lunch", "afternoon", "dinner", "after_dinner"}, []string{}},
		{"2026-12-11", []string{"dinner"}, []string{lucaID}},
		{"2026-12-12", []string{"morning"}, []string{organiser}},
	}
	if !reflect.DeepEqual(ev.Alternatives, want) {
		t.Fatalf("alternatives:\n got %v\nwant %v", ev.Alternatives, want)
	}
	note := h.notes.last(t)
	if note.EventID != id || note.Update.Version != 5 || note.Update.Kind != "status" || note.Update.By != nil {
		t.Fatalf("published %+v by %s", note, deref(note.Update.By))
	}

	t.Run("everyone reads the alternatives", func(t *testing.T) {
		got := h.do("GET", "/api/events/"+id, nil, creds{}).event(http.StatusOK)
		if !reflect.DeepEqual(got.Alternatives, want) {
			t.Fatalf("alternatives = %v", got.Alternatives)
		}
	})
	t.Run("reopen", func(t *testing.T) {
		ev := h.do("POST", "/api/events/"+id+"/reopen", nil, creds{key: created.OrganiserKey, token: created.ParticipantToken}).event(http.StatusOK)
		if ev.Status != "open" || ev.Version != 6 || ev.ClosedAt != nil || ev.Alternatives != nil {
			t.Fatalf("reopened event: %+v", ev)
		}
		note := h.notes.last(t)
		if note.Update.Version != 6 || note.Update.Kind != "status" || deref(note.Update.By) != organiser {
			t.Fatalf("published %+v by %s", note, deref(note.Update.By))
		}
		// Marking works again.
		h.do("PUT", "/api/events/"+id+"/absences", change{Clear: []pair{{"2026-12-11", "dinner"}}},
			creds{token: luca.ParticipantToken}).wantStatus(http.StatusOK)
	})
	t.Run("reopening an open event changes nothing", func(t *testing.T) {
		before := len(h.notes.all())
		ev := h.do("POST", "/api/events/"+id+"/reopen", nil, creds{key: created.OrganiserKey}).event(http.StatusOK)
		if ev.Status != "open" || ev.Version != 7 {
			t.Fatalf("event: %+v", ev)
		}
		if got := len(h.notes.all()); got != before {
			t.Fatalf("published %d updates for no change", got-before)
		}
	})
}

func TestCloseNeedsOrganiser(t *testing.T) {
	h := newHarness(t)
	created := h.create()
	other := h.create()
	id := created.Event.ID

	for _, action := range []string{"close", "reopen"} {
		for name, c := range map[string]creds{
			"participant token":         {token: created.ParticipantToken},
			"participant token as key":  {key: created.ParticipantToken},
			"nothing":                   {},
			"key of another event":      {key: other.OrganiserKey},
			"unknown key":               {key: unknownKey},
			"key that is not a UUID":    {key: "o_unknown"},
			"key in upper case":         {key: strings.ToUpper(created.OrganiserKey)},
			"the event id as the key":   {key: created.Event.ID},
			"organiser key as a bearer": {token: created.OrganiserKey},
		} {
			t.Run(action+" with "+name, func(t *testing.T) {
				h.do("POST", "/api/events/"+id+"/"+action, nil, c).wantError(http.StatusUnauthorized, "unauthorized")
			})
		}
	}
	if ev := h.do("GET", "/api/events/"+id, nil, creds{}).event(http.StatusOK); ev.Status != "open" || ev.Version != 1 {
		t.Fatalf("a refused close changed the event: %+v", ev)
	}
}

func TestCloseTwice(t *testing.T) {
	h := newHarness(t)
	created := h.create()
	path := "/api/events/" + created.Event.ID + "/close"
	c := creds{key: created.OrganiserKey}

	first := h.do("POST", path, nil, c).event(http.StatusOK)
	published := len(h.notes.all())
	second := h.do("POST", path, nil, c).event(http.StatusOK)

	if first.Version != 2 || second.Version != first.Version || second.Status != "closed" {
		t.Fatalf("versions %d then %d, status %q", first.Version, second.Version, second.Status)
	}
	if deref(second.ClosedAt) != deref(first.ClosedAt) {
		t.Fatalf("closed_at moved: %s then %s", deref(first.ClosedAt), deref(second.ClosedAt))
	}
	if got := len(h.notes.all()); got != published {
		t.Fatalf("closing twice published %d more updates", got-published)
	}
}

func TestRemoveParticipant(t *testing.T) {
	h := newHarness(t)
	created := h.create()
	id := created.Event.ID
	luca := h.join(id, "Luca")
	lucaID := *luca.Event.Me
	h.do("PUT", "/api/events/"+id+"/absences", change{Set: []pair{{"2026-12-12", "dinner"}}},
		creds{token: luca.ParticipantToken}).wantStatus(http.StatusOK)

	t.Run("needs the organiser", func(t *testing.T) {
		for _, c := range []creds{{}, {token: luca.ParticipantToken}, {token: created.ParticipantToken}} {
			h.do("DELETE", "/api/events/"+id+"/participants/"+lucaID, nil, c).wantError(http.StatusUnauthorized, "unauthorized")
		}
	})

	ev := h.do("DELETE", "/api/events/"+id+"/participants/"+lucaID, nil, creds{key: created.OrganiserKey}).event(http.StatusOK)
	if ev.Version != 4 || len(ev.Participants) != 1 || ev.Participants[0].Name != "Giulia" || !ev.CanManage {
		t.Fatalf("event after removal: %+v", ev)
	}
	note := h.notes.last(t)
	if note.Update.Version != 4 || note.Update.Kind != "participants" || note.Update.By != nil {
		t.Fatalf("published %+v by %s", note, deref(note.Update.By))
	}

	t.Run("unknown participant", func(t *testing.T) {
		h.do("DELETE", "/api/events/"+id+"/participants/"+lucaID, nil, creds{key: created.OrganiserKey}).
			wantError(http.StatusNotFound, "not_found")
	})
	t.Run("the name is free again", func(t *testing.T) {
		again := h.join(id, "Luca")
		if got := again.Event.Participants[1].Absences; len(got) != 0 {
			t.Fatalf("the new Luca inherited absences: %v", got)
		}
	})
}

func TestRemoveOrganiser(t *testing.T) {
	h := newHarness(t)
	created := h.create()
	id := created.Event.ID
	organiser := created.Event.Participants[0].ID

	h.do("DELETE", "/api/events/"+id+"/participants/"+organiser, nil, creds{key: created.OrganiserKey}).
		wantError(http.StatusConflict, "cannot_remove_organiser")
	if ev := h.do("GET", "/api/events/"+id, nil, creds{}).event(http.StatusOK); len(ev.Participants) != 1 || ev.Version != 1 {
		t.Fatalf("event: %+v", ev)
	}
}

func TestRemovedParticipantToken(t *testing.T) {
	h := newHarness(t)
	created := h.create()
	id := created.Event.ID
	luca := h.join(id, "Luca")
	c := creds{token: luca.ParticipantToken}

	h.do("DELETE", "/api/events/"+id+"/participants/"+*luca.Event.Me, nil, creds{key: created.OrganiserKey}).wantStatus(http.StatusOK)

	h.do("PUT", "/api/events/"+id+"/absences", change{Set: []pair{{"2026-12-12", "dinner"}}}, c).
		wantError(http.StatusUnauthorized, "unauthorized")
	ev := h.do("GET", "/api/events/"+id, nil, c).event(http.StatusOK)
	if ev.Me != nil {
		t.Fatalf("me = %s after removal, want null", deref(ev.Me))
	}
	if !bytes.Contains(h.do("GET", "/api/events/"+id, nil, c).body, []byte(`"me":null`)) {
		t.Fatal(`the event does not say "me":null`)
	}
}

// ---- errors -----------------------------------------------------------

func TestUnknownEvent(t *testing.T) {
	h := newHarness(t)
	created := h.create()
	const id = unknownEvent
	// Valid credentials of another event must not change the answer.
	for _, c := range []creds{{}, {token: created.ParticipantToken, key: created.OrganiserKey}} {
		for _, req := range []struct {
			method, path string
			body         any
		}{
			{"GET", "/api/events/" + id, nil},
			{"POST", "/api/events/" + id + "/participants", map[string]string{"name": "Luca"}},
			{"PUT", "/api/events/" + id + "/absences", change{Set: []pair{{"2026-12-12", "dinner"}}}},
			{"POST", "/api/events/" + id + "/close", nil},
			{"POST", "/api/events/" + id + "/reopen", nil},
			{"DELETE", "/api/events/" + id + "/participants/" + created.Event.Participants[0].ID, nil},
		} {
			t.Run(req.method+" "+req.path, func(t *testing.T) {
				h.do(req.method, req.path, req.body, c).wantError(http.StatusNotFound, "not_found")
			})
		}
	}
}

// noStore is a store that can not be asked anything: every call panics.
type noStore struct{ store.Store }

func TestEventIDThatIsNotAUUID(t *testing.T) {
	// An id that is not a canonical lower-case UUID can not be an event:
	// the answer is 404 and the database is not asked.
	h := newHarness(t, func(o *Options) {
		o.Store = noStore{}
		o.Updates = hub.New()
	})
	const real = "3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10"
	for _, id := range []string{
		"nosuchevent0",
		"k7Qm2xVd9LpA",
		strings.ToUpper(real),
		"%7B" + real + "%7D", // in braces
		strings.ReplaceAll(real, "-", ""),
		real + "0",
		real[:35],
		"3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b1g",
		"urn:uuid:" + real,
	} {
		for _, req := range []struct {
			method, path string
			body         any
		}{
			{"GET", "/api/events/" + id, nil},
			{"POST", "/api/events/" + id + "/participants", map[string]string{"name": "Luca"}},
			{"PUT", "/api/events/" + id + "/absences", change{Set: []pair{{"2026-12-12", "dinner"}}}},
			{"POST", "/api/events/" + id + "/close", nil},
			{"POST", "/api/events/" + id + "/reopen", nil},
			{"DELETE", "/api/events/" + id + "/participants/Zr4h1TqPwm", nil},
			{"GET", "/api/events/" + id + "/stream", nil},
		} {
			t.Run(req.method+" "+req.path, func(t *testing.T) {
				c := creds{token: "p_unknown", key: unknownKey}
				h.do(req.method, req.path, req.body, c).wantError(http.StatusNotFound, "not_found")
			})
		}
	}
}

// keyCounter counts how often the store is asked about an organiser key.
type keyCounter struct {
	store.Store
	asked atomic.Int32
}

func (k *keyCounter) IsOrganiserKey(ctx context.Context, eventID, keyHash string) (bool, error) {
	k.asked.Add(1)
	return k.Store.IsOrganiserKey(ctx, eventID, keyHash)
}

func TestOrganiserKeyThatIsNotAUUID(t *testing.T) {
	counter := &keyCounter{}
	h := newHarness(t, func(o *Options) {
		counter.Store = o.Store
		o.Store = counter
	})
	created := h.create()
	id := created.Event.ID

	// Treated as if the header were not there: nothing is looked up.
	for _, key := range []string{
		"o_unknown",
		"nonsense",
		strings.ToUpper(created.OrganiserKey),
		"{" + created.OrganiserKey + "}",
		strings.ReplaceAll(created.OrganiserKey, "-", ""),
		" " + created.OrganiserKey + "x",
		created.ParticipantToken,
	} {
		if ev := h.do("GET", "/api/events/"+id, nil, creds{key: key}).event(http.StatusOK); ev.CanManage {
			t.Fatalf("key %q can manage", key)
		}
		h.do("POST", "/api/events/"+id+"/close", nil, creds{key: key}).wantError(http.StatusUnauthorized, "unauthorized")
	}
	if got := counter.asked.Load(); got != 0 {
		t.Fatalf("the store was asked about %d keys that are not UUIDs", got)
	}

	// A UUID is looked up, and only the right one manages.
	if ev := h.do("GET", "/api/events/"+id, nil, creds{key: unknownKey}).event(http.StatusOK); ev.CanManage {
		t.Fatal("an unknown key can manage")
	}
	if ev := h.do("GET", "/api/events/"+id, nil, creds{key: created.OrganiserKey}).event(http.StatusOK); !ev.CanManage {
		t.Fatal("the organiser key can not manage")
	}
	if got := counter.asked.Load(); got != 2 {
		t.Fatalf("the store was asked %d times, want 2", got)
	}
}

func TestUnknownRoute(t *testing.T) {
	h := newHarness(t)
	id := h.create().Event.ID
	for _, req := range []struct{ method, path string }{
		{"GET", "/api/nope"},
		{"GET", "/api"},
		{"GET", "/api/"},
		{"GET", "/api/events"},
		{"GET", "/api/events/"},
		{"GET", "/api//events/" + id},
		{"GET", "/api/events/" + id + "/"},
		{"GET", "/api/events/" + id + "/../" + id},
		{"DELETE", "/api/events/" + id},
		{"PATCH", "/api/events/" + id},
		{"GET", "/api/events/" + id + "/absences"},
		{"POST", "/api/events/" + id + "/absences"},
		{"GET", "/api/events/" + id + "/close"},
		{"GET", "/"},
		{"GET", "/e/" + id},
	} {
		t.Run(req.method+" "+req.path, func(t *testing.T) {
			h.do(req.method, req.path, nil, creds{}).wantError(http.StatusNotFound, "not_found")
		})
	}
}

func TestBodyTooLarge(t *testing.T) {
	h := newHarness(t)
	created := h.create()
	id := created.Event.ID

	// Well-formed JSON, so only its size can be wrong.
	big := `{"title":"Cena di dicembre","organiser_name":"` + strings.Repeat("a", 64<<10) + `","days":[]}`
	h.do("POST", "/api/events", big, creds{}).wantError(http.StatusRequestEntityTooLarge, "payload_too_large")
	h.do("POST", "/api/events/"+id+"/participants", `{"name":"`+strings.Repeat("a", 64<<10)+`"}`, creds{}).
		wantError(http.StatusRequestEntityTooLarge, "payload_too_large")
	many := strings.TrimSuffix(strings.Repeat(`{"date":"2026-12-12","slot":"dinner"},`, 2000), ",")
	h.do("PUT", "/api/events/"+id+"/absences", `{"set":[`+many+`]}`,
		creds{token: created.ParticipantToken}).wantError(http.StatusRequestEntityTooLarge, "payload_too_large")

	t.Run("exactly 64 KiB is read", func(t *testing.T) {
		const prefix, suffix = `{"name":"`, `"}`
		body := prefix + strings.Repeat("a", 64<<10-len(prefix)-len(suffix)) + suffix
		if len(body) != 64<<10 {
			t.Fatalf("the body is %d bytes", len(body))
		}
		// Read in full, then refused for what it says.
		h.do("POST", "/api/events/"+id+"/participants", body, creds{}).
			wantError(http.StatusUnprocessableEntity, "validation_failed")
	})
}

func TestUnknownField(t *testing.T) {
	h := newHarness(t)
	created := h.create()
	id := created.Event.ID
	c := creds{token: created.ParticipantToken}

	body := dinner()
	body["colour"] = "yellow"
	h.do("POST", "/api/events", body, creds{}).wantError(http.StatusBadRequest, "invalid_request")

	nested := dinner()
	nested["days"] = []map[string]any{{"date": "2026-12-11", "slots": []string{"dinner"}, "note": "x"}}
	h.do("POST", "/api/events", nested, creds{}).wantError(http.StatusBadRequest, "invalid_request")

	h.do("POST", "/api/events/"+id+"/participants", `{"name":"Luca","organiser":true}`, creds{}).
		wantError(http.StatusBadRequest, "invalid_request")
	h.do("PUT", "/api/events/"+id+"/absences", `{"set":[],"toggle":[]}`, c).
		wantError(http.StatusBadRequest, "invalid_request")
	h.do("PUT", "/api/events/"+id+"/absences", `{"set":[{"date":"2026-12-12","slot":"dinner","who":"x"}]}`, c).
		wantError(http.StatusBadRequest, "invalid_request")
}

func TestMalformedBody(t *testing.T) {
	h := newHarness(t)
	id := h.create().Event.ID
	for name, body := range map[string]string{
		"empty":            ``,
		"not JSON":         `name=Luca`,
		"cut short":        `{"name":"Luca"`,
		"wrong type":       `{"name":7}`,
		"an array":         `["Luca"]`,
		"two values":       `{"name":"Luca"}{"name":"Anna"}`,
		"trailing garbage": `{"name":"Luca"} x`,
	} {
		t.Run(name, func(t *testing.T) {
			h.do("POST", "/api/events/"+id+"/participants", body, creds{}).wantError(http.StatusBadRequest, "invalid_request")
		})
	}
	if ev := h.do("GET", "/api/events/"+id, nil, creds{}).event(http.StatusOK); len(ev.Participants) != 1 {
		t.Fatalf("a malformed join added a participant: %+v", ev.Participants)
	}
}

func TestNoStore(t *testing.T) {
	h := newHarness(t)
	created := h.create()
	id := created.Event.ID
	organiser := creds{token: created.ParticipantToken, key: created.OrganiserKey}

	for _, req := range []struct {
		method, path string
		body         any
		creds        creds
		status       int
	}{
		{"POST", "/api/events", dinner(), creds{}, 201},
		{"POST", "/api/events", `{`, creds{}, 400},
		{"POST", "/api/events", map[string]any{}, creds{}, 422},
		{"GET", "/api/events/" + id, nil, creds{}, 200},
		{"GET", "/api/events/9d2c7f40-5b1e-4c3a-a6f8-0e1d2c3b4a59", nil, creds{}, 404},
		{"POST", "/api/events/" + id + "/participants", map[string]string{"name": "Luca"}, creds{}, 201},
		{"POST", "/api/events/" + id + "/participants", map[string]string{"name": "Luca"}, creds{}, 409},
		{"PUT", "/api/events/" + id + "/absences", change{Set: []pair{{"2026-12-12", "dinner"}}}, organiser, 200},
		{"PUT", "/api/events/" + id + "/absences", change{}, creds{}, 401},
		{"POST", "/api/events/" + id + "/close", nil, organiser, 200},
		{"POST", "/api/events/" + id + "/reopen", nil, organiser, 200},
		{"POST", "/api/events/" + id + "/close", nil, creds{}, 401},
		{"DELETE", "/api/events/" + id + "/participants/nobody", nil, organiser, 404},
		{"GET", "/api/nope", nil, creds{}, 404},
		{"PATCH", "/api/events", nil, creds{}, 404},
	} {
		t.Run(fmt.Sprintf("%s %s %d", req.method, req.path, req.status), func(t *testing.T) {
			res := h.do(req.method, req.path, req.body, req.creds).wantStatus(req.status)
			if got := res.header.Get("Cache-Control"); got != "no-store" {
				t.Fatalf("Cache-Control = %q, want no-store", got)
			}
		})
	}
}

// ---- concurrency ------------------------------------------------------

func TestConcurrentAbsences(t *testing.T) {
	h := newHarness(t)
	created := h.create()
	id := created.Event.ID
	luca := h.join(id, "Luca")
	before := luca.Event.Version

	// Thirteen candidate pairs; Giulia and Luca mark ten each, one pair per
	// request, all at the same moment.
	var pairs []pair
	for _, d := range luca.Event.Days {
		for _, s := range d.Slots {
			pairs = append(pairs, pair{d.Date, s})
		}
	}
	type mark struct {
		token string
		pair  pair
	}
	var marks []mark
	for i := range 10 {
		marks = append(marks, mark{created.ParticipantToken, pairs[i]}, mark{luca.ParticipantToken, pairs[len(pairs)-1-i]})
	}

	start := make(chan struct{})
	statuses := make(chan int, len(marks))
	var wg sync.WaitGroup
	for _, m := range marks {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			res := h.do("PUT", "/api/events/"+id+"/absences", change{Set: []pair{m.pair}}, creds{token: m.token})
			statuses <- res.status
		}()
	}
	close(start)
	wg.Wait()
	close(statuses)
	for status := range statuses {
		if status != http.StatusOK {
			t.Fatalf("a concurrent mark answered %d", status)
		}
	}

	ev := h.do("GET", "/api/events/"+id, nil, creds{}).event(http.StatusOK)
	if got := ev.Version - before; got != 20 {
		t.Fatalf("version grew by %d, want 20", got)
	}
	for i, p := range ev.Participants {
		marked := 0
		for _, slots := range p.Absences {
			marked += len(slots)
		}
		if marked != 10 {
			t.Fatalf("%s holds %d marks, want 10: %v", p.Name, marked, p.Absences)
		}
		for j := range 10 {
			want := pairs[j]
			if i == 1 {
				want = pairs[len(pairs)-1-j]
			}
			if !contains(p.Absences[want.Date], want.Slot) {
				t.Fatalf("%s lost the mark on %v", p.Name, want)
			}
		}
	}

	// One update per change, and every version from before+1 to before+20.
	seen := map[int64]bool{}
	for _, n := range h.notes.all() {
		if n.Update.Kind == "absences" {
			seen[n.Update.Version] = true
		}
	}
	for v := before + 1; v <= before+20; v++ {
		if !seen[v] {
			t.Fatalf("no update was published for version %d", v)
		}
	}
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
