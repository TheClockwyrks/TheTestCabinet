// instrumentation/snapshot-resting-values — the snapshot document is the same
// document on every screen: a field the current screen has nothing to say about
// reports the resting value `specs/instrumentation.md` fixes for it rather than
// going missing.
//
// WHY THIS IS ITS OWN POINT. Every check in this project reads the snapshot
// without first asking which screen the game is on, and a build that omits
// `units` off the yard, or reports `held` as `null` instead of an inactive
// record, turns each of those reads into a `TypeError` in some other point's
// setup. The title screen is where every branch rests at once, so it is where the
// resting values are read.
//
// The sibling point `snapshot-shape` reads the same document off a fully posed
// yard. This one reads it where the game holds nothing at all.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertHasProperty,
  assertLength,
  assertNull,
} from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  standComponent,
  type Harness,
} from "../harness";

/** The resting record `held` reports when no rock is on the cursor. */
const HELD_AT_REST = { active: false, col: 0, row: 0, legal: false };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports every unused field at its resting value on the title screen", async () => {
  // Reached from a run that had something in each of those fields, so a build
  // that merely never filled them in is not what is being read here.
  openYard(h);
  const standing = standComponent(h, "capacitor", 1, 20, 10);
  h.debug.select(standing);
  h.debug.setNextRoll("coil", 2);
  h.debug.reset();
  await h.advance(1);
  captureStill(h, "title");

  const s = h.snapshot();
  assertEqual(s.screen, "title", "snapshot().screen after a reset");

  // Off the yard there is no phase, no wave, and no rating.
  assertNull(s.phase, "snapshot().phase off the yard");
  assertEqual(s.wave, 0, "snapshot().wave before wave 1");
  assertEqual(s.mazeRating, 0, "snapshot().mazeRating before the finale");
  assertEqual(
    s.waveHeld,
    false,
    "snapshot().waveHeld with nothing holding the wave's resolution",
  );

  // Nothing is selected and nothing is armed.
  assertNull(s.selected, "snapshot().selected with nothing selected");
  assertNull(s.nextRoll, "snapshot().nextRoll with the press unarmed");

  // The four collections are present and empty rather than absent.
  assertHasProperty(s, "combineSet", "snapshot()");
  assertHasProperty(s, "units", "snapshot()");
  assertHasProperty(s, "structures", "snapshot()");
  assertHasProperty(s, "projectiles", "snapshot()");
  assertLength(s.combineSet, 0, "snapshot().combineSet");
  assertLength(s.units, 0, "snapshot().units");
  assertLength(s.structures, 0, "snapshot().structures");
  assertLength(s.projectiles, 0, "snapshot().projectiles");

  // And the held rock is an inactive record rather than a missing one.
  assertHasProperty(s, "held", "snapshot()");
  assertDeepEqual(s.held, HELD_AT_REST, "snapshot().held with nothing held");
});
