package api

import (
	"math"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/ratelimit"
)

// Rate limits, per client address.
const (
	creationsPerWindow = 10
	joinsPerWindow     = 30
	rateWindow         = time.Hour
)

// contentSecurityPolicy keeps a page to what its own origin serves and
// forbids framing. Inline styles are allowed for the style attributes the
// frontend sets.
const contentSecurityPolicy = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'"

// securityHeaders sets, on every response, the headers of the design
// document's security notes.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Content-Security-Policy", contentSecurityPolicy)
		next.ServeHTTP(w, r)
	})
}

// allow counts the request against a limit and reports whether it may go
// on. When it may not, it answers 429 itself. A nil limiter allows
// everything: that is how rate limits are switched off.
func (a *api) allow(w http.ResponseWriter, r *http.Request, l *ratelimit.Limiter) bool {
	if l == nil {
		return true
	}
	ok, retryAfter := l.Allow(a.clientAddress(r))
	if ok {
		return true
	}
	seconds := max(1, int(math.Ceil(retryAfter.Seconds())))
	w.Header().Set("Retry-After", strconv.Itoa(seconds))
	writeError(w, http.StatusTooManyRequests, codeRateLimited, "too many requests from this address, try again later")
	return false
}

// clientAddress returns the key rate limits count a request by: the
// address of the connection or, behind a trusted proxy, the last element
// of the configured header, which is the one the proxy itself wrote. The
// header is used only when that element is an IP address: missing, empty
// or anything else, the address of the connection counts instead, so the
// text of a header is never a key.
func (a *api) clientAddress(r *http.Request) string {
	if a.clientIPHeader != "" {
		if values := r.Header.Values(a.clientIPHeader); len(values) > 0 {
			elements := strings.Split(values[len(values)-1], ",")
			if key, ok := addressKey(strings.TrimSpace(elements[len(elements)-1])); ok {
				return key
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if key, ok := addressKey(host); ok {
		return key
	}
	// Not an IP connection: one key for all of them.
	return host
}

// addressKey turns an IP address into the key it is counted under, and
// reports false for anything that is not an IP address.
//
// An IPv4 address is its own key, also when it arrives written as an
// IPv4-mapped IPv6 address. An IPv6 address is counted by its /64: that is
// what one subscriber is given, so whoever holds one can change address
// inside it at will. A zone is dropped.
func addressKey(s string) (string, bool) {
	addr, err := netip.ParseAddr(s)
	if err != nil {
		return "", false
	}
	addr = addr.Unmap().WithZone("")
	if addr.Is4() {
		return addr.String(), true
	}
	network, err := addr.Prefix(64)
	if err != nil {
		return "", false
	}
	return network.String(), true
}
