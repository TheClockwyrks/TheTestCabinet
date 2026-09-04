// input/back-held-rock — `back` puts a held rock away before anything else.
//
// THE REQUIREMENT. `specs/controls.md` gives `back` one ordered list to resolve
// against: "`back` resolves against the first of these that applies: a held rock
// is put away; the selection is cleared; an open overlay is closed; on `playing`
// the pause menu opens; on `paused` the pause menu closes; on any other screen the
// game returns to the previous screen." A held rock is the FIRST of the six, so
// this point is the one that decides the order at the top: with everything else
// also true, the rock is what goes. `specs/scrap-press.md` adds that putting one
// away is free, "because the roll happens only on a successful drop".
//
// HOW IT IS DECIDED. Every one of the situations below the rock is arranged at the
// same time — a structure selected, an overlay open, the run on `playing` — and
// then a rock is armed on top of them. `back` is pressed once, as a player presses
// it, a real key event dispatched at the engine's own surface. Four things are
// read: the cursor is empty, and the selection, the overlay and the screen are
// exactly where they were. A build that resolves the list in the wrong order
// changes one of the other three.

import { afterEach, beforeEach, it } from "vitest";

import { STAMPS_PER_LEVEL } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  keyFor,
  openYard,
  pressAction,
  standComponent,
  type Harness,
} from "../harness";

/** Where the selected structure stands: clear of the chain. */
const ANCHOR = { col: 10, row: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("puts the rock away and leaves the selection, the overlay and the screen", async () => {
  openYard(h);
  const id = standComponent(h, "capacitor", 2, ANCHOR.col, ANCHOR.row);
  h.debug.select(id);
  h.debug.setOverlay("combos", true);
  await pressAction(h, "stamp");

  const posed = h.snapshot();
  assertEqual(
    posed.held.active,
    true,
    "a rock held on the cursor before back is pressed (specs/scrap-press.md)",
  );
  assertEqual(
    posed.selected,
    id,
    "a structure selected as well, so the order of back's list is what is " +
      "being read (specs/controls.md)",
  );
  assertEqual(
    posed.overlays.combos,
    true,
    "an overlay open as well, so the order of back's list is what is being " +
      "read (specs/controls.md)",
  );

  await pressAction(h, "back");
  captureStill(h, "back");

  const after = h.snapshot();
  assertEqual(
    after.held.active,
    false,
    `pressing ${keyFor("back")} with a rock held to put the rock away, which ` +
      "is the first of the six situations back resolves against " +
      "(specs/controls.md)",
  );
  assertEqual(
    after.selected,
    id,
    "the selection after back put the rock away, which it leaves alone " +
      "(specs/controls.md)",
  );
  assertEqual(
    after.overlays.combos,
    true,
    "the open overlay after back put the rock away, which it leaves alone " +
      "(specs/controls.md)",
  );
  assertEqual(
    after.screen,
    "playing",
    "the screen after back put the rock away, which it leaves alone " +
      "(specs/controls.md)",
  );
  assertEqual(
    after.stampsLeft,
    STAMPS_PER_LEVEL,
    "the stamp allowance after a rock is put away, which is free " +
      "(specs/scrap-press.md)",
  );
});
