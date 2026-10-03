package auth

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/executor"
)

// ResetFirstSelector sends new sessions to the available account whose observed
// weekly allowance resets first. SessionAffinitySelector preserves existing bindings.
// Accounts tied for the earliest reset share new sessions by round robin with
// accounts whose reset is still unknown, so unobserved accounts receive traffic
// and report their reset. Explicit priorities still win.
type ResetFirstSelector struct {
	fallback RoundRobinSelector
}

func (s *ResetFirstSelector) Pick(ctx context.Context, provider, model string, opts cliproxyexecutor.Options, auths []*Auth) (*Auth, error) {
	now := time.Now()
	available, err := getSelectorAvailableAuths(ctx, auths, provider, model, now)
	if err != nil {
		return nil, err
	}
	available = preferCodexWebsocketAuths(ctx, provider, available)
	var earliest time.Time
	var candidates, unknown []*Auth
	for _, credential := range available {
		reset := weeklyResetAt(credential, model, now)
		if reset.IsZero() {
			unknown = append(unknown, credential)
			continue
		}
		if earliest.IsZero() || reset.Before(earliest) {
			earliest = reset
			candidates = candidates[:0]
		}
		if reset.Equal(earliest) {
			candidates = append(candidates, credential)
		}
	}
	candidates = append(candidates, unknown...)
	return s.fallback.Pick(ctx, provider, model, opts, candidates)
}

func weeklyResetAt(credential *Auth, model string, now time.Time) time.Time {
	quota := credential.Quota
	if state := credential.ModelStates[canonicalModelKey(model)]; state != nil && state.Quota.ObservedAt.After(quota.ObservedAt) {
		quota = state.Quota
	}
	if quota.ObservedAt.IsZero() || quota.ObservedAt.After(now) {
		return time.Time{}
	}
	signals := quota.Signals
	// Observation snapshots use canonical HTTP header names.
	get := func(name string) string { return strings.TrimSpace(signals[http.CanonicalHeaderKey(name)]) }
	parseReset := func(prefix string) time.Time {
		if raw := get(prefix + "reset-at"); raw != "" {
			seconds, err := strconv.ParseInt(raw, 10, 64)
			if err == nil && seconds > 0 {
				reset := time.Unix(seconds, 0)
				if reset.After(now) && !reset.After(now.Add(7*24*time.Hour)) {
					return reset
				}
			}
			return time.Time{}
		}
		seconds, err := strconv.ParseInt(get(prefix+"reset-after-seconds"), 10, 64)
		if err == nil && seconds > 0 && seconds <= 7*24*3600 {
			reset := quota.ObservedAt.Add(time.Duration(seconds) * time.Second)
			if reset.After(now) {
				return reset
			}
		}
		return time.Time{}
	}
	switch strings.ToLower(strings.TrimSpace(credential.Provider)) {
	case "claude":
		prefix := "anthropic-ratelimit-unified-7d-"
		if strings.Contains(strings.ToLower(model), "fable") && get("anthropic-ratelimit-unified-7d_oi-reset") != "" {
			prefix = "anthropic-ratelimit-unified-7d_oi-"
		}
		seconds, err := strconv.ParseInt(get(prefix+"reset"), 10, 64)
		if err == nil && seconds > 0 {
			reset := time.Unix(seconds, 0)
			if reset.After(now) && !reset.After(now.Add(7*24*time.Hour)) {
				return reset
			}
		}
	case "codex":
		prefix := "x-codex-"
		if active := get("x-codex-active-limit"); active != "" {
			// Named limits appear on HTTP and websocket observations with different prefixes.
			for _, named := range []string{"x-codex-additional-" + active + "-", "x-codex-" + active + "-"} {
				if get(named+"primary-window-minutes") != "" || get(named+"secondary-window-minutes") != "" {
					prefix = named
					break
				}
			}
		}
		for _, window := range []string{"primary-", "secondary-"} {
			minutes, err := strconv.ParseInt(get(prefix+window+"window-minutes"), 10, 64)
			if err == nil && minutes == 7*24*60 {
				return parseReset(prefix + window)
			}
		}
	}
	return time.Time{}
}
