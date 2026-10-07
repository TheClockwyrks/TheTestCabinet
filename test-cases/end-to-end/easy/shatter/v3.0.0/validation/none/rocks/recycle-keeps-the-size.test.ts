// rocks/recycle-keeps-the-size — the rock comes back the size it went in.
//
// `specs/rocks.md`, Star recycling: "A rock the star swallows is the same rock
// relocated, not a fresh one... the rock is taken from the core and immediately
// re-placed AT THE SAME SIZE." This item decides the size alone: where it comes
// back is `recycle-re-enters-from-off-screen`'s item, how fast is
// `recycle-resets-speed`'s, and that it comes back at all is
// `recycle-keeps-the-count`'s.
//
// A MEDIUM IS WHAT IS SLUNG, NOT A LARGE. `specs/progression.md` fills a wave with
// Large rocks and `addRock`'s own examples lead with one, so a build that re-places
// every recycled rock as a Large — or that spawns a fresh wave rock in its place —
// passes a check posed with a Large and fails this one. The size below the top of
// the ladder is the one that tells those builds apart.
//
// THE FIELD HOLDS ONE ROCK AND NOTHING ELSE. `startPlaying` empties every roster
// and shuts both world gates, so the rock the check reads back can only be the one
// it placed. The rock is dropped from straight above the star's centre so the well's
// pull is exactly along its fall, and the recycle is found as a move of more than
// `200` units inside one tick, which nothing drifting can produce.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import type { RockSize } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  FALL_FROM,
  FALL_SPEED,
  poseRockAt,
  slingIntoTheStar,
  theOneRock,
} from "./scene";

/** The size slung into the star, and the size it must come back at. */
const SIZE: RockSize = "medium";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns a Medium as a Medium", async () => {
  await startPlaying(h);
  await poseRockAt(h, SIZE, FALL_FROM, { x: 0, y: FALL_SPEED });

  const recycle = await slingIntoTheStar(h);
  await captureStill(h, "recycle");

  assertEqual(
    theOneRock(recycle.before, "the rock the star took").size,
    SIZE,
    "the size of the rock that reached the core (specs/instrumentation.md)",
  );
  assertEqual(
    theOneRock(recycle.at, "the recycled rock").size,
    SIZE,
    "the size the star re-placed it at (specs/rocks.md)",
  );
});
