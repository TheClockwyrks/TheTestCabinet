# The `lattice` CLI

The `lattice` binary is **preinstalled on your `PATH`** in the run container. It
is your iteration tool — both the **oracle** that produces expected outputs and
the **same host** the validator uses, so a local result means what
the real result means. It is a development tool, not a runtime dependency:
your final engine is pure sandboxed wasm with no host access — it cannot shell
out to `lattice`, read the reference engine, or reach any expected output. There
is no path for your engine to obtain an answer it did not compute itself.

## Subcommands

```bash
# Oracle: run the reference engine on a scenario and write the expected `state`
# (the JSON array of canonical snapshots). Omit --out to write to stdout.
lattice solve --scenario scenario.json --out expected.json

# Local check: load your engine module, run it on a scenario via the SAME host
# the validator uses, diff its per-snapshot checksums against the reference, and
# report correct/incorrect plus the fuel it consumed. Exits non-zero on incorrect.
lattice run --module target/wasm32-unknown-unknown/release/engine.wasm \
            --scenario scenario.json

# Generate a fresh, deterministic, valid scenario from a seed — expand your
# training set with bigger/denser layouts to find where your engine diverges or
# where its fuel balloons. Same seed + flags always produces the identical
# scenario.
lattice gen --seed 0xFAC7 --grid 64x64 --ticks 100000 --out scenario.json

# Dump the scenario / state JSON Schema straight from the engine's own types.
lattice schema scenario   # | state
```

`lattice run` accepts optional `--fuel-limit`, `--max-memory-bytes`, and
`--entry` (default `simulate`) flags; their defaults are the manifest's
`[sandbox]` limits (5,000,000,000 fuel, 256 MiB memory) and the contract entry
(`simulate`), so a bare `lattice run` behaves exactly as the validator will.

`lattice run` prints `correct` and the fuel on success, or
`INCORRECT at snapshot tick N (expected fnv1a64:… got fnv1a64:…)` on a mismatch
(and still reports fuel for diagnostics), so a divergence is easy to locate —
re-`solve` that scenario and diff the full `state` to find the offending item,
lane, or buffer.

## Training scenarios

A set of labelled **training scenarios** lives under `$LATTICE_HOME/training/`
(`$LATTICE_HOME` is `/opt/lattice`). Each is a directory with a `scenario.json`
and the reference oracle's `expected.json` (the full `state` with the
per-snapshot checksums). They span the entity set and the tricky behaviors on
purpose — a single side-loaded lane, a backed-up inserter holding its item, a
saturated splitter with both round-robin cursors active, an assembler starved
then flooded, the multi-input `circuit` recipe — so you can confirm your engine
is bit-exact against the exact behaviors `specs/rules.md` describes.

These are **practice, not the final set.** The scenarios the validator runs
you on are **held out** — committed with the case, never in this image,
deliberately larger and longer (big grids, long runs, dense belt networks) so
the efficiency gap between a naive and a transport-line engine dominates the
fuel total. Use the training set and your own `lattice gen` scenarios to build
and validate the engine; the validator runs on scenarios you have never seen, so
there is no shortcut around actually simulating.

## The iteration loop

1. Write your engine; build it with
   `cargo build --release --target wasm32-unknown-unknown -p engine`.
2. `lattice run` it against every training scenario until each reports
   `correct`, watching the fuel number.
3. `lattice gen` larger/denser scenarios (and `lattice solve` them) to find
   where your fuel balloons or your engine diverges.
4. Refine the representation — the transport-line approach (gaps between items,
   constant-time advance of a packed run, event-driven machines) is what turns a
   correct engine into a low-fuel one.

When your engine is correct on the training set for a low fuel number, you are
done; `engine.wasm` is the authoritative output.
