// Meltdown — heat/cooling-scales-with-heat: cooling is proportional to heat.
//
// specs/heat.md makes air cooling proportional to `H / 100`:
// `airLoss(T) = (RAD_K * radiatorEdges(T) + BASE_K * plainEdges(T)) * (H_T / 100)`,
// and says what that is for — "a tower sheds most near the trip and almost
// nothing when cold". So the SAME tower, with the same faces on the same open
// floor, loses exactly half as much over a frame at heat `40` as it does at heat
// `80`.
//
// THE RATIO IS THE READING, not either loss. What each loss comes to is
// `heat/air-cooling-rate`'s requirement; what this item decides is that the loss
// tracks the heat, so the two losses are measured on one tower at two heats and
// divided. A build that sheds a fixed amount per open edge-tile regardless of
// heat reads a ratio of `1`.
//
// Each loss is measured over ONE frame, from a heat posed immediately before it,
// so neither reading is taken at a heat the frame before it had already moved.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  startRun,
  type Harness,
} from "../harness";
import { towerOf } from "./roster";
import { FREE_SITE } from "./sites";

/** The emitter read, and the two heats it is read at. */
const TOWER = "arc";
const HOT = 80;
const COOL = 40;

/** What proportionality requires of the two losses: 80 / 40. */
const EXPECTED_RATIO = HOT / COOL;

/**
 * How close the ratio must come, as decimal places.
 *
 * Two places is `0.005`, a quarter of one percent of the `2` required. Both
 * losses are single frames of a build's own arithmetic over one tower and one
 * face layout, so everything about the arrangement that could differ between them
 * has been held fixed and a conformant build lands on `2` to within float slack.
 * The bound is two hundred times smaller than the distance to the wrong model
 * this item exists to name: cooling that ignores heat reads `1`.
 */
const RATIO_DIGITS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The heat one frame takes off the tower `id`, posed at `heat` first. */
async function lossAt(id: number, heat: number): Promise<number> {
  h.debug.setTowerHeat(id, heat);
  const opened = towerOf(h.snapshot(), id).heat;
  await h.advance(1);
  return opened - towerOf(h.snapshot(), id).heat;
}

it("Cooling is proportional to heat", async () => {
  startRun(h);
  const id = poseIdleTower(h, TOWER, FREE_SITE.col, FREE_SITE.row, 0, HOT);

  const hotLoss = await lossAt(id, HOT);
  const coolLoss = await lossAt(id, COOL);
  captureStill(h, "scaled");

  assertGreaterThan(coolLoss, 0, `the loss at heat ${COOL} is a real loss`);
  assertCloseTo(
    hotLoss / coolLoss,
    EXPECTED_RATIO,
    RATIO_DIGITS,
    `the loss at heat ${HOT} over the loss at heat ${COOL}`,
  );
});
