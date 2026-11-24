// Package config reads the service configuration from ONP_ environment
// variables. Defaults live here and nowhere else.
package config

import (
	"fmt"
	"log/slog"
	"strconv"
)

// Config is the whole configuration of the service.
type Config struct {
	Listen          string
	DBPath          string
	StaticDir       string
	RetentionDays   int
	MaxParticipants int
	RateLimit       bool
	ClientIPHeader  string
	LogLevel        slog.Level
}

// Defaults returns the configuration used when no variable is set.
func Defaults() Config {
	return Config{
		Listen:          ":8080",
		DBPath:          "oggi-non-posso.db",
		StaticDir:       "",
		RetentionDays:   30,
		MaxParticipants: 50,
		RateLimit:       true,
		ClientIPHeader:  "",
		LogLevel:        slog.LevelInfo,
	}
}

// Load builds the configuration from the environment. An unset or empty
// variable keeps its default. A value that can not be used is an error that
// names the variable.
func Load(getenv func(string) string) (Config, error) {
	c := Defaults()

	if v := getenv("ONP_LISTEN"); v != "" {
		c.Listen = v
	}
	if v := getenv("ONP_DB_PATH"); v != "" {
		c.DBPath = v
	}
	if v := getenv("ONP_STATIC_DIR"); v != "" {
		c.StaticDir = v
	}
	if v := getenv("ONP_RETENTION_DAYS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			return Config{}, fmt.Errorf("ONP_RETENTION_DAYS: %q is not a whole number of days, 0 or more", v)
		}
		c.RetentionDays = n
	}
	if v := getenv("ONP_MAX_PARTICIPANTS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			return Config{}, fmt.Errorf("ONP_MAX_PARTICIPANTS: %q is not a whole number, 1 or more", v)
		}
		c.MaxParticipants = n
	}
	if v := getenv("ONP_RATE_LIMIT"); v != "" {
		switch v {
		case "true":
			c.RateLimit = true
		case "false":
			c.RateLimit = false
		default:
			return Config{}, fmt.Errorf("ONP_RATE_LIMIT: %q is not true or false", v)
		}
	}
	if v := getenv("ONP_CLIENT_IP_HEADER"); v != "" {
		c.ClientIPHeader = v
	}
	if v := getenv("ONP_LOG_LEVEL"); v != "" {
		switch v {
		case "debug":
			c.LogLevel = slog.LevelDebug
		case "info":
			c.LogLevel = slog.LevelInfo
		case "warn":
			c.LogLevel = slog.LevelWarn
		case "error":
			c.LogLevel = slog.LevelError
		default:
			return Config{}, fmt.Errorf("ONP_LOG_LEVEL: %q is not one of debug, info, warn, error", v)
		}
	}
	return c, nil
}
