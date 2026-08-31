// hunter/sense-follows-critter — a bear hunts the tile the critter is on, and
// follows it there the moment it hops.
//
// specs/hunter.md: "A bear's target is the tile the critter is on, read afresh
// EVERY TICK." So the target is not the tile the critter was on when the bear
// emerged, nor a tile refreshed on some slower cadence: each hop is answered on
// the tick that delivers it.
//
// THE BEAR IS POSED MID-GLIDE, and that is what makes this a reading of "every
// tick". A bear spends most of its ticks between two tiles, and a build that
// refreshed its target only on the ticks it SETTLES would report the right tile
// for a settled bear and a stale one for this bear — so posing it settled would
// grade a cadence rule with a scenario the cadence cannot show up in. It is put
// half a tile along a step with its travel off, so it stays exactly there while
// the critter hops around it.
//
// Its routing and its travel are off, so what is read is its SENSE and nothing
// else: it neither chooses a step nor moves, and its target is the only thing
// about it that can change. The critter is moved by REAL HOPS, each driven as the
// one frame the direction is held for, so the reading really is taken within a
// tick of the hop rather than a cooldown later.
//
// The strait is emptied and the hops run up the ice band, so no hop is refused by
// traffic and the tile the critter lands on is the tile it aimed for. The bear's
// own row is emptied ice too, so the step it is frozen on is one nothing arrives
// on.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertGreaterThanOrEqual,
  assertEqual,
} from "../assert";
import { ROW_NEAR, TILE, tileCX, tileCY } from "../../src/constants";
import {
  bearSettled,
  captureReplay,
  createHarness,
  critterTile,
  hop,
  poseBear,
  restHop,
  startCrossing,
  type Harness,
} from "../harness";
import { requireBear } from "./harness";

/** Where the bear watches from: far enough off to be a spectator, on solid ice. */
const BEAR_COL = 5;
const BEAR_ROW = ROW_NEAR - 4;

/** The hops driven, up the ice band and then along it. */
const HOPS = ["up", "up", "right"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reports the critter's tile as its target within a tick of each hop", async () => {
  startCrossing(h);
  const id = poseBear(h, BEAR_COL, BEAR_ROW, {
    routing: false,
    travel: false,
  });
  // Frozen half a tile into a step, so it is between two tiles for every reading
  // below rather than settled on one.
  h.debug.setBearStep(id, "right");
  h.debug.setBearPosition(id, tileCX(BEAR_COL) + TILE / 2, tileCY(BEAR_ROW));

  // The scenario this check needs, read off the game itself: the bear really is
  // between tiles, so a build that refreshed its target only on settling reads a
  // stale tile here rather than the right one for the wrong reason.
  assertEqual(
    bearSettled(requireBear(h.snapshot(), id, "the watching bear")),
    false,
    "the bear settled, which the mid-glide pose is meant to prevent",
  );

  const readings: {
    critter: { col: number; row: number };
    target: { col: number; row: number };
  }[] = [];
  await captureReplay(h, "pursue", async () => {
    // The tile the critter starts a crossing on, before any hop.
    await h.advance(1);
    const opening = h.snapshot();
    readings.push({
      critter: critterTile(opening),
      target: requireBear(opening, id, "the watching bear").target,
    });

    for (const direction of HOPS) {
      // The hop and nothing else: one frame with the direction held, which is
      // how the playing screen reads a movement action (specs/controls.md). The
      // reading is taken before the cooldown is run out.
      await hop(h, direction);
      const hopped = h.snapshot();
      readings.push({
        critter: critterTile(hopped),
        target: requireBear(hopped, id, "the watching bear").target,
      });
      await restHop(h);
    }
  });

  // The scenario really did move the critter, so a target that matched
  // throughout matched a tile that changed rather than one that never did.
  const visited = new Set(
    readings.map((reading) => `${reading.critter.col},${reading.critter.row}`),
  );
  assertGreaterThanOrEqual(
    visited.size,
    2,
    `tiles the critter stood on over ${HOPS.length} hops`,
  );

  for (const [index, reading] of readings.entries()) {
    assertDeepEqual(
      reading.target,
      reading.critter,
      index === 0
        ? "the bear's target before any hop"
        : `the bear's target within a tick of hop ${index} (${HOPS[index - 1]})`,
    );
  }
});
