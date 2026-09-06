// instrumentation/reset-title-state — `reset` puts the whole game back to its
// title state, field by field.
//
// EVERY OTHER CHECK IN THIS PROJECT OPENS WITH IT. `openYard` resets before it
// opens a run, so a reset that leaves one field behind does not fail here alone:
// it leaks a wave counter, a refinement level or a standing structure into
// whatever check runs next, and that check fails for a reason that has nothing to
// do with the point it decides. So this one dirties every field
// `specs/instrumentation.md` names, resets, and reads the whole list back.
//
// THE TWO FIELDS RESET LEAVES ALONE — the mute bit and the pointer — are the
// sibling point `reset-leaves-mute-and-pointer`, in the other direction.

import { afterEach, beforeEach, it } from "vitest";
import {
  STAMPS_PER_LEVEL,
  START_CHARGE,
  START_INTEGRITY,
  tileCenter,
} from "../constants";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNull,
} from "../assert";
import {
  captureStill,
  createHarness,
  type Harness,
  parkUnit,
  pressAction,
  standComponent,
} from "../harness";

/** Two clear anchors on the map the dirtied run opens on. */
const FIRST_AT = { col: 20, row: 10 };
const SECOND_AT = { col: 24, row: 10 };

/** Where the posed unit stands: inside the first structure's range. */
const UNIT_AT = tileCenter(23, 10);

/** The resting record `held` reports when no rock is on the cursor. */
const HELD_AT_REST = { active: false, col: 0, row: 0, legal: false };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("restores every title-screen value after a run has been driven", async () => {
  /* ---- Dirty everything reset is asked to restore ----------------------- */

  h.debug.setScreen("title");
  h.debug.setMenuIndex(1);
  h.debug.setMap("switchyard");
  h.debug.setDifficulty("hard");
  h.debug.startRun();

  const first = standComponent(h, "discharge", 5, FIRST_AT.col, FIRST_AT.row);
  const second = standComponent(
    h,
    "capacitor",
    1,
    SECOND_AT.col,
    SECOND_AT.row,
  );
  h.debug.select(first);
  h.debug.addToCombineSet(second);
  h.debug.setNextRoll("coil", 2);
  await pressAction(h, "stamp");
  h.debug.setOverlay("combos", true);
  h.debug.setOverlay("damage", true);
  h.debug.setWave(7);
  h.debug.setCharge(500);
  h.debug.setIntegrity(12);
  h.debug.setRefinement(4);
  h.debug.setStamps(2);
  h.debug.setSpeed(2);
  // A live wave, a walked clock, and a firing structure, so the fields a run
  // fills in on its own are filled in too.
  parkUnit(h, "overload", UNIT_AT);
  await h.advanceSeconds(2);
  h.debug.setPaused(true);

  // The precondition, read back: reset can only be shown to have restored a
  // field that was carrying something else.
  const dirty = h.snapshot();
  assertEqual(dirty.map, "switchyard", "the map the dirtied run opened on");
  assertEqual(dirty.difficulty, "hard", "the difficulty it opened at");
  assertEqual(dirty.wave, 7, "the dirtied wave counter");
  assertEqual(dirty.charge, 500, "the dirtied Charge");
  assertEqual(dirty.integrity, 12, "the dirtied Grid Integrity");
  assertEqual(dirty.refinement, 4, "the dirtied refinement level");
  assertEqual(dirty.stampsLeft, 2, "the dirtied stamp allowance");
  assertEqual(dirty.speed, 2, "the dirtied speed multiplier");
  assertEqual(dirty.paused, true, "the engaged pause");
  assertDeepEqual(
    dirty.overlays,
    { combos: true, damage: true },
    "the opened overlays",
  );
  assertEqual(dirty.selected, first, "the selected structure");
  assertGreaterThan(dirty.structures.length, 0, "the structures standing");
  assertGreaterThan(dirty.units.length, 0, "the units on the yard");

  /* ---- Then reset, and read the title state back ------------------------ */

  h.debug.reset();
  await h.advance(1);
  captureStill(h, "title");

  const s = h.snapshot();
  assertEqual(s.screen, "title", "snapshot().screen after reset");
  assertEqual(s.menuIndex, 0, "snapshot().menuIndex after reset");
  assertNull(s.phase, "snapshot().phase after reset");
  assertEqual(s.map, "substation", "snapshot().map after reset");
  assertEqual(s.difficulty, "medium", "snapshot().difficulty after reset");
  assertLength(s.structures, 0, "snapshot().structures after reset");
  assertLength(s.units, 0, "snapshot().units after reset");
  assertLength(s.projectiles, 0, "snapshot().projectiles after reset");
  assertNull(s.selected, "snapshot().selected after reset");
  assertLength(s.combineSet, 0, "snapshot().combineSet after reset");
  assertDeepEqual(s.held, HELD_AT_REST, "snapshot().held after reset");
  assertNull(s.nextRoll, "snapshot().nextRoll after reset");
  assertEqual(s.charge, START_CHARGE, "snapshot().charge after reset");
  assertEqual(s.integrity, START_INTEGRITY, "snapshot().integrity after reset");
  assertEqual(s.refinement, 0, "snapshot().refinement after reset");
  assertEqual(s.wave, 0, "snapshot().wave after reset");
  assertEqual(
    s.stampsLeft,
    STAMPS_PER_LEVEL,
    "snapshot().stampsLeft after reset",
  );
  assertEqual(s.mazeRating, 0, "snapshot().mazeRating after reset");
  assertEqual(s.speed, 1, "snapshot().speed after reset");
  assertDeepEqual(
    s.overlays,
    { combos: false, damage: false },
    "snapshot().overlays after reset",
  );
  assertEqual(s.paused, false, "snapshot().paused after reset");
  assertEqual(s.simTime, 0, "snapshot().simTime after reset");
});
