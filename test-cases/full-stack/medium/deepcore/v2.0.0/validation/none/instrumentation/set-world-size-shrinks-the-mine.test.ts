// instrumentation/set-world-size-shrinks-the-mine — a shallower size drops the
// rows past the new depth.
//
// The other direction of `specs/instrumentation.md`'s `setWorldSize`: the mine
// "is emptied to the new depth exactly as `clearMine` leaves it". A row past the
// new `coreRow` is no longer part of the mine, so it reads the way the same file
// says a cell outside the grid reads: "`bedrock` with every other field `null`".
//
// The mine is GENERATED at the deeper size first, so what the shrink has to get
// rid of is real terrain rather than the empty grid a scene opens with — and a
// row inside the new depth is read afterwards to hold the other half of the
// claim, that what is left is emptied rather than the deep mine truncated.

import { afterEach, beforeEach, it } from "vitest";
import { CORE_COL, coreRowFor } from "../constants";
import { assertEqual, assertNotNull, assertNull, fail } from "../assert";
import {
  captureStill,
  createHarness,
  openScene,
  pinDrill,
  pinMiner,
  type Harness,
} from "../harness";

/** The size the mine is generated at, and the shallower one it is taken to. */
const FROM = "marathon" as const;
const TO = "quick" as const;

/** A playable column, a row past the new Core chamber, and one well inside it. */
const COL = 5;
const DEEP_ROW = 700;
const SHALLOW_ROW = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("drops the rows past the new Core chamber when the size is taken shallower", async () => {
  await openScene(h, { size: FROM });
  await pinMiner(h);
  await pinDrill(h);
  await h.debug.generateMine();
  const deep = await h.snapshot();
  const generated = await h.tileAt(COL, DEEP_ROW);

  await h.debug.setWorldSize(TO);
  await h.advance(1);
  await captureStill(h, "shallower");
  const shallow = await h.snapshot();

  assertEqual(deep.coreRow, coreRowFor(FROM), `specs/world.md: coreRow at ${FROM}`);
  if (DEEP_ROW <= coreRowFor(TO) || DEEP_ROW >= coreRowFor(FROM)) {
    fail(`a row between the ${TO} and ${FROM} Core chambers`, `row ${DEEP_ROW}`);
  }
  if (SHALLOW_ROW < 1 || SHALLOW_ROW >= coreRowFor(TO)) {
    fail(`a row inside the ${TO} mine`, `row ${SHALLOW_ROW}`);
  }
  assertNotNull(
    generated.band,
    `the band tileAt(${COL}, ${DEEP_ROW}) reported while the mine was ${FROM}`,
  );

  assertEqual(shallow.worldSize, TO, "specs/instrumentation.md: the size is set");
  assertEqual(shallow.coreRow, coreRowFor(TO), `specs/world.md: coreRow at ${TO}`);

  // The row the new depth does not reach reads the way any cell outside the grid
  // reads, rather than still answering with the terrain it held.
  const dropped = await h.tileAt(COL, DEEP_ROW);
  const at = `tileAt(${COL}, ${DEEP_ROW})`;
  assertEqual(dropped.kind, "bedrock", `the kind ${at} reports`);
  assertNull(dropped.band, `the band ${at} reports`);
  assertNull(dropped.ore, `the ore ${at} reports`);
  assertNull(dropped.material, `the material ${at} reports`);
  assertNull(dropped.health, `the health ${at} reports`);
  assertNull(dropped.maxHealth, `the maxHealth ${at} reports`);

  // What is left is the empty mine at the new depth, not the deep one cut short.
  assertEqual(
    (await h.tileAt(COL, SHALLOW_ROW)).kind,
    "tunnel",
    "specs/instrumentation.md: emptied to the new depth exactly as clearMine leaves it",
  );
  assertEqual(
    (await h.tileAt(CORE_COL, shallow.coreRow)).kind,
    "core",
    "specs/world.md: the Core sits at (CORE_COL, coreRow)",
  );
});
