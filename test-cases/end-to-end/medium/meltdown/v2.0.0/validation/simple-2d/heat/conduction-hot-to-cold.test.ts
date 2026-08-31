// Meltdown — heat/conduction-hot-to-cold: heat conducts to a cooler neighbour.
//
// specs/heat.md gives conduction as
// `conduct(T) = COND_K * sharedEdges(T, N) * (H_N - H_T)`, summed over every
// emitter `T` touches, with `COND_K` `3.5` per shared edge-tile per degree per
// second, and divides the whole change by the tower's own mass. Two flush 2x2
// Arcs share two edge-tiles (specs/towers.md gives the footprint; specs/heat.md
// counts one edge-tile per tile of the side), so at `90` and `10` the flow is
// `3.5 * 2 * 80`, which is `560` per second: the hot tower loses it and the cool
// tower gains it, each over its own mass of `1.0`.
//
// EVERY OTHER FLOW IS POSED OUT OF THE ARRANGEMENT, so the number read is the
// conduction and nothing else. Each subject has its three remaining faces walled
// by a tower AT ITS OWN HEAT:
//
//   - the walls block those faces, and an edge-tile facing another tower sheds
//     nothing to air (specs/heat.md), so the air term is exactly zero rather than
//     a two-percent correction the reading would have to carry;
//   - the walls are at the subject's own heat, so they conduct nothing with it —
//     a gradient of zero, not a faculty switched off, so the reading does not
//     rest on `setTowerThermal` being honoured;
//   - and it is ONE frame, so the walls' own cooling cannot reach either subject:
//     every term of a frame is computed from the heats the frame opened with.
//
// What is left is one flow across one contact, and both ends of it are read.

import { afterEach, beforeEach, it } from "vitest";
import { COND_K } from "../../src/constants";
import { assertCloseTo } from "../assert";
import { sizeOf } from "../geometry";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  seconds,
  startRun,
  towerOf,
  type Harness,
} from "../harness";
import { wallFaces, type Footprint } from "./faces";
import { massOf } from "./roster";
import { BOXED_SITE } from "./sites";

/** The pair, and the two heats they open at. */
const TOWER = "arc";
const HOT = 90;
const COOL = 10;

/** A 2x2 face is two edge-tiles, so two flush 2x2 footprints share two. */
const SHARED_EDGES = sizeOf(TOWER);

/** `3.5 * 2 * (90 - 10)` per second, which is 560. */
const EXPECTED_FLOW = COND_K * SHARED_EDGES * (HOT - COOL);

/** The frame the exchange is measured over, in seconds of game time. */
const DT = seconds(1);

/** What each end of the contact must move over that frame, over its own mass. */
const EXPECTED_HOT_LOSS = (EXPECTED_FLOW * DT) / massOf(TOWER);
const EXPECTED_COOL_GAIN = (EXPECTED_FLOW * DT) / massOf(TOWER);

/**
 * How close each end must come, as decimal places of a heat point.
 *
 * Two places is `0.005`, a tenth of one percent of the `4.667` each end moves.
 * The arrangement leaves the frame's arithmetic as one multiplication over
 * figures the specification states exactly — no air term, no mover term, no
 * second neighbour — so a conformant build lands on it to within float slack.
 * What the bound excludes is every wrong reading of the rule: conducting per FACE
 * rather than per edge-tile halves it, dropping the mass division changes it on
 * any other pair, and conducting toward the hotter side reverses its sign.
 */
const HEAT_DIGITS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Heat conducts to a cooler neighbour", async () => {
  startRun(h);
  const hotAt: Footprint = {
    type: TOWER,
    col: BOXED_SITE.col,
    row: BOXED_SITE.row,
  };
  const coolAt: Footprint = {
    type: TOWER,
    col: BOXED_SITE.col,
    row: BOXED_SITE.row + sizeOf(TOWER),
  };
  const hot = poseIdleTower(h, TOWER, hotAt.col, hotAt.row, 0, HOT);
  const cool = poseIdleTower(h, TOWER, coolAt.col, coolAt.row, 0, COOL);
  wallFaces(h, hotAt, ["N", "E", "W"], { wall: TOWER, heat: HOT });
  wallFaces(h, coolAt, ["E", "W", "S"], { wall: TOWER, heat: COOL });

  await h.advance(1);
  captureStill(h, "conduct");
  const exchanged = h.snapshot();

  assertCloseTo(
    HOT - towerOf(exchanged, hot).heat,
    EXPECTED_HOT_LOSS,
    HEAT_DIGITS,
    `the heat the tower at ${HOT} loses over one frame across ` +
      `${SHARED_EDGES} shared edge-tiles`,
  );
  assertCloseTo(
    towerOf(exchanged, cool).heat - COOL,
    EXPECTED_COOL_GAIN,
    HEAT_DIGITS,
    `the heat the tower at ${COOL} gains over that same frame`,
  );
});
