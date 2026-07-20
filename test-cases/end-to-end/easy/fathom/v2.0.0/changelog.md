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
  "earlier build" framing is gone, and emphasis and asides are pared back.
- `specs/playfield.md` is renamed to `specs/trench.md` and `specs/flow.md` to
  `specs/progression.md`.
- Edge-case call-outs are removed. Where an edge case needs particular behavior
  the rule is stated plainly; otherwise handling it is the build's job.
- The prompt no longer prescribes a verification routine — it states that
  Playwright and Chromium are installed and leaves validation to the build.
