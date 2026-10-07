// Floe — instrumentation/state-critter: the critter's state — its tile, its
// centre, its facing, its hop cooldown and its best row — is reported and reads
// back.
//
// `specs/instrumentation.md` states the rule the whole surface is built to:
// "`snapshot` returns exactly this object. Every field an operation can set is
// present, so every operation is verifiable by setting it and reading it back."
// The rest of this suite reads its verdicts out of that object, so a field that
// is absent, that answers with something of the wrong kind, or that fails to
// report what a pose put into it costs the point that asks for it somewhere
// else, under a heading about a mechanic. This family of the shape is named
// here instead.
//
// THE SHAPE AND THE READ-BACK ARE ONE CLAIM PER FAMILY, and the families are
// separate points. A build whose bears report nothing usable must grade
// differently from one whose whole snapshot is wrong, and a single point over
// the whole surface can only fail once — so the six `instrumentation/state-*`
// points divide the object along the lines `specs/instrumentation.md` itself
// draws.
//
// EVERY POSE IS READ BEFORE ANYTHING RUNS. The harness holds the game off its own
// clock, so nothing happens between a pose and the snapshot that checks it: one
// tick would run the hold, the cooldown and the lanes on, and the check would be
// reading the update rather than the pose.
//
// EVERY VALUE IS ONE THE POSE HAD TO CARRY. Each is deliberately not the value
// `startCrossing` left behind, so a build that ignores a pose reads back the
// value it already held rather than the one asked for, and the failure names the
// operation. Each boolean is posed BOTH WAYS for the same reason: a field read
// back once could be a constant.
//
// WHAT THIS DOES NOT DECIDE. What any posed value MEANS to the simulation. That a
// posed gate holds a faculty off is each gate item's, that a posed step is
// carried out is `hunter/*`'s, and that a lane at a speed carries its items that
// far is `ice/*`'s and `water/*`'s.
//
// `present` and `footing` are read for their PRESENCE and their kind alone, and
// that is not an omission. No operation sets either: `present` follows
// `addCritter` and `removeCritter`, which
// `instrumentation/remove-critter` grades, and `footing` is derived from the
// critter's row and the floes on it, which `water/floe-is-footing` grades.
//
// THE CRITTER IS ON THE STRAIT BEFORE ANYTHING IS READ. Every field below belongs
// to a critter that exists, so `startCrossing` puts one on the near shore and the
// pose moves it into the ice band, clear of the shores' own rules.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import { tileCX, tileCY, type Facing, type Footing } from "../constants";
import {
  captureStill,
  createHarness,
  startCrossing,
  type FloeSnapshot,
  type Harness,
} from "../harness";

/** The strait the per-entity poses below are applied to. */
const BOARD_CRITTER_COL = 20;
const BOARD_CRITTER_ROW = 16;

/** The critter's poses: a tile, then a centre `x` inside a different column. */
const CRITTER_COL = 13;
const CRITTER_ROW = 12;
const CRITTER_X = 951;
const CRITTER_X_COL = 29; // colAt(951) = floor(951 / 32)
const CRITTER_FACING: Facing = "left";
const HOP_COOLDOWN = 0.0625;
const BEST_ROW = 11;

/** The four facings and the three footings the shape names. */
const FACINGS: readonly Facing[] = ["up", "down", "left", "right"];
const FOOTINGS: readonly Footing[] = ["solid", "floe", "water"];

/** Every field of one reported tile is a number. */
function assertTile(tile: { col: unknown; row: unknown }, what: string): void {
  assertEqual(typeof tile.col, "number", `${what}.col`);
  assertEqual(typeof tile.row, "number", `${what}.row`);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the critter's fields and reads every pose of them back", async () => {
  await startCrossing(h);
  await h.debug.setCritterTile(BOARD_CRITTER_COL, BOARD_CRITTER_ROW);

  await h.advance(1);
  // Taken before the walk, so a pose that fails to land still leaves the picture
  // of the strait it was applied to.
  await captureStill(h, "read-back");

  const s = await h.snapshot();

  /** Apply one pose and read its own field straight back off the snapshot. */
  const readsBack = async <T>(
    pose: () => Promise<void>,
    read: (s: FloeSnapshot) => T,
    want: T,
    what: string,
  ): Promise<void> => {
    await pose();
    assertEqual(read(await h.snapshot()), want, what);
  };

  // ---- The fields the critter reports -----------------------------------

  assertEqual(
    typeof s.critter.present,
    "boolean",
    "snapshot().critter.present",
  );
  assertTile(s.critter, "snapshot().critter");
  assertEqual(
    typeof s.critter.x,
    "number",
    "snapshot().critter.x, which is its CENTER",
  );
  assertEqual(
    typeof s.critter.y,
    "number",
    "snapshot().critter.y, which is its CENTER",
  );
  assertContains(FACINGS, s.critter.facing, "snapshot().critter.facing");
  assertContains(
    FOOTINGS,
    s.critter.footing,
    "snapshot().critter.footing, derived from its row and the floes on it",
  );
  assertEqual(
    typeof s.critter.hopCooldown,
    "number",
    "snapshot().critter.hopCooldown, in seconds",
  );
  assertEqual(typeof s.critter.bestRow, "number", "snapshot().critter.bestRow");

  // ---- What each pose reads back ----------------------------------------

  await h.debug.setCritterTile(CRITTER_COL, CRITTER_ROW);
  const onTile = (await h.snapshot()).critter;
  assertEqual(
    `${onTile.col},${onTile.row}`,
    `${CRITTER_COL},${CRITTER_ROW}`,
    `the tile snapshot() reports after setCritterTile(${CRITTER_COL}, ` +
      `${CRITTER_ROW})`,
  );
  assertEqual(
    `${onTile.x},${onTile.y}`,
    `${tileCX(CRITTER_COL)},${tileCY(CRITTER_ROW)}`,
    `the CENTRE snapshot() reports after setCritterTile(${CRITTER_COL}, ` +
      `${CRITTER_ROW}), which puts it on that tile's centre (specs/strait.md)`,
  );

  // The mid-drift pose: the centre `x` alone, with the row left as it stands and
  // the column following by colAt(x).
  await h.debug.setCritterX(CRITTER_X);
  const drifted = (await h.snapshot()).critter;
  assertEqual(
    drifted.x,
    CRITTER_X,
    `snapshot().critter.x after setCritterX(${CRITTER_X})`,
  );
  assertEqual(
    drifted.col,
    CRITTER_X_COL,
    `snapshot().critter.col after setCritterX(${CRITTER_X}), which follows ` +
      `its centre by colAt(x) (specs/instrumentation.md)`,
  );
  assertEqual(
    drifted.row,
    CRITTER_ROW,
    `snapshot().critter.row after setCritterX(${CRITTER_X}), which leaves the ` +
      `row as it stands`,
  );

  await readsBack(
    () => h.debug.setCritterFacing(CRITTER_FACING),
    (s) => s.critter.facing,
    CRITTER_FACING,
    `snapshot().critter.facing after ` +
      `setCritterFacing(${JSON.stringify(CRITTER_FACING)})`,
  );
  await readsBack(
    () => h.debug.setHopCooldown(HOP_COOLDOWN),
    (s) => s.critter.hopCooldown,
    HOP_COOLDOWN,
    `snapshot().critter.hopCooldown, in seconds, after ` +
      `setHopCooldown(${HOP_COOLDOWN})`,
  );
  await readsBack(
    () => h.debug.setBestRow(BEST_ROW),
    (s) => s.critter.bestRow,
    BEST_ROW,
    `snapshot().critter.bestRow after setBestRow(${BEST_ROW})`,
  );
});
