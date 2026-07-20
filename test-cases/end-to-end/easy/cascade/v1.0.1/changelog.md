## Reference views are illustrative examples, not targets to reproduce

The prompt, `specs/overview.md`, and the per-variant guidance now present the
reference screens as one way the title, gameplay, and win screens can look, and
tell the model to design its own menus and layout from the specification. The
only firm requirement is that every menu and navigation path the spec mandates
is present, in the specified palette and type. Because the screens are now the
model's design and judged by a human, the title-screen reference-similarity
`[[check]]` is removed and no reference-similarity checks are declared; the
automated load check still runs.

## Reference views are seeded as screenshots rather than rendered mockups

Every `[[reference]]` entry now points at a `media` PNG under
`reference/screenshots/`, seeded as-is, replacing the hand-authored static HTML
mockups the harness used to render at seed time (the former `*.html` files and
`theme.css` are gone). See `reference/README.md` for how the screenshots are
regenerated.

## Deal-mode seeding is flattened to a single stable path

Each variant now seeds its deal-mode spec from a flat source
(`specs/deal-mode-draw-one.md` or `specs/deal-mode-draw-three.md`) to the stable
`specs/deal-mode.md`, the only path ever seeded, so a run never sees a
`specs/modes/` folder implying deal modes other than its own. The prompt and the
common specs refer to `specs/deal-mode.md` accordingly.

## Other changes

- Pulling a card off a foundation back onto the tableau is now stated as a legal
  move in `specs/rules.md`, where it had been optional and never required.
- Cascade is mouse-only: the optional keyboard-accelerator section and its
  mentions in `specs/flow.md` are gone, and the out-of-scope list drops the
  keyboard from the supported inputs.
- The `correct-deal`, `stock-recycle`, `drag-and-drop`, and `victory-cascade`
  review items declare `sub_items` splitting each into its constituent scored
  checks.
- The prompt no longer enumerates the spec files and the order to read them; it
  points at `specs/` and asks for an implementation that matches it exactly.
- The specs say "viewer" rather than "reviewer" throughout, and the out-of-scope
  list and `specs/overview.md` pick up minor wording tweaks.
