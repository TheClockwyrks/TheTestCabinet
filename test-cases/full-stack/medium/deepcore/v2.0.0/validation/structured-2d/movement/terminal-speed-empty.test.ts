// movement/terminal-speed-empty — an empty fall caps at 950 units per second.
//
// `specs/character.md` fixes `FALL_TERMINAL_EMPTY` at `950` units per second and
// has the miner accelerate "downward at `GRAVITY` up to its terminal speed". An
// empty bay is the case its weight table opens at: the terminal speed rises with
// the load, and with no load it is `950`. So a fall of any length reaches `950`
// and goes no faster.
//
// TWO THINGS ARE READ, AND THEY ARE THE TWO HALVES OF A CAP. That the fall
// REACHES the speed, which a build with a lower cap fails; and that it never
// EXCEEDS it, which a build with no cap fails within a second and a half. The
// second is read across the whole fall rather than at its end, sampling as the
// drop runs, because a build that overshot and then clamped would look right
// afterwards.
//
// THE TOLERANCE. One percent of the stated speed. The cap is a clamp rather than
// an asymptote, so a conformant build sits on the figure exactly; the percent is
// there for a build that applies it a frame later than another, which is a
// difference of `GRAVITY / TICK_HZ` — about `12` units — at this frame rate.
//
// The bay is empty, the mine is open for the whole drop, no key is held and the
// drill is gated, so the load is `0` and nothing but gravity acts.

import { afterEach, beforeEach, it } from "vitest";
import { FALL_TERMINAL_EMPTY } from "../../src/constants";
import { assertBetween, assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  minerXOn,
  minerYOn,
  openScene,
  pinDrill,
  placeAt,
  TICK_HZ,
  type Harness,
} from "../harness";

const COL = 6;
/** The row the fall is let go from: high enough that the drop stays in open mine. */
const ROW = 3;

/** How long the fall runs, and how often it is sampled. */
const FALL_FRAMES = 3 * TICK_HZ;
const SAMPLE_EVERY = 20;

/** How far the measured cap may sit from the stated one. */
const TOLERANCE = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("caps an empty fall at 950 units per second", async () => {
  openScene(h);
  pinDrill(h);
  placeAt(h, minerXOn(COL), minerYOn(ROW));

  const settled = await captureReplay(h, "terminal", async () => {
    let fastest = 0;
    for (let frames = 0; frames < FALL_FRAMES; frames += SAMPLE_EVERY) {
      await h.advance(SAMPLE_EVERY);
      fastest = Math.max(fastest, h.snapshot().miner.vy);
    }
    return { fastest, snapshot: h.snapshot() };
  });

  assertEqual(
    settled.snapshot.miner.grounded,
    false,
    "the miner still in open space at the end of the drop",
  );
  assertEqual(
    settled.snapshot.cargo.loadKg,
    0,
    "the load the terminal speed is read at",
  );

  // It reached the cap ...
  assertBetween(
    settled.snapshot.miner.vy,
    FALL_TERMINAL_EMPTY * (1 - TOLERANCE),
    FALL_TERMINAL_EMPTY * (1 + TOLERANCE),
    "the downward speed after three seconds of fall",
  );
  // ... and never passed it, at any point of the drop.
  assertLessThanOrEqual(
    settled.fastest,
    FALL_TERMINAL_EMPTY * (1 + TOLERANCE),
    "the fastest the fall ever ran",
  );
});
