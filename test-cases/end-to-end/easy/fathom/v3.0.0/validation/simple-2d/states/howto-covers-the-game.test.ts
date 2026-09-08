// states/howto-covers-the-game — the how-to screen covers the game.
//
// specs/ui.md fixes what the screen has to carry: "it covers the controls, naming
// the key bound to each, the three predators and the sense each one hunts by, and
// how a dark maze is read, through the forager's own light and through the sonar
// pulse."
//
// THE SCREEN IS POSED STRAIGHT THROUGH `setScreen`, because how a player REACHES
// it is `states.howto-reachable`'s point: a build whose title menu is broken and
// whose how-to page is complete must fail the first and pass this one.
//
// WHAT THE COVERAGE READING ASSERTS, AND WHAT IT DELIBERATELY DOES NOT.
// The three predators are named in specs/predators.md as the Lanternjaw, the
// Gloamfin and the Flarefish, so those three words are copy the specification
// fixes and the screen has to carry them. `sonar` is fixed the same way, and so
// is the forager's `light`: specs/sensing.md names both, and the sentence above
// asks the screen to describe reading the dark by each of them.
//
// The KEYS are a different matter. specs/movement.md binds actions to
// `KeyboardEvent.code` values — `ArrowUp`, `KeyW`, `KeyM` — and fixes nothing
// about how a how-to screen writes one for a player: `ArrowUp` is reasonably
// written "arrows", "up", or an arrow glyph, and `KeyM` is reasonably written
// just "M", which no substring search can tell from the M in any other word. Two
// of the ten are the exception, because the `code` IS the word a player reads:
// `Space` and `Shift`. Those two are asserted; the rest are left alone rather
// than graded against a rendering this suite would have had to invent.
//
// Nothing advances on `"howto"` (specs/ui.md), so no bystander can move under the
// reading and none is posed away.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import { drewText } from "../case-harness/text";
import { createHarness, captureStill, type Harness } from "../harness";
import { frameOps } from "./screens";

/** The three hunters, named as specs/predators.md names them. */
const PREDATORS = ["LANTERNJAW", "GLOAMFIN", "FLAREFISH"] as const;

/**
 * The two senses specs/sensing.md gives for reading a dark maze, as the words
 * that file uses for them.
 */
const SENSES = ["LIGHT", "SONAR"] as const;

/**
 * The two controls whose binding a player reads as the word the binding is named
 * by: `a` is bound to `Space` and `b` to `ShiftLeft`/`ShiftRight`
 * (specs/movement.md).
 */
const NAMED_KEYS = ["SPACE", "SHIFT"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("names the controls, the three predators and both ways of reading the dark", async () => {
  h.debug.setScreen("howto");
  const ops = await frameOps(h);
  // Before the assertions, so a failing check still leaves the screen it read.
  captureStill(h, "howto");

  for (const predator of PREDATORS) {
    assertEqual(
      drewText(ops, predator),
      true,
      "a hunter the how-to screen names, of the three specs/predators.md fixes",
    );
  }
  for (const sense of SENSES) {
    assertEqual(
      drewText(ops, sense),
      true,
      "a way of reading the dark the how-to screen describes, of the forager's " +
        "own light and the sonar pulse (specs/ui.md)",
    );
  }
  for (const key of NAMED_KEYS) {
    assertEqual(
      drewText(ops, key),
      true,
      "a key the how-to screen names for the control it is bound to " +
        "(specs/movement.md)",
    );
  }
});
