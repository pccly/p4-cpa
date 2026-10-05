package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"testing"
	"time"

	internalconfig "github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	internallogging "github.com/router-for-me/CLIProxyAPI/v8/internal/logging"
	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/executor"
)

func TestExtraUsagePolicyAndReset(t *testing.T) {
	now := time.Unix(1800000000, 0)
	for _, tc := range []struct {
		name     string
		global   bool
		override any
		want     bool
	}{
		{"default off", false, nil, true},
		{"global on", true, nil, false},
		{"override on", false, true, false},
		{"override off", true, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a := &Auth{Provider: "codex", extraUsageDefault: tc.global, Metadata: map[string]any{"allow_extra_usage": tc.override}}
			recordSubscriptionWindows(a, subscriptionWindowsFromHeaders("codex", http.Header{
				"X-Codex-Primary-Used-Percent":        {"100"},
				"X-Codex-Primary-Reset-After-Seconds": {"60"},
			}, now), now, false)
			if blocked, _, _ := isAuthBlockedForModel(a, "gpt-5", now); blocked != tc.want {
				t.Fatalf("blocked=%t want %t", blocked, tc.want)
			}
			if blocked, _, _ := isAuthBlockedForModel(a, "gpt-5", now.Add(time.Minute)); blocked {
				t.Fatal("still blocked after reset")
			}
		})
	}
}

func TestExtraUsageObservationsPersistAndRemainScoped(t *testing.T) {
	now := time.Now()
	a := &Auth{Provider: "claude"}
	recordSubscriptionWindows(a, subscriptionWindowsFromHeaders("claude", http.Header{
		"Anthropic-Ratelimit-Unified-7d_oi-Utilization": {"1"},
		"Anthropic-Ratelimit-Unified-7d_oi-Reset":       {strconv.FormatInt(now.Add(time.Hour).Unix(), 10)},
	}, now), now, false)
	// Simulate an auth file round trip and an unrelated partial response.
	encoded, err := json.Marshal(a.Metadata)
	if err != nil {
		t.Fatal(err)
	}
	b := &Auth{Provider: "claude"}
	if err := json.Unmarshal(encoded, &b.Metadata); err != nil {
		t.Fatal(err)
	}
	recordSubscriptionWindows(b, subscriptionWindowsFromHeaders("claude", http.Header{"Anthropic-Ratelimit-Unified-5h-Utilization": {"0.2"}}, now), now, false)
	if blocked, _ := subscriptionQuotaBlock(b, "claude-opus-4-6", now); !blocked {
		t.Fatal("lost persisted opus exhaustion")
	}
	if blocked, _ := subscriptionQuotaBlock(b, "claude-sonnet-4-6", now); blocked {
		t.Fatal("opus limit blocked sonnet")
	}
	recordSubscriptionWindows(b, subscriptionWindowsFromHeaders("claude", http.Header{"Anthropic-Ratelimit-Unified-7d_oi-Utilization": {"0.2"}}, now), now, false)
	if blocked, _ := subscriptionQuotaBlock(b, "claude-opus-4-6", now); !blocked {
		t.Fatal("late response reopened exhausted allowance")
	}
	recordSubscriptionWindows(b, map[string]any{"claude-7d-opus": nil}, now, true)
	if blocked, _ := subscriptionQuotaBlock(b, "claude-opus-4-6", now); blocked {
		t.Fatal("fresh allowance did not clear block")
	}
	if blocked, _ := subscriptionQuotaBlock(a, "claude-opus-4-6", now); !blocked {
		t.Fatal("mutated original metadata")
	}
}

func TestExtraUsageMalformedAndMissingReset(t *testing.T) {
	now := time.Now()
	for _, used := range []string{"", "NaN", "+Inf", "-1", "garbage", "99.9"} {
		a := &Auth{Provider: "codex"}
		recordSubscriptionWindows(a, subscriptionWindowsFromHeaders("codex", http.Header{"X-Codex-Primary-Used-Percent": {used}}, now), now, false)
		if blocked, _ := subscriptionQuotaBlock(a, "gpt-5", now); blocked {
			t.Fatalf("blocked on %q", used)
		}
	}
	a := &Auth{Provider: "codex"}
	recordSubscriptionWindows(a, subscriptionWindowsFromHeaders("codex", http.Header{"X-Codex-Primary-Used-Percent": {"100"}}, now), now, false)
	if blocked, until := subscriptionQuotaBlock(a, "gpt-5", now); !blocked || !until.IsZero() {
		t.Fatal("exhaustion without reset must await fresh quota")
	}
}

func TestExtraUsageManagerFailoverAndHotReload(t *testing.T) {
	ctx := context.Background()
	m := NewManager(nil, nil, nil)
	a, err := m.Register(ctx, &Auth{ID: "extra-a", Provider: "codex", Metadata: map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = m.Register(ctx, &Auth{ID: "extra-b", Provider: "codex"})
	if err != nil {
		t.Fatal(err)
	}
	registerSchedulerModels(t, "codex", "gpt-extra-test", "extra-a", "extra-b")
	m.structuralEpoch.Add(1)
	m.syncScheduler()
	// Prime scheduler before recording a successful request that consumes the allowance.
	_, err = m.scheduler.pickSingle(ctx, "codex", "gpt-extra-test", cliproxyexecutor.Options{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	observed := internallogging.WithResponseHeadersHolder(ctx)
	internallogging.SetResponseHeaders(observed, http.Header{"X-Codex-Primary-Used-Percent": {"100"}, "X-Codex-Primary-Reset-After-Seconds": {"3600"}})
	m.MarkResult(observed, Result{AuthID: a.ID, Provider: "codex", Model: "gpt-extra-test", Success: true})
	for i := 0; i < 3; i++ {
		picked, err := m.scheduler.pickSingle(ctx, "codex", "gpt-extra-test", cliproxyexecutor.Options{}, nil)
		if err != nil || picked.ID != "extra-b" {
			t.Fatalf("failover picked %v: %v", picked, err)
		}
	}
	if err := m.ObserveSubscriptionUsage(ctx, a, []byte(`{"rate_limit":{"primary_window":{"used_percent":0}}}`)); err != nil {
		t.Fatal(err)
	}
	stillBlocked, _ := m.GetByID(a.ID)
	if blocked, _ := subscriptionQuotaBlock(stillBlocked, "gpt-extra-test", time.Now()); !blocked {
		t.Fatal("stale probe reopened newly exhausted allowance")
	}
	m.SetConfig(&internalconfig.Config{Routing: internalconfig.RoutingConfig{AllowExtraUsage: true}})
	updated, _ := m.GetByID(a.ID)
	if blocked, _ := subscriptionQuotaBlock(updated, "gpt-extra-test", time.Now()); blocked {
		t.Fatal("global enable did not take effect")
	}
	updated.Metadata["allow_extra_usage"] = false
	updated, err = m.Update(ctx, updated)
	if err != nil {
		t.Fatal(err)
	}
	if blocked, _ := subscriptionQuotaBlock(updated, "gpt-extra-test", time.Now()); !blocked {
		t.Fatal("credential override did not take effect")
	}
	// Refreshing quota clears the saved block without resetting unrelated cooldowns.
	if err = m.ObserveSubscriptionUsage(ctx, updated, []byte(`{"rate_limit":{"primary_window":{"used_percent":0,"reset_after_seconds":3600}}}`)); err != nil {
		t.Fatal(err)
	}
	updated, _ = m.GetByID(a.ID)
	if blocked, _ := subscriptionQuotaBlock(updated, "gpt-extra-test", time.Now()); blocked {
		t.Fatal("fresh quota failed to recover")
	}
}

func TestExtraUsageQuotaProbe(t *testing.T) {
	for _, provider := range []string{"codex", "claude"} {
		t.Run(provider, func(t *testing.T) {
			m := NewManager(nil, nil, nil)
			ctx := context.Background()
			a, err := m.Register(ctx, &Auth{ID: "probe-" + provider, Provider: provider})
			if err != nil {
				t.Fatal(err)
			}
			reset := time.Now().Add(time.Hour)
			body := fmt.Sprintf(`{"rate_limit":{"secondary_window":{"used_percent":100,"reset_at":%d}}}`, reset.Unix())
			if provider == "claude" {
				body = fmt.Sprintf(`{"seven_day":{"utilization":100,"resets_at":%q},"extra_usage":{"is_enabled":true}}`, reset.UTC().Format(time.RFC3339))
			}
			if err = m.ObserveSubscriptionUsage(ctx, a, []byte(body)); err != nil {
				t.Fatal(err)
			}
			a, _ = m.GetByID(a.ID)
			if blocked, until := subscriptionQuotaBlock(a, "test", time.Now()); !blocked || until.Unix() != reset.Unix() {
				t.Fatal("probe did not block exhausted subscription")
			}
			if a.Success != 0 || a.Failed != 0 {
				t.Fatal("probe changed request counts")
			}
		})
	}
}

func TestExtraUsageResetQuotaClearsSubscriptionBlock(t *testing.T) {
	ctx := context.Background()
	m := NewManager(nil, nil, nil)
	reset := strconv.FormatInt(time.Now().Add(time.Hour).Unix(), 10)
	a, err := m.Register(ctx, &Auth{ID: "reset-block", Provider: "codex", Metadata: map[string]any{
		subscriptionQuotaBlocksKey: map[string]any{"codex-primary": reset},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if blocked, _ := subscriptionQuotaBlock(a, "gpt-5", time.Now()); !blocked {
		t.Fatal("precondition: subscription block not applied")
	}
	if _, _, err = m.ResetQuota(ctx, a.ID); err != nil {
		t.Fatal(err)
	}
	updated, _ := m.GetByID(a.ID)
	if blocked, _ := subscriptionQuotaBlock(updated, "gpt-5", time.Now()); blocked {
		t.Fatal("reset quota kept subscription block")
	}
}
