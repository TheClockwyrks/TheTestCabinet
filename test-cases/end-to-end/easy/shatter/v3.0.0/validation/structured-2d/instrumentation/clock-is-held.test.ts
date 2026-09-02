// instrumentation/clock-is-held — nothing advances unless a step asks it to.
//
// THE RULE. `specs/simulation.md`: "The simulation advances in whole ticks and
// never in a partial one", and under this engine "the delta a frame brings is
// converted into whole ticks with the remainder carried into the next frame".
// `specs/instrumentation.md` rests the whole surface on that: "Game state
// advances from the elapsed time the game is handed, independent of a canvas, of
// the frame loop that measured it, and of wall-clock time."
//
// TWO LEGS, BECAUSE THE ITEM'S CLAIM SPLITS IN TWO UNDER THIS ENGINE.
//
// NO FRAME, NO GAME. `engine.advance(0)` runs no frame at all, so the game is
// handed no elapsed time and every reading must stand exactly as it was posed —
// `simTime` included. A build that ran a tick on entry to a frame, or that
// stepped from the wall clock behind the engine's back, moves something here.
//
// A FRAME SHORTER THAN A TICK IS NOT A TICK. This is where the item's "a build
// whose accumulator forces a minimum step" actually lives on an engine that owns
// the frame loop: the engine hands the game whatever the clock measured, and a
// frame of `4` milliseconds is `0.48` of Shatter's own `TICK_DT`. Two such
// frames are `8` milliseconds — still short of the `8.333` one tick is worth —
// so the game must have run NOTHING, and every body must stand where it was
// posed. The third frame carries the accumulator past a whole tick, and exactly
// one tick must then run: not two, and not the 1.44 the elapsed time would be
// worth if the game stepped in partial ticks.
//
// THE FIELD IS FULL ON PURPOSE. A held clock over an empty field is a claim about
// one number. Every kind of body the game moves is on the field, at rest and
// clear of everything else, so "nothing advanced" is read over the ship, both
// bullet rosters, three rocks and the saucer at once — and a build that advances
// one roster off a clock of its own is caught by the roster it advanced.

import { ConstantClock } from "@test-cabinet/structured-2d";
import { afterEach, beforeEach, it } from "vitest";
import { TICK_DT } from "../constants";
import { assertDeepEqual, assertLessThanOrEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { posePopulatedField } from "./scene";

/** How many times the held clock is asked for nothing. */
const EMPTY_ADVANCES = 3;

/**
 * A frame shorter than one of Shatter's own ticks, in milliseconds.
 *
 * `4` milliseconds is `0.48` of `TICK_DT` (`8.333` ms), so two frames of it are
 * `8` — still short of a whole tick, with `4` percent of a tick to spare — and
 * three are `12`, which is one whole tick with a remainder carried.
 */
const SHORT_MS = 4;

/** How many short frames still amount to less than one tick. */
const FRAMES_UNDER_A_TICK = 2;

/**
 * How far the tick the third short frame runs may sit from exactly one
 * `TICK_DT`, in seconds.
 *
 * Half a tick, which is what pins the count to one: a build advancing in whole
 * ticks reports a whole multiple of `TICK_DT`, so anything within half a tick of
 * one tick IS one tick, and two ticks or none is outside.
 */
const ONE_TICK_TOLERANCE = TICK_DT / 2;

/** Every harness an `it` built for itself, disposed whatever its verdict. */
let built: Harness[] = [];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
  for (const harness of built) harness.dispose();
  built = [];
});

it("advancing no frames advances nothing on a fully posed field", async () => {
  posePopulatedField(h);
  // One frame, so there is a drawn picture to keep and the reading below is of
  // a game that has genuinely run rather than of one that never started.
  await h.advance(1);

  const before = h.snapshot();
  for (let i = 0; i < EMPTY_ADVANCES; i += 1) await h.advance(0);
  const after = h.snapshot();

  // The field held exactly as it was posed.
  captureStill(h, "held");

  assertDeepEqual(
    after,
    before,
    `${EMPTY_ADVANCES} advances of no frames leave every reported field, ` +
      "simTime included, exactly as it stood",
  );
});

it("a frame shorter than a tick runs no tick, and the tick lands when it is whole", async () => {
  const slow = await createHarness({ clock: new ConstantClock(SHORT_MS) });
  built.push(slow);

  posePopulatedField(slow);
  const before = slow.snapshot();

  // Two frames of 4 ms: 8 ms of elapsed time, short of the 8.333 one tick is
  // worth, so the accumulator holds a remainder and the game has run nothing.
  await slow.advance(FRAMES_UNDER_A_TICK);
  assertDeepEqual(
    slow.snapshot(),
    before,
    `${FRAMES_UNDER_A_TICK} frames of ${SHORT_MS} ms are less than one tick, ` +
      "so nothing has advanced (specs/simulation.md)",
  );

  // The third carries it past a whole tick, and exactly one tick runs.
  await slow.advance(1);
  assertLessThanOrEqual(
    Math.abs(slow.snapshot().simTime - before.simTime - TICK_DT),
    ONE_TICK_TOLERANCE,
    "the frame that carries the accumulator past a whole tick runs one tick",
  );
});
