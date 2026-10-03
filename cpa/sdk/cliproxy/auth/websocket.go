package auth

import (
	"strconv"
	"strings"
)

// WebsocketsEnabled honors explicit transport settings and defaults Codex OAuth to WebSockets.
func (auth *Auth) WebsocketsEnabled() bool {
	if auth == nil {
		return false
	}
	if len(auth.Attributes) > 0 {
		if raw := strings.TrimSpace(auth.Attributes["websockets"]); raw != "" {
			parsed, errParse := strconv.ParseBool(raw)
			if errParse == nil {
				return parsed
			}
		}
	}
	raw, ok := auth.Metadata["websockets"]
	if !ok {
		raw, ok = auth.Metadata["websocket"]
	}
	if !ok || raw == nil {
		return strings.EqualFold(auth.Provider, "codex") && auth.AuthKind() == AuthKindOAuth
	}
	switch v := raw.(type) {
	case bool:
		return v
	case string:
		parsed, errParse := strconv.ParseBool(strings.TrimSpace(v))
		if errParse == nil {
			return parsed
		}
	default:
	}
	return false
}
