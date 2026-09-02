// Meltdown — heat/air-cooling-rate: open faces shed at the stated rate.
//
// specs/heat.md gives air cooling as
// `airLoss(T) = (RAD_K * radiatorEdges(T) + BASE_K * plainEdges(T)) * (H_T / 100)`
// with `RAD_K` `3.6` and `BASE_K` `1.1`, counted per EDGE-TILE and per second.
// specs/towers.md gives the Arc a 2x2 footprint with radiator faces N and S, so a
// lone Arc has four radiator edge-tiles and four plain ones, every one of them on
// open floor. At heat `80` it therefore loses `(3.6 * 4 + 1.1 * 4) * 0.80` per
// second, which is `15.04`.
//
// POSED AT 80 RATHER THAN 100, so no reading of the trip boundary can change the
// answer: at `100` a build that trips on the state rather than on the crossing
// would take the tower offline and bleed it at `20` per second instead.
//
// The tower is idle (`poseIdleTower`), so its guns add nothing while the loss is
// measured, and it stands at a quiet anchor where all four faces look onto open
// floor and nothing else is on the floor to conduct with it. ONE frame, because
// air cooling is proportional to heat: over two frames the second is taken at a
// heat the first moved, and the reading would be an integral rather than the rate
// the specification states.

import { afterEach, beforeEach, it } from "vitest";
import { BASE_K, RAD_K, TRIP_HEAT } from "../constants";
import { assertCloseTo } from "../assert";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  seconds,
  startRun,
  towerOf,
  type Harness,
} from "../harness";
import { FREE_SITE } from "./sites";

/** The emitter read, and the heat it is posed at. */
const TOWER = "arc";
const HEAT = 80;

/**
 * The Arc's edge-tiles, from specs/towers.md: a 2x2 footprint is two edge-tiles
 * per face, and its radiator faces are N and S, so two faces are radiator (four
 * edge-tiles) and two are plain (four).
 */
const RADIATOR_EDGES = 4;
const PLAIN_EDGES = 4;

/** `(3.6 * 4 + 1.1 * 4) * 0.80` per second, which is 15.04. */
const EXPECTED_RATE =
  (RAD_K * RADIATOR_EDGES + BASE_K * PLAIN_EDGES) * (HEAT / TRIP_HEAT);

/** The frame the rate is measured over, in seconds of game time. */
const DT = seconds(1);

/**
 * How close the measured rate must come, as decimal places of heat per second.
 *
 * One place is `0.05` of a heat point per second, a third of one percent of the
 * `15.04` the specification requires. The measurement is one frame of a build's
 * own arithmetic over figures the specification states exactly, so a conformant
 * build has no need of the room; what the bound excludes is every other reading
 * of the rule — treating both face kinds alike reads `8.8` or `28.8`, dropping
 * the proportionality to heat reads `18.8`, and shedding per FACE rather than per
 * edge-tile reads half.
 */
const RATE_DIGITS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Open faces shed at the stated rate", async () => {
  startRun(h);
  const id = poseIdleTower(h, TOWER, FREE_SITE.col, FREE_SITE.row, 0, HEAT);
  const opened = towerOf(h.snapshot(), id).heat;

  await h.advance(1);
  captureStill(h, "shedding");
  const closed = towerOf(h.snapshot(), id).heat;

  assertCloseTo(
    (opened - closed) / DT,
    EXPECTED_RATE,
    RATE_DIGITS,
    `heat per second a lone ${TOWER} at ${HEAT} sheds through ` +
      `${RADIATOR_EDGES} radiator and ${PLAIN_EDGES} plain edge-tiles`,
  );
});
