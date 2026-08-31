// Floe — audio/cue-game-over: the death that empties the lives plays the game-over
// sting, and the same death with lives left over plays none.
//
// The cue is read BY NAME off the engine's bus; see audio/cue-hop for the reading
// every check in this directory rests on. Every death already plays its own cue —
// the death driven here is a fall into open water, which `specs/ui.md` gives
// `splash` — so the death that ends the run lawfully plays two cues and only the
// NAME separates the sting from the splash beneath it.
//
// THE SURVIVED DEATH IS THE CONTROL. The check drives the SAME death twice on one
// strait — the critter dropped onto open water, which `specs/water.md` costs a
// life for on the tick its footing is `water` — with only `lives` posed
// differently between them. `specs/instrumentation.md` makes `setLives` a
// precondition that "ends no run, so `setLives(0)` leaves the game playing and the
// next death ends it", so posing it to `1` is the whole of the difference, and a
// build that plays the sting on every death is heard on the first one.
//
// AND THE WINDOW COVERS THE WHOLE OF THE ENDING. `specs/progression.md` runs
// `DEATH_PAUSE` (`0.9` s) after a life is lost and only then decides whether the
// run continues or the screen becomes `gameover`, so each window runs the death
// tick AND the hold out. A build that plays the sting on the death and one that
// plays it when the screen turns are both inside it, and neither reading is forced
// on a build: `specs/ui.md` says only "the death that empties the lives". The two
// windows are the same length, so neither can accrue a cue the other had no time
// for.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { CUES, DEATH_PAUSE, START_COL, START_LIVES } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  watchCues,
  type Harness,
  type TimedCue,
} from "../harness";

/**
 * The row the critter is dropped onto: a row of the water band, which this
 * strait leaves without a single floe, so its footing there is `water`
 * (`specs/strait.md`) and `specs/water.md` costs the life on that tick.
 */
const FALL_ROW = 5;

/**
 * How long each death is watched for, in whole ticks.
 *
 * The death tick, then `DEATH_PAUSE` (`0.9` s) out with a quarter second to
 * spare, so the window closes after `specs/progression.md` has decided what the
 * expiring hold leads to — a fresh crossing in the first death's case, the
 * `gameover` screen in the second's.
 */
const WINDOW_TICKS = ticksFor(DEATH_PAUSE + 0.25);

/** How many times `cue` sounded in `played`, from index `from` on. */
function sounded(
  played: readonly TimedCue[],
  from: number,
  cue: string,
): number {
  return played.slice(from).filter((entry) => entry.cue === cue).length;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the game-over sting on the death that empties the lives, and not on a death with lives left", async () => {
  // An empty strait: no floe anywhere, so every tile of the water band is open
  // water, and no vehicle, bear or timer can take either life instead.
  startCrossing(h);

  const played = watchCues(h);

  // THE CONTROL, driven outside the capture: the same death with lives to spare.
  h.debug.setCritterTile(START_COL, FALL_ROW);
  const beforeSurvived = played.length;
  await h.advance(WINDOW_TICKS);
  const survived = sounded(played, beforeSurvived, CUES.gameOver);
  const continuing = h.snapshot();

  // THE ENDING. One life left, and the same fall.
  const measured = await captureReplay(h, "gameover", async () => {
    h.debug.setLives(1);
    h.debug.setCritterTile(START_COL, FALL_ROW);
    const posed = h.snapshot();

    const beforeEnding = played.length;
    await h.advance(WINDOW_TICKS);
    const ending = played
      .slice(beforeEnding)
      .filter((entry) => entry.cue === CUES.gameOver);
    const over = h.snapshot();

    return { posed, ending, over };
  });

  // The control really was a death, and really left the run going.
  assertEqual(
    continuing.lives,
    START_LIVES - 1,
    "the control fall cost a life",
  );
  assertEqual(
    continuing.screen,
    "playing",
    "lives were left, so the run carried on",
  );
  assertEqual(
    survived,
    0,
    "no game-over sting on the death that left lives on the board",
  );

  // The second fall really was taken with one life on the board.
  assertEqual(measured.posed.lives, 1, "one life stood on the board");
  assertEqual(
    measured.posed.critter.footing,
    "water",
    "the posed tile is open water",
  );

  // And it really did end the run (specs/progression.md).
  assertEqual(measured.over.lives, 0, "the fall emptied the lives");
  assertEqual(measured.over.screen, "gameover", "the run ended");

  assertLength(
    measured.ending,
    1,
    "game-over stings played on the death that emptied the lives",
  );
});
