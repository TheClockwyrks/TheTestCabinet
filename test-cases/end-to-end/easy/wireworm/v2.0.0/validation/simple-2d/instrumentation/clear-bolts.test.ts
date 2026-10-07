// Wireworm — instrumentation/clear-bolts: `clearBolts()` empties the bolts in flight, and nothing else.
//
// specs/instrumentation.md: "clearBolts() removes every bolt in flight."
//
// WHY EACH OF THE FOUR IS ITS OWN POINT. The four rosters are what a check poses
// a world out of, and `startPlaying` in `harness.ts` opens every scenario in this
// project by emptying all four. A clear that took a neighbour's roster with it, or
// that left its own standing, would quietly rewrite every scenario built on it —
// so each is decided on its own, and a failing grade names the roster the build
// got wrong rather than "the clears".
//
// THE BOARD IS POSED WITH ALL FOUR ROSTERS CARRYING SOMETHING, and every entity on
// it is posed quiet: the worm's step is gated off and the foe's two faculties are
// gated off, so nothing moves between the pose and the reading and the survivors
// are the entities that were posed rather than whatever the board drifted into.
// No frame runs before the clear either, so the only thing that happened to the
// board is the one operation this point is about.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNull,
} from "../assert";
import {
  boltOf,
  captureStill,
  createHarness,
  poseBolt,
  poseField,
  poseFoe,
  poseWorm,
  startPlaying,
  type Harness,
} from "../harness";

/** The field posed: eight nodes over two rows, at every charge specs/nodes.md names. */
const FIELD_ROWS = ["0123", "3210"];
const FIELD_C = 4;
const FIELD_R = 8;

/** The one worm posed, three segments long on a clear row of its own. */
const WORM_C = 14;
const WORM_R = 4;
const WORM_LENGTH = 3;

/** The one foe posed. */
const FOE_C = 24;
const FOE_R = 6;

/** The one bolt posed, in a column nothing else stands in. */
const BOLT_C = 34;
const BOLT_R = 19;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes every bolt in flight and leaves the nodes, worms and foes standing", async () => {
  startPlaying(h);

  poseField(h, FIELD_ROWS, FIELD_C, FIELD_R);
  const wormId = poseWorm(h, WORM_C, WORM_R, WORM_LENGTH);
  h.debug.setWormStepping(wormId, false);
  const foeId = poseFoe(h, "glitch", FOE_C, FOE_R);
  h.debug.setFoeMind(foeId, false);
  h.debug.setFoeTravel(foeId, false);
  const boltId = poseBolt(h, BOLT_C, BOLT_R);

  const before = h.snapshot();
  assertLength(
    before.nodes,
    FIELD_ROWS.length * FIELD_ROWS[0].length,
    "the field the scenario posed",
  );

  h.debug.clearBolts();
  const after = h.snapshot();

  // The board with the bolts in flight alone removed.
  await h.advance(1);
  captureStill(h, "cleared");

  assertLength(after.bolts, 0, "clearBolts removes every bolt in flight");
  assertNull(
    boltOf(after, boltId),
    "the bolt the scenario posed is the one that was removed",
  );

  assertDeepEqual(
    after.nodes,
    before.nodes,
    "every node stands, at the charge it held",
  );

  assertLength(after.worms, 1, "the worm stands");
  assertEqual(
    after.worms[0]?.id,
    wormId,
    "the worm that stands is the one posed",
  );
  assertDeepEqual(
    after.worms[0]?.segments,
    before.worms[0]?.segments,
    "the worm stands on the tiles it was posed on",
  );

  assertLength(after.foes, 1, "the foe stands");
  assertEqual(after.foes[0]?.id, foeId, "the foe that stands is the one posed");
});
