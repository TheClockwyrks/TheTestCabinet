// audio/wave-clear-cue — the leak that clears a wave sounds MORE than the same
// leak on a wave that still has a unit to release.
//
// `specs/audio.md`'s cue table: `wave-clear` answers "A wave clears", and a cue
// "always names one real frame: ... the frame the wave cleared on".
// `specs/waves.md` fixes that frame: "A wave clears on the frame in which its last
// live unit dies or leaks with none of it left to release. A phase that has
// released no unit never clears."
//
// WHY PRESENCE ALONE CANNOT DECIDE THIS POINT. The wave clears ON a death or a
// leak, so the clearing frame lawfully carries two cues — `leak` for the escape
// and `wave-clear` for the transition. A cue's NAME is unobservable from outside
// an engineless build (`audio/cues`), so "the clearing frame sounded" is equally
// true of a build that plays its leak cue and no clear cue at all.
//
// WHAT DECIDES IT: COUNTING. One cue is one defined sound played the same way each
// time (`specs/audio.md`), so a frame carrying `leak` and `wave-clear` emits
// strictly more sound than a frame carrying `leak` alone. This point drives both
// frames and holds the clearing one strictly above the plain one. That is an
// ORDERING, not a threshold: a build whose every cue is a chord passes it exactly
// as one whose cues are single tones does.
//
// THE TWO BOARDS DIFFER IN ONE VALUE, AND IT IS `wavePending`. Same mode, same
// difficulty, same wave, same send, same Core, same tile, same walk out of the
// same exhaust. The first is posed with one unit still to release, which
// `specs/waves.md` says is not a clear; the second with none, which is. Every
// wrong model reads as a different number: a build that clears whenever the floor
// empties sounds the same on both frames, and a build that never clears sounds
// less on the second than the item requires.
//
// THE WAVE IS REALLY RELEASED, BY THE RUN'S OWN SEND. `specs/waves.md` is explicit
// that "[a] phase that has released no unit never clears", so a unit dropped onto
// a posed `wave` phase with `addUnit` would leave a conforming build entitled to
// clear nothing. The wave is therefore begun the way a player begins it — the
// `send` binding of `specs/controls.md`, with the world gate open for exactly as
// long as the release takes — and `MILESTONE_WAVE` is chosen because
// `specs/waves.md` makes a milestone wave a Core wave of exactly one unit, so the
// one unit released is the whole wave.
//
// THE CLEAR IS NOT A VICTORY. `MILESTONE_WAVE` is `round(n / 2)`, not `n`, so
// `specs/waves.md` has the wave number rise and a build phase begin rather than
// the run ending — the victory sting is `audio/victory-cue`'s subject and would be
// a third cue on this frame. The lives the Core's escape costs leave the run far
// above `0`, so the game-over sting has nothing to answer either.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  startRun,
  watchCues,
  type Harness,
} from "../harness";
import { milestoneWaves, modeFigures } from "../constants";
import { framesOutside, releaseAndLeak, soundsOn } from "./cues";

/** The run both boards are posed on: the default row `startRun` uses. */
const MODE = "containment" as const;
const DIFFICULTY = "medium" as const;

/**
 * The wave both boards are fought: the run's first milestone.
 *
 * `specs/waves.md` makes `round(n / 2)` and `n` Core waves and a Core wave one
 * unit, and this is the first of the two — so the wave is one unit long AND its
 * clear advances the run instead of winning it.
 */
const MILESTONE_WAVE = milestoneWaves(
  modeFigures(MODE, DIFFICULTY).waveCount,
)[0];

/** Units still to release on the board that must NOT clear, and on the one that must. */
const PENDING_LEFT = 1;
const PENDING_NONE = 0;

/** Quiet play driven between the two boards, so neither sound reads as the other's. */
const GAP_FRAMES = framesFor(0.4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds more on the clearing leak than on a leak that left the wave standing", async () => {
  await startRun(h, MODE, DIFFICULTY);
  await h.armAudio();
  const played = watchCues(h);

  // The plain leak: the wave's live unit escapes, and a unit is still to come.
  await h.debug.setWave(MILESTONE_WAVE);
  const plain = await releaseAndLeak(h, PENDING_LEFT);
  const plainFrame = plain.leak.frame;
  const plainSounds = soundsOn(played, plainFrame);

  await h.advance(GAP_FRAMES);

  // The clearing leak: the same wave, the same Core, nothing left to release.
  await startRun(h, MODE, DIFFICULTY);
  await h.debug.setWave(MILESTONE_WAVE);
  const clearing = await releaseAndLeak(h, PENDING_NONE);
  const clearFrame = clearing.leak.frame;
  const clearSounds = soundsOn(played, clearFrame);

  await captureStill(h, "clear");

  // Both boards really released the wave, and really lost its unit.
  assertEqual(
    plain.released.hit,
    true,
    "the send to begin the wave and release its first unit",
  );
  assertEqual(plain.leak.hit, true, "the released unit to reach its exhaust");
  assertEqual(
    clearing.released.hit,
    true,
    "the send to begin the wave again on the second board",
  );
  assertEqual(
    clearing.leak.hit,
    true,
    "the released unit to reach its exhaust on the second board",
  );

  // And the boards ended where `specs/waves.md` says each of them ends.
  assertEqual(
    plain.leak.snapshot.wave,
    MILESTONE_WAVE,
    `the wave the run stands on after a leak with ${PENDING_LEFT} unit left to release`,
  );
  assertEqual(
    plain.leak.snapshot.phase,
    "wave",
    "the phase a wave that did not clear is still being fought in",
  );
  assertEqual(
    clearing.leak.snapshot.wave,
    MILESTONE_WAVE + 1,
    `the wave the run advances to once wave ${MILESTONE_WAVE} clears`,
  );
  assertEqual(
    clearing.leak.snapshot.phase,
    "building",
    "the phase a cleared wave hands the run to",
  );
  assertGreaterThan(
    clearing.leak.snapshot.lives,
    0,
    "the lives still standing, so the clear ended no run",
  );

  assertGreaterThan(
    plainSounds,
    0,
    `sounds emitted on frame ${plainFrame}, the leak that cleared nothing`,
  );
  assertGreaterThan(
    clearSounds,
    plainSounds,
    `the sound on frame ${clearFrame}, which carries the wave-clear cue on ` +
      `top of its leak (the plain leak emitted ${plainSounds})`,
  );
  assertDeepEqual(
    framesOutside(played, [plainFrame, clearFrame]),
    [],
    "the frames of every sound emitted away from the two leaks",
  );
});
