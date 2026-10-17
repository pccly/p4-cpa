package antigravity

import (
	"crypto/sha256"
	"fmt"
	"strings"
)

// CredentialFileName returns the filename used to persist Antigravity credentials.
// It uses the email as a suffix to disambiguate accounts.
func CredentialFileName(email string) string {
	// Preserve existing safe filenames; hash identities containing path syntax.
	email = strings.TrimSpace(email)
	if strings.ContainsAny(email, "/\\:\x00") {
		email = fmt.Sprintf("%x", sha256.Sum256([]byte(email)))
	}
	if email == "" {
		return "antigravity.json"
	}
	return fmt.Sprintf("antigravity-%s.json", email)
}
