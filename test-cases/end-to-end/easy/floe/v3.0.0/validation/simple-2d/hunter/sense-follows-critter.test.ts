// hunter/sense-follows-critter — a bear hunts the tile the critter is on, and
// follows it there within a tick of each hop.
//
// specs/hunter.md: "A bear's target is the tile the critter is on, read afresh
// every tick." So the target is not the tile the critter was on when the bear
// emerged, nor a tile refreshed on some slower cadence: each hop is answered on
// the next tick after the one that delivered it.
//
// WHY THE READING IS TAKEN ONE TICK AFTER THE HOP. Both the sense and the hop
// happen inside a tick, and specs/instrumentation.md fixes their order — the hunt
// runs before the crossing, so on the tick a hop lands the bear has already read
// the tile the critter was on before it. "Within a tick of each hop" is therefore
// the tick after, and that is what this reads. A build that refreshes on a slower
// cadence than every tick — every few frames, or on the bear's own settling —
// still holds the old tile there.
//
// The bear is posed with its routing and its travel off, so what is read is its
// SENSE and nothing else: it neither chooses a step nor moves, and its target is
// the only thing about it that can change. It is frozen HALF A TILE into a step
// rather than settled on one, so a build that refreshed its target only when a
// bear settles never refreshes it here and reads a stale tile. The critter is moved by REAL HOPS,
// each driven as the one tick that delivers the press.
//
// The strait is emptied and the hops run up the ice band, so no hop is refused by
// traffic and the tile the critter lands on is the tile it aimed for.

import { afterEach, beforeEach, it } from "vitest";
import { ROW_NEAR, TILE, tileCX, tileCY } from "../constants";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import {
  HOP_COOLDOWN_TICKS,
  bearOf,
  captureReplay,
  createHarness,
  critterTile,
  keyFor,
  poseBear,
  sameTile,
  startCrossing,
  tileKey,
  type Facing,
  type Harness,
  type Tile,
} from "../harness";
import { bearStepTile, bearTile } from "./harness";

/** Where the bear watches from: far enough off to be a spectator, on solid ice. */
const BEAR_COL = 5;
const BEAR_ROW = ROW_NEAR - 4;

/** The hops driven, up the ice band and then along it. */
const HOPS: readonly Facing[] = ["up", "up", "right"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
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
  const watching = bearOf(h.snapshot(), id);
  assertEqual(
    sameTile(bearTile(watching), bearStepTile(watching)),
    false,
    "the bear settled, which the mid-glide pose is meant to prevent",
  );

  const readings: { critter: Tile; target: Tile }[] = [];
  await captureReplay(h, "pursue", async () => {
    // The tile the critter starts a crossing on, before any hop.
    await h.advance(1);
    const opening = h.snapshot();
    readings.push({
      critter: critterTile(opening),
      target: bearOf(opening, id).target,
    });

    for (const direction of HOPS) {
      // The press, the tick that delivers it, and then the one tick the rule
      // allows the bear to answer it in. The cooldown is run out afterwards, so
      // the reading is taken well inside it.
      await h.tap(keyFor(direction));
      await h.advance(1);
      const hopped = h.snapshot();
      readings.push({
        critter: critterTile(hopped),
        target: bearOf(hopped, id).target,
      });
      await h.advance(HOP_COOLDOWN_TICKS);
    }
  });

  // The scenario really did move the critter, so a target that matched
  // throughout matched a tile that changed rather than one that never did.
  const visited = new Set(readings.map((reading) => tileKey(reading.critter)));
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
        : `the bear's target a tick after hop ${index} (${HOPS[index - 1]})`,
    );
  }
});
