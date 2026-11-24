// Package cleanup deletes the events that are past their retention.
package cleanup

import (
	"context"
	"log/slog"
	"time"

	"github.com/M4RC02U1F4A4/oggi-non-posso/backend/internal/store"
)

// Run deletes the events whose last candidate day is more than
// retentionDays before today (UTC): once at start, then every `every`,
// until ctx ends. With retentionDays 0 events are kept for ever and Run
// returns at once.
func Run(ctx context.Context, s store.Store, retentionDays int, every time.Duration, now func() time.Time, log *slog.Logger) {
	if retentionDays <= 0 {
		return
	}
	sweep := func() {
		before := cutoff(now(), retentionDays)
		n, err := s.DeleteExpired(ctx, before)
		switch {
		case err != nil && ctx.Err() != nil:
			// Stopping: not a failure.
		case err != nil:
			log.Error("deleting expired events failed", "error", err)
		case n > 0:
			log.Info("deleted expired events", "count", n, "last_day_before", before)
		default:
			log.Debug("no expired events", "last_day_before", before)
		}
	}

	sweep()
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			sweep()
		}
	}
}

// cutoff returns the day (YYYY-MM-DD) before which a last candidate day
// has expired: today in UTC minus the retention.
func cutoff(now time.Time, retentionDays int) string {
	return now.UTC().AddDate(0, 0, -retentionDays).Format("2006-01-02")
}
