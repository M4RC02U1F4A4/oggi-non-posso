package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBodyMustBeJSON(t *testing.T) {
	body := `{"title":"Cena di dicembre","organiser_name":"Giulia","days":[{"date":"2030-12-13","slots":["dinner"]}]}`
	for _, ct := range []string{"", "text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"} {
		req := httptest.NewRequest("POST", "/api/events", strings.NewReader(body))
		if ct != "" {
			req.Header.Set("Content-Type", ct)
		}
		var dst struct{ Title string }
		err := decodeJSON(httptest.NewRecorder(), req, &dst)
		ae, ok := err.(*apiError)
		if !ok || ae.status != http.StatusBadRequest || ae.code != codeInvalidRequest {
			t.Errorf("Content-Type %q: got %v, want 400 invalid_request", ct, err)
		}
	}
	req := httptest.NewRequest("POST", "/api/events", strings.NewReader(`{"title":"x"}`))
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	var dst struct{ Title string }
	if err := decodeJSON(httptest.NewRecorder(), req, &dst); err != nil || dst.Title != "x" {
		t.Errorf("application/json with a charset: %v, %q", err, dst.Title)
	}
}
