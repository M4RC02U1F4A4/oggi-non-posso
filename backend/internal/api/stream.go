package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/hub"
	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/token"
)

const (
	// defaultPingInterval is how often an idle stream gets a comment line,
	// so that nothing between the two ends closes it for silence.
	defaultPingInterval = 25 * time.Second
	// streamWriteTimeout is how long a client has to take what is sent.
	streamWriteTimeout = 10 * time.Second
	// streamRetryAfter is what a client refused a stream is told to wait.
	// A place frees up when another stream closes, which nobody can tell
	// in advance.
	streamRetryAfter = 30 * time.Second
)

// Subscriber gives the updates of an event from now on, and the function
// that ends the subscription.
type Subscriber interface {
	Subscribe(eventID string) (updates <-chan Update, cancel func())
}

// stream serves the live updates of an event as server-sent events: the
// current version on connect, then every update, and a comment line now
// and then. It carries no data about the event: clients fetch the event
// when they see a version newer than theirs.
func (a *api) stream(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !token.IsUUID(id) {
		notFound(w)
		return
	}

	// A stream holds a connection for as long as its client stays: their
	// number is bounded, per client and in all, with or without rate
	// limits.
	leave, ok := a.streams.Enter(a.clientAddress(r))
	if !ok {
		w.Header().Set("Retry-After", strconv.Itoa(int(streamRetryAfter.Seconds())))
		writeError(w, http.StatusTooManyRequests, codeRateLimited, "too many open streams, try again later")
		return
	}
	defer leave()

	// Subscribe before reading the version: a change that lands between
	// the two is then announced twice instead of never.
	updates, cancel := a.updates.Subscribe(id)
	defer cancel()

	ev, err := a.store.GetEvent(r.Context(), id)
	if err != nil {
		a.fail(w, r, storeError(err))
		return
	}

	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Accel-Buffering", "no") // asks a buffering reverse proxy to pass events on as they come
	w.WriteHeader(http.StatusOK)

	rc := http.NewResponseController(w)
	write := func(s string) error {
		// Not every ResponseWriter can set a deadline.
		_ = rc.SetWriteDeadline(time.Now().Add(streamWriteTimeout))
		if _, err := io.WriteString(w, s); err != nil {
			return err
		}
		return rc.Flush()
	}
	send := func(u Update) error {
		data, err := json.Marshal(u)
		if err != nil {
			return err
		}
		return write("event: update\ndata: " + string(data) + "\n\n")
	}

	if err := send(Update{Version: ev.Version, Kind: hub.KindStatus}); err != nil {
		return
	}
	ping := time.NewTicker(a.pingInterval)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-a.shutdown:
			return
		case u := <-updates:
			if err := send(u); err != nil {
				return
			}
		case <-ping.C:
			if err := write(": ping\n\n"); err != nil {
				return
			}
		}
	}
}
