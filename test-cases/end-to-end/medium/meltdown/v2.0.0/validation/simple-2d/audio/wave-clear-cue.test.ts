// Meltdown — audio/wave-clear-cue: a wave clearing plays the `wave-clear` cue on
// the frame it clears.
//
// `specs/audio.md` binds `wave-clear` to "a wave clears" and fixes the frame: a
// cue "is raised by the frame that resolves the event it answers".
// `specs/waves.md` fixes the event — "a wave clears on the frame in which its last
// live unit dies or leaks with none of it left to release" — and what that frame
// does: the number rises by one and a build phase for the next wave begins.
//
// THE CLEAR IS THE RUN'S OWN. `setPhase` and `setWavePending` set that field alone
// and run no entry effect (`specs/instrumentation.md`), releasing and clearing
// nothing. So the wave phase is posed empty of pending units, one unit is put on
// the floor, and the build's own settling is what clears the wave when that unit
// goes.
//
// THE LAST UNIT LEAVES BY LEAKING. That needs no tower, no shot and no targeting
// on the floor, so the only thing between the pose and the clear is the unit's own
// walk — the shortest honest route to the transition this point is about. The
// `leak` cue sounds on the same frame, and this point says nothing about it:
// `audio/leak-cue` decides that one. The run opens on twenty lives
// (`specs/modes.md`) and the Mote costs one (`specs/surge.md`), so the leak cannot
// end the run, and Wave 1 of a twenty-wave run is not the final wave, so it cannot
// win it either.

import { afterEach, beforeEach, it } from "vitest";
import { CUES } from "../constants";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  ticksFor,
  watchCues,
  type Harness,
} from "../harness";
import { playedOn, playsOf, poseLeaker } from "./cues";

/**
 * How long the last unit is given to walk into the exhaust and clear the wave.
 *
 * It is posed one orthogonal step out, `TILE` (`19`) logical units
 * (`specs/floor.md`), and a Mote's base speed is `60` units a second
 * (`specs/surge.md`), so a conforming build clears about `0.32` seconds in. Two
 * seconds is a hard ceiling six times that.
 */
const CLEAR_TICKS = ticksFor(2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the wave-clear cue on the frame the wave clears", async () => {
  startRun(h);
  // A wave phase with nothing left to release, so the one unit on the floor is
  // the wave's last live unit (specs/waves.md, Clearing a wave).
  h.debug.setPhase("wave");
  h.debug.setWavePending(0);
  poseLeaker(h);

  const opened = h.snapshot();
  assertEqual(
    opened.waveRemaining,
    1,
    "posing: the wave has exactly one unit left, the one on the floor " +
      "(specs/instrumentation.md)",
  );

  // Subscribed after the floor is posed, so what is read is the walk alone.
  const played = watchCues(h);

  // A clear raises the wave number by one and opens a build phase for the next
  // wave (specs/waves.md), so the frame the number rises is the clear's own.
  const clear = await h.until((s) => s.wave > opened.wave, {
    maxFrames: CLEAR_TICKS,
  });
  const frame = h.engine.frame().count;
  captureStill(h, "clear");

  assertEqual(
    clear.hit,
    true,
    `the wave cleared when its last unit went, inside ${String(CLEAR_TICKS)} ` +
      "frames (specs/waves.md, Clearing a wave)",
  );
  assertEqual(
    clear.snapshot.phase,
    "building",
    "the phase the clear left the run in (specs/waves.md, Clearing a wave)",
  );
  assertLength(
    playsOf(played, CUES.waveClear).filter((cue) => cue.frame < frame),
    0,
    "plays of the wave-clear cue on any frame before the clear — a cue is " +
      "raised by the frame that resolves the event it answers (specs/audio.md)",
  );
  assertLength(
    playedOn(played, frame).filter((name) => name === CUES.waveClear),
    1,
    "plays of the wave-clear cue on the frame the wave cleared, which is its " +
      "own frame and once on it (specs/audio.md)",
  );
  assertGreaterThan(
    playsOf(played, CUES.waveClear)[0].gain,
    0,
    "the gain the wave-clear cue played at on an unmuted bus (specs/audio.md)",
  );
});
