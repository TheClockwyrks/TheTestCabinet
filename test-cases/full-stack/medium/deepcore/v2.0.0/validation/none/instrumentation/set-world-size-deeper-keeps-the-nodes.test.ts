// instrumentation/set-world-size-deeper-keeps-the-nodes — a material node inside
// the mine comes through a deeper size.
//
// `specs/instrumentation.md`, Resizing the mine, on a buried material node:
// "Kept with its cell where it is above the new Core chamber, and gone with its
// row where it is not." Taking the size deeper puts no row past the new Core
// chamber, so every node is kept.
//
// WHY THIS IS ITS OWN POINT. The nodes are the mine's second structure, parallel
// to the grid, and `specs/mining.md` makes them the scanner's whole subject: the
// scanner "locates the two buried material nodes" and locks on while its target
// is in range. A build that rebuilds the node list at the new depth loses the
// route to the Resonite and the Cryenite it needs for the rocket, while every
// cell of the grid may still be where it was, so a check that read the grid
// would pass it. This point reads the scanner instead.
//
// ISOLATION. An empty mine holding one material node, the scanner at its top
// tier, and both faculties gated so the miner holds the depth it was put at and
// cuts nothing.

import { afterEach, beforeEach, it } from "vitest";
import { coreRowFor, SCANNER_RANGE } from "../constants";
import { assertCloseTo, assertEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  openScene,
  pinDrill,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";

/** The size the node is posed at, and the deeper one the mine is taken to. */
const FROM = "quick" as const;
const TO = "marathon" as const;

/** The top scanner tier, whose range is the widest the shop sells. */
const TIER = SCANNER_RANGE.length;

/** A playable column, the node's row, and the row the miner stands on. */
const COL = 8;
const NODE_ROW = 200;
const STAND_ROW = 195;

/** The node's material. The satchel is empty, so the scanner targets it. */
const MATERIAL = "resonite" as const;

/** Tenths of a tile: the distance is read back, not recomputed. */
const TOLERANCE_DIGITS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps a material node the deeper mine still reaches", async () => {
  await openScene(h, { size: FROM });
  await pinMiner(h);
  await pinDrill(h);
  await h.debug.setTier("scanner", TIER);
  await h.debug.setMaterialTile(COL, NODE_ROW, MATERIAL);
  await standOn(h, COL, STAND_ROW);
  await h.advance(1);

  const shallow = await h.snapshot();
  if (NODE_ROW >= coreRowFor(FROM) || coreRowFor(TO) <= coreRowFor(FROM)) {
    fail(`a node inside the ${FROM} mine and a deeper size`, `row ${NODE_ROW}`);
  }
  const range = SCANNER_RANGE[TIER - 1];
  const away = Math.hypot(
    shallow.miner.col - COL,
    shallow.miner.row - NODE_ROW,
  );
  if (typeof range !== "number" || away > range) {
    fail(`a node inside the tier ${TIER} scanner's range`, `${away} tiles`);
  }
  assertEqual(
    shallow.scanner.locked,
    true,
    "specs/mining.md: the scanner locks onto the node it targets while it is in range",
  );
  const was = shallow.scanner.distanceTiles;
  if (was === null)
    fail("specs/mining.md: a locked scanner reports a distance", was);

  await h.debug.setWorldSize(TO);
  await h.advance(1);
  await captureStill(h, "kept");
  const deep = await h.snapshot();

  assertEqual(deep.coreRow, coreRowFor(TO), `specs/world.md: coreRow at ${TO}`);
  assertEqual(
    deep.scanner.locked,
    true,
    "specs/instrumentation.md: the node above the new Core chamber is kept",
  );
  assertEqual(deep.scanner.target, MATERIAL, "the node the scanner targets");
  const now = deep.scanner.distanceTiles;
  if (now === null)
    fail("specs/mining.md: a locked scanner reports a distance", now);
  assertCloseTo(
    now,
    was,
    TOLERANCE_DIGITS,
    "specs/mining.md: the node is where it was, so the distance to it is",
  );
  assertEqual(
    (await h.tileAt(COL, NODE_ROW)).material,
    MATERIAL,
    "specs/instrumentation.md: the node's cell comes through the resize",
  );
});
