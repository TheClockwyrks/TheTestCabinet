// rocks/split-large — a Large destroyed leaves two Medium.
//
// `specs/rocks.md`, Splitting: "Destroying a rock produces the size below it", and
// the ladder beneath it gives `large` two `medium`. This item decides one rung of
// that ladder in one direction — the count of the size below rises by exactly two
// and the count of the destroyed size falls by exactly one — so a build that drops
// the Large without replacing it, one that leaves three pieces, and one that
// leaves the wrong size each fail here and nowhere else.
//
// BOTH COUNTS, BECAUSE EITHER ALONE PASSES A DIFFERENT WRONG BUILD. A build that
// spawns two medium and leaves the parent standing has the right number of
// Medium and has destroyed nothing; a build that removes the parent and
// spawns nothing has the right number of Larges and no ladder. The pair is read
// off the same two ticks, the one before the fatal round landed and the one it
// landed on, so nothing else can have entered the field between them.
//
// THE FIELD HOLDS THE PARENT AND NOTHING ELSE. `startPlaying` empties every roster
// and shuts both world gates, so the only rocks either count sees are the parent and
// what it left. It is posed at rest on the field's lower left, `412` units from the star, far
// enough out that the well moves it a fraction of a unit over the scenario, and the
// round is placed on its doorstep on the side facing away from the star so
// `specs/collision.md`'s absorption at the core cannot take it on the way in. Under
// `warhead` a Large carries `ROCK_HEALTH.large` hits and only the last of them
// splits it, which is why the kill is driven by rounds rather than by one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  rocksOfSize,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { QUIET_GROUND, killRock, poseRockAt } from "./scene";

/** How many of the size below `specs/rocks.md` says a destroyed rock leaves. */
const FRAGMENTS = 2;

/** Seconds of the pieces coming apart, filmed after the reading is taken. */
const AFTERMATH_TICKS = ticksFor(0.75);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves exactly two Medium and one fewer Large", async () => {
  await startPlaying(h);
  const parent = await poseRockAt(h, "large", QUIET_GROUND);

  const kill = await killRock(h, parent);

  await h.advance(AFTERMATH_TICKS);
  await captureStill(h, "split");

  assertEqual(
    rocksOfSize(kill.at, "medium").length -
      rocksOfSize(kill.before, "medium").length,
    FRAGMENTS,
    "Medium the field gained on the tick the Large came apart (specs/rocks.md)",
  );
  assertEqual(
    rocksOfSize(kill.at, "large").length -
      rocksOfSize(kill.before, "large").length,
    -1,
    "Larges the field lost on that same tick (specs/rocks.md)",
  );
});
