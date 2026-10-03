package auth

import "testing"

func TestWebsocketsEnabledDefaultsOffAndHonorsSettings(t *testing.T) {
	for _, tc := range []struct {
		name string
		auth *Auth
		want bool
	}{
		{"nil", nil, false},
		{"OAuth default", &Auth{Provider: "codex", Metadata: map[string]any{"access_token": "test"}}, false},
		{"OAuth opt in", &Auth{Provider: "codex", Metadata: map[string]any{"access_token": "test", "websockets": true}}, true},
		{"legacy opt in", &Auth{Provider: "codex", Metadata: map[string]any{"access_token": "test", "websocket": true}}, true},
		{"explicit false", &Auth{Provider: "codex", Metadata: map[string]any{"access_token": "test", "websockets": false}}, false},
		{"legacy opt out", &Auth{Provider: "codex", Metadata: map[string]any{"access_token": "test", "websocket": false}}, false},
		{"string false", &Auth{Provider: "codex", Metadata: map[string]any{"access_token": "test", "websockets": "false"}}, false},
		{"attribute override", &Auth{Provider: "codex", Attributes: map[string]string{"websockets": "false"}, Metadata: map[string]any{"access_token": "test", "websockets": true}}, false},
		{"API default", &Auth{Provider: "codex", Attributes: map[string]string{"api_key": "test"}}, false},
		{"API opt in", &Auth{Provider: "codex", Attributes: map[string]string{"api_key": "test", "websockets": "true"}}, true},
		{"other provider", &Auth{Provider: "xai", Metadata: map[string]any{"access_token": "test"}}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.auth.WebsocketsEnabled(); got != tc.want {
				t.Fatalf("enabled = %v, want %v", got, tc.want)
			}
		})
	}
}
