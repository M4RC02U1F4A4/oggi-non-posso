// Package token makes the random identifiers and credentials of the
// service, and the hashes under which credentials are stored.
package token

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
)

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

// secretBytes is the amount of randomness in a credential.
const secretBytes = 32

// NewID returns n random characters of [A-Za-z0-9].
func NewID(n int) string {
	// Bytes of 248 and above are thrown away: 248 is the largest multiple
	// of 62 that fits in a byte, so the remainder below is uniform.
	const limit = 256 - 256%len(alphabet)

	out := make([]byte, 0, n)
	buf := make([]byte, n+n/4+8)
	for len(out) < n {
		// crypto/rand.Read never returns an error: it aborts the program
		// when the system has no randomness to give.
		_, _ = rand.Read(buf)
		for _, b := range buf {
			if int(b) >= limit {
				continue
			}
			out = append(out, alphabet[int(b)%len(alphabet)])
			if len(out) == n {
				break
			}
		}
	}
	return string(out)
}

// NewSecret returns prefix followed by 32 random bytes in unpadded
// base64url.
func NewSecret(prefix string) string {
	raw := make([]byte, secretBytes)
	_, _ = rand.Read(raw)
	return prefix + base64.RawURLEncoding.EncodeToString(raw)
}

// Hash returns the hex SHA-256 of secret: what the database keeps instead
// of the credential itself.
func Hash(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

// NewUUID returns a random UUID (version 4) in its canonical form: 36
// characters, lower case.
func NewUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40 // version 4
	b[8] = b[8]&0x3f | 0x80 // variant 10xx (RFC 9562)

	var out [36]byte
	hex.Encode(out[0:8], b[0:4])
	out[8] = '-'
	hex.Encode(out[9:13], b[4:6])
	out[13] = '-'
	hex.Encode(out[14:18], b[6:8])
	out[18] = '-'
	hex.Encode(out[19:23], b[8:10])
	out[23] = '-'
	hex.Encode(out[24:36], b[10:16])
	return string(out[:])
}

// IsUUID reports whether s is written as a canonical UUID: 36 characters,
// hexadecimal digits in lower case, hyphens after the 8th, 12th, 16th and
// 20th digit. Nothing else is accepted: no upper case, no braces.
func IsUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch i {
		case 8, 13, 18, 23:
			if c != '-' {
				return false
			}
		default:
			if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
				return false
			}
		}
	}
	return true
}
