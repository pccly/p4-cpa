package usageevent

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	sqliterepo "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/repository/sqlite"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/usage"
)

func TestAnalyticsResultLimits(t *testing.T) {
	db, err := sqliterepo.Open(filepath.Join(t.TempDir(), "usage.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	repo := New(db)
	ctx := context.Background()
	events := make([]usage.Event, maxAnalyticsResultLimit+1)
	for i := range events {
		events[i] = usage.Event{
			EventHash:   canonicalTestHash(fmt.Sprintf("limit-%d", i)),
			TimestampMS: 1000, Model: fmt.Sprintf("model-%d", i), Failed: true,
		}
	}
	if _, err := repo.InsertBatch(ctx, events); err != nil {
		t.Fatal(err)
	}
	queries := []struct {
		name         string
		query        func(int) (int, error)
		defaultCount int
	}{
		{"top models", func(limit int) (int, error) {
			rows, err := repo.TopModelsBetween(ctx, 0, 2000, limit)
			return len(rows), err
		}, 5},
		{"recent failures", func(limit int) (int, error) {
			rows, err := repo.RecentFailuresBetween(ctx, 0, 2000, limit)
			return len(rows), err
		}, 5},
		{"filtered failures", func(limit int) (int, error) {
			rows, err := repo.RecentFailuresWithFilter(ctx, AnalyticsFilter{FromMS: 0, ToMS: 2000}, limit)
			return len(rows), err
		}, 0},
	}
	for _, query := range queries {
		t.Run(query.name, func(t *testing.T) {
			for _, limit := range []int{-1, 0, 2, maxAnalyticsResultLimit, maxAnalyticsResultLimit + 1, int(^uint(0) >> 1)} {
				t.Run(fmt.Sprint(limit), func(t *testing.T) {
					want := limit
					if limit <= 0 {
						want = query.defaultCount
					} else if limit > maxAnalyticsResultLimit {
						want = maxAnalyticsResultLimit
					}
					got, err := query.query(limit)
					if err != nil || got != want {
						t.Fatalf("got %d rows, %v; want %d rows", got, err, want)
					}
				})
			}
		})
	}
}

func TestRecentFailuresHideHistoricalCodexProjectMarker(t *testing.T) {
	db, err := sqliterepo.Open(filepath.Join(t.TempDir(), "usage.sqlite"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	repo := New(db)
	ctx := context.Background()
	timestamp := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)
	if _, err := repo.InsertBatch(ctx, []usage.Event{{
		EventHash:             canonicalTestHash("recent-failure-legacy-codex-marker"),
		TimestampMS:           timestamp.UnixMilli(),
		Timestamp:             timestamp.Format(time.RFC3339Nano),
		Provider:              "codex",
		Model:                 "gpt-5",
		Failed:                true,
		AuthFileSnapshot:      "codex.json",
		AuthIndex:             "codex-auth",
		AuthProviderSnapshot:  "codex",
		AuthProjectIDSnapshot: "codex-account-id:v1:historical-account",
		CreatedAtMS:           timestamp.UnixMilli(),
	}}); err != nil {
		t.Fatalf("insert event: %v", err)
	}
	failures, err := repo.RecentFailuresBetween(ctx, timestamp.Add(-time.Hour).UnixMilli(), timestamp.Add(time.Hour).UnixMilli(), 5)
	if err != nil {
		t.Fatalf("recent failures: %v", err)
	}
	if len(failures) != 1 || failures[0].AuthProjectIDSnapshot != "" {
		t.Fatalf("recent failure project snapshot = %#v, want empty", failures)
	}
}
