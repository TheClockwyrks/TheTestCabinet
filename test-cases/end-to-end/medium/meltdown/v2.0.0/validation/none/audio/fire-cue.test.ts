// audio/fire-cue — an emitter landing a shot sounds a cue on the frame the shot
// resolves, and the quiet floor before it stays silent.
//
// `specs/audio.md`'s cue table: `fire` answers "An emitter's shot resolves", and
// "A cue is raised by the frame that resolves the event it answers, and it is
// played from the frame loop, so a cue always names one real frame: the frame the
// shot landed on". `specs/combat.md` fixes which frame that is: an emitter's
// accumulator grows by the frame's game time while it has a target and is online,
// and "[e]ach time the accumulator reaches `1 / fireRate` ... one shot resolves",
// so "[a] run of firing therefore lands its first shot one full interval after
// the target was acquired, not on the frame it appeared".
//
// WHAT IS AND IS NOT OBSERVABLE HERE is the whole of `audio/cues`' module comment;
// the short of it is that a sound and its frame can be read from outside an
// engineless build and a cue's NAME cannot, so this point separates a build that
// cues the shot from one that cues nothing, one that cues a frame late, and one
// that blips every frame — and leaves which of the ten sounds it played to the
// reviewer's ear.
//
// THE FLOOR THIS POSES, AND WHY EVERY SOUND IN THE WINDOW BELONGS TO THE SHOT.
// `startRun` empties both rosters, shuts the world gate and opens a live build
// phase, so nothing arrives and nothing leaks. Into it go exactly two things: one
// emitter and one target.
//
//   * THE EMITTER'S HEAT IS PINNED. `posePinnedTower` holds its part in the heat
//     model while it goes on targeting and firing (`specs/instrumentation.md`), so
//     its heat cannot climb to `100` and the trip — the other cue a firing
//     emitter can raise — is out of reach. The shot is still the game's own shot,
//     at the game's own rate, for the game's own damage.
//   * THE TARGET CANNOT DIE, so the shot cannot carry the death cue with it. Its
//     hp is `poseTarget`'s default, far past anything an Arc removes in a
//     scenario; its motion is off, so it cannot walk out of range mid-measurement
//     and cannot reach an exhaust.
//
// THE INTERVAL BEFORE THE FIRST SHOT IS THE SILENCE THIS POINT ALSO READS. The Arc
// fires twice a second (`specs/towers.md`), so half a second of frames pass with
// the emitter online, targeting, and resolving nothing — and `specs/audio.md` is
// explicit that "An event that does not resolve raises nothing". A build that
// blips per frame fails there, before the shot it is entitled to sound on.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  posePinnedTower,
  poseTarget,
  requireTower,
  startRun,
  watchCues,
  type Harness,
} from "../harness";
import { FREE_SITE } from "../fixtures";
import {
  SHOT_CEILING,
  frameWhere,
  framesOtherThan,
  reachFirstInput,
  soundsOn,
} from "./cues";

/**
 * The heat the emitter is pinned at.
 *
 * `0`, the heat a placed tower starts at (`specs/building.md`), so the shot is
 * the plainest shot the game has. Any heat below the redline would do: the point
 * is about the cue, and `specs/heat.md`'s multiplier decides only how much hp the
 * shot removes.
 */
const PINNED_HEAT = 0;

/**
 * Where the target stands: three and a half tiles from the emitter's footprint
 * centre, well inside the Arc's `6.0`-tile range (`specs/towers.md`,
 * `specs/combat.md`), and clear of both vent-to-exhaust corridors.
 */
const TARGET_TILE = { col: 8, row: 5 } as const;

/**
 * Flight driven after the readings are taken, so the still shows the shot's own
 * trace rather than the frame it opened on.
 *
 * The review item's evidence is "the shot the fire cue answers". Every assertion
 * below reads values captured before this ran.
 */
const TRACE_FRAMES = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds on the frame the shot resolves, and on no other frame", async () => {
  // The build is silent until a player has touched it (specs/audio.md), so
  // the first input is delivered before anything is posed.
  await reachFirstInput(h);
  await startRun(h);
  const emitter = await posePinnedTower(
    h,
    "arc",
    FREE_SITE.col,
    FREE_SITE.row,
    PINNED_HEAT,
  );
  await poseTarget(h, "mote", TARGET_TILE.col, TARGET_TILE.row);
  await h.armAudio();

  // Watched after the floor is posed, so what is read is the drive alone. The
  // frames before the shot are part of it: the emitter is online and targeting
  // through every one of them and resolves nothing.
  const played = watchCues(h);
  const shot = await frameWhere(
    h,
    (snapshot) => requireTower(snapshot, emitter, "the shot").damageDealt > 0,
    SHOT_CEILING,
    "the shot",
  );
  // Read HERE, on the frame the shot resolved: the frame number and the sounds
  // emitted by then are exactly what the assertions below read.
  const shotFrame = shot.frame;
  const heard = [...played];

  await h.advance(TRACE_FRAMES);
  await captureStill(h, "fire");

  assertEqual(
    shot.hit,
    true,
    "the pinned emitter to resolve a shot on the target in range",
  );
  assertEqual(
    requireTower(shot.snapshot, emitter, "the shot").tripped,
    false,
    "the emitter to be online on the frame its shot resolved",
  );
  assertGreaterThan(
    soundsOn(heard, shotFrame),
    0,
    `sounds emitted on frame ${shotFrame}, the frame the shot resolved`,
  );
  assertDeepEqual(
    framesOtherThan(heard, shotFrame),
    [],
    "the frames of every sound emitted away from the shot",
  );
});
