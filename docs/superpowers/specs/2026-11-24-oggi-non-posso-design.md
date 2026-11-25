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
- The look is the "agenda" direction: a white page, warm ink, one card
  per day with its slots as chips; red only for "I can't", green only for
  "everyone can" (see "Look"). It replaced a first "timetable" look that
  was too heavy on black and yellow and did not make clear that the marks
  are the times you can NOT make.

### Author's calls

- **Names are a touch away.** Each slot shows how many others can't; a
  long press (or a tap, when only looking) names them, and the people panel
  lists everyone.
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

JSON over HTTP, UTF-8, every path under `/api`. A request with a body must
send `Content-Type: application/json`; anything else is `400 invalid_request`
(so another site can not post to the API through its visitors' browsers). Every response under `/api`
carries `Cache-Control: no-store`.

### Credentials

- Participant: `Authorization: Bearer p_<token>`, where the token is 32
  random bytes, base64url. It never appears in a link.
- Organiser: `X-Organiser-Key: <uuid>`, a random UUID (version 4). It is the
  last segment of the organiser link.

The database keeps only the SHA-256 of both.
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
  "id": "3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10",
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

- `id`: a random UUID (version 4), lower case, in the canonical 36-character form. It is the unique part of the share link.
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

Every returned event is written for the caller (`me`, `can_manage`). The
event returned by a creation has `me` set to the organiser and `can_manage`
true; the event returned by a join has `me` set to the new participant.

An event starts at version 1. An accepted `PUT absences` bumps the version
even when it changes nothing; a close or reopen that changes nothing does
not. A method or path the table does not list is `404 not_found`.

Validation:

- `title`: 1–80 characters after trimming.
- `name`, `organiser_name`: 1–30 characters after trimming.
- `days`: 1–62 entries, distinct valid dates; each with 1–5 distinct slots
  from the closed set.
- Dates of a new event: from the day before today to a year and a day after
  it, both in UTC (the extra day on each side covers every time zone). The
  creation page offers today to the same day next year.
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
- `participants(id, event_id, name, name_key, token_hash, organiser, join_order, created_at)` — unique `(event_id, name_key)` and `(event_id, join_order)`; `join_order` is the position in the joining order, which a timestamp in seconds can not give
- `absences(participant_id, event_id, day, slot)` — primary key `(participant_id, day, slot)`, and a foreign key to `candidates` so the database itself refuses an absence on a pair that is not a candidate
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
At most 20 open streams per client address and 2000 in all. An IPv6
address counts by its /56, the block a home line is commonly given.

## Frontend

### Routes

- `/` — create an event: title, your name, the days (a month calendar,
  tap to pick), the slots (five switches), and per-day slot switches.
  After creating: the share link to copy, and the organiser link with a
  line saying to keep it.
- `/e/:id` — the event. Unknown id: a "not found" page with a link to `/`.
  - Open, not joined: the live day cards, read-only, under a "what's your
    name?" form.
  - Open, joined: the day cards to mark; a people panel (who marked how
    many slots, who is marking right now) and the share link.
  - Closed: the result — the everyone-free groups, the one-missing groups,
    and all the day cards with counts.
  - With the organiser key: close / reopen, remove a participant, copy both
    links.
- `/e/:id/o/:key` — the organiser link, with the organiser key (a UUID) in
  the path. The page checks the key with the server, stores it for that
  event only if it is valid, and then replaces the address with `/e/:id`, so
  that copying the address bar never hands out the organiser's rights. A key
  that is not valid never replaces one already stored.

Both unique links are plain paths with UUIDs: `/e/<event uuid>` to share,
`/e/<event uuid>/o/<organiser uuid>` for the organiser.

Credentials live in `localStorage`, keyed by event id.

### Behaviour

- Marking is optimistic: the cell changes at once, the request follows, a
  failure puts it back and says so.
- The stream drives refreshes; the page also refetches when it becomes
  visible again and reconnects the stream when it drops.
- "Is marking now" shows for 8 seconds after a participant's last
  `absences` update.
- Every slot shows how many others can't ("2 no"); a long press (or a tap
  when only looking, or on the closed event) names who is missing, in a
  small bubble under the slot. Phone and desktop alike.
- Dates are formatted from their parts, never through a time zone.

### Look

The "agenda" look: a white page and warm ink, the days as cards. Red means
only "I can't"; green means only "everyone can". No other accent colour.

- Palette, light: ground `#FFFFFF`, ink `#22211F`, muted text `#6F6C66`,
  rules `#E2DFD9`, quiet surfaces (link boxes, pills) `#F5F4F1`. "I can't":
  text and border `#C9302A` on `#FFF0EE` (the drawn `#D4342B` is 4.4:1 on
  the pale red; this one is 4.8:1). "Everyone can": `#1D8A4B` with a
  `#EAF6EF` fill and a `#C4E5D1` border.
- Palette, dark (`prefers-color-scheme: dark`), same roles: ground
  `#161514`, cards `#1F1E1C`, text `#F1EFEA`, muted `#A19D95`, rules
  `#34322E`; "I can't" `#FF6B5F` on `#3A1F1C`; "everyone can" `#4CC27A` on
  `#16301F`. What is ink in light (primary buttons, picked days, the
  "who is missing" bubble) is light with dark text in dark.
- Type: Fraunces 600/700 for titles (30 px on the phone, 40 px on the
  desktop; 18–21 px for card and section titles), Figtree 400–700 for
  everything else. Both bundled (`@fontsource-variable`), never fetched
  from a third party.
- Header of every page: the product name, small and muted; a muted bold
  line (the event and who organises it); the title. To someone who has
  joined the title asks "Quando **non** puoi, {name}?", with "non" in red
  and underlined, and the line under it says that an untouched slot means
  "I can".
- Day cards: 14 px corners, 1 px rule. The header is the day ("Venerdì 11
  dicembre") and, when marking, a small underlined "tutto il giorno". The
  body is the event's slots as chips: on the phone one row with a column
  per slot (shorter names with five slots); from 900 px the cards fill a
  grid (columns at least 260 px) with two chips per row and full names.
- Chips: free is white with a 1.5 px rule border; mine is the pale red
  with a red border, red text, the slot name struck through and a small
  round red cross; not in play is dashed and muted and not a control;
  others missing is a small muted "N no" under the name. On the closed
  event every chip has its count, and the slots everyone can make are
  green with a check.
- Buttons: primary is ink, fully rounded; secondary is white with a 1.5 px
  ink border. Fields: 1.5 px rule border, 12 px corners, 46 px tall.
- The phone has a white bar fixed at the bottom with a rule on top: "Non
  puoi in **N** momenti" (N in red) and the saved state; on the creation
  page the number of days and the create button.
- Result: green rows with a round check for the moments everyone can make,
  white rows for the next best with who is missing on the right ("manca
  **Anna**", "manchi **tu**"), then all the day cards.
- Phone first (390 px wide); the desktop layout (1280 px) is the same page
  with a sidebar (about 330 px) for the people and the organiser's links.

## Security notes

- Tokens only in headers: no cookies, so no cross-site request forgery.
- `Referrer-Policy: no-referrer` so a link is not leaked by a click.
- The organiser key is in a path, so it reaches the server: the backend
  never writes it to a log (the segment after `/o/` is redacted), and
  whoever runs a proxy in front should do the same.
- `Content-Security-Policy` limited to the page's own origin;
  `X-Content-Type-Options: nosniff`; no framing.
- Names and titles are plain text everywhere; the frontend never injects
  HTML.

## Left to the builder

- Package and component boundaries beyond what the plan fixes.
- The exact shape of the creation form's calendar.
- Tests beyond the ones the plan names.
