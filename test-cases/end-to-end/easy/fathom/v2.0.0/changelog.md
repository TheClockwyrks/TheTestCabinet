## Every build must expose a `window.__fathom` debug API and overlay

A new common spec, `specs/instrumentation.md`, requires a `window.__fathom`
debugging and automation surface — core operations, control operations that pose a
scenario through the game's real systems, injected keyboard input, and a read-only
overlay — backed by a render-free, seedable core with an `autoStep` flag so a
driver's clock can be the sole source of time. A new mandatory deliverable, hence
the major bump.

## The checklist is validated automatically

Every mechanical checklist item now carries a validation script that drives the
deterministic simulation through the debug handle and decides its verdict, capturing
side-by-side media; feel, art, audio, and layout stay human review, and any
auto-verdict is overridable. The checklist moves to the categories grammar
(`[review] format = 2`) and expands well past the v1 list.

## Specs reorganized and made self-contained

The specs are now fully authoritative: historical and "earlier build" framing is
gone, opinionated targets and rationale asides are removed, and no spec leans on the
reference screenshots for any required detail. The specification is reorganized by
concern — `specs/playfield.md` becomes `specs/maze.md`, a new `specs/gameplay.md`
gathers the plankton, drifters, ink defense, and sensing model (folding in the old
`specs/sensing.md`), a new `specs/ui.md` gathers the menus, states, and HUD, the
predators split into a common `specs/predators.md` plus one file per kind, and
`specs/flow.md` becomes `specs/progression.md`.

## Deeper mazes add predators instead of speeding them up

Each depth past the first adds one hunter, cycling Gloamfin, Lanternjaw, Flarefish,
capped at two of each (six total) by `DEPTH 4`; predator speeds no longer scale with
depth. The sonar range still shrinks one tile per depth.

## Other changes

- Terminology: the map is called the **maze** throughout (rather than "the trench"),
  and the base dive is now **Standard** (HUD label `STANDARD`).
- Edge-case call-outs are removed; where an edge case needs particular behavior the
  rule is stated plainly, otherwise handling it is the build's job.
- The prompt no longer prescribes a verification routine — it states that Playwright
  and Chromium are installed and leaves validation to the build.
- `setPredator(kind, { mode: "den" })` now **holds** the predator in the den: the
  staggered release schedule is suspended for a predator posed that way until a later
  `setPredator` poses it out. Previously the mode said only "returned to the den",
  which left a build free to release it on the very next step — so the op could not
  actually establish the precondition it exists for.
- The den release schedule is stated to be timed from **live play**: release time `0`
  is when the dive countdown ends, the countdown does not count against the schedule,
  and no predator leaves the den while it runs. Previously only the order and the `5 s`
  spacing were fixed, which left two readings of where the clock starts — one of them
  spending the reorientation moment the respawn schedule exists to give you.
- The wrap tunnel's two mouths are stated to be **adjacent tiles**, with the handover
  at the border: crossing covers one tile, position is carried across rather than
  snapped to the far mouth's center, and a character is never carried out past the
  maze frame. The neighbor rule already counted the far mouth as a neighbor; the
  movement consequence is now spelled out where the tunnel is defined.
