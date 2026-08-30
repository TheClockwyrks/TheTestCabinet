// instrumentation/set-world-size-moves-the-core-chamber — a deeper size leaves
// one Core chamber, and it is the new deepest row.
//
// `specs/instrumentation.md`, Resizing the mine: the row at the new `coreRow`
// becomes "The Core chamber, whatever the row held before", and the row that was
// the old Core chamber becomes "An ordinary row of the mine, opened the way an
// empty mine's rows are. Exactly one row is the Core chamber at any moment, and
// it is `row coreRow`."
//
// WHY THIS IS ITS OWN POINT. The Core chamber is the one structure a resize has
// to MOVE rather than carry: `specs/world.md` puts the Core at
// `(CORE_COL, coreRow)` and makes every other cell of that row bedrock, and
// `specs/mining.md` makes the Core the only source of a Core Sample. A build
// that appends the new rows and leaves the old chamber where it was has two
// floors and two Cores, so a player reaches a Core and an unbreakable wall a
// long way above the depth the size promised. Reaching the new depth is a
// separate point and passes for such a build, so this one reads the row the
// chamber LEFT.
//
// The read is `findTile("core")`, which `specs/instrumentation.md` defines as
// the cell of that kind "nearest the miner where several exist": the miner is at
// the camp, so a Core left behind at the old depth is the nearer of the two and
// the reading names it.
//
// ISOLATION. An empty mine at the shallow size, with both faculties gated so the
// miner stays at the camp and cuts nothing.

import { afterEach, beforeEach, it } from "vitest";
import { CORE_COL, WORLD_COLS } from "../../src/constants";
import { assertDeepEqual, assertEqual, fail } from "../assert";
import {
  captureStill,
  coreRowFor,
  createHarness,
  openScene,
  pinDrill,
  pinMiner,
  standAtCamp,
  type Harness,
} from "../harness";

/** The size the mine starts at, and the deeper one it is taken to. */
const FROM = "quick" as const;
const TO = "marathon" as const;

/** A playable column clear of the Core's own, read on the row the chamber left. */
const COL = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the old Core chamber an ordinary row and the Core at the new depth", async () => {
  openScene(h, { size: FROM });
  pinMiner(h);
  pinDrill(h);
  standAtCamp(h);
  await h.advance(1);

  const was = coreRowFor(FROM);
  const now = coreRowFor(TO);
  if (was >= now) fail(`a deeper size than ${FROM}`, `${TO}, coreRow ${now}`);
  assertEqual(
    h.tileAt(CORE_COL, was).kind,
    "core",
    `specs/world.md: the Core sits at (CORE_COL, coreRow) at ${FROM}`,
  );

  h.debug.setWorldSize(TO);
  await h.advance(1);
  captureStill(h, "moved");

  // One Core, at the new depth. A Core left behind at the old one would be the
  // nearer of the two to a miner standing at the camp, so it would be named here.
  assertDeepEqual(
    h.debug.findTile("core"),
    { col: CORE_COL, row: now },
    "specs/instrumentation.md: exactly one row is the Core chamber, and it is row coreRow",
  );

  // And the row it left is an ordinary row of the mine: open tunnel across the
  // playable columns, with the bedrock border still standing beside it.
  assertEqual(
    h.tileAt(CORE_COL, was).kind,
    "tunnel",
    `specs/instrumentation.md: row ${was} is an ordinary row of the mine once the depth passes it`,
  );
  assertEqual(
    h.tileAt(COL, was).kind,
    "tunnel",
    `specs/instrumentation.md: row ${was} is opened the way an empty mine's rows are`,
  );
  assertEqual(
    h.tileAt(0, was).kind,
    "bedrock",
    "specs/world.md: column 0 is the bedrock border",
  );
  assertEqual(
    h.tileAt(WORLD_COLS - 1, was).kind,
    "bedrock",
    "specs/world.md: the last column is the bedrock border",
  );
});
