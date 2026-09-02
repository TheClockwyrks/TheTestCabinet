// Meltdown — audio/game-over-cue: reaching the game-over screen plays the
// `game-over` cue on the frame it opens.
//
// `specs/audio.md` binds `game-over` to "the game-over screen opens" and fixes the
// frame: a cue "is raised by the frame that resolves the event it answers".
// `specs/waves.md` fixes the event — "lives reaching `0` ends the run at once, on
// the frame it happens and whatever the phase", and the game-over screen is what
// that frame opens.
//
// THE LOSS IS THE RUN'S OWN. `setScreen` sets that field alone and runs no entry
// effect, and `setLives` "triggers no game over: this is a precondition"
// (`specs/instrumentation.md`). So the lives are posed at one and a real leak is
// what takes them to zero: the Mote's leak value is `1` (`specs/surge.md`), so the
// unit walking into its exhaust is exactly the life the run had left.
//
// THE PHASE IS THE BUILD PHASE, deliberately. The loss lands "whatever the phase"
// (`specs/waves.md`), and a build phase carries no wave to clear, so the frame this
// point reads carries the loss and nothing else that a wave-clear or a victory
// could be confused with. The `leak` cue sounds on the same frame, and this point
// says nothing about it.

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
 * The lives the run is posed on: the one a single Mote's leak takes away.
 *
 * `specs/surge.md` prices a Mote's leak at `1` life, so this is the smallest pose
 * that makes the walk below the leak that ends the run.
 */
const POSED_LIVES = 1;

/**
 * How long the unit is given to walk into the exhaust and end the run.
 *
 * It is posed one orthogonal step out, `TILE` (`19`) logical units
 * (`specs/floor.md`), and a Mote's base speed is `60` units a second
 * (`specs/surge.md`), so a conforming build loses about `0.32` seconds in. Two
 * seconds is a hard ceiling six times that.
 */
const LOSS_TICKS = ticksFor(2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the game-over cue on the frame the game-over screen opens", async () => {
  startRun(h);
  h.debug.setLives(POSED_LIVES);
  poseLeaker(h);

  const opened = h.snapshot();
  assertEqual(
    opened.lives,
    POSED_LIVES,
    "posing: setLives triggers no game over, so the run opens this drive with " +
      "one life still in hand (specs/instrumentation.md)",
  );
  assertEqual(
    opened.screen,
    "playing",
    "posing: the run is still being played (specs/screens.md)",
  );

  // Subscribed after the floor is posed, so what is read is the walk alone.
  const played = watchCues(h);

  const loss = await h.until((s) => s.screen === "gameover", {
    maxFrames: LOSS_TICKS,
  });
  const frame = h.engine.frame().count;
  captureStill(h, "gameover");

  assertEqual(
    loss.hit,
    true,
    "the leak took the lives to 0 and opened the game-over screen inside " +
      `${String(LOSS_TICKS)} frames (specs/waves.md, Victory and loss)`,
  );
  assertEqual(
    loss.snapshot.lives,
    0,
    "the lives left when the run ended (specs/waves.md, Victory and loss)",
  );
  assertLength(
    playsOf(played, CUES.gameOver).filter((cue) => cue.frame < frame),
    0,
    "plays of the game-over cue on any frame before the screen opened — a cue " +
      "is raised by the frame that resolves the event it answers " +
      "(specs/audio.md)",
  );
  assertLength(
    playedOn(played, frame).filter((name) => name === CUES.gameOver),
    1,
    "plays of the game-over cue on the frame the game-over screen opened, " +
      "which is its own frame and once on it (specs/audio.md)",
  );
  assertGreaterThan(
    playsOf(played, CUES.gameOver)[0].gain,
    0,
    "the gain the game-over cue played at on an unmuted bus (specs/audio.md)",
  );
});
