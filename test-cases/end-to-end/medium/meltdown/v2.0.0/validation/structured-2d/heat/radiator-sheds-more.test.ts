// Meltdown — heat/radiator-sheds-more: a radiator face sheds better.
//
// specs/heat.md gives air cooling two constants, one per kind of edge-tile:
// `RAD_K` `3.6` on a radiator face and `BASE_K` `1.1` on a plain one, so a
// radiator edge-tile sheds `3.6 / 1.1` times what a plain one does — a factor of
// `3.2727`. specs/towers.md gives the Arc its radiator faces as N and S in local
// orientation.
//
// THE TWO ARRANGEMENTS DIFFER IN ONE THING ONLY. The same tower at the same heat
// is walled on three of its four faces, so exactly one face is on air and both
// readings have the same NUMBER of open edge-tiles — two, a 2x2 face — leaving
// the KIND of face as the only difference between them:
//
//   - N open: a radiator face, `3.6 * 2 * 0.80` per second, which is `5.76`;
//   - E open: a plain face,    `1.1 * 2 * 0.80` per second, which is `1.76`.
//
// So the ratio is the two constants and nothing else, and a build that treats
// every face alike reads `1`. That a face sheds per edge-tile rather than per face
// is `heat/edge-tiles-count`; that a walled face sheds nothing is
// `heat/blocked-face-sheds-nothing`.
//
// The walls stand at the subject's own heat, so nothing conducts through them,
// and each reading is one frame, so the walls' own cooling cannot reach the
// subject. The second arrangement is posed on a floor of its own rather than by
// moving walls around the first, so neither reading inherits anything from the
// other.

import { afterEach, beforeEach, it } from "vitest";
import { BASE_K, RAD_K } from "../constants";
import { assertCloseTo, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  startRun,
  type Face,
  type Harness,
} from "../harness";
import { SIDES, wallFaces } from "./faces";
import { towerOf } from "./roster";
import { BOXED_SITE } from "./sites";

/** The emitter read, and the heat both arrangements are posed at. */
const TOWER = "arc";
const HEAT = 80;

/** The Arc's radiator faces are N and S (specs/towers.md), so N is one. */
const RADIATOR_FACE: Face = "N";
/** E is therefore a plain face. */
const PLAIN_FACE: Face = "E";

/** What the two constants require of the ratio: 3.6 / 1.1, which is 3.2727. */
const EXPECTED_RATIO = RAD_K / BASE_K;

/**
 * How close the ratio must come, as decimal places.
 *
 * Two places is `0.005`, under two tenths of one percent of the `3.2727`
 * required. Each loss is one frame of a build's own arithmetic over an
 * arrangement whose only difference from the other is which face is open, so a
 * conformant build lands on the ratio of the two constants to within float slack.
 * The bound is four hundred times smaller than the distance to the wrong model
 * this item exists to name: one face kind reads `1`.
 */
const RATIO_DIGITS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * The heat one frame takes off an Arc posed with `open` on air and its other
 * three faces walled at its own heat.
 */
async function lossWithOpenFace(open: Face): Promise<number> {
  startRun(h);
  const site = BOXED_SITE;
  const id = poseIdleTower(h, TOWER, site.col, site.row, 0, HEAT);
  const walled = SIDES.filter((face) => face !== open);
  wallFaces(h, { type: TOWER, col: site.col, row: site.row }, walled, {
    wall: TOWER,
    heat: HEAT,
  });

  const opened = towerOf(h.snapshot(), id).heat;
  await h.advance(1);
  return opened - towerOf(h.snapshot(), id).heat;
}

it("A radiator face sheds better", async () => {
  const radiatorLoss = await lossWithOpenFace(RADIATOR_FACE);
  const plainLoss = await lossWithOpenFace(PLAIN_FACE);
  captureStill(h, "radiator");

  assertGreaterThan(
    radiatorLoss,
    plainLoss,
    `the loss with the ${RADIATOR_FACE} radiator face open against the loss ` +
      `with only the plain ${PLAIN_FACE} face open`,
  );
  assertCloseTo(
    radiatorLoss / plainLoss,
    EXPECTED_RATIO,
    RATIO_DIGITS,
    `that ratio, which specs/heat.md puts at RAD_K ${RAD_K} over BASE_K ` +
      `${BASE_K}`,
  );
});
