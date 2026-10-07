// hurt/flash-drawn — the stage drawn while the hurt flash runs differs from the
// stage drawn on the same state with no flash running.
//
// THE RULE, FROM THE SPEC. specs/ui.md ("`playing`", the HUD table): "Hurt |
// While `hurtFlash` is above `0`, a hurt cast over the view, so the stage drawn
// on a tick with `hurtFlash` above `0` differs from the stage drawn on the same
// state with `hurtFlash` at `0`. Its color, its shape, and its fade are yours."
//
// WHY A DIFFERENCE AND NOTHING MORE. The table fixes the cast's color, shape,
// and fade as the build's, and specs/ui.md fixes "no palette, no font, and no
// styling for any screen", so the only thing this point may read is that the
// two frames are not the same picture. It asserts no color, no coverage, and no
// place on the stage.
//
// WHAT MAKES THE TWO FRAMES COMPARABLE. The claim is about ONE state drawn
// twice, so the two poses are driven the same way and differ in `hurtFlash`
// alone, which the point checks before it compares pixels: the twenty stored
// fields of specs/state.md's run are read off both snapshots and compared with
// `hurtFlash` set aside, and the screen and the highlight with them. A
// difference measured between two frames whose states are otherwise identical
// can only be the cast.
//
// THE DRIVE, TWICE. An isolated night with `enemyContact` the only switch on
// and one rat posed along +x: at 20 units for the flashed pose, inside the 24
// its radius 12 and PLAYER_RADIUS sum to, so the first tick lands its hit and
// arms the flash; at 200 units for the calm pose, well outside that sum, so the
// same tick lands nothing. Both poses then take the rat off the field and set
// hp to the 92 the hit left, so the world, the health bar, and the run's ids
// read alike, and both draw one further frame. That frame is the one compared:
// the flashed pose carries 0.3 − TICK_DT of flash into it, which is above `0`,
// and the calm pose carries `0`.
//
// WHAT IS READ. The whole stage, `STAGE_W x STAGE_H` of pixels, after each of
// the two frames, and how many pixels of one differ from the other.
//
// THE TOLERANCE. None: the requirement is that the two pictures differ, and a
// picture either differs somewhere or does not.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  captureReplay,
  createHarness,
  pixelsDiffering,
  runFields,
  type Harness,
  type PixelRect,
  type RunSnapshot,
  type WickSnapshot,
} from "../harness";
import {
  CLEAR_OFFSET,
  HP_AFTER_HIT,
  OVERLAP_OFFSET,
  clearHitters,
  poseNight,
  spawnHitter,
} from "./hurt";

/** One pose: the frame's pixels, and the state that frame was drawn on. */
interface Pose {
  pixels: PixelRect;
  snapshot: WickSnapshot;
}

/** A run's stored fields with the flash set aside, for the "same state" reading. */
function withoutFlash(
  run: RunSnapshot,
): Omit<ReturnType<typeof runFields>, "hurtFlash"> {
  const { hurtFlash: _flash, ...rest } = runFields(run);
  return rest;
}

/**
 * Pose the night with a rat `offset` units along +x, run the tick that either
 * lands its hit or does not, level the world and the hp between the two poses,
 * and draw the frame the point compares.
 */
async function pose(h: Harness, offset: number): Promise<Pose> {
  poseNight(h);
  spawnHitter(h, offset);
  await h.tick(1);
  clearHitters(h);
  h.debug.setHp(HP_AFTER_HIT);
  await h.frameDraw();
  return {
    pixels: h.pixelRect(0, 0, STAGE_W, STAGE_H),
    snapshot: h.snapshot(),
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a stage that differs from the same stage drawn with hurtFlash 0", async () => {
  const [flashed, calm] = await captureReplay(h, "flash", async () => [
    await pose(h, OVERLAP_OFFSET),
    await pose(h, CLEAR_OFFSET),
  ]);

  assertGreaterThan(
    flashed.snapshot.run.hurtFlash,
    0,
    "hurtFlash on the frame drawn with the flash running",
  );
  assertEqual(
    calm.snapshot.run.hurtFlash,
    0,
    "hurtFlash on the frame drawn with no flash running",
  );
  assertEqual(
    calm.snapshot.screen,
    flashed.snapshot.screen,
    "the screen the two frames were drawn on",
  );
  assertEqual(
    calm.snapshot.menuIndex,
    flashed.snapshot.menuIndex,
    "the highlight the two frames were drawn on",
  );
  assertDeepEqual(
    withoutFlash(calm.snapshot.run),
    withoutFlash(flashed.snapshot.run),
    "the stored run fields of the two poses, hurtFlash aside",
  );

  assertGreaterThan(
    pixelsDiffering(flashed.pixels, calm.pixels),
    0,
    "pixels of the stage differing between a running flash and none",
  );
});
