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
