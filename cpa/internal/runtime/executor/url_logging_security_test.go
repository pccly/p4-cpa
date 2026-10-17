package executor

import (
	"bytes"
	"context"
	"strings"
	"testing"

	log "github.com/sirupsen/logrus"
)

func TestUpstreamURLLogsOmitCredentials(t *testing.T) {
	originalOutput, originalLevel := log.StandardLogger().Out, log.GetLevel()
	var output bytes.Buffer
	log.SetOutput(&output)
	log.SetLevel(log.InfoLevel)
	t.Cleanup(func() {
		log.SetOutput(originalOutput)
		log.SetLevel(originalLevel)
	})
	const upstreamURL = "wss://private-user:private-password@example.com/private-path?key=private-query#private-fragment"
	logCodexWebsocketConnected("session", "auth", upstreamURL)
	logCodexWebsocketDisconnected("session", "auth", upstreamURL, "done", nil)
	logXAIResolvedBaseURL(context.Background(), upstreamURL)
	logXAIWebsocketRequest("session", "auth", upstreamURL, nil)
	logXAIWebsocketRequest("session", "auth", upstreamURL, []byte(`{"type":"response.create"}`))
	logXAIWebsocketWarmupCompleted("session", "auth", upstreamURL, nil)
	logXAIWebsocketTerminalResponse("session", "auth", upstreamURL, "response.completed", nil)
	logXAIWebsocketConnected("session", "auth", upstreamURL)
	logXAIWebsocketDisconnected("session", "auth", upstreamURL, "done", nil)
	if strings.Contains(output.String(), "private-") {
		t.Fatal("upstream log leaked URL credentials, path, query, or fragment")
	}
	if !strings.Contains(output.String(), "example.com") {
		t.Fatal("upstream logs lost the host needed for diagnostics")
	}
}
