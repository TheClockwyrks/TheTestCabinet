## Every build must expose a `window.__fathom` debug API and overlay

A new common spec, `specs/instrumentation.md`, requires a debugging and
automation surface: core operations (`reset`, `step`, `setAutoStep`, a
JSON-serializable `snapshot`), control operations that pose a scenario through
the game's real systems, injected keyboard input, and a read-only debug overlay.
It is backed by a stricter core — render-free, seedable, and carrying an
`autoStep` flag so a driver's clock can be the sole source of time — which makes
a scripted scenario replay identically. This is a new mandatory deliverable,
hence the major version bump.

## The checklist is validated automatically

Every mechanical checklist item now carries a `validation` script that drives the
deterministic simulation through the debug handle and decides the item's verdict,
capturing side-by-side media. The reviewer still judges feel, art, audio, and
layout by hand, and can override any auto-verdict. The checklist moves to the
categories grammar (`[review] format = 2`) and expands well past the v1 list to
cover every spec-mandated observable behavior.

## Other changes

- The specs are now fully authoritative and self-contained: historical and
  "earlier build" framing is gone, opinionated "aim for" targets and rationale
  asides are removed (each rule either mandates a design or leaves it to the build),
  and no spec leans on the reference screenshots for any required detail — those are
  illustrative examples only.
- The specification is reorganized by concern. `specs/playfield.md` becomes
  `specs/maze.md` (map geometry, den, and wrap tunnel only); a new
  `specs/gameplay.md` gathers the plankton, the bonus drifters, the ink defense, and
  the signature sensing model (folding in the old `specs/sensing.md`); a new
  `specs/ui.md` gathers the menus, game states, and HUD; the predators split into a
  common `specs/predators.md` plus one file per kind under `specs/predators/`; and
  `specs/flow.md` becomes `specs/progression.md`.
- Deeper mazes now add predators instead of speeding them up. Each depth past the
  first adds one hunter, cycling Gloamfin, Lanternjaw, Flarefish, capped at two of
  each (six total) by `DEPTH 4`; predator speeds no longer scale with depth. The
  sonar range still shrinks one tile per depth.
- Terminology: the map is called the **maze** throughout (rather than "the trench"),
  and the base dive is now **Standard** — its HUD mode label reads `STANDARD` (the
  Kindle dive is unchanged).
- Edge-case call-outs are removed. Where an edge case needs particular behavior
  the rule is stated plainly; otherwise handling it is the build's job.
- The prompt no longer prescribes a verification routine — it states that
  Playwright and Chromium are installed and leaves validation to the build.
