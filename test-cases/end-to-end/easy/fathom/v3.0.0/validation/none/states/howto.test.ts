// states/howto — how to play is reachable from the title, and covers the game.
//
// `specs/ui.md` routes `HOW TO PLAY` confirmed from the title menu to `"howto"`,
// and `confirm` or `back` from there back to `"title"`. It also fixes what the
// screen has to cover: "it covers the controls, naming the key bound to each, the
// three predators and the sense each one hunts by, and how a dark maze is read,
// through the forager's own light and through the sonar pulse."
//
// THE MENU IS WALKED, NOT POSED. `specs/instrumentation.md` gives the surface no
// menu operation, and this point is about a screen a PLAYER reaches: so the two
// keys `specs/movement.md` binds are pressed at the title menu, and where the
// game goes is read back. The selection sits on the first item on arriving
// (`specs/ui.md`), so one `down` moves it to `HOW TO PLAY` and `confirm` takes it.
//
// WHAT THE COVERAGE READING ASSERTS, AND WHAT IT DELIBERATELY DOES NOT.
// The three predators are named in `specs/predators.md` as the Lanternjaw, the
// Gloamfin and the Flarefish, so those three words are copy the specification
// fixes and the screen has to carry them. `sonar` is fixed the same way, and so
// is the forager's `light`: `specs/sensing.md` names both, and the sentence above
// asks the screen to describe reading the dark by each of them.
//
// The KEYS are a different matter. `specs/movement.md` binds actions to
// `KeyboardEvent.code` values — `ArrowUp`, `KeyW`, `KeyM` — and fixes nothing
// about how a how-to screen writes one for a player: `ArrowUp` is reasonably
// written "arrows", "up", or an arrow glyph, and `KeyM` is reasonably written
// just "M", which no substring search can tell from the M in any other word. Two
// of the ten are the exception, because the `code` IS the word a player reads:
// `Space` and `Shift`. Those two are asserted; the rest are left alone rather
// than graded against a rendering this suite would have had to invent.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  BACK_KEY,
  CONFIRM_KEY,
  MENU_DOWN_KEY,
  assertDrew,
  frameOps,
} from "./screens";

/** The three hunters, named as `specs/predators.md` names them. */
const PREDATORS = ["LANTERNJAW", "GLOAMFIN", "FLAREFISH"] as const;

/**
 * The two senses `specs/sensing.md` gives for reading a dark maze, as the words
 * that file uses for them.
 */
const SENSES = ["LIGHT", "SONAR"] as const;

/**
 * The two controls whose binding a player reads as the word the binding is named
 * by: `a` is bound to `Space` and `b` to `ShiftLeft`/`ShiftRight`
 * (`specs/movement.md`).
 */
const NAMED_KEYS = ["SPACE", "SHIFT"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reaches how-to-play from the title menu, covers the game, and goes back", async () => {
  await h.debug.reset();
  // DIVE -> HOW TO PLAY, then take it.
  await h.tap(MENU_DOWN_KEY);
  await h.tap(CONFIRM_KEY);
  const reached = await h.snapshot();

  const ops = await frameOps(h);
  // Before the assertions, so a failing check still leaves the screen it read.
  await captureStill(h, "howto");

  await h.tap(BACK_KEY);
  const returned = await h.snapshot();

  assertEqual(
    reached.screen,
    "howto",
    "the screen HOW TO PLAY confirmed from the title menu reaches (specs/ui.md)",
  );

  for (const predator of PREDATORS) {
    assertDrew(
      ops,
      predator,
      "a hunter the how-to screen names, of the three specs/predators.md fixes",
    );
  }
  for (const sense of SENSES) {
    assertDrew(
      ops,
      sense,
      "a way of reading the dark the how-to screen describes, of the forager's " +
        "own light and the sonar pulse (specs/ui.md)",
    );
  }
  for (const key of NAMED_KEYS) {
    assertDrew(
      ops,
      key,
      "a key the how-to screen names for the control it is bound to " +
        "(specs/movement.md)",
    );
  }

  assertEqual(
    returned.screen,
    "title",
    "the screen `back` from how-to-play returns to (specs/ui.md)",
  );
});
