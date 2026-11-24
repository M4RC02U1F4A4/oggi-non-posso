package config

import (
	"log/slog"
	"strings"
	"testing"
)

func env(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestLoadDefaults(t *testing.T) {
	got, err := Load(env(nil))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	want := Config{
		Listen:          ":8080",
		DBPath:          "oggi-non-posso.db",
		StaticDir:       "",
		RetentionDays:   30,
		MaxParticipants: 50,
		RateLimit:       true,
		ClientIPHeader:  "",
		LogLevel:        slog.LevelInfo,
	}
	if got != want {
		t.Fatalf("defaults:\n got %+v\nwant %+v", got, want)
	}
}

func TestLoadValues(t *testing.T) {
	got, err := Load(env(map[string]string{
		"ONP_LISTEN":           "127.0.0.1:9000",
		"ONP_DB_PATH":          "/data/events.db",
		"ONP_STATIC_DIR":       "/app/static",
		"ONP_RETENTION_DAYS":   "0",
		"ONP_MAX_PARTICIPANTS": "8",
		"ONP_RATE_LIMIT":       "false",
		"ONP_CLIENT_IP_HEADER": "X-Forwarded-For",
		"ONP_LOG_LEVEL":        "debug",
	}))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	want := Config{
		Listen:          "127.0.0.1:9000",
		DBPath:          "/data/events.db",
		StaticDir:       "/app/static",
		RetentionDays:   0,
		MaxParticipants: 8,
		RateLimit:       false,
		ClientIPHeader:  "X-Forwarded-For",
		LogLevel:        slog.LevelDebug,
	}
	if got != want {
		t.Fatalf("values:\n got %+v\nwant %+v", got, want)
	}
}

func TestLoadErrors(t *testing.T) {
	cases := []struct{ name, value string }{
		{"ONP_RETENTION_DAYS", "-1"},
		{"ONP_RETENTION_DAYS", "soon"},
		{"ONP_MAX_PARTICIPANTS", "0"},
		{"ONP_MAX_PARTICIPANTS", "many"},
		{"ONP_RATE_LIMIT", "maybe"},
		{"ONP_LOG_LEVEL", "loud"},
	}
	for _, c := range cases {
		t.Run(c.name+"="+c.value, func(t *testing.T) {
			_, err := Load(env(map[string]string{c.name: c.value}))
			if err == nil {
				t.Fatalf("no error for %s=%s", c.name, c.value)
			}
			if !strings.Contains(err.Error(), c.name) {
				t.Fatalf("error %q does not name %s", err, c.name)
			}
		})
	}
}
