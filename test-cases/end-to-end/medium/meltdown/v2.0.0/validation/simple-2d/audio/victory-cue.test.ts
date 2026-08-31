// Meltdown — audio/victory-cue: reaching the victory screen plays the `victory`
// cue on the frame it opens.
//
// `specs/audio.md` binds `victory` to "the victory screen opens" and fixes the
// frame: a cue "is raised by the frame that resolves the event it answers".
// `specs/waves.md` fixes the event — "victory is reached by clearing Wave `N` with
// at least one life left" — and the victory screen is what that frame opens.
//
// THE VICTORY IS THE RUN'S OWN. `setScreen` sets that field alone and runs no
// entry effect, and `setWave` "rebuilds, releases and clears nothing"
// (`specs/instrumentation.md`); reaching an entry effect is what the run's own
// transitions are for. So the run is posed on its FINAL wave — the mode's own
// `waveCount`, read back off the snapshot rather than restated here, because
// `specs/modes.md` derives it from the mode and difficulty — with nothing left to
// release and one unit on the floor, and the build's own settling is what wins the
// run when that unit goes.
//
// THE LAST UNIT LEAVES BY LEAKING, which needs no tower and no shot on the floor.
// The run opens on twenty lives and the Mote costs one (`specs/modes.md`,
// `specs/surge.md`), so nineteen are left: "at least one life left" holds, and the
// leak that clears the final wave wins the run rather than losing it. The `leak`
// and `wave-clear` cues sound on the same frame, and this point says nothing about
// either.

import { afterEach, beforeEach, it } from "vitest";
import { CUES } from "../../src/constants";
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
 * How long the final wave's last unit is given to walk into the exhaust.
 *
 * It is posed one orthogonal step out, `TILE` (`19`) logical units
 * (`specs/floor.md`), and a Mote's base speed is `60` units a second
 * (`specs/surge.md`), so a conforming build wins about `0.32` seconds in. Two
 * seconds is a hard ceiling six times that.
 */
const WIN_TICKS = ticksFor(2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the victory cue on the frame the victory screen opens", async () => {
  startRun(h);
  // The run's final wave, as the mode and difficulty derive it (specs/modes.md);
  // `setWave` rebuilds, releases and clears nothing (specs/instrumentation.md),
  // so this is a precondition and not a transition.
  h.debug.setWave(h.snapshot().waveCount);
  h.debug.setPhase("wave");
  h.debug.setWavePending(0);
  poseLeaker(h);

  const opened = h.snapshot();
  assertEqual(
    opened.waveRemaining,
    1,
    "posing: the final wave has exactly one unit left, the one on the floor " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    opened.screen,
    "playing",
    "posing: the run is still being played (specs/screens.md)",
  );

  // Subscribed after the floor is posed, so what is read is the walk alone.
  const played = watchCues(h);

  const win = await h.until((s) => s.screen === "victory", {
    maxFrames: WIN_TICKS,
  });
  const frame = h.engine.frame().count;
  captureStill(h, "victory");

  assertEqual(
    win.hit,
    true,
    "clearing the final wave opened the victory screen inside " +
      `${String(WIN_TICKS)} frames (specs/waves.md, Victory and loss)`,
  );
  assertGreaterThan(
    win.snapshot.lives,
    0,
    "the lives left when the run was won, which is what makes it a victory " +
      "(specs/waves.md, Victory and loss)",
  );
  assertLength(
    playsOf(played, CUES.victory).filter((cue) => cue.frame < frame),
    0,
    "plays of the victory cue on any frame before the screen opened — a cue " +
      "is raised by the frame that resolves the event it answers " +
      "(specs/audio.md)",
  );
  assertLength(
    playedOn(played, frame).filter((name) => name === CUES.victory),
    1,
    "plays of the victory cue on the frame the victory screen opened, which " +
      "is its own frame and once on it (specs/audio.md)",
  );
  assertGreaterThan(
    playsOf(played, CUES.victory)[0].gain,
    0,
    "the gain the victory cue played at on an unmuted bus (specs/audio.md)",
  );
});
