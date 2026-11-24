package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	indexHTML = "<!doctype html><title>index</title>"
	appJS     = "console.log('app')"
	secret    = "outside the static directory"
)

// staticHarness serves a small built frontend. Next to the directory, and
// so outside it, there is a file that must never be served.
func staticHarness(t *testing.T) *harness {
	t.Helper()
	base := t.TempDir()
	dir := filepath.Join(base, "static")
	write := func(name, content string) {
		t.Helper()
		path := filepath.Join(base, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	write("static/index.html", indexHTML)
	write("static/assets/app-3f9a1c.js", appJS)
	write("static/favicon.svg", "<svg xmlns='http://www.w3.org/2000/svg'/>")
	write("secret.txt", secret)
	// A link that points out of the directory.
	if err := os.Symlink(filepath.Join(base, "secret.txt"), filepath.Join(dir, "assets", "link.txt")); err != nil {
		t.Fatalf("symlink: %v", err)
	}
	return newHarness(t, func(o *Options) { o.StaticDir = dir })
}

func TestStaticFiles(t *testing.T) {
	h := staticHarness(t)

	t.Run("index", func(t *testing.T) {
		for _, path := range []string{"/", "/index.html"} {
			res := h.do("GET", path, nil, creds{})
			if res.status != http.StatusOK || string(res.body) != indexHTML {
				t.Fatalf("GET %s = %d %q", path, res.status, res.body)
			}
			if got := res.header.Get("Cache-Control"); got != "no-cache" {
				t.Fatalf("GET %s: Cache-Control = %q, want no-cache", path, got)
			}
			if got := res.header.Get("Content-Type"); !strings.HasPrefix(got, "text/html") {
				t.Fatalf("GET %s: Content-Type = %q", path, got)
			}
			wantSecurityHeaders(t, res)
		}
	})
	t.Run("asset", func(t *testing.T) {
		res := h.do("GET", "/assets/app-3f9a1c.js", nil, creds{})
		if res.status != http.StatusOK || string(res.body) != appJS {
			t.Fatalf("status %d, body %q", res.status, res.body)
		}
		if got := res.header.Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
			t.Fatalf("Cache-Control = %q", got)
		}
		if got := res.header.Get("Content-Type"); !strings.Contains(got, "javascript") {
			t.Fatalf("Content-Type = %q", got)
		}
		wantSecurityHeaders(t, res)
	})
	t.Run("another file", func(t *testing.T) {
		res := h.do("GET", "/favicon.svg", nil, creds{})
		if res.status != http.StatusOK || !strings.HasPrefix(res.header.Get("Content-Type"), "image/svg+xml") {
			t.Fatalf("status %d, Content-Type %q", res.status, res.header.Get("Content-Type"))
		}
		if got := res.header.Get("Cache-Control"); got != "" {
			t.Fatalf("Cache-Control = %q, want none", got)
		}
	})
	t.Run("the routes of the app fall back to the index", func(t *testing.T) {
		for _, path := range []string{
			"/e/3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10",
			"/e/3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10/",
			"/e/3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10/o/5a1f0c9e-3b7d-4e2a-9c48-6d0f1e2a3b4c", // the organiser link
			"/anything/else", "/assets", "/assets/",
		} {
			res := h.do("GET", path, nil, creds{})
			if res.status != http.StatusOK || string(res.body) != indexHTML {
				t.Fatalf("GET %s = %d %q", path, res.status, res.body)
			}
			if got := res.header.Get("Cache-Control"); got != "no-cache" {
				t.Fatalf("GET %s: Cache-Control = %q, want no-cache", path, got)
			}
			wantSecurityHeaders(t, res)
		}
	})
	t.Run("a missing asset is not the index", func(t *testing.T) {
		h.do("GET", "/assets/app-000000.js", nil, creds{}).wantError(http.StatusNotFound, "not_found")
	})
	t.Run("HEAD", func(t *testing.T) {
		res := h.do("HEAD", "/assets/app-3f9a1c.js", nil, creds{})
		if res.status != http.StatusOK || len(res.body) != 0 {
			t.Fatalf("status %d, %d bytes of body", res.status, len(res.body))
		}
	})
	t.Run("only GET and HEAD", func(t *testing.T) {
		for _, method := range []string{"POST", "PUT", "DELETE"} {
			h.do(method, "/", nil, creds{}).wantError(http.StatusNotFound, "not_found")
		}
	})
}

func TestStaticDoesNotHideTheAPI(t *testing.T) {
	h := staticHarness(t)
	id := h.create().Event.ID

	for _, path := range []string{"/api/nope", "/api", "/api/", "/api/events/9d2c7f40-5b1e-4c3a-a6f8-0e1d2c3b4a59", "/api/events/" + id + "/nope"} {
		res := h.do("GET", path, nil, creds{})
		res.wantError(http.StatusNotFound, "not_found")
		if got := res.header.Get("Cache-Control"); got != "no-store" {
			t.Fatalf("GET %s: Cache-Control = %q", path, got)
		}
	}
	h.do("GET", "/api/events/"+id, nil, creds{}).event(http.StatusOK)

	res := h.do("GET", "/healthz", nil, creds{})
	if res.status != http.StatusOK || string(res.body) != "ok" {
		t.Fatalf("GET /healthz = %d %q", res.status, res.body)
	}
}

func TestStaticNeverLeavesTheDirectory(t *testing.T) {
	h := staticHarness(t)
	for _, path := range []string{
		"/../secret.txt",
		"/assets/../../secret.txt",
		"/assets/../../../../../../etc/hostname",
		"/..%2fsecret.txt",
		"/%2e%2e/secret.txt",
		"/assets/..%2f..%2fsecret.txt",
		"//../secret.txt",
		"/assets/link.txt", // a link that points outside
	} {
		t.Run(path, func(t *testing.T) {
			res := h.do("GET", path, nil, creds{})
			if strings.Contains(string(res.body), secret) {
				t.Fatalf("GET %s served a file outside the directory", path)
			}
			// What is not a file of the directory is the index or a 404.
			switch {
			case res.status == http.StatusOK && string(res.body) == indexHTML:
			case res.status == http.StatusNotFound:
			default:
				t.Fatalf("GET %s = %d %q", path, res.status, res.body)
			}
		})
	}
}

func TestStaticDirWithoutIndex(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.StaticDir = t.TempDir() })
	h.do("GET", "/", nil, creds{}).wantError(http.StatusNotFound, "not_found")
	h.do("GET", "/e/3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10", nil, creds{}).wantError(http.StatusNotFound, "not_found")
}
