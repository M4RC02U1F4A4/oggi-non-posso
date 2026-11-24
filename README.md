# Oggi non posso

A small web page that helps a group find a day when everyone is free.
Instead of asking "when can you come?", everyone marks when they can
**not**; what is left over is the answer.

- Someone creates an event: a title, the candidate days, and which parts of
  the day are in play (morning, lunch, afternoon, dinner, after dinner).
- They share one link. Whoever opens it writes a name and marks the slots
  they can't make. Everyone sees the table fill in live.
- The organiser closes the voting and the page lists the moments everyone
  can make, then the ones where a single person is missing.

No accounts. The interface is in Italian.

## How it is built

Two halves that share only an HTTP API:

- `backend/` — a Go service: JSON API under `/api`, server-sent events for
  the live update, SQLite. It returns no HTML.
- `frontend/` — a React + TypeScript + Vite single-page app.

The API contract, the domain rules and the look are described in
[`docs/superpowers/specs/`](docs/superpowers/specs/).

## Run it for development

You need Go 1.26 and Node 22.

```sh
# Terminal 1: the API on :8080, database in the current directory
cd backend
go run ./cmd/oggi-non-posso

# Terminal 2: the frontend on :5173, proxying /api to the backend
cd frontend
npm install
npm run dev
```

Set `VITE_API_TARGET` if the backend listens somewhere else.

Checks:

```sh
cd backend && gofmt -l . && go vet ./... && go test ./... -race
cd frontend && npm run typecheck && npm test -- --run && npm run build
```

## Releases

Every push to `main` publishes an image to
`ghcr.io/m4rc02u1f4a4/oggi-non-posso` (linux/arm64), tagged with a version
computed from the commit messages and `latest`, plus a git tag and a GitHub
Release.

## Run it as one image

```sh
docker build -t oggi-non-posso .
docker run --rm -p 8080:8080 -v oggi-non-posso-data:/data oggi-non-posso
```

The image holds the Go binary and the built frontend; the binary serves
both on port 8080 and keeps its database in `/data`.

## Configuration

Everything is set through the environment; `.env.example` lists the same
variables.

| Variable | Default | Meaning |
| --- | --- | --- |
| `ONP_LISTEN` | `:8080` | Address to listen on |
| `ONP_DB_PATH` | `oggi-non-posso.db` | SQLite file |
| `ONP_STATIC_DIR` | empty | Directory with the built frontend; empty serves the API only |
| `ONP_RETENTION_DAYS` | `30` | Days after its last candidate day when an event is deleted; `0` keeps events for ever |
| `ONP_MAX_PARTICIPANTS` | `50` | Participants per event |
| `ONP_RATE_LIMIT` | `true` | Rate limits on creating events and joining |
| `ONP_CLIENT_IP_HEADER` | empty | Header holding the client address behind a trusted proxy (its last element is used); empty uses the connection's address |
| `ONP_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |

A bad value stops the process with exit code 2 and names the variable.

## Behind a proxy

- Set `ONP_CLIENT_IP_HEADER` to the header your proxy writes, or every
  visitor shares one rate limit.
- `/api/events/<id>/stream` is a long-lived response: switch off response
  buffering for it and allow idle connections of at least a minute.
- The organiser's link has the organiser key in its path
  (`/e/<event>/o/<key>`). The service does not write it to its log; make
  sure your proxy's access log does not either.
