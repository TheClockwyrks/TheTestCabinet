Reference and seeding refinements, plus a few rules and scope clarifications to
the game the model is asked to build.

## Playable reference implementations

Both deal modes now ship an authored, *correct* playable build —
`reference-impl/draw-one` and `reference-impl/draw-three` — wired through each
variant's new `reference_implementation` key and surfaced on the case's
Reference tab. These are the case-variant analogue of a run's playable build:
buildable web projects, built with the case's own install/build commands and
deployed via `tcab publish-reference`. They are never seeded into a run.

## Reference views captured from the reference-impls

Every reference view is now a screenshot **captured from those reference-impls**
(`reference/screenshots/`), replacing the hand-authored static HTML/CSS mockups
(the former `*.html` files and `theme.css` are gone). The reference-impl builds
are the ground truth, so there is no separate mockup to keep in sync; the images
are captured straight from the real games. Accordingly the `[[reference]]`
entries now point at `media` PNGs served as-is rather than a `path` HTML the
harness rendered at seed time. See `reference/README.md` for how the screenshots
are regenerated.

## References are illustrative examples, not targets to reproduce

The reference screenshots are now presented as illustrative examples of the
title, gameplay, and win screens — one way the screens can look — rather than
layouts to match pixel-for-pixel. The prompt, `specs/overview.md`, and the
per-variant guidance now tell the model to design its own menus and layout from
the specification, with the only firm requirement being that every menu and
navigation path the spec mandates is present in the specified palette and type.
Because the screens are left to the model's design and reviewed by a human
rather than scored against a baseline, the title-screen reference-similarity
`[[check]]` ("Title Screen") is removed and no reference-similarity checks are
declared; the automated load check still runs.

## Flattened deal-mode seeding

Each variant now seeds its deal-mode spec from a flat source
(`specs/deal-mode-draw-one.md` / `specs/deal-mode-draw-three.md`) to the stable
`specs/deal-mode.md` — the only path ever seeded — so a run never sees a
`specs/modes/` folder implying deal modes other than its own. The prompt and the
common specs refer to `specs/deal-mode.md` accordingly, rather than to "the mode
spec under `specs/modes/`" generically.

## Foundation cards can return to the tableau

Pulling a card off a foundation back onto the tableau is now stated as a legal
move in `specs/rules.md`, where it had previously been described as optional and
never required. Cards are still normally left on the foundations.

## Mouse-only controls

Cascade is now mouse-only: the optional keyboard-accelerator section and its
mentions in `specs/flow.md` are removed, and the out-of-scope list drops the
keyboard from the supported inputs. This narrows the build to a single,
consistent control scheme.

## Review items broken into sub-items

Four review items — `correct-deal`, `stock-recycle`, `drag-and-drop`, and
`victory-cascade` — now declare `sub_items` that split each into its individual
scored checks (for example `correct-deal` into the tableau layout, the stock and
empty piles, and the reshuffle), so a reviewer rates the constituent
requirements rather than one combined item.

## Other changes

- Reworded the specs to refer to a "viewer" rather than a "reviewer" throughout
  (`rules.md`, `cascade.md`, `proof.md`).
- Minor wording tweaks in `specs/overview.md` ("does not satisfy this
  requirement") and the `specs/flow.md` out-of-scope list.
