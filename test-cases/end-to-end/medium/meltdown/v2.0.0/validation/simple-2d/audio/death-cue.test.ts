// Meltdown — audio/death-cue: a unit taken to `0` hp plays the `death` cue on the
// frame it dies.
//
// `specs/audio.md` binds `death` to "a surge unit's hp reaches `0`" and fixes the
// frame: a cue "is raised by the frame that resolves the event it answers". The
// removal is the same frame — `specs/surge.md` takes a unit that dies off the
// floor — so the frame the roster empties is the frame the cue must name.
//
// THE KILL IS REAL. No operation of the debug surface plays a cue and none can
// (`specs/instrumentation.md`), and none of them kills: `setUnitHp` "does not kill
// the unit: death belongs to the damage path". So the hp is posed low and the
// emitter's own shot is what takes it to `0`.
//
// THE HEAT IS PINNED, so nothing here can reach `100` and raise the `trip` cue,
// and the unit's motion is off, so it cannot reach the exhaust and raise `leak`.
// The `fire` cue sounds on the same frame, because the shot that killed is a shot
// that resolved, and this point says nothing about it: `audio/fire-cue` decides
// the fire cue, and what is read here is the death cue and its frame alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { CUES } from "../constants";
import {
  captureStill,
  createHarness,
  posePinnedTower,
  poseTarget,
  startRun,
  ticksFor,
  watchCues,
  type Harness,
} from "../harness";
import { playedOn, playsOf } from "./cues";

/** The tile the Arc's 2x2 footprint is anchored on: quiet floor, off every opening. */
const TOWER = { col: 10, row: 10 } as const;

/** The tile the target stands on, about `3.5` tiles inside the Arc's `6.0` (specs/towers.md). */
const TARGET = { col: 14, row: 10 } as const;

/** The heat the Arc is pinned at: zero, so nothing here approaches the trip. */
const PINNED_HEAT = 0;

/**
 * The hp the target is posed at.
 *
 * An Arc at heat `0` removes `6 * heatMultiplier(0, 80)` = `6 * 0.35` = `2.1` per
 * shot (`specs/towers.md`, `specs/heat.md`), so one shot takes a unit at `1` hp to
 * `0` whatever rounding the build carries. One hp is far enough below `2.1` that
 * no spec-compliant reading of the multiplier leaves the unit alive.
 */
const TARGET_HP = 1;

/**
 * How long the kill is given to land.
 *
 * The Arc fires `2.0` shots per second at level I and lands its first "one full
 * interval after the target was acquired" (`specs/towers.md`, `specs/combat.md`),
 * so a conforming build kills `0.5` seconds in. Three seconds is a hard ceiling
 * six times that.
 */
const KILL_TICKS = ticksFor(3);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the death cue on the frame the unit's hp reaches zero", async () => {
  startRun(h);
  posePinnedTower(h, "arc", TOWER.col, TOWER.row, PINNED_HEAT);
  poseTarget(h, "mote", TARGET.col, TARGET.row, TARGET_HP);

  // Subscribed after the floor is posed, so what is read is the drive alone.
  const played = watchCues(h);

  // A unit that dies is removed from the floor (specs/surge.md), so the frame the
  // roster empties is the frame the death resolved on.
  const kill = await h.until((s) => s.surge.length === 0, {
    maxFrames: KILL_TICKS,
  });
  const frame = h.engine.frame().count;
  captureStill(h, "death");

  assertEqual(
    kill.hit,
    true,
    `the Arc's shot took the target to 0 hp inside ${String(KILL_TICKS)} ` +
      "frames (specs/combat.md, Damage)",
  );
  assertLength(
    playsOf(played, CUES.death).filter((cue) => cue.frame < frame),
    0,
    "plays of the death cue on any frame before the kill — a cue is raised by " +
      "the frame that resolves the event it answers (specs/audio.md)",
  );
  assertLength(
    playedOn(played, frame).filter((name) => name === CUES.death),
    1,
    "plays of the death cue on the frame the unit's hp reached 0, which is its " +
      "own frame and once on it (specs/audio.md)",
  );
  assertGreaterThan(
    playsOf(played, CUES.death)[0].gain,
    0,
    "the gain the death cue played at on an unmuted bus (specs/audio.md)",
  );
});
