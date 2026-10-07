// Floe — audio/cue-game-over: the death that empties the lives sounds more than
// the same death with lives left over.
//
// Cue NAMES are not observable outside an engineless build; see audio/cue-hop for
// the doctrine every check here rests on. Every death already carries its own cue
// — this one is a fall into open water, which `specs/ui.md` gives `splash` — so
// the death that ends the run lawfully carries two cues and presence alone cannot
// tell it from any other death.
//
// WHAT CAN. Each cue is one defined sound, emitting the same number of sources
// every time it plays, so the death that empties the lives emits strictly MORE
// than the identical death that does not. The check drives the SAME death twice
// on one strait — the critter dropped onto open water, which `specs/water.md`
// costs a life for on the tick its footing is `water` — with only `lives` posed
// differently between them. `specs/instrumentation.md` makes `setLives` a
// precondition that "ends no run", so posing it to `1` is the whole of the
// difference.
//
// AND THE WINDOW COVERS THE WHOLE OF THE ENDING. `specs/progression.md` runs
// `DEATH_PAUSE` (`0.9` s) after a life is lost and only then decides whether the
// run continues or the screen becomes `gameover`, so each window runs the death
// tick AND the hold out. A build that sounds the sting on the death and one that
// sounds it when the screen turns are both inside it, and neither reading is
// forced on a build: `specs/ui.md` says only "the death that empties the lives".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { DEATH_PAUSE, START_COL, START_LIVES } from "../constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  ticksPast,
  watchCues,
  type Harness,
} from "../harness";

/**
 * The row the critter is dropped onto: a row of the water band, which this
 * strait leaves without a single floe, so its footing there is `water`
 * (`specs/strait.md`) and `specs/water.md` costs the life on the next tick.
 */
const FALL_ROW = 5;

/**
 * How long each death is watched for, in whole ticks.
 *
 * The death tick, then `DEATH_PAUSE` (`0.9` s) out with a quarter second to
 * spare, so the window closes after `specs/progression.md` has decided what the
 * expiring hold leads to — a fresh crossing in the first death's case, the
 * `gameover` screen in the second's. The two windows are the same length, so
 * neither can accrue sound the other had no time for.
 */
const WINDOW_TICKS = ticksPast(DEATH_PAUSE) + ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds more on the death that empties the lives than on a death with lives left", async () => {
  // An empty strait: no floe anywhere, so every tile of the water band is open
  // water, and no vehicle, bear or timer can take either life instead.
  await startCrossing(h);
  await h.armAudio();

  const played = watchCues(h);

  // THE CONTROL, driven outside the capture: the same death with lives to spare.
  await h.debug.setCritterTile(START_COL, FALL_ROW);
  const beforeSurvived = played.length;
  await h.advance(WINDOW_TICKS);
  const survived = played.length - beforeSurvived;
  const continuing = await h.snapshot();

  // THE ENDING. One life left, and the same fall.
  const measured = await captureReplay(h, "gameover", async () => {
    await h.debug.setLives(1);
    await h.debug.setCritterTile(START_COL, FALL_ROW);
    const posed = await h.snapshot();

    const beforeEnding = played.length;
    await h.advance(WINDOW_TICKS);
    const ending = played.length - beforeEnding;
    const over = await h.snapshot();

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

  assertGreaterThan(
    measured.ending,
    survived,
    `the death that empties the lives plays its sting on top of the death's ` +
      `own cue (${survived} sound(s) on the death that left lives)`,
  );
});
