// stages/stage-cleared-screen — a cleared stage opens its interstitial.
//
// specs/stages.md, The sequence: "A cleared stage opens the stage-cleared
// interstitial." specs/ui.md names the screen `stageCleared`. This point grades
// only WHICH screen a clear opens; `stages/clears-on-last-drone` grades that the
// live wave ends at all, and `stages/advances-stage` what the interstitial's end
// does to the stage number.
//
// WHY THE SCREEN IS REACHED BY CLEARING RATHER THAN BY POSING. `setScreen` would
// put the game on `stageCleared` whatever the build does when a wave actually
// ends, which is the thing under test. So the stage's own wave is opened, raked
// down to one of its own drones, and that drone is shot — the same drive
// `stages/clears-on-last-drone` runs — and the screen is read from what the
// build's own stage rules did with it.

import { afterEach, beforeEach, it } from "vitest";
import { PLAYER_BULLET_SPEED } from "../../src/constants";
import { assertEqual, assertTrue } from "../assert";
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
 * Frames the shot is given to resolve: the climb at `PLAYER_BULLET_SPEED`, plus
 * four frames of slack for where inside a frame the contact falls.
 */
const SHOT_FRAMES = ticksFor(SHOT_BELOW / PLAYER_BULLET_SPEED) + 4;

/**
 * Frames run after the clear before the picture is kept.
 *
 * One, so the canvas carries a frame the interstitial drew rather than the last
 * frame of the wave. `STAGE_CLEARED_HOLD` is 2.6 s, so the screen is nowhere near
 * giving way, and the verdict is read from the snapshot of the clearing frame
 * itself rather than from this one.
 */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the stage-cleared interstitial when a stage clears", async () => {
  const survivor = await rakeToLastDrone(h);

  h.debug.addPlayerBullet(
    SURVIVOR_AT.x,
    SURVIVOR_AT.y + SHOT_BELOW,
    survivor.band,
  );
  const killed = await h.until(
    (snapshot) => droneById(snapshot, survivor.id) === undefined,
    { maxFrames: SHOT_FRAMES, poll: 1 },
  );
  await h.advance(SETTLE_FRAMES);
  captureStill(h, "screen");

  assertTrue(
    killed.hit,
    "a matching shot to destroy the wave's last drone (specs/bands.md)",
  );
  assertEqual(
    killed.snapshot.screen,
    "stageCleared",
    "the screen a cleared stage opens (specs/stages.md, specs/ui.md)",
  );
});
