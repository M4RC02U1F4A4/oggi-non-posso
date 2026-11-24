package api

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"time"
)

const (
	// maxBodyBytes is the largest request body the API reads.
	maxBodyBytes = 64 << 10
	// bodyReadTimeout is how long a client has to send its body.
	bodyReadTimeout = 15 * time.Second
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	h := w.Header()
	h.Set("Content-Type", "application/json; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// decodeJSON reads the request body into dst. The body must be one JSON
// value with no unknown field and nothing after it, in at most 64 KiB.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	// Only application/json: a plain form post or a no-cors fetch from
	// another site can not send it, so other sites can not create events or
	// join through their visitors' browsers.
	if mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mt != "application/json" {
		return &apiError{http.StatusBadRequest, codeInvalidRequest, "the request body must be sent as application/json"}
	}
	// Not every ResponseWriter can set a deadline; the body limit holds
	// either way.
	_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(bodyReadTimeout))

	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	dec.DisallowUnknownFields()
	err := dec.Decode(dst)
	if err == nil {
		// Anything but the end of the body after the value is an error.
		if _, err = dec.Token(); err == io.EOF {
			return nil
		}
		if err == nil {
			err = errors.New("unexpected data after the JSON value")
		}
	}

	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return &apiError{http.StatusRequestEntityTooLarge, codePayloadTooLarge, "the request body is larger than 64 KiB"}
	}
	return &apiError{http.StatusBadRequest, codeInvalidRequest, "the request body is not the expected JSON: " + err.Error()}
}
