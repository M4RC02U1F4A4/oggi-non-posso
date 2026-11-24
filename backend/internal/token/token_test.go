package token

import (
	"encoding/base64"
	"regexp"
	"strings"
	"testing"
)

func TestNewID(t *testing.T) {
	re := regexp.MustCompile(`^[A-Za-z0-9]{10}$`)
	seen := make(map[string]bool, 1000)
	for range 1000 {
		id := NewID(10)
		if !re.MatchString(id) {
			t.Fatalf("id %q does not match %s", id, re)
		}
		if seen[id] {
			t.Fatalf("id %q came out twice", id)
		}
		seen[id] = true
	}
	if got := len(NewID(12)); got != 12 {
		t.Fatalf("NewID(12) has %d characters", got)
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
	for _, prefix := range []string{"p_", ""} {
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

func TestNewUUID(t *testing.T) {
	// Version 4, variant 10xx, lower case, canonical form.
	re := regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	seen := make(map[string]bool, 1000)
	variants := make(map[byte]bool)
	for range 1000 {
		id := NewUUID()
		if !re.MatchString(id) {
			t.Fatalf("%q is not a canonical version 4 UUID", id)
		}
		if !IsUUID(id) {
			t.Fatalf("IsUUID refuses %q", id)
		}
		if seen[id] {
			t.Fatalf("%q came out twice", id)
		}
		seen[id] = true
		variants[id[19]] = true
	}
	// The two bits under the variant are random too.
	if len(variants) != 4 {
		t.Fatalf("saw %d variant digits, want 8, 9, a and b", len(variants))
	}
}

func TestIsUUID(t *testing.T) {
	const id = "3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10"
	if !IsUUID(id) {
		t.Fatalf("IsUUID refuses %q", id)
	}
	for _, s := range []string{
		"",
		"k7Qm2xVd9LpA",
		strings.ToUpper(id),
		"3F2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10",
		"{" + id + "}",
		"urn:uuid:" + id,
		strings.ReplaceAll(id, "-", ""),
		"3f2b8c1e9-a47-4d0b-8e65-1c7a2f9d4b10",
		"3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b1",
		"3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b100",
		"3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b1g",
		"3f2b8c1e_9a47_4d0b_8e65_1c7a2f9d4b10",
		" " + id,
		id + "\n",
	} {
		if IsUUID(s) {
			t.Errorf("IsUUID accepts %q", s)
		}
	}
}
