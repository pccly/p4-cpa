package models

import (
	"math"
	"strconv"
	"testing"
)

func TestIntModelValueBounds(t *testing.T) {
	limit := math.Ldexp(1, strconv.IntSize-1)
	for _, test := range []struct {
		name  string
		input any
		want  int
	}{
		{"normal integer", int64(128000), 128000},
		{"maximum integer", int64(math.MaxInt), math.MaxInt},
		{"minimum integer", int64(math.MinInt), math.MinInt},
		{"normal JSON number", float64(128000), 128000},
		{"nan", math.NaN(), 0},
		{"positive infinity", math.Inf(1), 0},
		{"negative infinity", math.Inf(-1), 0},
		{"above maximum", limit, 0},
		{"below minimum", math.Nextafter(-limit, math.Inf(-1)), 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := intModelValue(map[string]any{"limit": test.input}, "limit"); got != test.want {
				t.Fatalf("got %d, want %d", got, test.want)
			}
		})
	}
}
