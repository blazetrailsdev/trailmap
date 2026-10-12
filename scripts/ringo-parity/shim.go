// The two names vendor/ringo/db/parity.go takes from the rest of ringo's
// webhook package, which is not vendored. Neither is part of what the gate
// compares: envOr is how the handler finds STATS_DB, and parityHTML is the
// page HandleParityPage prints, which the gate never calls.
package webhook

import "os"

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

const parityHTML = ""
