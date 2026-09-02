// stages/clears-on-last-drone — a wave clears in the moment its last drone dies.
//
// specs/stages.md, The sequence: "A standard stage clears in the moment the last
// drone of its wave is destroyed." This is the positive half of the stage-clear
// rule; `stages/empty-wave-does-not-clear` is the negative half, and
// `stages/stage-cleared-screen` grades WHICH screen the clear opens. This point
// grades only that the live wave ENDS on that frame.
//
// WHY THE GAME'S OWN WAVE. The rule is about "the last drone of its wave", and
// the specification deliberately leaves a build free to read "its wave" either
// way — the drones the stage itself built, or the drones standing on the field.
// A scenario that poses a drone into an emptied field makes the verdict rest on
// which reading the build took. Opening the stage's own wave with `startStage`
// and raking it down to one of its own drones is the one scenario where the two
// readings agree: that drone is the last of the wave under either.
//
// WHAT IS DRIVEN. The game builds stage 1's wave; every drone but one Shard of it
// is removed through the surface, so the wave still holds one of its own; the
// three world gates are shut so nothing else arrives, dives or costs a life; and
// one of the player's bullets is put under the survivor on its own band. The
// build's own contact, band and stage rules decide the rest — nothing about the
// outcome is posed.
//
// THE VERDICT IS READ ON THE FRAME THE DRONE LEFT THE ROSTER, which is the frame
// the specification's "moment" names.

import { afterEach, beforeEach, it } from "vitest";
import { PLAYER_BULLET_SPEED } from "../constants";
import {
  assertEqual,
  assertLength,
  assertNotEqual,
  assertTrue,
} from "../assert";
import {
  captureStill,
  createHarness,
  droneById,
  ticksFor,
  type Harness,
} from "../harness";
import { rakeToLastDrone, SURVIVOR_AT } from "./rake";

/** How far below the survivor the shot starts. Clear of it, and inside the field. */
const SHOT_BELOW = 200;

/**
 * Frames the shot is given to resolve.
 *
 * The geometry alone — the frames a bullet needs to climb `SHOT_BELOW` at
 * `PLAYER_BULLET_SPEED` — plus four frames of slack for where inside a frame the
 * contact falls. Nothing about the verdict rests on it: a bullet that has not
 * resolved by then has missed a stationary target it was fired straight at.
 */
const SHOT_FRAMES = ticksFor(SHOT_BELOW / PLAYER_BULLET_SPEED) + 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("clears the wave in the frame its last drone is destroyed", async () => {
  const survivor = await rakeToLastDrone(h);

  const before = h.snapshot();
  assertLength(
    before.drones,
    1,
    "the one drone of the game's own wave the rake left standing",
  );
  assertEqual(
    before.screen,
    "inWave",
    "the live wave, still playing while one of its drones stands (specs/stages.md)",
  );

  h.debug.addPlayerBullet(
    SURVIVOR_AT.x,
    SURVIVOR_AT.y + SHOT_BELOW,
    survivor.band,
  );
  const killed = await h.until(
    (snapshot) => droneById(snapshot, survivor.id) === undefined,
    { maxFrames: SHOT_FRAMES, poll: 1 },
  );
  captureStill(h, "cleared");

  assertTrue(
    killed.hit,
    "a matching shot to destroy the wave's last drone (specs/bands.md)",
  );
  assertNotEqual(
    killed.snapshot.screen,
    "inWave",
    "the wave to have ended in the frame its last drone was destroyed (specs/stages.md)",
  );
});
