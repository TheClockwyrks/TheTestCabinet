// modes/bottleneck-allows-inside — a footprint wholly inside the zone is accepted
// and builds, and the floor outside the zone is still the surge's to walk.
//
// THE RULE. specs/modes.md, Bottleneck: "Bottleneck restricts building to a marked
// central zone", "Every tile of a footprint must lie inside that zone", and "The
// floor outside the zone stays open for the surge to walk". specs/building.md makes
// the zone the fifth of six placement conditions, and gives what a valid commit does:
// "A tower of the held type appears on the held footprint at the held rotation".
//
// THE OTHER DIRECTION OF `modes.bottleneck-refuses-outside`, and the reason both
// exist. A build that refuses every footprint on Bottleneck passes the refusal item
// and fails this one; a build that accepts every footprint passes this one and fails
// that one. Neither item on its own separates a working zone from a broken mode.
//
// THE FOOTPRINT SITS IN THE ZONE'S NEAR CORNER, ON THE FIRST BUILDABLE COLUMN AND
// THE FIRST BUILDABLE ROW. specs/modes.md ends the zone at columns `13` and `36` and
// rows `8` and `27`, "both ends included", so those two indices are inside it — and a
// build that read the bounds as exclusive, or that compared with the wrong
// inequality, refuses a footprint anchored exactly there while accepting everything
// further in. That build reports the specified zone and enforces a smaller one, which
// no reading of the REPORTED zone can catch: `modes.bottleneck-zone-reported` reads
// what the build says, and this point reads what it does.
//
// EVERY OTHER PLACEMENT CONDITION IS SATISFIED, so an acceptance here is an
// acceptance for the stated reason and a refusal can only be the zone's. The
// footprint is on the grid, on open floor, with `startRun` leaving the floor clear of
// surge; the purse is far above the Arc's build cost; and the anchor keeps the whole
// block clear of both straight vent-to-exhaust corridors — rows `16..19` and columns
// `22..29` (specs/floor.md) — so the never-seal rule is nowhere near being reached.
//
// THE FLOOR OUTSIDE IS READ WITH A WALKER, NOT WITH A ROUTE LENGTH. A zone that had
// been applied to the surge as well as to building would leave the outside
// unwalkable, and what a player would see is a unit that will not move. So one Mote
// is posed at a tile well outside the zone — column `5`, five tiles inside the left
// vent's own corridor and eight short of the zone's first buildable column — and it
// is asked to walk for a second of game time under its own power.
//
// THE DISTANCE ASKED FOR IS ONE TILE IN ONE SECOND, and it is deliberately a floor
// rather than a figure. specs/surge.md gives the Mote `60` logical units a second,
// which is a shade over three tiles, so this admits a build walking at under a third
// of the specified speed — how fast a Mote walks is `surge.walks-at-its-speed`'s
// requirement, not this point's. What it does not admit is a unit that does not move
// at all, which is what a floor closed outside the zone produces.
//
// THREE READINGS, ONE PER CLAUSE. Reads valid: the held preview's `valid`. Places: a
// tower stands on the held footprint afterwards. The outside stays open: the Mote
// travelled.

import { afterEach, beforeEach, it } from "vitest";
import { BOTTLENECK_ZONE, TILE, TOWER_DEFS } from "../../src/constants";
import { assertEqual, assertGreaterThan, assertNotNull } from "../assert";
import { tileCentre } from "../geometry";
import {
  captureStill,
  createHarness,
  lastTower,
  overWindow,
  poseWalker,
  startRun,
  ticksFor,
  type Harness,
} from "../harness";

/** The mode this point is about. */
const MODE = "bottleneck";

/** The type held: the cheapest 2x2 emitter on the roster (specs/towers.md). */
const HELD = "arc";

/**
 * The accepted footprint's top-left tile: the zone's first buildable column and its
 * first buildable row, both ends being included.
 *
 * Its `2x2` block covers columns `13` and `14` and rows `8` and `9`, every one of
 * them inside columns `13..36` and rows `8..27`, and every one of them clear of the
 * left corridor (`16..19`) and the top one (`22..29`).
 */
const INSIDE_COL = BOTTLENECK_ZONE.col0;
const INSIDE_ROW = BOTTLENECK_ZONE.row0;

/**
 * The tile the walker is posed on: column `5`, row `17`.
 *
 * Eight columns short of the zone's first buildable column, so it is unambiguously
 * outside it, and on a row the left vent opens onto, so it stands where the surge
 * really enters (specs/floor.md).
 */
const OUTSIDE_COL = 5;
const OUTSIDE_ROW = 17;

/** The window the walker is watched over: one second of game time. */
const WALK_TICKS = ticksFor(1);

/**
 * The least the walker must cover in that second: one tile.
 *
 * A floor rather than a figure. specs/surge.md's Mote covers `60` units a second,
 * better than three tiles, so this admits a build at under a third of that speed and
 * refuses only a unit that did not move.
 */
const LEAST_TRAVEL = TILE;

/** Enough money that affordability is never what refuses anything here. */
const PURSE = 1000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("accepts a footprint wholly inside the zone and leaves the floor outside walkable", async () => {
  startRun(h, MODE);
  h.debug.setMoney(PURSE);

  h.debug.setArmed(HELD);
  h.debug.setPreview(INSIDE_COL, INSIDE_ROW);
  const preview = h.snapshot().build;
  h.debug.place();
  const built = h.snapshot();

  const walker = poseWalker(h, "mote", "left");
  const at = tileCentre(OUTSIDE_COL, OUTSIDE_ROW);
  h.debug.setUnitPosition(walker, at.x, at.y);
  const window = await overWindow(h, WALK_TICKS);
  captureStill(h, "inside");

  assertNotNull(
    preview,
    `the build preview arming a ${HELD} holds (specs/building.md, Arming a type)`,
  );
  const held = preview as NonNullable<typeof preview>;
  assertEqual(
    held.valid,
    true,
    `whether a ${TOWER_DEFS[HELD].size}x${TOWER_DEFS[HELD].size} ${HELD} ` +
      `anchored at (${INSIDE_COL}, ${INSIDE_ROW}) is placeable, every tile of ` +
      `it lying inside columns ${BOTTLENECK_ZONE.col0}-${BOTTLENECK_ZONE.col1} ` +
      `and rows ${BOTTLENECK_ZONE.row0}-${BOTTLENECK_ZONE.row1} ` +
      "(specs/modes.md, Bottleneck)",
  );
  assertEqual(
    built.towers.length,
    1,
    "the towers standing after committing a footprint wholly inside the zone " +
      "(specs/modes.md, Bottleneck; specs/building.md, Placing)",
  );
  assertEqual(
    lastTower(built).col,
    INSIDE_COL,
    "the column the tower the zone accepted stands on (specs/building.md, Placing)",
  );
  assertEqual(
    lastTower(built).row,
    INSIDE_ROW,
    "the row the tower the zone accepted stands on (specs/building.md, Placing)",
  );
  assertGreaterThan(
    window.travel(walker),
    LEAST_TRAVEL,
    `the logical units a Mote posed at (${OUTSIDE_COL}, ${OUTSIDE_ROW}), ` +
      "outside the zone, covered in a second of game time — the floor outside " +
      "the zone staying open for the surge to walk (specs/modes.md, Bottleneck)",
  );
});
