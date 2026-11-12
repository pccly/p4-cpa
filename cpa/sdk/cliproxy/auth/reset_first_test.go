package auth

import (
	"context"
	"net/http"
	"strconv"
	"testing"
	"time"

	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/executor"
	sdktranslator "github.com/router-for-me/CLIProxyAPI/v8/sdk/translator"
)

func resetFirstAuth(id, provider string, observed time.Time, headers map[string]string) *Auth {
	signals := make(map[string]string, len(headers))
	for key, value := range headers {
		signals[http.CanonicalHeaderKey(key)] = value
	}
	return &Auth{ID: id, Provider: provider, Quota: QuotaState{ObservedAt: observed, Signals: signals}}
}

func TestWeeklyResetAt(t *testing.T) {
	now := time.Date(2026, 10, 3, 0, 0, 0, 0, time.UTC)
	seconds := func(offset time.Duration) string { return strconv.FormatInt(now.Add(offset).Unix(), 10) }
	for _, tc := range []struct {
		name, provider, model string
		headers               map[string]string
		want                  time.Duration
	}{
		{"claude weekly", "claude", "claude-sonnet", map[string]string{"anthropic-ratelimit-unified-7d-reset": seconds(24 * time.Hour), "anthropic-ratelimit-unified-5h-reset": seconds(time.Hour)}, 24 * time.Hour},
		{"fable weekly", "claude", "claude-fable", map[string]string{"anthropic-ratelimit-unified-7d-reset": seconds(24 * time.Hour), "anthropic-ratelimit-unified-7d_oi-reset": seconds(48 * time.Hour)}, 48 * time.Hour},
		{"expired", "claude", "claude-sonnet", map[string]string{"anthropic-ratelimit-unified-7d-reset": seconds(-time.Hour)}, 0},
		{"malformed", "claude", "claude-sonnet", map[string]string{"anthropic-ratelimit-unified-7d-reset": "tomorrow"}, 0},
		{"milliseconds", "claude", "claude-sonnet", map[string]string{"anthropic-ratelimit-unified-7d-reset": "1791072000000"}, 0},
		{"codex secondary", "codex", "gpt-test", map[string]string{"x-codex-primary-window-minutes": "300", "x-codex-primary-reset-at": seconds(time.Hour), "x-codex-secondary-window-minutes": "10080", "x-codex-secondary-reset-at": seconds(24 * time.Hour)}, 24 * time.Hour},
		{"codex primary", "codex", "gpt-test", map[string]string{"x-codex-primary-window-minutes": "10080", "x-codex-primary-reset-at": seconds(24 * time.Hour)}, 24 * time.Hour},
		{"codex relative", "codex", "gpt-test", map[string]string{"x-codex-secondary-window-minutes": "10080", "x-codex-secondary-reset-after-seconds": "86460"}, 24 * time.Hour},
		{"relative overflow", "codex", "gpt-test", map[string]string{"x-codex-secondary-window-minutes": "10080", "x-codex-secondary-reset-after-seconds": "9223372036854775807"}, 0},
		{"short window only", "codex", "gpt-test", map[string]string{"x-codex-primary-window-minutes": "300", "x-codex-primary-reset-at": seconds(time.Hour)}, 0},
		{"named HTTP", "codex", "gpt-test", map[string]string{"x-codex-active-limit": "test", "x-codex-test-secondary-window-minutes": "10080", "x-codex-test-secondary-reset-at": seconds(48 * time.Hour), "x-codex-secondary-window-minutes": "10080", "x-codex-secondary-reset-at": seconds(time.Hour)}, 48 * time.Hour},
		{"named websocket", "codex", "gpt-test", map[string]string{"x-codex-active-limit": "test", "x-codex-additional-test-secondary-window-minutes": "10080", "x-codex-additional-test-secondary-reset-at": seconds(48 * time.Hour)}, 48 * time.Hour},
	} {
		t.Run(tc.name, func(t *testing.T) {
			auth := resetFirstAuth("test", tc.provider, now.Add(-time.Minute), tc.headers)
			got := weeklyResetAt(auth, tc.model, now)
			if tc.want == 0 {
				if !got.IsZero() {
					t.Fatalf("reset = %v, want unknown", got)
				}
			} else if want := now.Add(tc.want); !got.Equal(want) {
				t.Fatalf("reset = %v, want %v", got, want)
			}
		})
	}
}

func TestResetFirstSelectorPriorityCooldownAndAffinity(t *testing.T) {
	now := time.Now().Add(-time.Second)
	makeAuth := func(id string, offset time.Duration) *Auth {
		return resetFirstAuth(id, "claude", now, map[string]string{"anthropic-ratelimit-unified-7d-reset": strconv.FormatInt(now.Add(offset).Unix(), 10)})
	}
	later, sooner := makeAuth("a-later", 72*time.Hour), makeAuth("z-sooner", 24*time.Hour)
	selector := &ResetFirstSelector{}
	auths := []*Auth{later, sooner}
	pick := func(s Selector, opts cliproxyexecutor.Options, want string) {
		t.Helper()
		got, err := s.Pick(context.Background(), "claude", "claude-test", opts, auths)
		if err != nil || got == nil || got.ID != want {
			t.Fatalf("pick = %v, %v; want %s", got, err, want)
		}
	}
	pick(selector, cliproxyexecutor.Options{}, sooner.ID)
	later.Attributes = map[string]string{"priority": "1"}
	pick(selector, cliproxyexecutor.Options{}, later.ID)
	later.Attributes = nil
	sooner.Disabled = true
	pick(selector, cliproxyexecutor.Options{}, later.ID)
	sooner.Disabled = false
	sooner.Quota.Exceeded = true
	sooner.Quota.Reason = "credential_quota"
	sooner.Quota.NextRecoverAt = now.Add(time.Hour)
	pick(selector, cliproxyexecutor.Options{}, later.ID)
	sooner.Quota.Exceeded = false
	sticky := NewSessionAffinitySelectorWithConfig(SessionAffinityConfig{Fallback: selector, TTL: time.Hour})
	defer sticky.Stop()
	opts := cliproxyexecutor.Options{Headers: http.Header{"X-Session-Id": []string{"existing"}}}
	pick(sticky, opts, sooner.ID)
	later.Quota.Signals[http.CanonicalHeaderKey("anthropic-ratelimit-unified-7d-reset")] = strconv.FormatInt(now.Add(24*time.Hour+30*time.Minute).Unix(), 10)
	pick(sticky, opts, sooner.ID)
	later.Quota.Signals[http.CanonicalHeaderKey("anthropic-ratelimit-unified-7d-reset")] = strconv.FormatInt(now.Add(12*time.Hour).Unix(), 10)
	pick(sticky, opts, later.ID)
	pick(sticky, opts, later.ID)
	pick(sticky, cliproxyexecutor.Options{Headers: http.Header{"X-Session-Id": []string{"new"}}}, later.ID)
	sooner.Disabled = true
	pick(sticky, opts, later.ID)
}

func TestResetFirstAffinityRebindsAfterBoundAccountRenews(t *testing.T) {
	now := time.Now().Add(-time.Second)
	reset := func(d time.Duration) string { return strconv.FormatInt(now.Add(d).Unix(), 10) }
	renewing := resetFirstAuth("a-renewing", "claude", now, map[string]string{"anthropic-ratelimit-unified-7d-reset": reset(time.Hour), "anthropic-ratelimit-unified-7d_oi-reset": reset(time.Hour)})
	waiting := resetFirstAuth("b-waiting", "claude", now, map[string]string{"anthropic-ratelimit-unified-7d-reset": reset(4 * 24 * time.Hour)})
	unknown := resetFirstAuth("c-unknown", "claude", now, map[string]string{})
	sticky := NewSessionAffinitySelectorWithConfig(SessionAffinityConfig{Fallback: &ResetFirstSelector{}, TTL: time.Hour})
	defer sticky.Stop()
	pick := func(auths []*Auth, session, want string) {
		t.Helper()
		opts := cliproxyexecutor.Options{Headers: http.Header{"X-Session-Id": []string{session}}}
		got, err := sticky.Pick(context.Background(), "claude", "claude-fable-test", opts, auths)
		if err != nil || got == nil || got.ID != want {
			t.Fatalf("pick = %v, %v; want %s", got, err, want)
		}
	}
	pair := []*Auth{renewing, waiting}
	pick(pair, "fable", renewing.ID)
	renewing.Quota.Signals[http.CanonicalHeaderKey("anthropic-ratelimit-unified-7d-reset")] = reset(7 * 24 * time.Hour)
	renewing.Quota.Signals[http.CanonicalHeaderKey("anthropic-ratelimit-unified-7d_oi-reset")] = reset(7 * 24 * time.Hour)
	pick(pair, "fable", waiting.ID)
	pick(pair, "fable", waiting.ID)

	pick([]*Auth{unknown}, "unknown-bound", unknown.ID)
	pick([]*Auth{unknown, waiting}, "unknown-bound", unknown.ID)

	stale := resetFirstAuth("b-stale", "claude", now, map[string]string{"anthropic-ratelimit-unified-7d-reset": reset(7 * 24 * time.Hour)})
	unknownFirst := resetFirstAuth("a-unknown", "claude", now, map[string]string{})
	pick([]*Auth{stale}, "skip-unknown", stale.ID)
	pick([]*Auth{unknownFirst, stale}, "skip-unknown", stale.ID)
	pick([]*Auth{unknownFirst, stale, waiting}, "skip-unknown", waiting.ID)

	soon := resetFirstAuth("d-soon", "claude", now, map[string]string{"anthropic-ratelimit-unified-7d-reset": reset(time.Hour)})
	pick([]*Auth{waiting}, "tiered", waiting.ID)
	soon.Attributes = map[string]string{"priority": "1"}
	pick([]*Auth{soon, waiting}, "tiered", waiting.ID)
}

func TestResetFirstSelectorUnknownAndEqualResetFallback(t *testing.T) {
	for _, known := range []bool{false, true} {
		selector := &ResetFirstSelector{}
		now := time.Now().Add(-time.Second)
		headers := map[string]string{}
		if known {
			headers["anthropic-ratelimit-unified-7d-reset"] = strconv.FormatInt(now.Add(time.Hour).Unix(), 10)
		}
		auths := []*Auth{resetFirstAuth("a", "claude", now, headers), resetFirstAuth("b", "claude", now, headers)}
		for _, want := range []string{"a", "b", "a"} {
			got, err := selector.Pick(context.Background(), "claude", "", cliproxyexecutor.Options{}, auths)
			if err != nil || got.ID != want {
				t.Fatalf("known=%v pick=%v, %v; want %s", known, got, err, want)
			}
		}
	}
}

func TestResetFirstSelectorSharesWithUnobservedAccounts(t *testing.T) {
	now := time.Now().Add(-time.Second)
	reset := func(d time.Duration) map[string]string {
		return map[string]string{"anthropic-ratelimit-unified-7d-reset": strconv.FormatInt(now.Add(d).Unix(), 10)}
	}
	auths := []*Auth{
		resetFirstAuth("b", "claude", now, reset(time.Hour)),
		resetFirstAuth("a", "claude", now, map[string]string{}),
		resetFirstAuth("d", "claude", now, reset(2*time.Hour)),
		resetFirstAuth("c", "claude", now, map[string]string{}),
	}
	contexts := map[string]context.Context{
		"plain":        context.Background(),
		"prevalidated": context.WithValue(context.Background(), prevalidatedAuthCandidatesKey{}, true),
	}
	for name, ctx := range contexts {
		selector := &ResetFirstSelector{}
		for _, want := range []string{"a", "b", "c", "a"} {
			got, err := selector.Pick(ctx, "claude", "", cliproxyexecutor.Options{}, auths)
			if err != nil || got.ID != want {
				t.Fatalf("%s pick=%v, %v; want %s", name, got, err, want)
			}
		}
	}
}

func TestResetFirstRebindTargetRules(t *testing.T) {
	now := time.Now().Add(-time.Second)
	claude := func(id string, d time.Duration) *Auth {
		return resetFirstAuth(id, "claude", now, map[string]string{"anthropic-ratelimit-unified-7d-reset": strconv.FormatInt(now.Add(d).Unix(), 10)})
	}
	codex := func(id string, d time.Duration) *Auth {
		return resetFirstAuth(id, "codex", now, map[string]string{"x-codex-primary-window-minutes": "10080", "x-codex-primary-reset-at": strconv.FormatInt(now.Add(d).Unix(), 10)})
	}
	newSelector := func(rebindOn string) *SessionAffinitySelector {
		s := NewSessionAffinitySelectorWithConfig(SessionAffinityConfig{Fallback: &ResetFirstSelector{}, TTL: time.Hour, RebindOn: rebindOn})
		t.Cleanup(s.Stop)
		return s
	}
	bound := claude("bound", 24*time.Hour)
	codexBound := codex("codex-bound", 5*24*time.Hour)
	for _, tc := range []struct {
		name, rebindOn string
		bound          *Auth
		candidates     []*Auth
		want           string
	}{
		{"exactly one hour sooner stays", "", bound, []*Auth{bound, claude("x", 23*time.Hour)}, ""},
		{"just over one hour sooner moves", "", bound, []*Auth{bound, claude("x", 23*time.Hour-time.Second)}, "x"},
		{"soonest known target wins", "", bound, []*Auth{bound, claude("y", 10*time.Hour), claude("x", 2*time.Hour)}, "x"},
		{"equal targets break ties by id", "", bound, []*Auth{bound, claude("y", 2*time.Hour), claude("x", 2*time.Hour)}, "x"},
		{"rebind-on never keeps binding", "never", bound, []*Auth{bound, claude("x", time.Hour)}, ""},
		{"rebind-on quota still moves", "quota", bound, []*Auth{bound, claude("x", time.Hour)}, "x"},
		{"bound outside tier stays", "", bound, []*Auth{claude("x", time.Hour)}, ""},
		{"codex binding never moves", "", codexBound, []*Auth{codexBound, codex("x", time.Hour)}, ""},
		{"non-claude target ignored", "", bound, []*Auth{bound, codex("x", time.Hour)}, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := newSelector(tc.rebindOn).resetFirstRebindTarget("model", tc.bound, tc.candidates, time.Now())
			gotID := ""
			if got != nil {
				gotID = got.ID
			}
			if gotID != tc.want {
				t.Fatalf("target = %q, want %q", gotID, tc.want)
			}
		})
	}
}

func TestResetFirstAffinityRebindsLCPSessions(t *testing.T) {
	now := time.Now().Add(-time.Second)
	reset := func(d time.Duration) string { return strconv.FormatInt(now.Add(d).Unix(), 10) }
	renewing := resetFirstAuth("a-renewing", "claude", now, map[string]string{"anthropic-ratelimit-unified-7d-reset": reset(time.Hour)})
	waiting := resetFirstAuth("b-waiting", "claude", now, map[string]string{"anthropic-ratelimit-unified-7d-reset": reset(4 * 24 * time.Hour)})
	auths := []*Auth{renewing, waiting}
	sticky := NewSessionAffinitySelectorWithConfig(SessionAffinityConfig{Fallback: &ResetFirstSelector{}, TTL: time.Hour})
	defer sticky.Stop()
	conversation := `{"role":"system","content":"stable"},{"role":"user","content":"first"}`
	pick := func(want string) {
		t.Helper()
		opts := cliproxyexecutor.Options{
			SourceFormat:    sdktranslator.FormatOpenAI,
			OriginalRequest: []byte(`{"messages":[` + conversation + `]}`),
			Metadata:        map[string]any{cliproxyexecutor.CallerScopeMetadataKey: "caller"},
		}
		got, err := sticky.Pick(context.Background(), "claude", "claude-test", opts, auths)
		if err != nil || got == nil || got.ID != want {
			t.Fatalf("pick = %v, %v; want %s", got, err, want)
		}
	}
	pick(renewing.ID)
	conversation += `,{"role":"assistant","content":"answer"},{"role":"user","content":"second"}`
	pick(renewing.ID)
	renewing.Quota.Signals[http.CanonicalHeaderKey("anthropic-ratelimit-unified-7d-reset")] = reset(7 * 24 * time.Hour)
	conversation += `,{"role":"assistant","content":"answer"},{"role":"user","content":"third"}`
	pick(waiting.ID)
	conversation += `,{"role":"assistant","content":"answer"},{"role":"user","content":"fourth"}`
	pick(waiting.ID)
}
