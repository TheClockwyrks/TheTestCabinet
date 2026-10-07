// Wick — progression/pool-held-weapons-below-max: a held base weapon below
// `MAX_WEAPON_LEVEL` is a candidate.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`, "The
// candidate pool": the pool "holds every held base weapon below
// `MAX_WEAPON_LEVEL`, and every held passive below its max level, each as a
// `+1 level` offer", with `MAX_WEAPON_LEVEL` (`8`).
// `specs/instrumentation.md` reports the pool as the run's `pool` on `levelup`.
//
// THE POSE. An isolated `playing` run holding two base weapons and nothing
// else: Taper at level `3`, far below the maximum, and Ember at level `7`, one
// level below it, so the rule is read at both a middle level and its last
// eligible one. Every driver switch is off and the world is empty, so nothing
// alters the slots between the pose and the overlay. The overlay is opened by
// the real path, one queued level-up and one `playing` tick.
//
// THE TOLERANCE. Exact: membership of two ids in a list of ids.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import { MAX_WEAPON_LEVEL } from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** A middle level, and the last level below `MAX_WEAPON_LEVEL`. */
const TAPER_LEVEL = 3;
const EMBER_LEVEL = MAX_WEAPON_LEVEL - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds taper and ember in the pool while both are below the maximum", async () => {
  isolate(h);
  holdWeapon(h, "taper", TAPER_LEVEL);
  holdWeapon(h, "ember", EMBER_LEVEL);

  const overlay = await openLevelUp(h, 1);
  await h.frameDraw();
  captureStill(h, "pool");

  assertEqual(overlay.screen, "levelup", "screen after the opening tick");
  assertContains(
    overlay.run.pool,
    "taper",
    `run.pool with Taper held at ${TAPER_LEVEL} (specs/progression.md, The candidate pool)`,
  );
  assertContains(
    overlay.run.pool,
    "ember",
    `run.pool with Ember held at ${EMBER_LEVEL}`,
  );
});
