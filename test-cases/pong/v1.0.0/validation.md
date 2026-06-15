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

A build that fails to build, throws on load, or renders nothing is the clearest
negative signal and is recorded as such.

## Checks

Validation comparisons are **opt-in**: the harness runs only the checks this
version declares in its `test-case.toml`. A check drives the served build into a
view, screenshots it at `1280 &times; 720`, and records a **similarity signal**
against the rendered screenshot of a reference view. These are soft signals, not
strict matches.

Carom declares a single check:

| Check view | Baseline    | How the implementation reaches it | Actions |
| ---------- | ----------- | --------------------------------- | ------- |
| `title`    | `menu.html` | The initial screen shown on load. | none    |

The **title** view is the only one viable for automated comparison: it is
deterministic, being whatever the game shows on load, so it needs no actions to
reach. The title screen should match `menu.html` in layout, palette, and type.

The `gameplay` and `game-over` views are seeded as reference images (visual
targets for the model) but are **not** validated: both depend on live state and
on reaching a screen through input, which cannot be driven reliably enough across
arbitrary implementations to produce a meaningful signal.

## Recorded signals

Validation contributes the following to the run record:

- Whether the implementation loaded (built and rendered without a fatal error).
- The `title` check's reference similarity, when it could be captured.
