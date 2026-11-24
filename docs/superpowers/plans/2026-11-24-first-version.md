# Oggi non posso — first version Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working first version: create an event, share the link, mark
absences live, close the voting, read the alternatives.

**Architecture:** A Go JSON API with server-sent events and SQLite in
`backend/`, and a React single-page app in `frontend/` that talks to it only
through `/api`. One image: the Go binary serves the built frontend from a
directory.

**Tech Stack:** Go 1.26 (standard library `net/http`, `log/slog`,
`modernc.org/sqlite`), React 19, TypeScript, Vite, Vitest, React Router,
`@fontsource/barlow` and `@fontsource/barlow-condensed`.

**Spec:** `docs/superpowers/specs/2026-11-24-oggi-non-posso-design.md`. It
holds the API contract, the domain rules, the configuration table and the
look. Read it before any task; this plan does not repeat it.

## Global Constraints

- Everything in the repository is in English; the interface text is Italian
  and lives only in `frontend/src/i18n/it.ts`.
- Nothing personal or private in anything tracked; examples use invented
  names (`Giulia`, `Luca`, "Cena di dicembre", `oggi.example.org`).
- Conventional Commits, in English, ending with
  `Co-authored-by: Claude <noreply@anthropic.com>`. Stage files by name.
  Commit on `main`. Never push.
- Backend: no web framework, no ORM, no cgo. Only `internal/store/sqlite`
  contains SQL. SQL stays in the subset PostgreSQL also accepts; anything
  SQLite-only carries a comment saying so.
- Backend never returns HTML and never contains interface text.
- Slots: `morning`, `lunch`, `afternoon`, `dinner`, `after_dinner`, in this
  order, everywhere.
- Dates are `YYYY-MM-DD` strings end to end. No `time.Time` zone conversion
  on them in Go, no `new Date("YYYY-MM-DD")` in TypeScript.
- Limits, verbatim from the spec: title 1–80, names 1–30, days 1–62, body
  64 KiB, 50 participants, 10 events/hour and 30 joins/hour per address,
  event id and organiser key random UUIDs (version 4), participant token
  `p_` + 32 random bytes base64url, comment ping every 25 s, "is marking" 8 s.
- Colours and fonts verbatim from the spec's "Look".
- A server or watcher started for a check is stopped when the check is over.

## Review Focus

1. **Two people mark at the same moment.** Both changes must survive and the
   version must grow by two. → Task 4, `TestConcurrentAbsences`.
2. **A participant is removed while their page is open.** Their next mark is
   `401`; the page drops the stored token and shows the name form again
   instead of failing silently. → Task 4 (`TestRemovedParticipantToken`),
   Task 8 (`useEvent` test "forgets a rejected token").
3. **The phone sleeps and the stream dies.** On wake the page shows current
   data without a reload. → Task 8, `useEventStream` reconnect test and the
   visibility refetch.
4. **Names that look the same.** `" giulia "` joining after `Giulia` is
   `name_taken`; a 30-character name of multi-byte letters is accepted, a
   31-character one is not (characters, not bytes). → Task 2
   (`TestNormalizeName`), Task 4 (`TestJoinNameTaken`).
5. **An event nobody can make, or with a single participant.** Closing
   still answers: with no everyone-free group the best tier is returned;
   with one participant and no absences every pair is free. → Task 2,
   `TestAlternatives` table.
6. **A date near midnight in another time zone.** `2026-12-11` renders as
   "venerdì 11" whatever the browser's zone. → Task 7, `dates.test.ts`.
7. **A stale page marks a closed event.** `409 event_closed` switches the
   page to the result instead of showing an error. → Task 8.

---

## File Structure

```
backend/
  go.mod                         module github.com/M4RC02U1F4A4/oggi-non-posso/backend
  cmd/oggi-non-posso/main.go     wiring, signals, exit codes (0 stop, 1 runtime, 2 config)
  internal/config/               ONP_ variables → Config
  internal/domain/               slots, validation, name normalisation, alternatives (pure)
  internal/token/                random ids and credentials, hashing
  internal/store/                Store interface and its types
  internal/store/sqlite/         the SQLite Store, migrations/*.sql
  internal/hub/                  per-event fan-out for the stream
  internal/ratelimit/            fixed-window limiter per key
  internal/api/                  routes, handlers, middleware, errors, static files
  internal/cleanup/              retention job
frontend/
  package.json, vite.config.ts, tsconfig.json, index.html
  src/main.tsx, src/App.tsx      entry, routes
  src/api/                       types.ts (the contract), client.ts (fetch + errors)
  src/lib/                       slots.ts, dates.ts, grid.ts, credentials.ts
  src/i18n/                      index.ts (t), it.ts (catalogue)
  src/hooks/                     useEvent.ts, useEventStream.ts
  src/components/                Band, VoteTable, PeoplePanel, JoinForm, ResultView,
                                 OrganiserPanel, ShareBox, DayPicker, SlotPicker
  src/pages/                     CreatePage, EventPage, NotFoundPage
  src/styles/                    tokens.css, base.css, one file per component
Dockerfile, .dockerignore, .env.example, README.md
```

---

## Backend

### Task 1: Skeleton, configuration, health

**Files:** `backend/go.mod`, `backend/cmd/oggi-non-posso/main.go`,
`backend/internal/config/config.go`, `config_test.go`

**Interfaces — produces:**

```go
package config
type Config struct {
    Listen          string
    DBPath          string
    StaticDir       string
    RetentionDays   int
    MaxParticipants int
    RateLimit       bool
    ClientIPHeader  string
    LogLevel        slog.Level
}
func Load(getenv func(string) string) (Config, error)
```

- [ ] Test `TestLoadDefaults`: empty environment gives the spec's defaults.
- [ ] Test `TestLoadErrors`: `ONP_RETENTION_DAYS=-1`, `ONP_MAX_PARTICIPANTS=0`,
      `ONP_RATE_LIMIT=maybe`, `ONP_LOG_LEVEL=loud` each return an error whose
      text contains the variable's name.
- [ ] Implement `Load`; `main` exits 2 on its error, logs with `slog` (JSON),
      serves `GET /healthz` → `200 ok`, stops cleanly on SIGINT/SIGTERM.
- [ ] `go vet ./... && go test ./...` pass. Commit `feat(backend): skeleton, configuration and health check`.

### Task 2: Domain

**Files:** `backend/internal/domain/{slots.go,event.go,validate.go,alternatives.go}` and tests

**Interfaces — produces:**

```go
package domain
type Slot string // "morning" | "lunch" | "afternoon" | "dinner" | "after_dinner"
var Slots = []Slot{Morning, Lunch, Afternoon, Dinner, AfterDinner}
func ParseSlot(s string) (Slot, bool)
func SlotIndex(s Slot) int

type Pair struct{ Date string; Slot Slot }
type Day struct{ Date string; Slots []Slot }
type Participant struct {
    ID string; Name string; Organiser bool
    Absences []Pair // sorted by date, then slot order
}
type Event struct {
    ID, Title, Status string // Status: "open" | "closed"
    Version int64
    Days []Day
    Participants []Participant
    CreatedAt time.Time
    ClosedAt *time.Time
}
type Alternative struct{ Date string; Slots []Slot; Missing []string }

type ValidationError struct{ Field, Message string }
func NormalizeTitle(s string) (string, error)          // trimmed, 1–80 characters
func NormalizeName(s string) (name, key string, err error) // trimmed, 1–30 characters; key = lower-cased
func NormalizeDays(in []Day) ([]Day, error)             // sorted, distinct, valid dates, slots canonical
func (e Event) IsCandidate(p Pair) bool
func (e Event) UnionSlots() []Slot
func Alternatives(e Event) []Alternative
```

- [ ] `TestNormalizeName`: `"  Giulia "` → (`Giulia`, `giulia`); empty and
      31 characters are errors; 30 characters of `è` is accepted.
- [ ] `TestNormalizeDays`: unsorted input comes back sorted with slots in
      canonical order; a duplicate date, `2026-02-30`, an empty slot list, an
      unknown slot, a repeated slot, zero days and 63 days are errors.
- [ ] `TestAlternatives`, table-driven, at least these cases:
  - the spec example: 5 participants, 6 days, Fridays without morning and
    lunch, absences as in the table below → exactly, in order:
    `11 [after_dinner] []`, `12 [afternoon dinner] []`,
    `20 [lunch afternoon] []`, `11 [dinner] [Luca]`, `12 [lunch] [Anna]`,
    `12 [after_dinner] [Marta]`, `13 [lunch afternoon] [Luca]`,
    `18 [dinner after_dinner] [Anna]`, `20 [morning] [Marta]`,
    `20 [dinner] [Paolo]`;
  - no everyone-free and no one-missing group → only the smallest tier;
  - one participant, no absences → one group per day with all its slots;
  - neighbours with equal counts but different people are NOT merged;
  - `lunch` and `dinner` with the same absent set but `afternoon` not a
    candidate are NOT merged.

  Fixture (December 2026; `—` = not a candidate):

  | | morning | lunch | afternoon | dinner | after_dinner |
  | --- | --- | --- | --- | --- | --- |
  | 11 | — | — | Luca, Paolo, Marta | Luca | |
  | 12 | Anna, Paolo | Anna | | | Marta |
  | 13 | Giulia, Luca, Anna | Luca | Luca | Paolo, Marta | Paolo, Marta, Giulia |
  | 18 | — | — | Luca, Paolo, Marta, Anna | Anna | Anna |
  | 19 | Giulia, Luca, Paolo | Giulia, Luca | Giulia, Luca | Giulia, Luca | Giulia, Luca, Marta |
  | 20 | Marta | | | Paolo | Paolo, Anna |

- [ ] Implement; tests pass. Commit `feat(backend): domain rules and alternatives`.

### Task 3: Tokens and store

**Files:** `backend/internal/token/token.go` + test,
`backend/internal/store/store.go`,
`backend/internal/store/sqlite/{sqlite.go,migrate.go,migrations/0001_init.sql}` + tests

**Interfaces — produces:**

```go
package token
func NewID(n int) string                 // n characters of [A-Za-z0-9], crypto/rand, no modulo bias
func NewSecret(prefix string) string     // prefix + base64url(32 random bytes), no padding
func Hash(secret string) string          // hex SHA-256

package store
var ErrNotFound, ErrNameTaken, ErrClosed, ErrTooManyParticipants, ErrIsOrganiser error
type NewEvent struct {
    ID, Title, OrganiserKeyHash string
    Days []domain.Day
    Organiser NewParticipant
}
type NewParticipant struct{ ID, Name, NameKey, TokenHash string }
type Store interface {
    CreateEvent(ctx context.Context, e NewEvent) (domain.Event, error)
    GetEvent(ctx context.Context, id string) (domain.Event, error)
    AddParticipant(ctx context.Context, eventID string, p NewParticipant, max int) (domain.Event, error)
    ParticipantByToken(ctx context.Context, eventID, tokenHash string) (id string, err error)
    IsOrganiserKey(ctx context.Context, eventID, keyHash string) (bool, error)
    ChangeAbsences(ctx context.Context, eventID, participantID string, set, clear []domain.Pair) (domain.Event, error)
    SetStatus(ctx context.Context, eventID, status string) (ev domain.Event, changed bool, err error)
    RemoveParticipant(ctx context.Context, eventID, participantID string) (domain.Event, error)
    DeleteExpired(ctx context.Context, lastDayBefore string) (int, error)
    Close() error
}
package sqlite
func Open(path string) (*Store, error) // WAL, foreign keys on, busy timeout, runs migrations
```

Every mutating method runs in one transaction, bumps `events.version` and
returns the event as it is after the change. `ChangeAbsences` and
`AddParticipant` return `ErrClosed` on a closed event. `events.last_day` is
the greatest candidate date. Migrations are embedded `NNNN_name.sql` files
tracked in `schema_migrations`.

- [ ] `token` tests: ids match `^[A-Za-z0-9]{12}$`; 1000 ids are distinct;
      secrets carry the prefix and decode to 32 bytes; `Hash` is stable.
- [ ] Store tests against a temp file, covering each method's happy path and:
      `ErrNameTaken` on the same `NameKey`; `ErrTooManyParticipants` at `max`;
      `ErrClosed`; `ErrIsOrganiser`; `ErrNotFound` for unknown event and
      participant; removing a participant removes their absences; set/clear
      idempotence; `DeleteExpired("2026-12-21")` deletes an event whose last
      day is `2026-12-20` and keeps one whose last day is `2026-12-21`;
      reopening `Open` on the same file keeps data and runs no migration twice.
- [ ] Commit `feat(backend): tokens and SQLite store`.

### Task 4: API

**Files:** `backend/internal/api/{api.go,events.go,errors.go,json.go,auth.go}` + tests

**Interfaces — consumes** `store.Store`, `domain`, `token`.
**Produces:**

```go
package api
type Notifier interface{ Publish(eventID string, u Update) }
type Update struct {
    Version int64  `json:"version"`
    Kind    string `json:"kind"` // "absences" | "participants" | "status"
    By      *string `json:"by"`
}
type Options struct {
    Store store.Store
    Notifier Notifier
    MaxParticipants int
    Logger *slog.Logger
}
func New(o Options) http.Handler // every /api route of the spec except the stream
```

Handlers decode with `DisallowUnknownFields` and a 64 KiB limit, map store
and validation errors to the spec's table, publish an `Update` after every
successful change, and write the event for the caller (`me`, `can_manage`).

- [ ] Tests with `httptest` and a real SQLite store in a temp dir, one per
      endpoint for the happy path asserting the JSON shape of the spec
      (including `slots` union, `absences` map with only non-empty dates,
      `alternatives` null while open and a list when closed), plus:
      `TestJoinNameTaken` (`" giulia "` after `Giulia` → 409 `name_taken`);
      `TestMarkNeedsParticipant` (no header, organiser key only, token of
      another event → 401); `TestMarkNotCandidate` (422);
      `TestMarkSetAndClearSamePair` (422); `TestMarkClosed` (409
      `event_closed`); `TestCloseNeedsOrganiser` (401 with a participant
      token); `TestCloseTwice` (200, version unchanged the second time);
      `TestRemoveOrganiser` (409 `cannot_remove_organiser`);
      `TestRemovedParticipantToken` (after removal, `PUT absences` → 401 and
      `GET` has `me: null`); `TestUnknownEvent` (404 on every route);
      `TestBodyTooLarge` (413); `TestUnknownField` (400);
      `TestConcurrentAbsences` (20 goroutines, two participants, final state
      holds every mark and `version` grew by 20); `TestNoStore` (every
      response has `Cache-Control: no-store`).
- [ ] Commit `feat(backend): JSON API for events, participants and absences`.

### Task 5: Live updates

**Files:** `backend/internal/hub/hub.go` + test, `backend/internal/api/stream.go` + test

**Interfaces — produces:**

```go
package hub
type Hub struct{ /* ... */ }
func New() *Hub
func (h *Hub) Subscribe(eventID string) (ch <-chan api.Update, cancel func())
func (h *Hub) Publish(eventID string, u api.Update) // never blocks; a slow subscriber keeps only the newest
```

To avoid an import cycle, `Update` moves to `internal/hub` and `api` aliases
it (`type Update = hub.Update`). The stream handler answers 404 for an
unknown event, sets `Content-Type: text/event-stream`, sends the current
version at once (`kind: "status"`, `by: null`), then every update, and a
`: ping` comment every 25 s (interval injectable for tests). It ends when
the request context ends.

- [ ] Hub tests: two subscribers both receive; a cancelled one does not; a
      subscriber that never reads does not block `Publish` and, when it reads,
      gets the newest update; no goroutine or map entry is left after cancel.
- [ ] Stream test: connect, read the first `update`, mark an absence through
      the API, read the second `update` with the new version, `kind`
      `absences` and `by` the participant; with a 10 ms ping interval a
      `: ping` line arrives.
- [ ] Commit `feat(backend): live updates over server-sent events`.

### Task 6: Limits, headers, static files, retention, wiring

**Files:** `backend/internal/ratelimit/ratelimit.go` + test,
`backend/internal/api/{middleware.go,static.go}` + tests,
`backend/internal/cleanup/cleanup.go` + test, `main.go`

**Interfaces — produces:**

```go
package ratelimit
func New(limit int, window time.Duration, now func() time.Time) *Limiter
func (l *Limiter) Allow(key string) (ok bool, retryAfter time.Duration)

package api // additions to Options
    RateLimit      bool
    ClientIPHeader string
    StaticDir      string

package cleanup
func Run(ctx context.Context, s store.Store, retentionDays int, every time.Duration, now func() time.Time, log *slog.Logger)
```

- Rate limits (10 creations and 30 joins per hour per client address) answer
  429 `rate_limited` with `Retry-After`. The client address is the
  connection's, or the last element of `ClientIPHeader` when set.
- Every response: `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`,
  `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'`.
- With `StaticDir` set, non-`/api` GETs serve files from it; a path that is
  not a file serves `index.html` (the app's routes). `index.html` is
  `no-cache`; files under `assets/` are cached for a year, immutable.
  Unknown `/api/...` paths stay JSON 404. Without `StaticDir`, non-API
  paths are JSON 404.
- `cleanup.Run` deletes events whose last day is more than `retentionDays`
  before today (UTC), at start and every `every`; `0` does nothing.

- [ ] Tests: limiter windows and `retryAfter`; the 11th creation in an hour
      is 429 and one after the window passes; header takes the last element;
      security headers present on API and static responses; static fallback
      and cache headers; `/api/nope` is JSON 404 with `StaticDir` set; a path
      with `..` never leaves the directory; cleanup deletes only expired.
- [ ] Wire everything in `main`; run the binary, create an event and read it
      with `curl`, then stop it.
- [ ] Commit `feat(backend): rate limits, security headers, static files and retention`.

---

## Frontend

The mockups (outside the repository) are the reference for every page; the
spec's "Look" fixes colours, type and structure.

### Task 7: Scaffold, contract, pure logic

**Files:** `frontend/{package.json,vite.config.ts,tsconfig.json,index.html}`,
`src/main.tsx`, `src/App.tsx`, `src/api/{types.ts,client.ts}`,
`src/lib/{slots.ts,dates.ts,grid.ts,credentials.ts}`, `src/i18n/{index.ts,it.ts}`,
`src/styles/{tokens.css,base.css}`, tests next to the files

**Interfaces — produces:**

```ts
// api/types.ts — mirrors the spec's event object exactly
export type Slot = 'morning' | 'lunch' | 'afternoon' | 'dinner' | 'after_dinner'
export interface EventDay { date: string; slots: Slot[] }
export interface Participant { id: string; name: string; organiser: boolean; absences: Record<string, Slot[]> }
export interface Alternative { date: string; slots: Slot[]; missing: string[] }
export interface EventData { /* every field of the spec's event object */ }
export type ErrorCode = 'invalid_request' | 'unauthorized' | 'not_found' | 'event_closed' | 'name_taken'
  | 'too_many_participants' | 'cannot_remove_organiser' | 'payload_too_large' | 'validation_failed'
  | 'rate_limited' | 'internal' | 'network'
export class ApiError extends Error { code: ErrorCode; status: number }

// api/client.ts — one function per endpoint, credentials passed in
createEvent(input): Promise<{ event; participant_token; organiser_key }>
getEvent(id, creds): Promise<EventData>
joinEvent(id, name): Promise<{ event; participant_token }>
changeAbsences(id, token, change: { set: Pair[]; clear: Pair[] }): Promise<EventData>
closeEvent(id, key) / reopenEvent(id, key) / removeParticipant(id, key, pid): Promise<EventData>

// lib
SLOTS: Slot[]                                   // canonical order
parseDate(s): { y; m; d; weekday: 0..6 }        // pure arithmetic, no Date parsing of the string
cellsOf(event: EventData): Cell[][]             // per day, per union slot: { candidate, missing: Participant[], mine }
countMarked(event, participantId): number
credentials: load(id) / saveParticipant(id, token) / saveOrganiser(id, key) / forgetParticipant(id)
t(key, vars?): string                           // typed keys from it.ts; plural forms by count
```

Vite proxies `/api` to `http://localhost:8080` in dev. Scripts: `dev`,
`build` (typecheck + build), `typecheck`, `test` (Vitest).

- [ ] `dates.test.ts`: `2026-12-11` → Friday 11 December, `2028-02-29` →
      Tuesday; the result is the same with `process.env.TZ` set to
      `Pacific/Kiritimati` and `Pacific/Pago_Pago`.
- [ ] `grid.test.ts`: on the plan's fixture, the 13th afternoon has one
      missing (Luca), the 11th morning is not a candidate, `mine` is true
      only for the caller's absences, `countMarked` for Anna is 7.
- [ ] `client.test.ts` (mocked `fetch`): credentials go in the right
      headers; a JSON error becomes `ApiError` with its code; a network
      failure becomes code `network`.
- [ ] `i18n.test.ts`: plural keys choose by count; a missing variable throws
      in tests.
- [ ] `npm run build` and `npm test` pass. Commit `feat(frontend): scaffold, API client and core logic`.

### Task 8: The event page — join, mark, live

**Files:** `src/hooks/{useEvent.ts,useEventStream.ts}`,
`src/components/{Band,VoteTable,PeoplePanel,JoinForm,ShareBox}.tsx` + styles,
`src/pages/{EventPage,NotFoundPage}.tsx`, tests for the hooks

**Interfaces — produces:**

```ts
useEvent(id): {
  state: 'loading' | 'ready' | 'not_found' | 'error'
  event?: EventData
  marking: Set<string>                 // participant ids active in the last 8 s
  join(name): Promise<void>
  toggle(pairs: Pair[]): void          // optimistic; whole day = that day's candidate pairs
  refresh(): void
}
useEventStream(id, onUpdate: (u: { version; kind; by }) => void): void // reconnects with backoff
```

- [ ] Hook tests (fake timers, mocked `EventSource` and client): an update
      with a newer version triggers one refetch and an older one none; `by`
      enters `marking` and leaves after 8 s; a failed toggle restores the
      cell; `event_closed` on toggle refetches and does not surface an error;
      `unauthorized` on toggle forgets the token ("forgets a rejected
      token"); the stream reconnects after an error; becoming visible
      refetches.
- [ ] Build the page as in the mockup "Vota": band, table (names in cells
      from 900 px up, counts below; black "can't" cells; greys by count),
      people panel, share box, bottom bar on the phone; the join form above a
      read-only table for a visitor. Light and dark.
- [ ] Keyboard: every cell and day header is a button with an accessible
      name ("sabato 12, cena: non puoi" / "puoi"); focus is visible.
- [ ] Look at it in a browser against a running backend at 390 px and
      1280 px, light and dark. Commit `feat(frontend): event page with live marking`.

### Task 9: The result and the organiser

**Files:** `src/components/{ResultView,OrganiserPanel}.tsx` + styles, `EventPage.tsx`

- [ ] `ResultView` as in the mockup "Risultato": headline from the number of
      everyone-free groups ("Ci siete tutti in tre momenti"; with none,
      "Non c'è un momento per tutti"), the groups, "Se ne manca uno solo" (or
      the best tier's heading), the whole table with counts and yellow
      everyone-free cells. Test the headline and heading choice on the
      fixture and on a no-free event.
- [ ] `OrganiserPanel` (only with `can_manage`): close with a confirmation,
      reopen, remove a participant with a confirmation, copy both links. The
      organiser link `/e/:id/o/:key` is verified, stored and replaced by `/e/:id` on load (test with a fake
      `location`).
- [ ] Browser check as above. Commit `feat(frontend): result view and organiser controls`.

### Task 10: Creating an event

**Files:** `src/components/{DayPicker,SlotPicker}.tsx` + styles, `src/pages/CreatePage.tsx`

- [ ] `DayPicker`: a month grid starting on Monday, previous/next month,
      tap to pick and unpick, past days disabled, at most 62 picked. Test the
      month matrix for December 2026 (starts on Tuesday, 31 days) and
      February 2028.
- [ ] `SlotPicker`: five switches for the event, and for each picked day a
      row of the chosen slots to switch off; a day cannot lose its last slot.
- [ ] Submit creates the event, stores both credentials, and shows the share
      screen: the share link with a copy button, the organiser link with "keep
      this one for yourself", and "open the event".
- [ ] Errors from the API show next to the field or as a line above the
      button, in Italian, from the catalogue (`rate_limited` included).
- [ ] Browser check. Commit `feat(frontend): create an event and share it`.

---

## Integration

### Task 11: Image, docs

**Files:** `Dockerfile`, `.dockerignore`, `.env.example`, `README.md`, `CLAUDE.md`

- [ ] Dockerfile: Node stage builds `frontend/`, Go stage builds the binary
      (cgo off, `-trimpath`, version from a build arg), final stage
      distroless static, non-root 65532, `ONP_STATIC_DIR=/app/static`,
      `ONP_DB_PATH=/data/oggi-non-posso.db`, volume `/data`, port 8080.
- [ ] `.env.example` lists every `ONP_` variable with its default; README
      says what it is, how to run both halves in development, how to build
      the image, and carries the configuration table.
- [ ] `CLAUDE.md`: stack and repository layout as built.
- [ ] Commit `build: single image serving API and frontend` and `docs: README and configuration`.

### Task 12: End-to-end check and review

- [ ] Build the frontend, start the binary with `ONP_STATIC_DIR`, and with a
      browser at 390 px and 1280 px, light and dark: create an event, join
      from a second browser context, mark in both and watch each update the
      other, close, read the result, reopen, remove a participant. Fix what
      is wrong.
- [ ] Independent review of the whole diff against the spec and the Review
      Focus list; fix what it finds. Stop every process started.
