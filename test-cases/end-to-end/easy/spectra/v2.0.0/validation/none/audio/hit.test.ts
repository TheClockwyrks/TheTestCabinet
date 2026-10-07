// audio/hit — the cue a lost life plays.
//
// `specs/ui.md` fixes `hit` as the cue played when "a life is lost", and governs
// all nine with one sentence: "Each is played on the frame its event happens and
// at most once on that frame."
//
// So the measurement is: pose an empty, quiet, live wave, drop ONE enemy bullet
// of the band OPPOSITE the ship's onto the hull, step one frame at a time, and
// read what sounded on the frame the run's lives fell against what sounded over
// the bullet's fall. The fall is the half a build cannot fake — a build that
// blips every frame sounds on the hit's frame too, and fails on the quiet that
// should have come first.
//
// THE HIT IS REAL, NOT POSED. Nothing here writes the lives: the bullet is placed
// above the hull with the band `specs/bands.md` says the shield does NOT take,
// and the build's own contact and band rules decide the rest. `setShipContact(true)`
// puts back the one world gate `startPosed` shuts, because this is one of the
// items whose requirement that gate is.
//
// LIVES ARE LEFT AT `START_LIVES`, so the hit costs a life and opens the ready
// hold rather than ending the run. A hit with no life left opens the game-over
// screen instead (`specs/progression.md`), which is a different event and not the
// one this cue is owed to.
//
// WHAT THIS ENGINE CANNOT SEE. The cue's NAME, and how many sources one cue is
// made of. `./cues.ts` states why, and what these checks assert instead.
//
// WHAT THIS DOES NOT DECIDE. That an opposite-band bullet costs a life, or what
// the ready hold does, which are `progression/bullet-costs-life`'s and
// `progression/ready-hold`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  ENEMY_BULLET_SPEED,
  START_LIVES,
  bulletSpeedScale,
  opposite,
} from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  startPosed,
  type Harness,
} from "../harness";
import {
  poseEnemyBulletAbove,
  quietFrames,
  soundsBeforeEvent,
  soundsOnEvent,
  watchForEvent,
} from "./cues";

/**
 * How far above the ship's centre the bullet starts, in logical units.
 *
 * Far enough that the fall is a real window of quiet — at the stage-1 enemy
 * bullet speed of `ENEMY_BULLET_SPEED` (`320`) times `bulletSpeedScale(1)` (`1`)
 * it is better than a third of a second — and short enough that the budget below
 * expires well before the bullet could reach `FIELD_BOTTOM` (`656`), fifty-six
 * units past the ship.
 */
const ABOVE_SHIP = 120;

/** The speed the bullet falls at on stage 1 (`specs/stages.md`). */
const FALL_SPEED = ENEMY_BULLET_SPEED * bulletSpeedScale(1);

/**
 * Frames the fall is given to reach the hull.
 *
 * The time to fall the whole `ABOVE_SHIP` at `FALL_SPEED` — geometry, not a
 * tolerance — plus two frames for the frame the bullet is placed on. Contact
 * lands sooner than that, since the hull's and the bullet's half-extents meet
 * before their centres do.
 */
const FALL_FRAMES = framesFor(ABOVE_SHIP / FALL_SPEED) + 2;

/** Frames run after the reading, purely so the still shows the ready hold. */
const TAIL_FRAMES = framesFor(0.15);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds on the frame the ship loses a life, and not before", async () => {
  // A real, browser-trusted gesture first: an engineless build owns its whole
  // audio layer and is entitled to open it on the player's first interaction
  // alone (`specs/ui.md`). The key is bound to nothing, so this changes no state.
  await h.armAudio();
  // An empty, quiet, live wave: no drone, no other bullet and no burst, so the
  // only thing that can cost a life in this window is the bullet below.
  await startPosed(h);
  // The one world gate this item's requirement IS: without it the hull runs no
  // contact test and no life is ever lost.
  await h.debug.setShipContact(true);

  const band = opposite((await h.snapshot()).ship.band);
  await poseEnemyBulletAbove(h, band, ABOVE_SHIP);

  const watch = await watchForEvent(
    h,
    (s) => s.lives < START_LIVES,
    FALL_FRAMES,
  );
  // Held on past the reading, so the still shows the ready hold the hit opened.
  // Nothing after this line can reach an assertion.
  await h.advance(TAIL_FRAMES);
  await captureStill(h, "hit");

  assertEqual(
    watch.hit,
    true,
    `the ${band} bullet dropped ${String(ABOVE_SHIP)} units above the hull, ` +
      "opposite the band the ship holds, cost a life inside the " +
      `${String(FALL_FRAMES)} frames its fall takes (specs/bands.md, ` +
      "specs/progression.md)",
  );
  assertEqual(
    soundsBeforeEvent(watch),
    0,
    `sounds the build emitted over the ${String(quietFrames(watch))} frames the ` +
      "bullet fell, on a field where nothing else is happening — a cue is played " +
      "on the frame its event happens (specs/ui.md)",
  );
  assertGreaterThanOrEqual(
    soundsOnEvent(watch),
    1,
    "sounds the build emitted on the frame the ship lost a life, which is the " +
      "frame the hit cue is played on (specs/ui.md)",
  );
});
