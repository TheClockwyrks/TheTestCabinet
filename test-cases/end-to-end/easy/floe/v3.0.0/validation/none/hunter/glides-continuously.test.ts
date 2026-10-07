// hunter/glides-continuously — a bear travels continuously between two tiles
// rather than jumping from one to the next.
//
// specs/hunter.md: "A bear travels continuously along one grid axis at a time",
// and while it is between tiles it occupies both of them. So a bear given one step
// spends the crossing of that tile with its centre STRICTLY BETWEEN the two tile
// centres, on tick after tick; a build that teleports its bear a tile at a time is
// never between them on any tick at all.
//
// The scenario is the median (`ROW_MEDIAN`), which is the one row of the strait
// that carries no lane: nothing can be on it, nothing can arrive on it, and the
// bear's footing there is ice, so the tick count below rests on nothing the
// scenario has to keep quiet. The bear is posed with its sense and its routing
// off, so the step it takes is the one this check gave it and no route can
// redirect it mid-tile.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThanOrEqual } from "../assert";
import { ROW_MEDIAN, tileCX } from "../constants";
import {
  bearStepTile,
  captureReplay,
  createHarness,
  poseBear,
  requireBear,
  startCrossing,
  type Harness,
} from "../harness";
import { samplePerTick } from "./harness";

/** The tile the bear is settled on, and the one it is stepped into. */
const FROM_COL = 12;
const TO_COL = FROM_COL + 1;

/** The consecutive ticks between the two centres the item asks for. */
const MIN_BETWEEN_TICKS = 4;

/**
 * Ticks driven, which must not carry the bear past the tile it is entering.
 *
 * At `BEAR_ICE_SPEED` (3) tiles a second a tile is 40 ticks wide, so twelve ticks
 * is well inside it at the specified speed and still inside it for a build up to
 * three times too fast. It is not a speed requirement: `ice-speed` grades the
 * rate, and a build outside that window fails there rather than being called a
 * hopper here.
 */
const DRIVE_TICKS = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spends consecutive ticks between the two tile centres", async () => {
  await startCrossing(h);
  const id = await poseBear(h, FROM_COL, ROW_MEDIAN, {
    sense: false,
    routing: false,
  });
  await h.debug.setBearStep(id, "right");

  // The scenario this check needs: the bear really is committed to the step into
  // the neighbouring tile, so what is read below is the crossing of that tile
  // rather than a bear that was never sent anywhere.
  assertDeepEqual(
    bearStepTile(
      requireBear(await h.snapshot(), id, "the bear given one step"),
    ),
    { col: TO_COL, row: ROW_MEDIAN },
    "the tile the bear is travelling into",
  );

  const samples = await captureReplay(h, "glide", () =>
    samplePerTick(h, DRIVE_TICKS),
  );

  const from = tileCX(FROM_COL);
  const to = tileCX(TO_COL);
  let run = 0;
  let longest = 0;
  for (const snapshot of samples) {
    const bear = snapshot.bears.find((entry) => entry.id === id);
    const between = bear !== undefined && bear.x > from && bear.x < to;
    run = between ? run + 1 : 0;
    longest = Math.max(longest, run);
  }

  assertGreaterThanOrEqual(
    longest,
    MIN_BETWEEN_TICKS,
    `consecutive ticks with the bear's centre strictly between ` +
      `x=${from} and x=${to}`,
  );
});
