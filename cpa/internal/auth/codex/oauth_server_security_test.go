package codex

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestSuccessPageEscapesPlatformURL(t *testing.T) {
	for _, test := range []struct{ name, input, want string }{
		{"attribute injection", `https://example.com/" onclick="alert(1)`, `href="https://example.com/&#34; onclick=&#34;alert(1)"`},
		{"javascript scheme", "javascript:alert(1)", `href="https://platform.openai.com"`},
		{"data scheme", "data:text/html,<script>alert(1)</script>", `href="https://platform.openai.com"`},
		{"relative URL", "//example.com", `href="https://platform.openai.com"`},
		{"query parameters", "https://example.com/setup?a=1&b=2", `href="https://example.com/setup?a=1&amp;b=2"`},
	} {
		t.Run(test.name, func(t *testing.T) {
			for _, setup := range []string{"false", "true"} {
				request := httptest.NewRequest(http.MethodGet, "/success?setup_required="+setup+"&platform_url="+url.QueryEscape(test.input), nil)
				response := httptest.NewRecorder()
				NewOAuthServer(0).handleSuccess(response, request)
				body := response.Body.String()
				if response.Code != http.StatusOK || !strings.Contains(body, test.want) {
					t.Fatalf("status=%d; missing escaped platform link %q", response.Code, test.want)
				}
				if strings.Contains(body, `" onclick="alert(1)`) || strings.Contains(body, `href="javascript:`) || strings.Contains(body, "<script>alert(1)</script>") {
					t.Fatal("success page contains executable user input")
				}
			}
		})
	}
}
