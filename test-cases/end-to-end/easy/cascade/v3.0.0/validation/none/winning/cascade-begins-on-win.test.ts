// winning/cascade-begins-on-win — the first card launches on the cascade's first
// frame.
//
// `specs/victory.md`, The cascade: "The victory cascade begins with the win." And
// The launch clock: "The cascade keeps a launch clock, in seconds, which holds
// `LAUNCH_INTERVAL` (`0.18`) when the cascade begins, so the first card launches
// on the cascade's first frame."
//
// THE READING IS THE COUNT, ACROSS EXACTLY ONE FRAME. `launched` is `0` at the
// win, because no frame has run — the win is reached by a move and
// `specs/instrumentation.md` says the surface's operations take effect when they
// are called, not on a frame — and it is `1` once one frame has. Those two
// readings are the whole of the requirement, in one direction: a build that
// starts its clock at `0` reads `0` after the first frame and fails, a build that
// launches the first card AT the win reads `1` before the frame and `2` after it
// and fails, and a conformant build reads `0` then `1`.
//
// ONE FRAME IS 1/240 s HERE, which is far shorter than `LAUNCH_INTERVAL`, so the
// carry rule (`floor(t / LAUNCH_INTERVAL) + 1`) admits exactly one launch on it.
// That is why the count after the frame is asserted as `1` rather than as "at
// least one": a coarser step would let a conformant build launch several, and a
// finer reading than this would be measuring the suite's own clock. The CADENCE
// over many launches is `cascade/launch-cadence`'s, not this point's.
//
// THE WIN IS THE REAL ONE. `startCascade` puts fifty-one cards home and sends the
// last King to its foundation through a real `move()`, so the win test runs and
// the build's own cascade takes over. Nothing about the ending is posed.
//
// THE REPLAY KEEPS THE TRAIL PAINTING ON, per the plan's split: this capture is
// the cascade's first fifth of a second and cannot approach the recorder's
// budget, and the picture is worth more with the real trail in it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { LAUNCH_INTERVAL } from "../constants";
import {
  captureReplay,
  createHarness,
  framesFor,
  openTable,
  startCascade,
  type Harness,
} from "../harness";

/** The one frame the requirement is read across. */
const FIRST_FRAME = 1;

/**
 * How much cascade the replay records after that frame, in seconds.
 *
 * Evidence only, and driven AFTER the reading the assertions use. A fifth of a
 * second is two launches by `specs/victory.md`'s cadence — the ending visibly
 * beginning — and few enough painted frames to stay well inside the recorder's
 * capture budget.
 */
const TAIL_SECONDS = 0.2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("launches its first card on the cascade's first frame and not before", async () => {
  await openTable(h);
  await startCascade(h);

  // The instant of the win: the move that completed the board has been applied
  // and no frame has run since.
  const won = await h.snapshot();

  const first = await captureReplay(h, "first-frames", async () => {
    await h.advance(FIRST_FRAME);
    const state = await h.snapshot();
    await h.advance(framesFor(TAIL_SECONDS) - FIRST_FRAME);
    return state;
  });

  assertEqual(
    won.screen,
    "won",
    "the screen the completed board reached, which is where the cascade runs " +
      "(specs/screens.md)",
  );
  assertEqual(
    won.launched,
    0,
    "cards launched at the instant of the win, before any frame of the " +
      `cascade has run — specs/victory.md holds the launch clock at ` +
      `LAUNCH_INTERVAL (${LAUNCH_INTERVAL} s) when the cascade BEGINS, and the ` +
      "first card leaves on the first frame rather than on the win itself",
  );
  assertLength(won.flyers, 0, "cards in flight at the instant of the win");

  assertEqual(
    first.launched,
    1,
    "cards launched by the end of the cascade's first frame — " +
      "specs/victory.md: the clock holds LAUNCH_INTERVAL when the cascade " +
      "begins, so the first card launches on that frame. A reading of 0 is a " +
      "clock started empty; a reading of 2 is a card launched at the win as well",
  );
  assertLength(
    first.flyers,
    1,
    "cards in flight after the cascade's first frame — specs/victory.md: a " +
      "launched card leaves its foundation and becomes a card in flight, and " +
      "it takes no motion in the frame it launched in, so it cannot have retired",
  );
});
