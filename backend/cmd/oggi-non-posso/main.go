// Command oggi-non-posso serves the JSON API of Oggi non posso and, when
// ONP_STATIC_DIR is set, the built frontend next to it.
//
// Exit codes: 0 after a clean stop, 1 on a runtime failure, 2 on a
// configuration error.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/api"
	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/cleanup"
	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/config"
	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/hub"
	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/store/sqlite"
)

const (
	exitRuntime = 1
	exitConfig  = 2

	// cleanupInterval is the time between two runs of the retention job.
	cleanupInterval = time.Hour
	// shutdownTimeout is how long requests in flight get to finish.
	shutdownTimeout = 10 * time.Second
)

func main() {
	cfg, err := loadConfig()
	if err != nil {
		fmt.Fprintln(os.Stderr, "configuration:", err)
		os.Exit(exitConfig)
	}
	log := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: cfg.LogLevel}))

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if err := run(ctx, cfg, log); err != nil {
		log.Error("stopped on an error", "error", err)
		os.Exit(exitRuntime)
	}
	log.Info("stopped")
}

// loadConfig reads the environment and checks what only the machine can
// tell: that the static directory is there.
func loadConfig() (config.Config, error) {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return config.Config{}, err
	}
	if cfg.StaticDir != "" {
		info, err := os.Stat(cfg.StaticDir)
		if err != nil || !info.IsDir() {
			return config.Config{}, fmt.Errorf("ONP_STATIC_DIR: %q is not a directory", cfg.StaticDir)
		}
	}
	return cfg, nil
}

// run serves until ctx ends, then shuts down.
func run(ctx context.Context, cfg config.Config, log *slog.Logger) error {
	st, err := sqlite.Open(cfg.DBPath)
	if err != nil {
		return fmt.Errorf("database: %w", err)
	}
	defer func() {
		if err := st.Close(); err != nil {
			log.Error("closing the database failed", "error", err)
		}
	}()

	live := hub.New()
	handler := api.New(api.Options{
		Store:           st,
		Notifier:        live,
		Updates:         live,
		MaxParticipants: cfg.MaxParticipants,
		Logger:          log,
		RateLimit:       cfg.RateLimit,
		ClientIPHeader:  cfg.ClientIPHeader,
		StaticDir:       cfg.StaticDir,
	})

	// background ends with ctx: it stops the retention job and, as the
	// base of every request, ends the streams, which would otherwise keep
	// the shutdown waiting for ever.
	background, cancel := context.WithCancel(ctx)
	defer cancel()

	var jobs sync.WaitGroup
	jobs.Go(func() {
		cleanup.Run(background, st, cfg.RetentionDays, cleanupInterval, time.Now, log)
	})
	defer jobs.Wait()
	defer cancel()

	ln, err := net.Listen("tcp", cfg.Listen)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", cfg.Listen, err)
	}
	srv := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
		// No write timeout: a stream stays open for as long as its client.
		// The stream sets a deadline on each of its writes.
		BaseContext: func(net.Listener) context.Context { return background },
		ErrorLog:    slog.NewLogLogger(log.Handler(), slog.LevelWarn),
	}

	serveErr := make(chan error, 1)
	go func() { serveErr <- srv.Serve(ln) }()
	log.Info("listening",
		"address", ln.Addr().String(),
		"static_dir", cfg.StaticDir,
		"retention_days", cfg.RetentionDays,
		"max_participants", cfg.MaxParticipants,
		"rate_limit", cfg.RateLimit,
	)

	select {
	case err := <-serveErr:
		return fmt.Errorf("serve: %w", err)
	case <-ctx.Done():
	}

	log.Info("shutting down")
	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancelShutdown()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	if err := <-serveErr; err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("serve: %w", err)
	}
	return nil
}
