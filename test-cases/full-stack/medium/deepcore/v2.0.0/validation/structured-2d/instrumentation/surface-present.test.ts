// instrumentation/surface-present — the build returned a live debug surface.
//
// THREE THINGS, AND ALL OF THEM ARE THE BUILD'S. `specs/instrumentation.md`: "the
// game instance's `initialize` returns the finished surface. The engine holds it
// and returns it from `engine.debug`, and it is reached that way alone: nothing is
// installed on the page."
//
// The first is that it is THERE. A build whose `initialize` returned nothing
// leaves `engine.debug` with nothing to hand over, and every other automated point
// in this project fails with it; this one names the fault plainly, which is why
// the harness stands a failing proxy in its place rather than throwing out of the
// `beforeEach`.
//
// The second is that every operation the specification names is on it, as a
// function, alongside the `version` the specification fixes at `1`. The clock,
// the keyboard and the mute bit are the engine's under this engine, so the
// surface carries no operation for any of them and none is demanded here.
//
// The third is that it is LIVE: a surface whose operations are all present and
// whose poses do nothing is present and useless. So a cell is posed and read
// back, the miner is moved and read back, and the frame the build draws is read
// where the specification says that cell is drawn — `specs/overview.md` requires
// that an unmined tile is clearly distinct from a carved tunnel, so a posed solid
// cell and the open tunnel beside it are drawn differently, and posing the cell
// open again brings the two together.

import { afterEach, beforeEach, it } from "vitest";
import { DEEPCORE_DEBUG_VERSION } from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertNotEqual,
  assertNotNull,
} from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  minerXOn,
  minerYOn,
  openScene,
  pinDrill,
  REQUIRED_OPS,
  sampleCell,
  standOn,
  type Harness,
} from "../harness";

/** Where the miner stands, and the cell the drawn frame is read at. */
const COL = 8;
const ROW = 12;
const READ_COL = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns a whole, live surface from the game instance's initialize", async () => {
  // `engine.debug` is whatever the build's `initialize` returned, so reading it is
  // the check: there is no page property to look for and nothing the harness could
  // have supplied in the build's place.
  assertNotNull(h.engine.debug, "the surface engine.debug holds");
  assertEqual(typeof h.engine.debug, "object", "what engine.debug holds");

  const probed = h.probe(REQUIRED_OPS);
  assertEqual(probed.version, DEEPCORE_DEBUG_VERSION, "the surface's version");
  for (const op of REQUIRED_OPS) {
    assertEqual(probed.ops[op], "function", `the surface's ${op}`);
  }

  // A posed cell reads back as what it was posed to ...
  openScene(h);
  h.debug.setTile(COL, ROW, "rock");
  h.debug.setTile(READ_COL, ROW, "rock");
  standOn(h, COL, ROW);
  pinDrill(h);
  assertEqual(h.tileAt(READ_COL, ROW).kind, "rock", "the posed cell");
  assertEqual(
    h.tileAt(READ_COL, ROW - 1).kind,
    "tunnel",
    "the open cell beside it",
  );

  // ... a posed miner reads back where it was put ...
  const snapshot = h.snapshot();
  assertEqual(snapshot.miner.x, minerXOn(COL), "the posed miner's x");
  assertEqual(snapshot.miner.y, minerYOn(ROW), "the posed miner's y");
  assertEqual(snapshot.screen, "in-mine", "the posed screen");

  // ... and the drawn frame shows them: the solid cell is drawn differently from
  // the open one beside it.
  await h.advance(2);
  const drawn = h.snapshot();
  captureStill(h, "state");
  const solid = sampleCell(h, drawn, READ_COL, ROW);
  const open = sampleCell(h, drawn, READ_COL, ROW - 1);
  const apart = colorDistance(solid, open);
  assertGreaterThan(apart, 0, "an unmined cell drawn apart from an open one");

  // And posing the cell open again changes the frame to match: what was drawn as
  // rock is now drawn as the tunnel it became.
  h.debug.setTile(READ_COL, ROW, "tunnel");
  await h.advance(2);
  const after = h.snapshot();
  const cleared = sampleCell(h, after, READ_COL, ROW);
  const still = sampleCell(h, after, READ_COL, ROW - 1);
  assertNotEqual(
    h.tileAt(READ_COL, ROW).kind,
    "rock",
    "the cell after it was posed open",
  );
  assertLessThan(
    colorDistance(cleared, still),
    apart,
    "the cleared cell drawn nearer the open one than the rock was",
  );
});
