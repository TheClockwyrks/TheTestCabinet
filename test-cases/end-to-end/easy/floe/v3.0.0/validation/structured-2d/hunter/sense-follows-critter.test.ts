// hunter/sense-follows-critter — a bear hunts the tile the critter is on, and
// follows it there the moment it hops.
//
// specs/hunter.md: "A bear's target is the tile the critter is on, read afresh
// every tick." So the target is not the tile the critter was on when the bear
// emerged, nor a tile refreshed on some slower cadence: each hop is answered on
// the tick that delivers it.
//
// The bear is posed with its routing and its travel off, so what is read is its
// SENSE and nothing else: it neither chooses a step nor moves, and its target is
// the only thing about it that can change. The critter is moved by REAL HOPS,
// each driven as the one frame the direction is held for, so the reading really
// is taken within a tick of the hop rather than a cooldown later.
//
// The strait is emptied and the hops run up the ice band, so no hop is refused by
// traffic and the tile the critter lands on is the tile it aimed for.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThanOrEqual } from "../assert";
import { ROW_NEAR } from "../../src/constants";
import {
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
