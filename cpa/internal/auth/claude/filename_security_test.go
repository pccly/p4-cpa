package claude

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
)

func TestCredentialFileNameConfinesProviderIdentity(t *testing.T) {
	const safeEmail = "user%tag+label@example.com"
	if name := CredentialFileName(safeEmail, "", ""); !strings.Contains(name, safeEmail) {
		t.Fatalf("safe legacy email filename changed: %q", name)
	}
	seen := make(map[string]bool)
	for _, email := range []string{"user@example.com", "../../outside@example.com", `..\..\outside@example.com`, "user%2Fname@example.com", "user/name@example.com", "C:alternate@example.com", "null\x00@example.com"} {
		name := CredentialFileName(email, "org", "account")
		if filepath.Base(name) != name || strings.ContainsAny(name, "/\\:\x00") {
			t.Fatalf("identity %q escaped its filename component: %q", email, name)
		}
		if seen[name] {
			t.Fatalf("distinct identities collided at %q", name)
		}
		seen[name] = true
	}
}

func TestSafeEmailFindsLegacyCredential(t *testing.T) {
	const email = "user%tag@example.com"
	for _, test := range []struct {
		name, filename, organization string
	}{
		{"email legacy", "claude-user%tag@example.com.json", "org"},
		{"account predecessor", "claude-9af21132-user%tag@example.com.json", ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			candidate := &coreauth.Auth{Provider: "claude", FileName: test.filename,
				Metadata: map[string]any{"email": email, "organization_uuid": test.organization, "account_uuid": "account"}}
			target := &coreauth.Auth{Provider: "claude", FileName: CredentialFileName(email, "org", "account"),
				Metadata: map[string]any{"email": email, "organization_uuid": "org", "account_uuid": "account"}}
			got, err := FindMatchingLegacyCredential(context.Background(), &credentialListStore{records: []*coreauth.Auth{candidate}}, target)
			if err != nil || got != candidate {
				t.Fatalf("legacy credential was not found: %v", err)
			}
		})
	}
}
