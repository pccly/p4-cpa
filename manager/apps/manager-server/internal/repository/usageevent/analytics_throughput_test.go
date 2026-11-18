package usageevent

import (
	"context"
	"fmt"
	"path/filepath"
	"sort"
	"testing"
	"time"

	sqliterepo "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/repository/sqlite"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/usage"
)

func TestModelThroughputSumsOnlySuccessfulTimedOutput(t *testing.T) {
	db, err := sqliterepo.Open(filepath.Join(t.TempDir(), "usage.sqlite"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	repo := New(db)
	base := time.Date(2026, time.January, 1, 10, 0, 0, 0, time.UTC)
	latency := func(value int64) *int64 { return &value }
	specs := []struct {
		model     string
		requested string
		output    int64
		latency   *int64
		failed    bool
		offset    time.Duration
	}{
		{model: "gpt-a", output: 100, latency: latency(1000)},
		{model: "gpt-a", output: 300, latency: latency(1000)},
		{model: "gpt-a", output: 500, latency: latency(2000), failed: true},
		{model: "gpt-a", output: 50},
		{model: "gpt-a", output: 0, latency: latency(4000)},
		{model: "gpt-a", output: 70, latency: latency(0)},
		{model: "upstream-b", requested: "gpt-b", output: 90, latency: latency(3000)},
		{model: "gpt-a", output: 1000, latency: latency(1000), offset: 3 * time.Hour},
	}
	events := make([]usage.Event, 0, len(specs))
	for index, spec := range specs {
		timestamp := base.Add(spec.offset).Add(time.Duration(index) * time.Second)
		events = append(events, usage.Event{
			EventHash:      canonicalTestHash(fmt.Sprintf("throughput-%d", index)),
			TimestampMS:    timestamp.UnixMilli(),
			Timestamp:      timestamp.Format(time.RFC3339Nano),
			Model:          spec.model,
			RequestedModel: spec.requested,
			OutputTokens:   spec.output,
			LatencyMS:      spec.latency,
			Failed:         spec.failed,
			CreatedAtMS:    timestamp.UnixMilli(),
		})
	}
	if _, err := repo.InsertBatch(context.Background(), events); err != nil {
		t.Fatalf("insert events: %v", err)
	}

	got, err := repo.ModelThroughputWithFilter(context.Background(), AnalyticsFilter{
		FromMS: base.UnixMilli(),
		ToMS:   base.Add(time.Hour).UnixMilli(),
	})
	if err != nil {
		t.Fatalf("model throughput: %v", err)
	}
	sort.Slice(got, func(i, j int) bool { return got[i].Model < got[j].Model })
	want := []ModelThroughput{
		{Model: "gpt-a", OutputTokens: 400, LatencyMS: 2000, Samples: 2},
		{Model: "gpt-b", OutputTokens: 90, LatencyMS: 3000, Samples: 1},
	}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("throughput = %+v, want %+v", got, want)
	}

	empty, err := repo.ModelThroughputWithFilter(context.Background(), AnalyticsFilter{
		FromMS: base.Add(10 * time.Hour).UnixMilli(),
		ToMS:   base.Add(11 * time.Hour).UnixMilli(),
	})
	if err != nil {
		t.Fatalf("empty model throughput: %v", err)
	}
	if len(empty) != 0 {
		t.Fatalf("empty throughput = %+v", empty)
	}
}
