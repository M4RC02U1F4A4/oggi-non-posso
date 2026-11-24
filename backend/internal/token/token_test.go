package token

import (
	"encoding/base64"
	"regexp"
	"strings"
	"testing"
)

func TestNewID(t *testing.T) {
	re := regexp.MustCompile(`^[A-Za-z0-9]{12}$`)
	seen := make(map[string]bool, 1000)
	for range 1000 {
		id := NewID(12)
		if !re.MatchString(id) {
			t.Fatalf("id %q does not match %s", id, re)
		}
		if seen[id] {
			t.Fatalf("id %q came out twice", id)
		}
		seen[id] = true
	}
	if got := len(NewID(10)); got != 10 {
		t.Fatalf("NewID(10) has %d characters", got)
	}
}

func TestNewIDUsesTheWholeAlphabet(t *testing.T) {
	seen := make(map[rune]bool)
	for _, r := range NewID(20000) {
		seen[r] = true
	}
	if len(seen) != 62 {
		t.Fatalf("saw %d distinct characters, want 62", len(seen))
	}
}

func TestNewSecret(t *testing.T) {
	for _, prefix := range []string{"p_", "o_"} {
		s := NewSecret(prefix)
		rest, ok := strings.CutPrefix(s, prefix)
		if !ok {
			t.Fatalf("secret %q does not start with %q", s, prefix)
		}
		raw, err := base64.RawURLEncoding.DecodeString(rest)
		if err != nil {
			t.Fatalf("secret %q is not unpadded base64url: %v", s, err)
		}
		if len(raw) != 32 {
			t.Fatalf("secret decodes to %d bytes, want 32", len(raw))
		}
	}
	if NewSecret("p_") == NewSecret("p_") {
		t.Fatal("two secrets are equal")
	}
}

func TestHash(t *testing.T) {
	// SHA-256 of "abc", from FIPS 180-2.
	const want = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
	if got := Hash("abc"); got != want {
		t.Fatalf("Hash(abc) = %s, want %s", got, want)
	}
	if Hash("p_one") == Hash("p_two") {
		t.Fatal("different secrets hash the same")
	}
}
