// camera/lead-rests-at-zero — a miner that is barely moving vertically sits on
// the centre of the view.
//
// specs/world.md: `leadTarget` is `0` while `abs(vy) <= CAM_STILL_SPEED` (40),
// and `lead` is a signed distance carried across frames "starting at 0". So a
// fresh expedition opens with no lead, and a miner at or under the still speed
// never acquires any, however long it is watched: `camY` is `my - VIEW_H / 2`
// and the miner holds the vertical centre.
//
// TWO ARRANGEMENTS, BOTH OF THEM THE SAME RULE.
//
// 1. A miner at rest on solid ground, with the real physics running. Its vertical
//    speed is 0, which is inside the still band, and three seconds of game time
//    must leave the lead where it started.
// 2. A miner held at exactly `CAM_STILL_SPEED`, the top of the band, which the
//    rule includes ("at or under"). Nothing in the game holds a steady vertical
//    speed on its own — a fall accelerates — so this is what the travel gate is
//    for: specs/instrumentation.md fixes that a gated miner keeps the velocity it
//    was posed with while everything else about it carries on, the camera
//    included. The drill is gated in both, since neither exercises it.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { CAM_STILL_SPEED, VIEW_H } from "../constants";
import {
  captureReplay,
  createHarness,
  layFloor,
  minerCenter,
  openScene,
  pinDrill,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";

/** The column and the floor the resting miner stands on. */
const COL = 16;
const FLOOR_ROW = 30;

/** The sustained span each arrangement is watched over, in seconds. */
const WATCH_SECONDS = 3;

/** Frames the span is divided into. Every rate is integrated against the delta. */
const WATCH_FRAMES = 180;

/** Half a unit: the specification fixes both the lead and `camY` exactly. */
const TOLERANCE_DIGITS = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the lead at 0 while the miner is at or under the still speed", async () => {
  await openScene(h);
  await pinDrill(h);
  await layFloor(h, FLOOR_ROW);
  await standOn(h, COL, FLOOR_ROW);
  await h.advance(1);

  const opened = await h.snapshot();
  assertCloseTo(
    opened.camera.lead,
    0,
    TOLERANCE_DIGITS,
    "specs/world.md: lead starts at 0",
  );

  await captureReplay(h, "still", () =>
    h.advanceSeconds(WATCH_SECONDS, WATCH_FRAMES),
  );

  const rested = await h.snapshot();
  assertCloseTo(
    rested.camera.lead,
    0,
    TOLERANCE_DIGITS,
    `specs/world.md: a miner at rest never leads, after ${WATCH_SECONDS}s`,
  );
  assertCloseTo(
    rested.camera.y,
    minerCenter(rested.miner).y - VIEW_H / 2,
    TOLERANCE_DIGITS,
    "specs/world.md: camY is my - VIEW_H / 2 with no lead",
  );

  // The top of the still band, which the rule takes in: `abs(vy) <= 40`.
  await pinMiner(h);
  await h.debug.setMinerVelocity(0, CAM_STILL_SPEED);
  await h.advanceSeconds(WATCH_SECONDS, WATCH_FRAMES);

  const drifting = await h.snapshot();
  assertCloseTo(
    drifting.camera.lead,
    0,
    TOLERANCE_DIGITS,
    `specs/world.md: leadTarget is 0 at vy = CAM_STILL_SPEED (${CAM_STILL_SPEED})`,
  );
});
