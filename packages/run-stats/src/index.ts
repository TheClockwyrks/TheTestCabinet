// `@test-cabinet/run-stats` — the framework-free rules for scoring a reviewed run
// and for rolling a set of runs up into figures.
//
// Everything that has to agree on a number reads these: the consoles and the
// static gallery (through `@test-cabinet/ui`, which re-exports the scoring half
// alongside its display metadata), and any consumer outside a browser bundle that
// needs the same arithmetic. The package has no runtime dependencies and imports
// only *types* from the run-record contract, so it runs anywhere — a bundler, a
// build script, or a worker.
//
// See `scoring` for the per-run rules (each mirroring a counterpart in the Rust
// core) and `rollup` for the set-level reduction that makes a frozen figure and a
// later live one comparable.

export * from "./scoring";
export * from "./rollup";
