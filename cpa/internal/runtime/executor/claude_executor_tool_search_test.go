package executor

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/runtime/executor/helps"
	cliproxyauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/executor"
	sdktranslator "github.com/router-for-me/CLIProxyAPI/v8/sdk/translator"
	"github.com/tidwall/gjson"
)

// Exercise the complete native Messages path, including OAuth cloaking, beta
// assembly, caching, alias restoration, and replay of client-side ToolSearch.
func TestClaudeExecutor_DeferredToolSearchRoundTrip(t *testing.T) {
	for _, stream := range []bool{false, true} {
		t.Run(fmt.Sprintf("stream=%v", stream), func(t *testing.T) {
			calls := 0
			transport := roundTripperFunc(func(r *http.Request) (*http.Response, error) {
				body, err := io.ReadAll(r.Body)
				if err != nil {
					return nil, err
				}
				calls++
				if !strings.Contains(strings.Join(helps.HeaderValuesCaseInsensitive(r.Header, "Anthropic-Beta"), ","), claudeAdvancedToolUseBeta) {
					t.Error("missing advanced-tool-use beta")
				}
				search := gjson.GetBytes(body, "tools.0")
				deferred := gjson.GetBytes(body, "tools.1")
				if !deferred.Get("defer_loading").Bool() || deferred.Get("cache_control").Exists() {
					t.Errorf("deferred tool changed or cached: %s", deferred.Raw)
				}
				if deferred.Get("input_schema.properties.query.type").String() != "string" {
					t.Error("deferred input schema lost")
				}
				name := search.Get("name").String()
				if calls == 2 {
					name = deferred.Get("name").String()
					found := false
					for _, msg := range gjson.GetBytes(body, "messages").Array() {
						for _, block := range msg.Get("content").Array() {
							if block.Get("type").String() != "tool_result" {
								continue
							}
							found = true
							if block.Get("content.0.type").String() != "tool_reference" || block.Get("content.0.tool_name").String() != name {
								t.Errorf("nested reference does not match declaration: %s", block.Raw)
							}
						}
					}
					if !found {
						t.Error("ToolSearch result lost")
					}
				}
				content := fmt.Sprintf(`{"type":"tool_use","id":"toolu_%d","name":%q,"input":{"query":"notes"}}`, calls, name)
				response := fmt.Sprintf(`{"id":"msg_1","type":"message","role":"assistant","model":"claude-opus-5-5","content":[%s],"stop_reason":"tool_use","usage":{"input_tokens":1,"output_tokens":1}}`, content)
				contentType := "application/json"
				if stream {
					contentType = "text/event-stream"
					response = fmt.Sprintf("event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":%s}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n", content)
				}
				return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": {contentType}}, Body: io.NopCloser(strings.NewReader(response))}, nil
			})
			ctx := context.WithValue(t.Context(), "cliproxy.roundtripper", http.RoundTripper(transport))
			executor := NewClaudeExecutor(&config.Config{})
			auth := &cliproxyauth.Auth{ID: "deferred-tool-search", Attributes: map[string]string{"api_key": "sk-ant-oat-tool-search-fixture"}, Metadata: claudeOAuthTestMetadata()}
			tools := `"tools":[{"name":"ToolSearch","input_schema":{"type":"object","properties":{"query":{"type":"string"}}}},{"name":"lookup_notes","description":"Search notes","input_schema":{"type":"object","properties":{"query":{"type":"string"}}},"defer_loading":true}]`
			for turn, messages := range []string{
				`[{"role":"user","content":"Find notes"}]`,
				`[{"role":"user","content":"Find notes"},{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"ToolSearch","input":{"query":"notes"}}]},{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":[{"type":"tool_reference","tool_name":"lookup_notes"}]}]}]`,
			} {
				payload := []byte(fmt.Sprintf(`{"model":"claude-opus-5-5","max_tokens":64,%s,"messages":%s,"stream":%v}`, tools, messages, stream))
				req := cliproxyexecutor.Request{Model: "claude-opus-5-5", Payload: payload}
				opts := cliproxyexecutor.Options{SourceFormat: sdktranslator.FormatClaude, Headers: http.Header{"Anthropic-Beta": {claudeAdvancedToolUseBeta}}}
				var response []byte
				if stream {
					result, err := executor.ExecuteStream(ctx, auth, req, opts)
					if err != nil {
						t.Fatal(err)
					}
					for chunk := range result.Chunks {
						if chunk.Err != nil {
							t.Fatal(chunk.Err)
						}
						response = append(response, chunk.Payload...)
					}
				} else {
					result, err := executor.Execute(ctx, auth, req, opts)
					if err != nil {
						t.Fatal(err)
					}
					response = result.Payload
				}
				want := []string{"ToolSearch", "lookup_notes"}[turn]
				if !bytes.Contains(response, []byte(`"name":"`+want+`"`)) {
					t.Errorf("client tool name not restored to %s: %s", want, response)
				}
			}
			if calls != 2 {
				t.Errorf("upstream calls = %d, want 2", calls)
			}
		})
	}
}
