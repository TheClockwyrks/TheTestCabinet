// audio/game-over-cue — the leak that takes the last life sounds MORE than the
// same leak with one life to spare.
//
// `specs/audio.md`'s cue table: `game-over` answers "The game-over screen opens",
// and a cue always names the one real frame that resolved its event.
// `specs/waves.md` fixes that frame: "Lives reaching `0` ends the run at once, on
// the frame it happens and whatever the phase, and opens the game-over screen."
//
// WHY PRESENCE ALONE CANNOT DECIDE THIS POINT. The lives can only reach `0` on a
// frame a unit leaked, so the closing frame lawfully carries two cues — `leak` for
// the escape and `game-over` for the run ending. A cue's NAME is unobservable from
// outside an engineless build (`audio/cues`), so "the closing frame sounded" is
// equally true of a build that plays its leak cue and no sting at all.
//
// WHAT DECIDES IT: COUNTING. One cue is one defined sound played the same way each
// time (`specs/audio.md`), so a frame carrying `leak` and `game-over` emits
// strictly more sound than a frame carrying `leak` alone. This point drives both
// frames and holds the closing one strictly above the survivable one. That is an
// ORDERING, not a threshold: a build whose every cue is a chord passes it exactly
// as one whose cues are single tones does.
//
// THE TWO BOARDS DIFFER BY ONE LIFE, WHICH IS THE DISTINGUISHING VALUE. Same mode,
// same Mote entering the same vent under its own power, same tile, same walk out of
// the same exhaust. `specs/surge.md` costs a Mote's escape `LEAK_COST` (`1`) life,
// so the first board is posed with one life more than that and survives with one
// left, and the second with exactly that many and reaches `0`. Every wrong model
// reads as a different number here: a build that ends the run when the lives merely
// get low ends it on the first board too and sounds the same on both frames, a
// build that ends it only below `0` never ends it at all, and a build that ends it
// silently sounds the same on both.
//
// THE LIVES ARE POSED, WHICH `specs/instrumentation.md` PROVIDES FOR: "`setLives`
// triggers no game over: the loss belongs to the leak path, and this is a
// precondition." So the loss reached here is the leak's, on the real path, and the
// pose only decides how far from it the run started.
//
// THE LEAK IS THE ONLY OTHER EVENT IN THE WINDOW. `startRun` empties both rosters,
// shuts the world gate and opens a live BUILD phase — nothing arrives, no tower
// fires, nothing dies, and a build phase releases no unit and so never clears
// (`specs/waves.md`), which keeps both the wave-clear cue and the victory sting out
// of reach.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  poseWalker,
  requireUnit,
  startRun,
  watchCues,
  type Harness,
} from "../harness";
import { SURGE_DEFS } from "../constants";
import { framesOutside, leakOut, poseAtExhaustDoor, soundsOn } from "./cues";

/** The unit both boards lose, and what its escape costs (`specs/surge.md`). */
const TYPE = "mote" as const;
const VENT = "left" as const;
const LEAK_COST = SURGE_DEFS[TYPE].leak;

/** The lives the run survives its leak on, and the lives it does not. */
const SURVIVING_LIVES = LEAK_COST + 1;
const LAST_LIVES = LEAK_COST;

/** Quiet play driven between the two boards, so neither sound reads as the other's. */
const GAP_FRAMES = framesFor(0.4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

/** One board: a run posed on `lives`, losing one unit through its own exhaust. */
async function leakOneUnit(lives: number) {
  await startRun(h);
  await h.debug.setLives(lives);
  const unit = await poseWalker(h, TYPE, VENT);
  const entered = requireUnit(await h.snapshot(), unit, "the walker");
  await poseAtExhaustDoor(h, unit, entered.exhaust);
  return leakOut(h, `the leak from ${lives} lives`);
}

it("sounds more on the leak that ends the run than on one the run survives", async () => {
  await startRun(h);
  await h.armAudio();
  const played = watchCues(h);

  // The survivable leak: one life more than the escape costs.
  const survived = await leakOneUnit(SURVIVING_LIVES);
  const survivedFrame = survived.frame;
  const survivedSounds = soundsOn(played, survivedFrame);

  await h.advance(GAP_FRAMES);

  // The closing leak: exactly as many lives as the escape costs.
  const lost = await leakOneUnit(LAST_LIVES);
  const lostFrame = lost.frame;
  const lostSounds = soundsOn(played, lostFrame);

  await captureStill(h, "gameover");

  assertEqual(survived.hit, true, "the first walker to reach its exhaust");
  assertEqual(lost.hit, true, "the second walker to reach its exhaust");

  assertEqual(
    survived.snapshot.lives,
    SURVIVING_LIVES - LEAK_COST,
    `the lives left after a ${TYPE} escaped from ${SURVIVING_LIVES}`,
  );
  assertEqual(
    survived.snapshot.screen,
    "playing",
    "the screen a run with a life left is still being played on",
  );
  assertEqual(
    lost.snapshot.lives,
    0,
    `the lives left after a ${TYPE} escaped from ${LAST_LIVES}`,
  );
  assertEqual(
    lost.snapshot.screen,
    "gameover",
    "the screen the frame the last life went opens",
  );

  assertGreaterThan(
    survivedSounds,
    0,
    `sounds emitted on frame ${survivedFrame}, the leak the run survived`,
  );
  assertGreaterThan(
    lostSounds,
    survivedSounds,
    `the sound on frame ${lostFrame}, which carries the game-over sting on ` +
      `top of its leak (the survivable leak emitted ${survivedSounds})`,
  );
  assertDeepEqual(
    framesOutside(played, [survivedFrame, lostFrame]),
    [],
    "the frames of every sound emitted away from the two leaks",
  );
});
