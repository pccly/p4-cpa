package management

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	fileauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/auth"
	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/executor"
)

func TestExtraUsagePersistsAcrossRestartAndCredentialPatch(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	store := fileauth.NewFileTokenStore()
	store.SetBaseDir(dir)
	m := coreauth.NewManager(store, nil, nil)
	a, err := m.Register(ctx, &coreauth.Auth{
		ID: "extra.json", FileName: "extra.json", Provider: "codex",
		Attributes: map[string]string{"path": filepath.Join(dir, "extra.json")},
		Metadata:   map[string]any{"type": "codex", "access_token": "test-token", "account_id": "test-account"},
	})
	if err != nil {
		t.Fatal(err)
	}
	body := fmt.Sprintf(`{"rate_limit":{"primary_window":{"used_percent":100,"reset_at":%d}}}`, time.Now().Add(time.Hour).Unix())
	if err = m.ObserveSubscriptionUsage(ctx, a, []byte(body)); err != nil {
		t.Fatal(err)
	}
	restarted := coreauth.NewManager(store, nil, nil)
	if err = restarted.Load(ctx); err != nil {
		t.Fatal(err)
	}
	selector := &coreauth.RoundRobinSelector{}
	if _, err = selector.Pick(ctx, "codex", "", cliproxyexecutor.Options{}, restarted.List()); err == nil {
		t.Fatal("restart lost exhaustion block")
	}
	h := &Handler{authManager: restarted, cfg: &config.Config{AuthDir: dir}}
	for _, tc := range []struct {
		value   string
		allowed bool
	}{{"true", true}, {"false", false}, {"null", false}} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Set(ConfigV8ContextKey, true)
		c.Request = httptest.NewRequest(http.MethodPatch, "/v8/management/credentials/fields", strings.NewReader(`{"name":"extra.json","allow_extra_usage":`+tc.value+`}`))
		c.Request.Header.Set("Content-Type", "application/json")
		h.PatchAuthFileFields(c)
		if recorder.Code != http.StatusOK {
			t.Fatalf("patch %s: %d %s", tc.value, recorder.Code, recorder.Body.String())
		}
		_, err = selector.Pick(ctx, "codex", "", cliproxyexecutor.Options{}, restarted.List())
		if (err == nil) != tc.allowed {
			t.Fatalf("patch %s: selection error %v", tc.value, err)
		}
	}
}

func TestExtraUsageQuotaProbeWorkspaceIdentity(t *testing.T) {
	a := &coreauth.Auth{Metadata: map[string]any{"account_id": "workspace-a"}}
	for _, account := range []string{"workspace-a", "workspace-b", ""} {
		req := httptest.NewRequest(http.MethodGet, "https://chatgpt.com/backend-api/wham/usage", nil)
		req.Header.Set("Chatgpt-Account-Id", account)
		if codexQuotaProbeMatchesAccount(a, req) != (account == "workspace-a") {
			t.Fatalf("incorrect workspace match for %q", account)
		}
	}
}
