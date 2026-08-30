// instrumentation/set-world-size-shrinks-the-mine — a shallower size drops the
// rows past the new depth.
//
// The other direction of `specs/instrumentation.md`'s `setWorldSize`, from
// Resizing the mine: a cell "in a row past the new Core chamber, where the size
// gets shallower" is "Gone with its row. The mine no longer reaches that row, so
// `tileAt` there reads as a cell outside the grid" — "`bedrock` with every other
// field `null`". The row at the new `coreRow` becomes "The Core chamber, whatever
// the row held before: bedrock across the row, with the Core at `CORE_COL`."
//
// The mine is GENERATED at the deeper size first, so what the shrink has to get
// rid of is real terrain rather than the empty grid a scene opens with, and the
// new deepest row is read afterwards to hold the other half of the claim: the
// mine ends in a Core chamber at the new depth rather than in whatever terrain
// the deep mine happened to have there.
//
// WHAT THIS POINT DOES NOT DECIDE. Whether the cells ABOVE the new Core chamber
// come through the resize is its own point, and so are the material nodes.

import { afterEach, beforeEach, it } from "vitest";
import { CORE_COL } from "../../src/constants";
import { assertEqual, assertNotNull, assertNull, fail } from "../assert";
import {
  captureStill,
  coreRowFor,
  createHarness,
  openScene,
  pinDrill,
  pinMiner,
  type Harness,
} from "../harness";

/** The size the mine is generated at, and the shallower one it is taken to. */
const FROM = "marathon" as const;
const TO = "quick" as const;

/** A playable column and a row past the new Core chamber. */
const COL = 5;
const DEEP_ROW = 700;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("drops the rows past the new Core chamber when the size is taken shallower", async () => {
  openScene(h, { size: FROM });
  pinMiner(h);
  pinDrill(h);
  h.debug.generateMine();
  const deep = h.snapshot();
  const generated = h.tileAt(COL, DEEP_ROW);

  h.debug.setWorldSize(TO);
  await h.advance(1);
  captureStill(h, "shallower");
  const shallow = h.snapshot();

  assertEqual(deep.coreRow, coreRowFor(FROM), `specs/world.md: coreRow at ${FROM}`);
  if (DEEP_ROW <= coreRowFor(TO) || DEEP_ROW >= coreRowFor(FROM)) {
    fail(`a row between the ${TO} and ${FROM} Core chambers`, `row ${DEEP_ROW}`);
  }
  assertNotNull(
    generated.band,
    `the band tileAt(${COL}, ${DEEP_ROW}) reported while the mine was ${FROM}`,
  );

  assertEqual(shallow.worldSize, TO, "specs/instrumentation.md: the size is set");
  assertEqual(shallow.coreRow, coreRowFor(TO), `specs/world.md: coreRow at ${TO}`);

  // The row the new depth does not reach reads the way any cell outside the grid
  // reads, rather than still answering with the terrain it held.
  const dropped = h.tileAt(COL, DEEP_ROW);
  const at = `tileAt(${COL}, ${DEEP_ROW})`;
  assertEqual(dropped.kind, "bedrock", `the kind ${at} reports`);
  assertNull(dropped.band, `the band ${at} reports`);
  assertNull(dropped.ore, `the ore ${at} reports`);
  assertNull(dropped.material, `the material ${at} reports`);
  assertNull(dropped.health, `the health ${at} reports`);
  assertNull(dropped.maxHealth, `the maxHealth ${at} reports`);

  // And the mine ends in a Core chamber at the new depth: the row that becomes
  // `coreRow` is bedrock across its width, whatever terrain it held before.
  assertEqual(
    h.tileAt(CORE_COL, shallow.coreRow).kind,
    "core",
    "specs/world.md: the Core sits at (CORE_COL, coreRow)",
  );
  assertEqual(
    h.tileAt(COL, shallow.coreRow).kind,
    "bedrock",
    "specs/world.md: every cell of the Core chamber is bedrock border except the Core tile",
  );
  assertEqual(
    h.tileAt(0, shallow.coreRow).kind,
    "bedrock",
    "specs/world.md: column 0 is the bedrock border",
  );
});
