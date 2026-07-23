## The build must expose a `window.__valence` API and a debug overlay

A new common spec, `specs/instrumentation.md`, seeded for every variant, requires a
deterministic, seedable, render-free core behind a `window.__valence` API — core
operations, a JSON-serializable snapshot, control operations that arrange a scenario
through the game's real systems, a manual clock, and injected keyboard input — plus
a read-only overlay toggled with the backtick key. A new mandatory deliverable, hence
the major bump.

## The economy is rebuilt to pay for damage rather than kills

Energy is now earned by damage dealt: every shell stripped pays `1`, and damage past
a unit's last shell pays nothing, so a unit pays out exactly its total shells over
its lifetime regardless of who lands the final hit. The round-clear bonus
(`100 + roundNumber`) is now explicitly the bulk of the early economy.

## Difficulty comes from the round table, not from scaling

Per-round difficulty scaling is gone. Every matter type's shells, bond pool, decay
chain, speed, and leak value are fixed by the roster and never vary with the round
number, so the campaign's `40` rounds run against an explicit round table naming
exactly what each round sends.

## The matter roster gains the Lattice and makes inert a modifier

The Lattice is a new bonded cluster with a thin bond pool of `8` over sixteen full
6-electron atoms, so it opens almost at once and then floods the strippers behind it.
Inert is now a modifier any type may carry rather than three fixed types: Noble,
Chelate, and Shroud are simply the shielded Atom, Polymer, and Isotope.

## The boss is a fission chain, and the only one in the campaign

Round `40` is a single Macromass and the whole of that round. Its containment pool of
`180` sits in front of a nucleus of `132` shells, and six of its decay steps drop a
daughter Isotope on the path, so a kinetic/nuclear line must be held against a
cascade while the strippers behind it clear the loose particles.

## The reviewer checklist is reorganized into categories with automated validation

The checklist now uses the categories grammar (`[review] format = 2`), with every
graded point a one-point item and most carrying a validation script that drives the
build through `window.__valence` and decides its own verdict against a deterministic
core. Produced art, animation, particle bursts, audio, and how each screen reads
stay a human judgement.

## Other changes

- `specs/flow.md` is split into `specs/gameplay.md` and `specs/ui.md`, and the
  per-variant mode spec is folded into `specs/gameplay.md`.
- The specs are tightened throughout: history and prior-version framing removed,
  emphasis pared back, and edge-case call-outs turned into plain rules.
- The prompt's mandatory verification pass is replaced by a note that Playwright and
  Chromium are available for driving and validating the build, leaving their use to
  the model's judgment.
- `specs/proof.md` notes the debug API can set up the exact state each capture needs;
  the captures and their fixed paths are unchanged.
