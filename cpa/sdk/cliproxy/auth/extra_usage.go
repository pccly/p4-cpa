package auth

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	internalconfig "github.com/router-for-me/CLIProxyAPI/v8/internal/config"
)

// Only exhausted subscription windows are persisted, independently of transient
// error cooling. This prevents a restart or a partial observation from reopening
// an allowance that is known to be exhausted.
const subscriptionQuotaBlocksKey = "subscription_quota_blocks"

func extraUsageAllowed(a *Auth) bool {
	if value, ok := a.Metadata["allow_extra_usage"].(bool); ok {
		return value
	}
	return a.extraUsageDefault
}

func subscriptionWindowApplies(key, model string) bool {
	model = strings.ToLower(model)
	switch key {
	case "codex-primary", "codex-secondary", "claude-5h", "claude-7d":
		return true
	case "claude-7d-sonnet":
		return strings.Contains(model, "sonnet")
	case "claude-7d-opus":
		return strings.Contains(model, "opus") || strings.Contains(model, "fable")
	}
	return false
}

func subscriptionQuotaBlock(a *Auth, model string, now time.Time) (bool, time.Time) {
	if a == nil || extraUsageAllowed(a) || IsConfigAPIKeyAuth(a) ||
		(a.Provider != "codex" && a.Provider != "claude") {
		return false, time.Time{}
	}
	blocks, _ := a.Metadata[subscriptionQuotaBlocksKey].(map[string]any)
	var until time.Time
	for key, value := range blocks {
		if !subscriptionWindowApplies(key, model) {
			continue
		}
		seconds, err := strconv.ParseInt(toQuotaString(value), 10, 64)
		if err != nil {
			continue
		}
		if seconds == 0 { // No reset evidence: require a fresh quota observation.
			return true, time.Time{}
		}
		reset := time.Unix(seconds, 0)
		if reset.After(now) && reset.After(until) {
			until = reset
		}
	}
	return !until.IsZero(), until
}

func toQuotaString(value any) string {
	switch value := value.(type) {
	case string:
		return value
	case float64:
		return strconv.FormatFloat(value, 'f', -1, 64)
	case json.Number:
		return value.String()
	}
	return ""
}

// recordSubscriptionWindows merges only windows present in this observation.
// Maps are replaced, never mutated, because Auth.Clone shares nested metadata.
func recordSubscriptionWindows(a *Auth, windows map[string]any, now time.Time, canRecover bool) {
	if len(windows) == 0 {
		return
	}
	blocks := make(map[string]any)
	previous, _ := a.Metadata[subscriptionQuotaBlocksKey].(map[string]any)
	for key, value := range previous {
		blocks[key] = value
	}
	for key, value := range windows {
		if value == nil {
			// Concurrent generation responses can arrive out of order. Only a
			// quota probe may reopen a known exhausted window before its reset.
			if canRecover {
				delete(blocks, key)
			}
			continue
		}
		next, _ := strconv.ParseInt(toQuotaString(value), 10, 64)
		previous, _ := strconv.ParseInt(toQuotaString(blocks[key]), 10, 64)
		if next > 0 && next <= now.Unix() {
			continue
		}
		if previous > now.Unix() && (next == 0 || (!canRecover && next < previous)) {
			continue
		}
		blocks[key] = value
	}
	for key, value := range blocks {
		seconds, err := strconv.ParseInt(toQuotaString(value), 10, 64)
		if err == nil && seconds > 0 && seconds <= now.Unix() {
			delete(blocks, key)
		}
	}
	if a.Metadata == nil {
		a.Metadata = make(map[string]any)
	}
	if len(blocks) == 0 {
		delete(a.Metadata, subscriptionQuotaBlocksKey)
	} else {
		a.Metadata[subscriptionQuotaBlocksKey] = blocks
	}
}

func addSubscriptionWindow(windows map[string]any, key, used string, maximum float64, reset string, relative string, now time.Time) {
	percent, err := strconv.ParseFloat(used, 64)
	if err != nil || math.IsNaN(percent) || math.IsInf(percent, 0) || percent < 0 {
		return
	}
	if percent < maximum {
		windows[key] = nil
		return
	}
	seconds, _ := strconv.ParseInt(reset, 10, 64)
	if parsed, err := time.Parse(time.RFC3339, reset); err == nil {
		seconds = parsed.Unix()
	}
	if seconds <= 0 {
		if delta, err := strconv.ParseInt(relative, 10, 64); err == nil && delta >= 0 && delta <= 31*24*3600 {
			seconds = now.Unix() + delta
		}
	}
	windows[key] = strconv.FormatInt(max(seconds, 0), 10)
}

func subscriptionWindowsFromHeaders(provider string, headers http.Header, now time.Time) map[string]any {
	windows := make(map[string]any)
	switch provider {
	case "codex":
		for _, window := range []string{"primary", "secondary"} {
			prefix := "X-Codex-" + window + "-"
			addSubscriptionWindow(windows, "codex-"+window, headers.Get(prefix+"Used-Percent"), 100,
				headers.Get(prefix+"Reset-At"), headers.Get(prefix+"Reset-After-Seconds"), now)
		}
	case "claude":
		for _, window := range []struct{ header, key string }{
			{"5h", "5h"}, {"7d", "7d"}, {"7d-sonnet", "7d-sonnet"}, {"7d-opus", "7d-opus"}, {"7d_oi", "7d-opus"},
		} {
			prefix := "Anthropic-Ratelimit-Unified-" + window.header + "-"
			addSubscriptionWindow(windows, "claude-"+window.key, headers.Get(prefix+"Utilization"), 1,
				headers.Get(prefix+"Reset"), "", now)
		}
	}
	return windows
}

// ObserveSubscriptionUsage accepts the successful, provider-owned quota probe
// body. It does not change request counts, errors, or transient cooldowns.
func (m *Manager) ObserveSubscriptionUsage(ctx context.Context, credential *Auth, body []byte) error {
	if m == nil || credential == nil {
		return nil
	}
	var root map[string]json.RawMessage
	if err := json.Unmarshal(body, &root); err != nil {
		return err
	}
	now := time.Now()
	windows := make(map[string]any)
	if credential.Provider == "codex" {
		var limits map[string]json.RawMessage
		_ = json.Unmarshal(root["rate_limit"], &limits)
		for _, name := range []string{"primary", "secondary"} {
			var window struct {
				Used  json.Number `json:"used_percent"`
				Reset json.Number `json:"reset_at"`
				After json.Number `json:"reset_after_seconds"`
			}
			if json.Unmarshal(limits[name+"_window"], &window) == nil {
				addSubscriptionWindow(windows, "codex-"+name, window.Used.String(), 100, window.Reset.String(), window.After.String(), now)
			}
		}
	} else if credential.Provider == "claude" {
		for source, key := range map[string]string{"five_hour": "5h", "seven_day": "7d", "seven_day_sonnet": "7d-sonnet", "seven_day_opus": "7d-opus"} {
			var window struct {
				Used  json.Number `json:"utilization"`
				Reset string      `json:"resets_at"`
			}
			if json.Unmarshal(root[source], &window) == nil {
				addSubscriptionWindow(windows, "claude-"+key, window.Used.String(), 100, window.Reset, "", now)
			}
		}
	}
	if len(windows) == 0 {
		return nil
	}
	m.mu.Lock()
	current := m.auths[credential.ID]
	if current == nil || current.RegistrationEpoch != credential.RegistrationEpoch {
		m.mu.Unlock()
		return nil
	}
	// A probe started before a newer request must not reopen its exhaustion.
	recordSubscriptionWindows(current, windows, now, current.Generation == credential.Generation)
	current.Generation++
	err := m.persist(ctx, current)
	snapshot := current.Clone()
	m.mu.Unlock()
	if m.scheduler != nil {
		m.scheduler.upsertAuth(snapshot)
	}
	return err
}

func (m *Manager) refreshExtraUsageDefaults() {
	m.mu.Lock()
	cfg := m.runtimeConfig.Load().(*internalconfig.Config)
	for _, a := range m.auths {
		a.extraUsageDefault = cfg.Routing.AllowExtraUsage
		a.Generation++
	}
	m.mu.Unlock()
	m.structuralEpoch.Add(1)
	m.syncScheduler()
}
