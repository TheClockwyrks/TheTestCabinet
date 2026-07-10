Reference and seeding refinements; no change to the game the model is asked to build.

- Added authored, playable **reference implementations** for both deal modes
  (`reference-impl/draw-one`, `reference-impl/draw-three`), wired through each
  variant's new `reference_implementation` key and surfaced on the case's
  Reference tab.
- Regenerated every reference view as a screenshot **captured from those
  reference-impls** (`reference/screenshots/`), replacing the hand-authored
  static HTML/CSS mockups; `[[reference]]` entries now point at `media` PNGs
  rather than rendered `path` HTML.
- Flattened deal-mode seeding: each variant now seeds its mode spec to a flat
  `specs/deal-mode.md`, so a run never sees a `specs/modes/` folder implying deal
  modes other than its own. The prompt and common specs refer to
  `specs/deal-mode.md` accordingly.
