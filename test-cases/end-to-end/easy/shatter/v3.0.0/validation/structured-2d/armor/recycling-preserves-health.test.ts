// armor/recycling-preserves-health — the star gives a rock back with its damage.
//
// `specs/rocks.md`, Star recycling: "A rock the star swallows is the same rock
// relocated, not a fresh one", and, under `warhead`, "A recycled rock carries
// exactly the health it had when the star took it... Its speed is reset and its
// health is not." This item decides the HEALTH half of that in one direction: a
// Large posed at `1` and slung into the core re-enters still reporting `1`.
//
// WHY IT IS A POINT OF ITS OWN. A build that re-places a rock by constructing a
// fresh one of the same size gets everything else about recycling right — the count
// holds, the size holds, the entry is from an edge, the drift speed is fresh — and
// silently repairs every damaged rock the star touches. Nothing else in this case
// reads the health across a recycle, and a player who has spent two rounds on a
// Large watches them come back.
//
// POSED AT `1`, THE FURTHEST VALUE FROM FULL. `setRockHealth` takes "a whole number
// from `1` to the full health of its size" (`specs/instrumentation.md`), so `1` is
// the lowest legal pose and sits two hits below a Large's `ROCK_HEALTH.large` (`3`).
// A build that resets health on recycling therefore reads `3` against an expected
// `1` — the two models differ by the widest margin the size allows, so the failure
// names which one the build implemented. The health is POSED rather than shot off
// so this item fails apart from `armor/health-falls-by-one`, which grades the
// arithmetic of a hit.
//
// THE POSE IS READ BACK ON THE WAY IN, on the last tick before the re-placement, so
// a build whose `setRockHealth` never took hold fails naming the pose rather than
// passing this vacuously — and a build that damages a rock while it falls is caught
// there too.
//
// THE RECYCLE IS FOUND AS A DISCONTINUITY, not as the rock reading far from the
// star: a build that never recycles at all sends its rock straight through the core
// and out the far side, where it reads exactly as far out as a re-placed one. See
// `slingIntoTheStar`.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_HEALTH } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  dropOntoTheStar,
  healthOf,
  poseHealth,
  slingIntoTheStar,
  theOneRock,
} from "./scene";

/**
 * The health the Large is chipped to before it is slung in: the lowest value
 * `setRockHealth` accepts, and two hits below its size's full `ROCK_HEALTH.large`.
 */
const CHIPPED = 1;

/** A Large's full health, which a build that re-places a fresh rock would report. */
const FULL = ROCK_HEALTH.large;

/** Seconds of the recycled rock coming back in, filmed after the reading. */
const AFTERMATH_TICKS = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("re-enters carrying the health it was taken with", async () => {
  startPlaying(h);
  const rock = dropOntoTheStar(h, "large");
  poseHealth(h, rock, CHIPPED);

  const recycle = await slingIntoTheStar(h);

  assertEqual(
    healthOf(
      theOneRock(recycle.before, "the Large on its way into the core"),
      "the Large on its way into the core",
    ),
    CHIPPED,
    "the health the Large carried into the star, which the scenario posed " +
      `at ${CHIPPED} of its ROCK_HEALTH.large (${FULL}) ` +
      "(specs/instrumentation.md)",
  );

  const back = theOneRock(recycle.at, "the Large the star gave back");

  await h.advance(AFTERMATH_TICKS);
  captureStill(h, "recycle");

  assertEqual(
    healthOf(back, "the recycled Large"),
    CHIPPED,
    "the health of the rock the star gave back: specs/rocks.md makes it the " +
      "same rock relocated, carrying exactly the health it had when the star " +
      `took it — a build that re-places a fresh rock reports ${FULL}`,
  );
});
