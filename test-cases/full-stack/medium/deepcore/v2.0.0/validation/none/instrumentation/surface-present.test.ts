// instrumentation/surface-present — the build installed a live debug surface.
//
// THREE THINGS, AND ALL OF THEM ARE THE BUILD'S. Under an engine the build hands
// its surface back from `initialize` and the engine holds it. Nothing holds it
// here: an engineless run is given no runtime at all, so the global it is
// installed on, every operation on it, and the version it reports are all
// deliverables of this point (`specs/instrumentation.md`: "the build installs the
// finished surface on `window.__deepcore` as soon as the game has initialized").
//
// The first is that it is THERE. A build that never installed the global leaves
// nothing for any check in this project to reach the game through, and every
// other automated point fails with it; this one names the fault plainly, which is
// why the harness reports it as `surfaceFault` rather than by throwing.
//
// The second is that every operation the specification names is on it, as a
// function, alongside the `version` the specification fixes at `1`.
//
// The third is that it is LIVE: a surface whose operations are all present and
// whose poses do nothing is present and useless. So a cell is posed and read
// back, the miner is moved and read back, and the frame the build draws is read
// where the specification says that cell is drawn — `specs/overview.md` requires
// that "an unmined tile is clearly distinct from a carved tunnel", so a posed
// solid cell and the open tunnel beside it are drawn differently, and posing the
// cell open again brings the two together.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertNotEqual,
} from "../assert";
import { DEEPCORE_DEBUG_VERSION } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  failSurface,
  HANDLE,
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

afterEach(async () => {
  await h.dispose();
});

it(`installs a whole, live surface on window.${HANDLE}`, async () => {
  // Named plainly rather than through a comparison, because the pair a reviewer
  // reads here is "what the specification requires" against "what was found".
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);

  const probed = await h.probe(REQUIRED_OPS);
  assertEqual(
    probed.version,
    DEEPCORE_DEBUG_VERSION,
    `window.${HANDLE}.version`,
  );
  for (const op of REQUIRED_OPS) {
    assertEqual(probed.ops[op], "function", `window.${HANDLE}.${op}`);
  }

  // A posed cell reads back as what it was posed to ...
  await openScene(h);
  await h.debug.setTile(COL, ROW, "rock");
  await h.debug.setTile(READ_COL, ROW, "rock");
  await standOn(h, COL, ROW);
  await pinDrill(h);
  assertEqual((await h.tileAt(READ_COL, ROW)).kind, "rock", "the posed cell");
  assertEqual(
    (await h.tileAt(READ_COL, ROW - 1)).kind,
    "tunnel",
    "the open cell beside it",
  );

  // ... a posed miner reads back where it was put ...
  const snapshot = await h.snapshot();
  assertEqual(snapshot.miner.x, minerXOn(COL), "the posed miner's x");
  assertEqual(snapshot.miner.y, minerYOn(ROW), "the posed miner's y");
  assertEqual(snapshot.screen, "in-mine", "the posed screen");

  // ... and the drawn frame shows them: the solid cell is drawn differently from
  // the open one beside it.
  await h.advance(2);
  const drawn = await h.snapshot();
  await captureStill(h, "state");
  const solid = await sampleCell(h, drawn, READ_COL, ROW);
  const open = await sampleCell(h, drawn, READ_COL, ROW - 1);
  const apart = colorDistance(solid, open);
  assertGreaterThan(apart, 0, "an unmined cell drawn apart from an open one");

  // And posing the cell open again changes the frame to match: what was drawn as
  // rock is now drawn as the tunnel it became.
  await h.debug.setTile(READ_COL, ROW, "tunnel");
  await h.advance(2);
  const after = await h.snapshot();
  const cleared = await sampleCell(h, after, READ_COL, ROW);
  const still = await sampleCell(h, after, READ_COL, ROW - 1);
  assertNotEqual(
    (await h.tileAt(READ_COL, ROW)).kind,
    "rock",
    "the cell after it was posed open",
  );
  assertLessThan(
    colorDistance(cleared, still),
    apart,
    "the cleared cell drawn nearer the open one than the rock was",
  );
});
