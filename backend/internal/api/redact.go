package api

import "strings"

// redactedSegment stands in a logged path for what must not be read there.
const redactedSegment = "<redacted>"

// redactPath returns a request path as it may be written to a log.
//
// The organiser link is /e/<event id>/o/<organiser key>: the key is in the
// path, so it reaches this server like any other path, and it must never
// reach a log. Everything after the first "o" segment is replaced, whatever
// it looks like and however many segments it is, so that an odd spelling of
// the link (another case, a doubled slash, something appended) does not get
// the key through.
//
// Every path that goes to a log goes through here. The query string never
// goes to a log at all.
func redactPath(p string) string {
	rest := p
	offset := 0
	for {
		i := strings.IndexByte(rest, '/')
		if i < 0 {
			return p
		}
		segment := rest[:i]
		offset += i + 1
		rest = rest[i+1:]
		if strings.EqualFold(segment, "o") && rest != "" {
			return p[:offset] + redactedSegment
		}
	}
}
