// instrumentation/set-world-size-extends-the-mine — a deeper size leaves a mine
// that reaches the new depth.
//
// `specs/instrumentation.md`, `setWorldSize`: it sets "the expedition's world
// size ... and with it `coreRow` and the depth the mine reaches", and Resizing
// the mine says a row "the old depth did not reach" holds "What an empty mine
// holds at that depth: the bedrock border across columns `0` and `31`, open
// tunnel across the playable columns, carrying the band the new depth gives that
// row."
//
// That matters because the same file fixes the pose domain as `row` from `1` to
// `coreRow`. A build that moved `coreRow` and left the grid where it was would
// accept a pose at a row it has no cell for and quietly do nothing with it, and
// every scenario posed at the new depth would then be a scenario that was never
// arranged.
//
// So the size is taken from Quick to Marathon and a row PAST the old depth is
// read: it is inside the grid, it is open tunnel, and it takes a pose that reads
// back. The Core chamber and the bedrock border are read at the new depth too,
// because reaching the new depth is a claim about all three.
//
// WHAT THIS POINT DOES NOT DECIDE. Whether the cells the two depths SHARE come
// through the resize is its own point, and so is the old Core chamber ceasing to
// be one.

import { afterEach, beforeEach, it } from "vitest";
import { BAND_HEALTH, CORE_COL, coreRowFor, WORLD_COLS } from "../constants";
import {
  assertEqual,
  assertNotNull,
  assertNull,
  fail,
} from "../assert";
import {
  captureStill,
  createHarness,
  openScene,
  pinDrill,
  pinMiner,
  type Harness,
} from "../harness";

/** The size the mine starts at, and the deeper one it is taken to. */
const FROM = "quick" as const;
const TO = "marathon" as const;

/**
 * The cell the reading is taken at: a playable column, and a row past Quick's
 * Core chamber but well short of Marathon's.
 */
const COL = 5;
const DEEP_ROW = 700;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reaches rows past the old depth after the size is taken deeper", async () => {
  await openScene(h, { size: FROM });
  await pinMiner(h);
  await pinDrill(h);
  const shallow = await h.snapshot();

  await h.debug.setWorldSize(TO);
  await h.advance(1);
  await captureStill(h, "deeper");
  const deep = await h.snapshot();

  assertEqual(
    shallow.coreRow,
    coreRowFor(FROM),
    `specs/world.md: coreRow at ${FROM}`,
  );
  if (DEEP_ROW <= shallow.coreRow || DEEP_ROW >= coreRowFor(TO)) {
    fail(
      `a row between the ${FROM} and ${TO} Core chambers`,
      `row ${DEEP_ROW}`,
    );
  }

  assertEqual(deep.worldSize, TO, "specs/instrumentation.md: the size is set");
  assertEqual(
    deep.coreRow,
    coreRowFor(TO),
    `specs/world.md: coreRow at ${TO}`,
  );

  // A row the old depth did not reach is now an ordinary in-grid open tunnel:
  // it carries a band, which is what a cell outside the grid does not.
  const opened = await h.tileAt(COL, DEEP_ROW);
  assertEqual(
    opened.kind,
    "tunnel",
    "specs/instrumentation.md: a row the old depth did not reach opens as an empty mine's",
  );
  assertNotNull(opened.band, `the band tileAt(${COL}, ${DEEP_ROW}) reports`);
  assertNull(opened.health, "specs/instrumentation.md: a tunnel is not minable");

  // And it takes a pose, which is the whole of what the extended grid is for.
  await h.debug.setTile(COL, DEEP_ROW, "rock");
  const posed = await h.tileAt(COL, DEEP_ROW);
  assertEqual(posed.kind, "rock", "specs/instrumentation.md: setTile poses it");
  const band = posed.band;
  if (band === null) fail("a band on the posed cell", band);
  assertEqual(
    posed.maxHealth,
    BAND_HEALTH[band],
    "specs/instrumentation.md: posed at that band's full health",
  );
  assertEqual(posed.health, BAND_HEALTH[band], "the health it was posed at");

  // The border and the Core chamber stand at the new depth.
  assertEqual(
    (await h.tileAt(0, DEEP_ROW)).kind,
    "bedrock",
    "specs/world.md: column 0 is the bedrock border",
  );
  assertEqual(
    (await h.tileAt(WORLD_COLS - 1, DEEP_ROW)).kind,
    "bedrock",
    "specs/world.md: the last column is the bedrock border",
  );
  assertEqual(
    (await h.tileAt(CORE_COL, deep.coreRow)).kind,
    "core",
    "specs/world.md: the Core sits at (CORE_COL, coreRow)",
  );
});
