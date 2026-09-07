// The gate's entry point into ringo's own code. Everything else in this
// directory is vendored verbatim (see scripts/vendor-ringo.sh); this file is
// trailmap's, and it exists because both of the functions the gates care about
// are unexported in another repo's package.
//
//	go run ./vendor/ringo/go markdown  < {"id": "markdown source"} > {"id": "html"}
//	go run ./vendor/ringo/go counts    < {"rfc": ["status", ...]}  > {"rfc": [total, done, open]}
//
// JSON in, JSON out, one process for the whole corpus: spawning Go per document
// would put minutes into a gate that runs on every PR.
package main

import (
	"encoding/json"
	"fmt"
	"os"
)

// story is the one field rfcStoryCounts reads, standing in for ringo's much
// larger struct. Widening it would only add fields the tally never looks at.
type story struct {
	Status string
}

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: harness markdown|counts")
		os.Exit(2)
	}
	dec := json.NewDecoder(os.Stdin)
	enc := json.NewEncoder(os.Stdout)
	switch os.Args[1] {
	case "markdown":
		var in map[string]string
		if err := dec.Decode(&in); err != nil {
			fmt.Fprintln(os.Stderr, "read corpus:", err)
			os.Exit(1)
		}
		out := make(map[string]string, len(in))
		for id, src := range in {
			out[id] = string(renderMarkdown(src))
		}
		if err := enc.Encode(out); err != nil {
			fmt.Fprintln(os.Stderr, "write html:", err)
			os.Exit(1)
		}
	case "counts":
		var in map[string][]string
		if err := dec.Decode(&in); err != nil {
			fmt.Fprintln(os.Stderr, "read statuses:", err)
			os.Exit(1)
		}
		out := make(map[string][3]int, len(in))
		for rfc, statuses := range in {
			stories := make([]story, 0, len(statuses))
			for _, st := range statuses {
				stories = append(stories, story{Status: st})
			}
			total, done, open := rfcStoryCounts(stories)
			out[rfc] = [3]int{total, done, open}
		}
		if err := enc.Encode(out); err != nil {
			fmt.Fprintln(os.Stderr, "write counts:", err)
			os.Exit(1)
		}
	default:
		fmt.Fprintln(os.Stderr, "unknown mode:", os.Args[1])
		os.Exit(2)
	}
}
