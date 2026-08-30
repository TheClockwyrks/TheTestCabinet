// movement/no-speedup-when-long — a long snake runs at the same fixed rate.
//
// specs/movement.md: "the rate is the same for the whole round whatever the score
// is and however long the snake has grown", and specs/scoring.md puts "any speed
// ramp or difficulty curve tied to the score or the snake's length" out of scope
// outright. This is the same eight ticks a second `constant-rate` reads, asked of
// a snake ten times the length a round opens at, because a build that recomputes
// its tick interval from the chain is a build a player cannot steer.
//
// THIRTY CELLS DO NOT FIT ACROSS THE INTERIOR, which is 28 cells wide, so the
// posed chain is the first thirty cells of the harness's boustrophedon walk over
// the interior, reversed so its head leads. That walk is contiguous and repeats
// no cell by construction, which is what specs/instrumentation.md requires of a
// chain, and its head comes out on the second row with a clear column beneath it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { TICKS_PER_SECOND } from "../constants";
import {
  ahead,
  captureReplay,
  createHarness,
  FRAME_HZ,
  poseScene,
  serpentine,
  type Harness,
} from "../harness";

/** The length the claim is worded in: ten times the three a round opens at. */
const LONG = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("advances eight cells in a second at thirty cells long", async () => {
  const chain = serpentine().slice(0, LONG).reverse();
  const head = chain[0];
  const posed = await poseScene(h, { snake: chain, dir: "down", pellet: null });
  assertLength(posed.snake, LONG, "the posed chain");
  assertDeepEqual(posed.snake[0], head, "the posed head");

  const after = await captureReplay(h, "speed", async () => {
    await h.advance(FRAME_HZ);
    return h.snapshot();
  });

  assertEqual(after.ticks, TICKS_PER_SECOND, "ticks in one second at thirty cells");
  assertDeepEqual(
    after.snake[0],
    ahead(head, "down", TICKS_PER_SECOND),
    "the head after one second at thirty cells",
  );
  assertLength(after.snake, LONG, "the chain's length over the second");
});
