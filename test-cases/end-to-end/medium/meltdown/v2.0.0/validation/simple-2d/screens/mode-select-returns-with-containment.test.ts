// screens/mode-select-returns-with-containment — leaving the difficulty list
// puts the mode list's highlight back on CONTAINMENT.
//
// THE RULE. `specs/screens.md`, "What is highlighted on arrival": arriving at
// `modeselect` from `difficultyselect` highlights `CONTAINMENT`, row `0`. The
// table's own note says why it is that row rather than any other: "`CONTAINMENT`
// is the row that led away from `modeselect` toward `difficultyselect`", so this
// is the same "return to the row you left from" rule the how-to trip follows,
// landing on row `0` because that is where the trip started.
//
// THE ROUND TRIP IS DRIVEN, NOT POSED, because an arrival highlight is an ENTRY
// EFFECT and `setScreen` runs none (`specs/instrumentation.md`).
//
// THE DIFFICULTY LIST IS LEFT ON `HARD` BEFORE THE RETURN, and that is what makes
// the reading mean anything: a build that carried the difficulty screen's own
// highlight back to the mode list reads `2` where `0` is due, and a build that
// clamped it into range reads `2` as well. Only a build that puts the highlight
// back where the trip began reads `0`.
//
// WHY THE WAY BACK IS `back` AND NOT THE `BACK` ROW. Both leave `difficultyselect`
// for `modeselect`, and where the list's own row leads is
// `screens.difficulty-back-row`'s. This item is about the highlight the ARRIVAL
// sets.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DIFFICULTY_ITEMS, MODE_ITEMS, BINDINGS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseMenu } from "./menu";

/** The key specs/controls.md binds `confirm` to. */
const CONFIRM = BINDINGS.confirm[0];

/** The key specs/controls.md binds `back` to. */
const BACK = BINDINGS.back[0];

/** The row the trip leads away from, which the return must set again. */
const CONTAINMENT_ROW = MODE_ITEMS.indexOf("CONTAINMENT");

/** The row the difficulty list is left on: not the one the return is due to set. */
const HARD_ROW = DIFFICULTY_ITEMS.indexOf("HARD");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the mode list with CONTAINMENT highlighted", async () => {
  poseMenu(h, "modeselect", CONTAINMENT_ROW);
  await h.advance(1);

  const opened = h.snapshot();
  assertEqual(opened.screen, "modeselect", "the screen the trip starts on");
  assertEqual(
    opened.menuIndex,
    CONTAINMENT_ROW,
    "the row the trip leads away from",
  );

  await h.tap(CONFIRM);
  const inside = h.snapshot();
  assertEqual(
    inside.screen,
    "difficultyselect",
    "precondition: CONTAINMENT opens the difficulty list (specs/screens.md)",
  );

  h.debug.setMenuIndex(HARD_ROW);
  await h.advance(1);
  assertEqual(
    h.snapshot().menuIndex,
    HARD_ROW,
    "the row the difficulty list is left on before the return",
  );

  await h.tap(BACK);
  captureStill(h, "returned");

  const back = h.snapshot();
  assertEqual(
    back.screen,
    "modeselect",
    "precondition: back leaves the difficulty list for the mode list",
  );
  assertEqual(
    back.menuIndex,
    CONTAINMENT_ROW,
    "the row the mode list is highlighted on after a trip into the " +
      "difficulty list, which specs/screens.md fixes at CONTAINMENT",
  );
});
