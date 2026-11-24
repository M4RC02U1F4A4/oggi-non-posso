# CLAUDE.md

Project context for Claude Code working on **Oggi non posso** — a web page
that helps a group find a day when everyone is free. Each person marks when
they can NOT make it; what is left over is the answer.

## Status

First version in progress. The design is in
`docs/superpowers/specs/2026-11-24-oggi-non-posso-design.md` (behaviour, API
contract, look) and the plan in `docs/superpowers/plans/`. The mockups live
outside this repository.

## What it does

- Someone (the **organiser**) creates an **event**: a title, the candidate
  **days**, and which **slots** of the day are in play. The event gets a
  unique link to share.
- Everyone who opens the link gives a name and marks the slots when they are
  **not** available. Marking is negative on purpose: an untouched slot means
  "I can".
- Anyone with the link sees the calendar update live while the others vote.
- The organiser closes the voting. The page then shows the alternatives:
  first the slots free for everybody, then the ones with the fewest people
  missing, with who is missing.
- No accounts.

## Domain model

Rules the server enforces and every page relies on. A change to one of them
goes here and in the design document in the same commit.

- **Slots are a closed set, in this order**: `morning`, `lunch`,
  `afternoon`, `dinner`, `after_dinner`. Behaviour and layout depend on the
  set and on its order; it is not a free string and there are no clock
  times.
- **An event's candidates are (day, slot) pairs.** The organiser picks the
  days one by one (not a range) and the slots for the whole event, and can
  switch a slot off on a single day. A pair that is not a candidate can not
  be voted and never shows as "free".
- **A vote is an absence.** What is stored is "this participant is NOT
  available on this (day, slot)". Availability is never stored: it is what
  remains. Marking a whole day is the same as marking each of its slots.
- **Nothing about the result is stored.** Who is missing where, the free
  slots and the ranking of the alternatives are derived from the absences
  at read time. Don't add a "best day" column: one changed vote would
  falsify it.
- **The organiser closes the voting**, and only the organiser. There is no
  expected number of participants and no automatic close. While the event is
  open everyone sees everyone's absences; once closed, votes are read-only
  and the page leads with the alternatives.
- **Links and tokens are the only credentials.** The share link reaches the
  event. A participant token (kept by the browser that joined) changes that
  participant's marks; an organiser key closes, reopens and removes
  participants. They are random and the database keeps only their hashes.
  The two unique links are plain paths with UUIDs: `/e/<event>` to share and
  `/e/<event>/o/<organiser key>` for the organiser; the organiser key is
  never written to a log, and the page drops it from the address bar once
  stored.
- **Dates are calendar dates**, `YYYY-MM-DD` strings end to end. No time
  zone is ever applied to them, in Go or in TypeScript.

## Stack

Frontend and backend are separate on purpose. They share one thing, the API
contract in the design document; a change to it is made there first, then
on both sides.

- **Backend** (`backend/`): Go, standard library HTTP, one binary. A JSON
  API under `/api` and server-sent events for the live update. It returns no
  HTML and holds no interface text.
- **Frontend** (`frontend/`): React + TypeScript + Vite single-page app, no
  component library (the look is its own). It talks to the backend only
  through `/api`.
- **SQLite** for now. **PostgreSQL may come later**, so: only the store
  package speaks SQL, the rest of the code goes through its Go interface;
  queries stay in the subset both databases accept, and anything
  SQLite-only is isolated and commented as such; schema changes are numbered
  migration files, never edited once released.
- **One image**: the Go binary serves the built frontend from a directory
  (`ONP_STATIC_DIR`); without it, it is an API and nothing else.
- **Configuration from the environment only** (`ONP_` variables), every one
  listed with its default in `.env.example` and in the README. Defaults live
  in the code, in one place.
- The interface is in **Italian** for now. Every text a person reads comes
  from one catalogue (`frontend/src/i18n/it.ts`), never a literal in a
  component, so a second language is a new catalogue and nothing else. The
  backend answers with error codes; the frontend owns the words.
- Phone first: most people will open the link from a chat on their phone.
  The desktop layout is the same page with more room, not a different one.

## Repository layout

- `CLAUDE.md` — this file.
- `backend/` — the Go service; `frontend/` — the single-page app. Their
  inner layout is in the plan and grows with the code.
- `docs/superpowers/specs/` — design documents; `docs/superpowers/plans/`
  — implementation plans. Internal, not user documentation.
- `.gitignore` — keeps `local/`, databases, builds and `.env` out of git.
- `local/` — NOT in git: notes and anything personal.

The layout grows with the code; describe a new directory here in the commit
that adds it.

## Working on this repository

1. **Nothing personal or private in anything tracked.** The repository is
   public. Code, comments, docs, commit messages, issues, PR bodies, tests,
   fixtures, mockups and screenshots carry nothing about the maintainer, the
   people who use it or where it runs: no real names, emails, places,
   domains, hostnames, IPs, server or cluster names, names of private
   repositories, and no real events or votes. When an example helps, invent
   a neutral one ("Cena di dicembre", `Giulia`, `Luca`,
   `oggi.example.org`). Read every text before it is committed or published
   and strip what does not belong; git history and issue edits stay visible.
2. **Push only when asked.** Commit when asked; push to GitHub only on an
   explicit request. Stage files by name, never `git add -A` /
   `git commit -a`.
3. **Commit messages**: Conventional Commits, in English, with this trailer:

       Co-authored-by: Claude <noreply@anthropic.com>

   The type describes THIS change: `feat:` only for something a person can
   now do or see that they could not before; corrections and tweaks are
   `fix:`; `docs:`, `chore:`, `refactor:`, `test:`, `ci:` for what changes
   no behaviour. Decide the type from the diff before writing the subject.
4. **Everything in the repository is in English**: code, comments, logs,
   docs, commit messages. The interface text is Italian by design: that is
   product behaviour, not the language of the repository.
5. **Design before code.** A new page or a change of look is drawn first and
   approved by the maintainer; the code follows the approved drawing. Mockups
   use invented data (rule 1) and only what the product really does.
6. **Look at UI changes** in a browser before committing: phone width and
   desktop, light and dark.
7. **Stop what you start.** A server or a binary started for a test is
   stopped when the test is over.

## When in doubt

- A choice about how the product behaves that the maintainer has not made:
  ask a short question first, then build.
- One commit per logical change, so it is easy to revert.
- An audit is a punch list grouped by severity (BLOCKER / HIGH / MEDIUM /
  LOW) with `file:line` references, not vague critique.
