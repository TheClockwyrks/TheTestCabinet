// instrumentation/set-score-grants-no-life — `setScore` grants no extra ship,
// whatever multiple of `EXTRA_LIFE_STEP` it carries the score across.
//
// WHY THE SURFACE DRAWS THIS LINE AT ALL. `specs/scoring.md` grants one extra ship
// "each time the score crosses a multiple of `EXTRA_LIFE_STEP` (`10 000`) THROUGH
// PLAY", and `specs/instrumentation.md` says outright that "`setScore` grants no
// extra ship, whatever multiple of `EXTRA_LIFE_STEP` it carries the score across".
// The two together fix where the award lives: on the scoring path a destruction
// runs down, and nowhere else. A pose is a PRECONDITION — it says what the run had
// scored before the scenario started — and a pose that paid out would hand a free
// ship to every check in this project that opens on a score.
//
// THE THREE POSES ARE THE THREE WAYS A BUILD GETS IT WRONG.
//
//   1. A pose that STOPS SHORT of a boundary must pay nothing, which is the leg a
//      build with no award logic at all passes trivially and which is here so the
//      two below are read against a known-good baseline.
//   2. A pose that CROSSES ONE boundary must pay nothing: the fault is a build that
//      routes `setScore` through the same "did we just cross a multiple?" test its
//      destructions use.
//   3. A pose that CROSSES SEVERAL at once must pay nothing either. `setScore` is
//      the only way a score moves by three multiples in one step, so a build that
//      pays per multiple crossed — which `specs/scoring.md` requires of the PLAY
//      path — is caught paying three ships here, and reads as a different number
//      from the build that paid one.
//
// AND THE READING IS TAKEN TWICE. Once with no tick between the pose and the read,
// which catches a build whose `setScore` awards on the spot, and once a frame
// later, which catches a build that defers the award to its own `update` by
// comparing the score it now holds against a high-water mark it kept. Nothing else
// is on the field, so nothing but the pose can move the ship count.

import { afterEach, beforeEach, it } from "vitest";
import { EXTRA_LIFE_STEP, START_LIVES } from "../constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * The scores posed, in order, each read at once and again a frame later.
 *
 * Every figure is derived from `EXTRA_LIFE_STEP`: just under the first boundary,
 * just over it, and past the third of them. The last is what tells a build that
 * pays per multiple crossed apart from one that pays once.
 */
const POSES = [
  { score: EXTRA_LIFE_STEP - 10, crossed: 0 },
  { score: EXTRA_LIFE_STEP + 10, crossed: 1 },
  { score: EXTRA_LIFE_STEP * 3 + 10, crossed: 3 },
] as const;

/** The game time a posed score is left to stand before it is read again. */
const SETTLE_FRAMES = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the ship count exactly as it was, across any boundary", async () => {
  // An empty, quiet field: nothing can be destroyed, so nothing can score, so
  // the ONLY thing that moves the score in this check is the pose itself.
  startPlaying(h);
  assertEqual(
    h.snapshot().lives,
    START_LIVES,
    "the ships a new run opens with",
  );
  assertEqual(h.snapshot().score, 0, "the score a new run opens with");

  for (const pose of POSES) {
    h.debug.setScore(pose.score);

    // At once: the state the pose returned, with no tick in between.
    const posed = h.snapshot();
    assertEqual(posed.score, pose.score, `setScore(${pose.score}) reads back`);
    assertEqual(
      posed.lives,
      START_LIVES,
      `the ships after a pose across ${pose.crossed} x EXTRA_LIFE_STEP`,
    );

    // And half a second later, which catches a build that defers the award to
    // its own update by watching the score for a boundary.
    await h.advance(SETTLE_FRAMES);
    const settled = h.snapshot();
    assertEqual(
      settled.score,
      pose.score,
      `the posed score still stands at ${pose.score}`,
    );
    assertEqual(
      settled.lives,
      START_LIVES,
      `the ships half a second after a pose across ${pose.crossed} x EXTRA_LIFE_STEP`,
    );
  }

  captureStill(h, "posed");

  // And the pose spawned nothing and cleared nothing while it was about it.
  const end = h.snapshot();
  assertLength(end.rocks, 0, "the rock roster a posed score left");
  assertEqual(end.screen, "playing", "the screen a posed score left");
});
