package codex

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestCredentialFileNameConfinesProviderIdentity(t *testing.T) {
	const safeEmail = "user%tag+label@example.com"
	if name := CredentialFileName(safeEmail, "pro", "account", true); !strings.Contains(name, safeEmail) {
		t.Fatalf("safe legacy email filename changed: %q", name)
	}
	seen := make(map[string]bool)
	for _, email := range []string{"user@example.com", "../../outside@example.com", `..\..\outside@example.com`, "user%2Fname@example.com", "user/name@example.com", "C:alternate@example.com", "null\x00@example.com"} {
		name := CredentialFileName(email, "pro", "account", true)
		if filepath.Base(name) != name || strings.ContainsAny(name, "/\\:\x00") {
			t.Fatalf("identity %q escaped its filename component: %q", email, name)
		}
		if seen[name] {
			t.Fatalf("distinct identities collided at %q", name)
		}
		seen[name] = true
	}
}
