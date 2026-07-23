## The build must expose a `window.__cascade` API and a debug overlay

A new common spec, `specs/instrumentation.md`, seeded for every variant, requires
a deterministic, seedable, render-free core behind a small API on
`window.__cascade`: `reset`, `newGame`, `step`, a JSON-serializable `snapshot` of
the board and cascade state, control operations that pose a board and drive the
real rules (`setBoard`, `turnStock`, `move`, `autoMove`), a `selectMenu` that activates a
title-menu item by index (so a menu screen is reachable independent of the build's
own menu layout), and injected pointer input that goes through the same handling a
real mouse or touchscreen feeds. The snapshot's `wasteVisibleCount` fan-count field
is a Draw Three affordance, present only in that variant. The victory cascade is
the only time-driven system, so an `autoStep` flag decides whether it advances
from the wall clock or by hand, making a scripted cascade exact. A read-only
overlay, toggled with the backtick key and off by default, shows the live
internal state. The `specs/overview.md` hard requirements, the file map,
`prompt.hbs`, and `specs/proof.md` are updated to match, and the surface is framed
throughout as an ordinary developer affordance of the game. It is a new mandatory
deliverable, hence the major version bump.

## The reviewer checklist is reorganized into categories with automated validation

The checklist now uses the categories grammar (`[review] format = 2`), with every
graded point a one-point item and most carrying a `validation` script that drives
the build through `window.__cascade` and decides its own verdict. The deal,
foundation, tableau, run, stock and waste, auto-move, win-detection, and
victory-cascade behaviors are each checked more finely than before, so a build
fails exactly the rule it breaks. Presentation points remain reviewer-judged. Each
variant contributes its turn-count point to the common stock category.

## The seeded specs are renamed and tightened

`layout.md` became `table.md`, `flow.md` became `states.md`, and `cascade.md` (the
win animation) became `victory.md`. The per-variant deal-mode spec is gone: its
turn count, waste fan, and menu label are now a variant branch inside
`specs/rules.md.hbs` (rendered for the selected deal mode before it lands), so a
variant seeds no spec of its own. Historical and edge-case call-outs were removed
and emphasis pared back, so each variant's seeded set reads as one self-contained
game.

## Other changes

- The prompt's mandatory "verify before you finish" pass is replaced by a
  "Playwright and Chromium" section that notes both are available for driving and
  validating the build but leaves their use to the model's judgment.
- `specs/proof.md` drops the validator and review-UI framing and the warning not
  to skip the clip; the captures and their fixed paths are unchanged.
- `specs/overview.md` drops the "inspired by classic patience card games"
  framing.
- Touchscreen support is now a hard requirement: the game must be fully playable
  with a mouse and on a touchscreen alike (v1 listed touch as out of scope). The
  rules of play are otherwise unchanged.
