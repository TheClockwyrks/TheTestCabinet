// Wireworm — instrumentation/entity-ids: every worm, foe and bolt added through
// the surface takes an id no other live entity carries, lands at the end of its
// own roster, and keeps that id while the game runs.
//
// specs/instrumentation.md makes both rules explicit, under Identity: "Every
// worm, every foe, and every bolt carries an `id`: a number, distinct among the
// entities live at any moment, reported by `snapshot` and taken by every
// per-entity operation", and "An entity added through this surface is appended
// to its roster, so it is the last entry and its id is read from there."
//
// WITHOUT BOTH, NO PER-ENTITY OPERATION IS ADDRESSABLE. `addWorm`, `addFoe` and
// `addBolt` return nothing, so the append rule is the only way a caller learns
// what it just created — and every scenario in this suite that steers one worm
// while a second stands by, or gates one foe's mind while another travels,
// rests on the id it read from the roster's end being that entity's and no
// other's. A build that reuses ids across the three rosters, or that inserts an
// added entity at the front, silently mis-aims those scenarios.
//
// SO EACH ADD IS READ TWICE. The roster is read before the add and after it: the
// roster must have grown by exactly one, and the entry now at the end must carry
// an id none of the entries before it carried. Then every id collected across
// all three rosters is held to being distinct from every other.
//
// AND THE IDS ARE READ AGAIN AFTER THE GAME HAS RUN. An id that is merely a
// roster position changes when the roster is walked; one that is reassigned each
// frame changes with the frame. Both are caught by driving the board for half a
// second — long enough that a worm on level 1 takes several steps, which the
// check confirms rather than assumes — and finding every entity still carrying
// the id it was given.
//
// THE BOARD IS POSED SO NOTHING LEAVES IT. The foes are held still and mindless,
// because a glitch left to descend would fall off the bottom of the board and be
// gone (specs/foes.md) and this point would report a missing id for a rule about
// leaving the board. The bolts climb clear columns and the worms step along
// empty rows, so nothing resolves against anything.
//
// WHAT THIS DOES NOT DECIDE. How ids are assigned — nothing here requires them
// to count up, or to be small — nor what happens to an id when a worm is cut,
// which specs/worm.md states and `worm/split-keeps-head-id` and
// `discharge/fry-split-keeps-head-id` decide.

import { afterEach, beforeEach, it } from "vitest";
import { WORM_STEP_L1, tileCX, tileCY } from "../../src/constants";
import {
  assertEqual,
  assertLength,
  assertNotEqual,
  assertTrue,
} from "../assert";
import {
  boltById,
  captureStill,
  createHarness,
  foeById,
  headOf,
  startPlaying,
  ticksFor,
  wormById,
  type FoeKind,
  type Harness,
  type WirewormSnapshot,
} from "../harness";

/** Where the two worms' heads are posed, on separate empty rows. */
const WORM_TILES = [
  { c: 5, r: 3 },
  { c: 12, r: 6 },
] as const;

/** The three foe kinds, and the tile one of each is posed on. */
const FOES: readonly { kind: FoeKind; c: number; r: number }[] = [
  { kind: "glitch", c: 20, r: 10 },
  { kind: "dropper", c: 26, r: 10 },
  { kind: "corruptor", c: 32, r: 10 },
];

/** The columns the two posed bolts climb, and the row they start on. */
const BOLT_COLS = [0, 2] as const;
const BOLT_ROW = 19;

/**
 * How long the board is driven for, in seconds.
 *
 * Half a second. At level 1 a worm steps every `WORM_STEP_L1` (`0.14` s)
 * (specs/worm.md), so this is three steps for a build that keeps to the figure
 * and at least one for a build three times slower — and the check reads that a
 * step happened rather than assuming it. It is also well short of the `0.69` s a
 * bolt needs to climb the board at `BOLT_SPEED` (`900` units per second,
 * specs/cursor.md), so both bolts are still in flight at the end.
 */
const DRIVE_SECONDS = 0.5;

/** A worm's head tile as `"c,r"`, or what the snapshot reported instead. */
function headTile(snapshot: WirewormSnapshot, id: number): string {
  const worm = wormById(snapshot, id);
  if (worm === undefined) return `no worm carrying id ${id}`;
  const head = headOf(worm);
  return head === undefined ? "a worm of no segments" : `${head.c},${head.r}`;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives each added entity a distinct id at the end of its roster, and keeps it", async () => {
  startPlaying(h);

  /**
   * Run one add and read the id off the end of its roster, holding the roster
   * to having grown by exactly one entry whose id is new.
   */
  const appended = (
    roster: (s: WirewormSnapshot) => readonly { id: number }[],
    add: () => void,
    what: string,
  ): number => {
    const before = roster(h.snapshot()).map((entry) => entry.id);
    add();
    const after = roster(h.snapshot());
    assertLength(
      after,
      before.length + 1,
      `the ${what} roster after the add, against the ${before.length} it held ` +
        `before it`,
    );
    const last = after[after.length - 1];
    assertEqual(
      before.includes(last.id),
      false,
      `whether the id at the END of the ${what} roster (${last.id}) was ` +
        `already carried by an entry that stood there before the add — an ` +
        `added entity is APPENDED, so the last entry is the new one ` +
        `(specs/instrumentation.md, Identity)`,
    );
    return last.id;
  };

  const worms = WORM_TILES.map((tile) =>
    appended(
      (s) => s.worms,
      () => h.debug.addWorm(tile.c, tile.r),
      "worm",
    ),
  );
  const foes = FOES.map((foe) => {
    const id = appended(
      (s) => s.foes,
      () => h.debug.addFoe(foe.kind, tileCX(foe.c), tileCY(foe.r)),
      "foe",
    );
    // Held still and mindless: this point is about the id, and a glitch left to
    // descend leaves the board and takes its id with it (specs/foes.md).
    h.debug.setFoeTravel(id, false);
    h.debug.setFoeMind(id, false);
    return id;
  });
  const bolts = BOLT_COLS.map((c) =>
    appended(
      (s) => s.bolts,
      () => h.debug.addBolt(tileCX(c), tileCY(BOLT_ROW)),
      "bolt",
    ),
  );

  await h.advance(1);
  // Before the assertions, so a failure still leaves the picture of the
  // entities whose ids are being read.
  captureStill(h, "roster");

  // Distinct among the entities live at this moment, across all three rosters.
  const all = [...worms, ...foes, ...bolts];
  all.forEach((id, index) => {
    assertEqual(
      all.indexOf(id),
      index,
      `the position of id ${id} among the ${all.length} ids the two worms, ` +
        `three foes and two bolts were given ([${all.join(", ")}]) — an id is ` +
        `distinct among the entities live at any moment ` +
        `(specs/instrumentation.md, Identity)`,
    );
  });

  const posed = headTile(h.snapshot(), worms[0]);
  await h.advance(ticksFor(DRIVE_SECONDS));
  const driven = h.snapshot();

  // The game really ran, so "still carrying its id" is a reading rather than a
  // statement about a board that never moved.
  assertNotEqual(
    headTile(driven, worms[0]),
    posed,
    `the first worm's head tile after ${DRIVE_SECONDS} s of game time, which ` +
      `is the tile it stood on before — a step is WORM_STEP_L1 ` +
      `(${WORM_STEP_L1} s) at level 1 (specs/worm.md)`,
  );

  for (const id of worms) {
    assertTrue(
      wormById(driven, id) !== undefined,
      `whether a worm still carries the id ${id} it was given, after ` +
        `${DRIVE_SECONDS} s of game time`,
    );
  }
  for (const id of foes) {
    assertTrue(
      foeById(driven, id) !== undefined,
      `whether a foe still carries the id ${id} it was given, after ` +
        `${DRIVE_SECONDS} s of game time`,
    );
  }
  for (const id of bolts) {
    assertTrue(
      boltById(driven, id) !== undefined,
      `whether a bolt still carries the id ${id} it was given, after ` +
        `${DRIVE_SECONDS} s of game time`,
    );
  }
});
