// instrumentation/set-world-size-shallower-drops-the-nodes — a material node the
// shrink puts outside the mine goes with its row.
//
// `specs/instrumentation.md`, Resizing the mine, on a buried material node:
// "Kept with its cell where it is above the new Core chamber, and gone with its
// row where it is not."
//
// WHY THIS IS ITS OWN POINT. The nodes are the mine's second structure, parallel
// to the grid, and `specs/mining.md` makes them the scanner's whole subject: the
// scanner "locates the two buried material nodes" and locks on while its target
// is in range. A build that drops the rows and keeps the node list has a scanner
// pointing the miner at a cell the mine no longer holds, which reads as a route
// down to nothing. Dropping the ROWS is a separate point and passes for such a
// build, so this one reads the scanner rather than the grid.
//
// The node is posed just past the new Core chamber and the miner just above it,
// so the lock is inside the scanner's range before the shrink and the reading
// afterwards is about the node being gone rather than about it being far away.
//
// ISOLATION. An empty mine holding one material node, the scanner at its top
// tier, and both faculties gated so the miner holds the depth it was put at and
// cuts nothing.

import { afterEach, beforeEach, it } from "vitest";
import { coreRowFor, SCANNER_RANGE } from "../constants";
import { assertEqual, assertNull, fail } from "../assert";
import {
  captureStill,
  createHarness,
  openScene,
  pinDrill,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";

/** The size the node is posed at, and the shallower one the mine is taken to. */
const FROM = "marathon" as const;
const TO = "standard" as const;

/** The top scanner tier, whose range is the widest the shop sells. */
const TIER = SCANNER_RANGE.length;

/** A playable column, the node's row past the new depth, and the row the miner stands on. */
const COL = 8;
const NODE_ROW = coreRowFor(TO) + 5;
const STAND_ROW = coreRowFor(TO) - 2;

/** The node's material. The satchel is empty, so the scanner targets it. */
const MATERIAL = "resonite" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("drops a material node the new depth no longer reaches", async () => {
  await openScene(h, { size: FROM });
  await pinMiner(h);
  await pinDrill(h);
  await h.debug.setTier("scanner", TIER);
  await h.debug.setMaterialTile(COL, NODE_ROW, MATERIAL);
  await standOn(h, COL, STAND_ROW);
  await h.advance(1);

  const deep = await h.snapshot();
  if (NODE_ROW <= coreRowFor(TO) || NODE_ROW >= coreRowFor(FROM)) {
    fail(
      `a row between the ${TO} and ${FROM} Core chambers`,
      `row ${NODE_ROW}`,
    );
  }
  const range = SCANNER_RANGE[TIER - 1];
  const away = Math.hypot(deep.miner.col - COL, deep.miner.row - NODE_ROW);
  if (typeof range !== "number" || away > range) {
    fail(`a node inside the tier ${TIER} scanner's range`, `${away} tiles`);
  }
  assertEqual(
    deep.scanner.locked,
    true,
    "specs/mining.md: the scanner locks onto the node it targets while it is in range",
  );
  assertEqual(deep.scanner.target, MATERIAL, "the node the scanner targets");

  await h.debug.setWorldSize(TO);
  await h.advance(1);
  await captureStill(h, "dropped");
  const shallow = await h.snapshot();

  assertEqual(
    shallow.coreRow,
    coreRowFor(TO),
    `specs/world.md: coreRow at ${TO}`,
  );
  assertEqual(
    shallow.scanner.locked,
    false,
    "specs/instrumentation.md: the node past the new Core chamber is gone with its row",
  );
  assertNull(
    shallow.scanner.target,
    "specs/mining.md: nothing is targeted once the node is gone",
  );
});
