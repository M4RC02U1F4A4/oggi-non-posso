package sqlite

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strconv"
	"strings"
)

// Migrations are numbered NNNN_name.sql files. A released file is never
// edited: a schema change is a new file.
//
//go:embed migrations/*.sql
var migrationFiles embed.FS

type migration struct {
	version int
	name    string
	sql     string
}

// migrations returns the embedded migrations in the order they apply.
func migrations() ([]migration, error) {
	names, err := fs.Glob(migrationFiles, "migrations/*.sql")
	if err != nil {
		return nil, err
	}
	out := make([]migration, 0, len(names))
	seen := make(map[int]string, len(names))
	for _, path := range names {
		name := strings.TrimPrefix(path, "migrations/")
		number, _, ok := strings.Cut(name, "_")
		version, err := strconv.Atoi(number)
		if !ok || err != nil || version < 1 {
			return nil, fmt.Errorf("migration %s: the name must be NNNN_name.sql", name)
		}
		if other, dup := seen[version]; dup {
			return nil, fmt.Errorf("migrations %s and %s have the same number", other, name)
		}
		seen[version] = name
		body, err := migrationFiles.ReadFile(path)
		if err != nil {
			return nil, err
		}
		out = append(out, migration{version: version, name: name, sql: string(body)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].version < out[j].version })
	return out, nil
}

// migrate applies the migrations the database has not seen yet, each in its
// own transaction together with its row in schema_migrations, and returns
// how many it applied.
func migrate(ctx context.Context, db *sql.DB) (int, error) {
	all, err := migrations()
	if err != nil {
		return 0, err
	}
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)`); err != nil {
		return 0, fmt.Errorf("create schema_migrations: %w", err)
	}

	applied := 0
	for _, m := range all {
		done, err := applyMigration(ctx, db, m)
		if err != nil {
			return applied, fmt.Errorf("migration %s: %w", m.name, err)
		}
		if done {
			applied++
		}
	}
	return applied, nil
}

func applyMigration(ctx context.Context, db *sql.DB, m migration) (bool, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback() }()

	var n int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM schema_migrations WHERE version = $1`, m.version).Scan(&n); err != nil {
		return false, err
	}
	if n > 0 {
		return false, nil
	}
	if _, err := tx.ExecContext(ctx, m.sql); err != nil {
		return false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, m.version); err != nil {
		return false, err
	}
	return true, tx.Commit()
}
