# Oggi non posso — design

Status: **approved for a first version** (2026-11-24). Items under "Author's
calls" stand until the maintainer says otherwise.

## Intent

A group wants to meet and nobody can find a date. Asking "when are you
free?" gets long, vague answers; asking "when can you NOT come?" gets short,
precise ones. Oggi non posso is a page where each person marks the moments
they can't make, and what stays unmarked is the answer.

## Goals

- From "let's meet" to a shared link in under a minute, with no sign-up.
- Voting from a phone, opened from a chat, with one thumb.
- Everyone sees the calendar fill in live, so the group converges while it
  votes.
- When the voting is closed, a clear answer: the moments everyone can make,
  and the closest alternatives with who would be missing.

## Non-goals

- Accounts, profiles, a list of "my events".
- Clock times, time zones, durations. A day is split into five named slots.
- Calendar integrations, reminders, e-mail.
- Picking the final date on the page: it lists the alternatives, the group
  decides elsewhere.
- Editing an event after it is created (title, days, slots).

## Anti-goals

- A page that needs explaining. If someone opening the link has to ask the
  group what to do, it has failed.
- Asking people to mark when they ARE free. The whole point is the opposite.

## Behaviour

### Decided by the maintainer

- The organiser creates an event and gets a unique link to share.
- The organiser chooses the candidate **days** one by one, and the **slots**
  in play: morning, lunch, afternoon, dinner, after dinner.
- Each participant marks when they are not available.
- Anyone with the link can watch the calendar update in real time.
- The organiser closes the voting; then the alternatives are shown. The page
  does not pick a final date.
- A Go backend with SQLite (PostgreSQL may come later) and a **separate
  frontend**: React + TypeScript + Vite. The backend exposes a JSON API and
  nothing else; it knows nothing about pages.
- The look is the "timetable" direction: a yellow band, black type, a
  days × slots table (see "Look").

### Author's calls

- **Names are visible.** The table shows who is missing, not only how many.
- **No accounts; links and tokens.** The share link is for everyone. The
  organiser also gets an organiser key, shown once at creation as a second
  link, that closes and reopens the voting and removes participants.
- **A participant is a name plus this browser.** Joining returns a token
  the browser keeps; the same browser can change its marks later. Names are
  unique inside an event, compared without case and outer spaces. A second
  device is a second participant; the organiser can remove a duplicate.
- **The organiser is a participant too**: creating an event asks for their
  name and joins them.
- **Slots are chosen for the whole event**, and the organiser can switch one
  off on a single day. The API stores the outcome: a list of slots per day.
- **One tap on a day** marks the whole day; a second tap clears it.
- **The result counts (day, slot) pairs** and groups neighbouring slots of
  one day that miss the same people ("Saturday, afternoon and dinner").
- **Reopening** a closed event is allowed.
- **Events expire**: an event is deleted a configurable number of days after
  its last candidate day.
- **Built to be reachable from the Internet**: size limits and rate limits
  on creation and joining are on by default.
- **Interface in Italian**, all text in one catalogue.

### Deferred

- A personal link to carry one's marks to another device.
- Deleting an event by hand; editing it.
- Any further language.

## Architecture

```
frontend/   React + TypeScript + Vite single-page app. Talks to the backend
            only through /api. Owns every text and every pixel.
backend/    Go service. JSON API, server-sent events, SQLite. No HTML.
Dockerfile  Builds both; the Go binary serves the built frontend from a
            directory when ONP_STATIC_DIR is set.
```

The two halves share one thing: the API contract below. Either can be
replaced without touching the other.

### Approaches considered

- **Server-rendered pages + a little JavaScript.** One binary, no frontend
  build. Set aside when the maintainer asked to keep frontend and backend as
  separate as possible.
- **JSON API in Go + single-page app (chosen).** Two toolchains, but a clean
  seam: the API is the only contract, and the frontend can grow or be
  rewritten on its own.
- **Static page + a hosted database.** No server to run, but live updates
  and the organiser's rights would depend on someone else's product.

## Domain rules

- **Slots are a closed set, in this order**: `morning`, `lunch`,
  `afternoon`, `dinner`, `after_dinner`.
- **Candidates are (date, slot) pairs.** A date is a plain calendar date
  (`YYYY-MM-DD`), never an instant: no time zone is ever applied to it.
- **A vote is an absence** on a candidate pair. Availability is what
  remains and is never stored.
- **Nothing about the result is stored**: counts and alternatives are
  derived from the absences on every read.
- **Only the organiser closes** (and reopens). While open, everyone sees
  everyone's absences; once closed, absences are read-only and nobody joins.
- **Every change bumps the event's `version`** (a counter), so clients can
  tell stale from fresh.

### Alternatives

Computed only for a closed event:

1. For every candidate pair, the set of participants absent on it.
2. On each day, merge runs of slots that are neighbours in the canonical
   order (both candidates) and have the same absent set into one group.
3. Keep the groups whose absent count is ≤ max(1, the smallest absent count
   of any group). So: everyone-free and one-missing groups normally; if the
   best is two or more missing, only that best tier.
4. Order by absent count, then date, then first slot.

## API contract

JSON over HTTP, UTF-8, every path under `/api`. Every response under `/api`
carries `Cache-Control: no-store`.

### Credentials

- Participant: `Authorization: Bearer p_<token>`.
- Organiser: `X-Organiser-Key: o_<key>`.

Both are 32 random bytes, base64url. The database keeps only their SHA-256.
An unknown or foreign credential on a read is ignored (the caller is simply
nobody); on a write that needs it, it is `401 unauthorized`.

### Errors

```json
{ "error": { "code": "name_taken", "message": "human readable, English" } }
```

| Status | Code |
| --- | --- |
| 400 | `invalid_request` (malformed JSON, unknown field) |
| 401 | `unauthorized` |
| 404 | `not_found` |
| 409 | `event_closed`, `name_taken`, `too_many_participants`, `cannot_remove_organiser` |
| 413 | `payload_too_large` |
| 422 | `validation_failed` (well-formed but not acceptable; `message` names the field) |
| 429 | `rate_limited` (with `Retry-After`) |
| 500 | `internal` |

The frontend maps codes to its own text; `message` is for logs and curl.

### The event object

```json
{
  "id": "k7Qm2xVd9LpA",
  "title": "Cena di dicembre",
  "status": "open",
  "version": 12,
  "slots": ["afternoon", "dinner", "after_dinner"],
  "days": [
    { "date": "2026-12-11", "slots": ["afternoon", "dinner", "after_dinner"] },
    { "date": "2026-12-12", "slots": ["dinner", "after_dinner"] }
  ],
  "participants": [
    { "id": "Zr4h1TqPwm", "name": "Giulia", "organiser": true,
      "absences": { "2026-12-11": ["afternoon"] } }
  ],
  "me": "Zr4h1TqPwm",
  "can_manage": false,
  "created_at": "2026-11-24T13:05:00Z",
  "closed_at": null,
  "alternatives": null
}
```

- `id`: 12 characters of `[A-Za-z0-9]`, random.
- `status`: `open` or `closed`.
- `slots`: the union of the days' slots, canonical order.
- `days`: ascending by date; each `slots` in canonical order, never empty.
- `participants`: in joining order. `absences` has only dates with at least
  one slot.
- `me`: the caller's participant id, or `null`.
- `can_manage`: `true` when the request carried this event's organiser key.
- `alternatives`: `null` while open; when closed, a list of
  `{ "date": "2026-12-12", "slots": ["afternoon", "dinner"], "missing": ["<participant id>"] }`.

### Endpoints

| Method and path | Needs | Body | Answers |
| --- | --- | --- | --- |
| `POST /api/events` | — | `{ "title", "organiser_name", "days": [{ "date", "slots": [] }] }` | `201 { "event", "participant_token", "organiser_key" }` |
| `GET /api/events/{id}` | — | — | `200` event |
| `POST /api/events/{id}/participants` | — | `{ "name" }` | `201 { "event", "participant_token" }` |
| `PUT /api/events/{id}/absences` | participant | `{ "set": [{ "date", "slot" }], "clear": [{ "date", "slot" }] }` | `200` event |
| `POST /api/events/{id}/close` | organiser | — | `200` event |
| `POST /api/events/{id}/reopen` | organiser | — | `200` event |
| `DELETE /api/events/{id}/participants/{pid}` | organiser | — | `200` event |
| `GET /api/events/{id}/stream` | — | — | server-sent events |
| `GET /healthz` | — | — | `200 ok` (plain text) |

Every returned event is written for the caller (`me`, `can_manage`).

Validation:

- `title`: 1–80 characters after trimming.
- `name`, `organiser_name`: 1–30 characters after trimming.
- `days`: 1–62 entries, distinct valid dates; each with 1–5 distinct slots
  from the closed set.
- `set` / `clear`: every pair must be a candidate of the event; a pair in
  both is `validation_failed`. Setting what is set and clearing what is
  clear are not errors.
- Request bodies over 64 KiB: `payload_too_large`.
- Joining or marking a closed event: `event_closed`.
- Removing the organiser's own participant: `cannot_remove_organiser`.
  Removing a participant deletes their absences.
- Closing a closed event or reopening an open one succeeds and changes
  nothing.

### Live updates

`GET /api/events/{id}/stream` is `text/event-stream`. On connect, and after
every change to the event, the server sends:

```
event: update
data: {"version":13,"kind":"absences","by":"Zr4h1TqPwm"}
```

`kind` is `absences`, `participants` or `status`; `by` is the participant
who caused it, or `null`. A comment line is sent every 25 seconds to keep
the connection open. The client reacts by fetching the event again when the
version is newer than the one it holds; it never trusts the stream for
data. An unknown event id is `404` before the stream starts.

## Data

Tables, portable between SQLite and PostgreSQL (plain SQL, integer unix
timestamps, text keys):

- `events(id, title, status, organiser_key_hash, version, last_day, created_at, closed_at)`
- `candidates(event_id, day, slot)` — primary key on all three
- `participants(id, event_id, name, name_key, token_hash, organiser, created_at)` — unique `(event_id, name_key)`
- `absences(participant_id, event_id, day, slot)` — primary key `(participant_id, day, slot)`
- `schema_migrations(version)` — applied migrations

Only the store package speaks SQL. Deleting an event removes everything
that belongs to it.

## Configuration

Environment only, prefix `ONP_`, defaults in the code:

| Variable | Default | Meaning |
| --- | --- | --- |
| `ONP_LISTEN` | `:8080` | Address to listen on |
| `ONP_DB_PATH` | `oggi-non-posso.db` | SQLite file |
| `ONP_STATIC_DIR` | empty | Directory with the built frontend; empty serves the API only |
| `ONP_RETENTION_DAYS` | `30` | Days after its last candidate day when an event is deleted; `0` keeps events for ever |
| `ONP_MAX_PARTICIPANTS` | `50` | Participants per event |
| `ONP_RATE_LIMIT` | `true` | Rate limits on creating events and joining |
| `ONP_CLIENT_IP_HEADER` | empty | Header holding the client address behind a trusted proxy (its last element is used); empty uses the connection's address |
| `ONP_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

A bad value stops the process with exit code 2 and names the variable.

Rate limits, per client address: 10 new events per hour, 30 joins per hour.

## Frontend

### Routes

- `/` — create an event: title, your name, the days (a month calendar,
  tap to pick), the slots (five switches), and per-day slot switches.
  After creating: the share link to copy, and the organiser link with a
  line saying to keep it.
- `/e/:id` — the event. Unknown id: a "not found" page with a link to `/`.
  - Open, not joined: the live table, read-only, under a "what's your
    name?" form.
  - Open, joined: the table to mark; a people panel (who marked how many
    slots, who is marking right now) and the share link.
  - Closed: the result — the everyone-free groups, the one-missing groups,
    and the whole table with counts.
  - With the organiser key: close / reopen, remove a participant, copy both
    links.
- `/e/:id#o=<key>` — the organiser link. The page stores the key for that
  event and removes it from the address bar. The fragment never reaches the
  server.

Credentials live in `localStorage`, keyed by event id.

### Behaviour

- Marking is optimistic: the cell changes at once, the request follows, a
  failure puts it back and says so.
- The stream drives refreshes; the page also refetches when it becomes
  visible again and reconnects the stream when it drops.
- "Is marking now" shows for 8 seconds after a participant's last
  `absences` update.
- Phone: the table shows counts, a long press (or a tap on the count when
  the event is closed) names who is missing. Desktop: names in the cells.
- Dates are formatted from their parts, never through a time zone.

### Look

- Colours: timetable yellow `#FFD100`, black `#000000`, white `#FFFFFF`;
  absent-count greys `#F0F0EE` (one), `#DEDEDB` (two), `#C8C8C4` (three or
  more); muted text `#5E5E5A`. "You can't" is a black cell with yellow
  text; "everyone is free" in the result is a yellow cell.
- Type: Barlow Condensed 600/700 for titles, day numbers and counts;
  Barlow 400/500/600 for everything else. Fonts are bundled, not fetched
  from a third party.
- Structure: a yellow band with the name of the product, the title and the
  state; under it, the table with 3 px black rules at the top and under the
  header, 1 px rules between rows; a black bar at the bottom of the phone
  layout with the saved state.
- Light and dark: dark swaps white for black surfaces and keeps the yellow
  band.
- Phone first (390 px wide); the desktop layout (1280 px) is the same page
  with the people panel beside the table.

## Security notes

- Tokens only in headers: no cookies, so no cross-site request forgery.
- `Referrer-Policy: no-referrer` so a share link is not leaked by a click.
- `Content-Security-Policy` limited to the page's own origin;
  `X-Content-Type-Options: nosniff`; no framing.
- Names and titles are plain text everywhere; the frontend never injects
  HTML.

## Left to the builder

- Package and component boundaries beyond what the plan fixes.
- The exact shape of the creation form's calendar.
- Tests beyond the ones the plan names.
