# Carom — Validation Criteria

This describes what the testing harness can check automatically for a Carom
implementation. As with all test cases, validation is a cheap first pass that
produces signals, **not** a pass/fail gate or a score. The real evaluation is a
person playing the build.

## Load check

The harness builds the produced implementation, serves it as a static site, and
loads it in a headless browser at a **1280 &times; 720** viewport. It records:

- Whether the static production build **succeeds**.
- Whether the page **loads without fatal errors** (no build failure, no uncaught
  exception that prevents rendering).
- Whether the game actually **renders** — the canvas / play area is present and
  non-blank after load, rather than an empty or error page.

A build that fails to build, throws on load, or renders nothing is the clearest
negative signal and is recorded as such.

## Reference comparison

The reference visuals in [`reference/`](./reference/) define three canonical
views. The harness renders each reference mockup at a `1280 &times; 720` viewport
to produce the comparison image, captures the corresponding screenshot from the
implementation, and records a **similarity signal** per view. These are soft
signals, not strict matches.

| View slug   | Reference          | How the implementation reaches it          | Comparison strength |
| ----------- | ------------------ | ------------------------------------------ | ------------------- |
| `title`     | `menu.html`        | The initial screen shown on load.          | Strong              |
| `gameplay`  | `gameplay.html`    | A frame captured during an active match.   | Soft (layout)       |
| `game-over` | `game-over.html`   | The match-over screen.                     | Soft (layout)       |

Notes:

- The **`title`** view is deterministic: it is whatever the game shows on load,
  so it is the most meaningful comparison. The title screen should match
  `menu.html` in layout, palette, and type.
- The **`gameplay`** and **`game-over`** views depend on live state and on
  reaching a screen through input, so they are compared loosely — for field
  layout, palette, and HUD placement rather than exact ball and paddle
  positions. A harness that cannot reliably drive the implementation into these
  states may record only the `title` comparison.

## Recorded signals

Validation contributes the following to the run record:

- Build succeeded (yes/no).
- Loaded without fatal error (yes/no).
- Rendered non-blank (yes/no).
- Per-view reference similarity for the views that could be captured.
- Screenshots captured during the load check.
