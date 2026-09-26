// drilling/climb-after-drill — a drilled shaft can be flown back up.
//
// specs/character.md: a broken cell becomes an open tunnel, the jetpack is the
// only way to ascend, and it climbs through tunnels already carved. So a shaft
// the miner cut itself is a shaft it can fly back out of, and the round trip is
// what says the drill really removed the rock rather than animating over it.
//
// The scene is four rock cells in one column with a floor beneath them and open
// ground above, so the descent is four whole cuts and the climb has somewhere to
// go. The cuts are driven one cell at a time with the direction held, which is
// how a player sinks a shaft; the climb is one hold of thrust on a full tank.
//
// The verdict is the row the miner set out from. A build whose drill leaves the
// terrain standing never reaches the bottom, and one that strands the miner in
// its own hole never comes back.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertLessThanOrEqual } from "../assert";
import { TILE } from "../constants";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  driveCut,
  minerYOn,
  openScene,
  standOn,
  type Harness,
} from "../harness";

/** A column and a row well clear of the camp, the cave mouth, and the Core. */
const COL = 8;
const ROW = 12;

/** How many cells the shaft is sunk through. */
const DEPTH = 4;

/** Frames the climb may spend before it counts as a miner that cannot get out. */
const CLIMB_FRAMES = 300;

/**
 * How far the box may sit from a resting position, in world units.
 *
 * A build resolves a resting contact with an epsilon of its own and
 * `specs/character.md` fixes none, so this reading cannot be tighter than the
 * settle one produces. What it discriminates against is a miner that never
 * reached the bottom of what it cut, which is a whole cell — eighty units. The
 * band is an eighth of that, so a shaft one cell short cannot hide inside it,
 * while the contact epsilon that the points whose subject is contact read does
 * not decide a point about the round trip.
 */
const RESTING = TILE / 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("cuts a shaft and flies back to the row it set out from", async () => {
  await openScene(h);
  // The cells to cut, and the floor that stops the descent under them.
  for (let row = ROW; row <= ROW + DEPTH; row += 1) {
    await h.debug.setTile(COL, row, "rock");
  }
  await standOn(h, COL, ROW);
  const startY = minerYOn(ROW);
  assertEqual((await h.snapshot()).miner.y, startY, "specs/instrumentation.md");

  const trip = await captureReplay(h, "round-trip", async () => {
    for (let row = ROW; row < ROW + DEPTH; row += 1) {
      const cut = await driveCut(h, "down", { col: COL, row });
      if (!cut.broke)
        return { sunk: row - ROW, climbed: false, y: cut.snapshot.miner.y };
    }
    const bottom = await h.snapshot();
    await h.hold(ACTION_KEY.up);
    try {
      const up = await h.until((s) => s.miner.y <= startY, {
        maxFrames: CLIMB_FRAMES,
      });
      return { sunk: DEPTH, climbed: up.hit, y: up.snapshot.miner.y, bottom };
    } finally {
      await h.release(ACTION_KEY.up);
    }
  });

  assertEqual(trip.sunk, DEPTH, "specs/character.md");
  // Every cell of the shaft really is open tunnel.
  for (let row = ROW; row < ROW + DEPTH; row += 1) {
    assertEqual(
      (await h.tileAt(COL, row)).kind,
      "tunnel",
      "specs/character.md",
    );
  }
  // The miner reached the bottom of what it cut, so the climb is a climb.
  assertBetween(
    trip.bottom?.miner.y ?? Number.NaN,
    minerYOn(ROW + DEPTH) - RESTING,
    minerYOn(ROW + DEPTH) + RESTING,
    "specs/character.md",
  );
  assertEqual(trip.climbed, true, "specs/character.md");
  assertLessThanOrEqual(trip.y, startY, "specs/character.md");
});
