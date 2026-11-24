package api

import (
	"net/http"
	"os"
	"path"
	"strings"
)

const (
	indexFile    = "index.html"
	assetsPrefix = "assets/"
)

// serveStatic serves the built frontend from the static directory. A path
// that is not a file there is one of the app's own routes and gets the
// index, except under assets/: those names carry the hash of their content
// and a missing one is a 404, not a page.
func (a *api) serveStatic(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		notFound(w)
		return
	}
	// Cleaning against the root resolves every ".." before the file system
	// sees the name; openStatic refuses what would still leave the
	// directory.
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "" {
		name = indexFile
	}

	f, info, ok := a.openStatic(name)
	if !ok {
		if strings.HasPrefix(name, assetsPrefix) {
			notFound(w)
			return
		}
		name = indexFile
		if f, info, ok = a.openStatic(name); !ok {
			notFound(w)
			return
		}
	}
	defer f.Close()

	switch {
	case name == indexFile:
		// Always revalidated: it is what points at the current assets.
		w.Header().Set("Cache-Control", "no-cache")
	case strings.HasPrefix(name, assetsPrefix):
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	http.ServeContent(w, r, name, info.ModTime(), f)
}

// openStatic opens a regular file of the static directory. The name can
// not reach outside the directory, through ".." or through a link.
func (a *api) openStatic(name string) (*os.File, os.FileInfo, bool) {
	f, err := os.OpenInRoot(a.staticDir, name)
	if err != nil {
		return nil, nil, false
	}
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		_ = f.Close()
		return nil, nil, false
	}
	return f, info, true
}
