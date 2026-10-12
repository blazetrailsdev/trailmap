// Asks ringo's own /spawnloop/parity handler — vendor/ringo/db/parity.go,
// verbatim — one question per argument, and prints one JSON document per line.
// Assembled into a module and run by scripts/ringo-parity-answers.sh.
//
//	STATS_DB=<file> go run . 'metrics=api&packages=arel&days=90' ...
package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"

	"github.com/deanmarano/btwhooks/webhook"
)

func main() {
	parity := &webhook.Parity{}
	for _, query := range os.Args[1:] {
		rec := httptest.NewRecorder()
		parity.HandleParityData(rec, httptest.NewRequest(http.MethodGet, "/spawnloop/parity?"+query, nil))
		os.Stdout.WriteString(strings.TrimSpace(rec.Body.String()) + "\n")
	}
}
