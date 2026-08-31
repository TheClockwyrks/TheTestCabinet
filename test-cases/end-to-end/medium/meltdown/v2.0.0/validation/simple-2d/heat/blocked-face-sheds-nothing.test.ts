// Meltdown — heat/blocked-face-sheds-nothing: a face against a tower sheds nothing.
//
// specs/heat.md classifies every perimeter edge-tile by what lies immediately
// outside it, and is flat about the tower case: "An edge-tile facing another
// tower sheds nothing to air." So an Arc with one face flush against a neighbour
// has only its other three faces in the air term.
//
// THE FIGURE. specs/towers.md gives the Arc a 2x2 footprint with radiator faces N
// and S, so with a neighbour flush against N the tower has one radiator face open
// (two edge-tiles) and two plain ones (four), and at heat `80` it loses
// `(3.6 * 2 + 1.1 * 4) * 0.80` per second, which is `9.28`. The same Arc with
// nothing against it loses `15.04`, so a build that goes on shedding through the
// blocked face reads sixty percent high.
//
// THE NEIGHBOUR IS AT THE SUBJECT'S OWN HEAT, so nothing conducts across the face
// they share: specs/heat.md has two emitters at the same heat exchange nothing.
// That is a gradient of zero rather than a faculty switched off, so the reading
// does not rest on `setTowerThermal` being honoured. One frame, so the
// neighbour's own cooling cannot reach the subject either — every term of a frame
// is computed from the heats that frame opened with.

import { afterEach, beforeEach, it } from "vitest";
import { BASE_K, RAD_K, TRIP_HEAT } from "../../src/constants";
import { assertCloseTo } from "../assert";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  seconds,
  startRun,
  towerOf,
  type Face,
  type Harness,
} from "../harness";
import { wallFaces } from "./faces";
import { BOXED_SITE } from "./sites";

/** The emitter read, the face its neighbour stands against, and the heat. */
const TOWER = "arc";
const BLOCKED_FACE: Face = "N";
const HEAT = 80;

/**
 * The Arc's edge-tiles left on air, from specs/towers.md: its radiator faces are
 * N and S, so blocking N leaves the S radiator face (two edge-tiles) and both
 * plain faces (four) shedding.
 */
const OPEN_RADIATOR_EDGES = 2;
const OPEN_PLAIN_EDGES = 4;

/** `(3.6 * 2 + 1.1 * 4) * 0.80` per second, which is 9.28. */
const EXPECTED_RATE =
  (RAD_K * OPEN_RADIATOR_EDGES + BASE_K * OPEN_PLAIN_EDGES) *
  (HEAT / TRIP_HEAT);

/** The frame the rate is measured over, in seconds of game time. */
const DT = seconds(1);

/**
 * How close the measured rate must come, as decimal places of heat per second.
 *
 * One place is `0.05` of a heat point per second, half of one percent of the
 * `9.28` required. The measurement is one frame of a build's own arithmetic over
 * figures the specification states exactly, so a conformant build needs none of
 * the room; the bound is a hundred times smaller than the distance to the wrong
 * model this item exists to name — shedding through the blocked face as well
 * reads `15.04`.
 */
const RATE_DIGITS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("A face against a tower sheds nothing", async () => {
  startRun(h);
  const site = BOXED_SITE;
  const id = poseIdleTower(h, TOWER, site.col, site.row, 0, HEAT);
  wallFaces(h, { type: TOWER, col: site.col, row: site.row }, [BLOCKED_FACE], {
    wall: TOWER,
    heat: HEAT,
  });

  const opened = towerOf(h.snapshot(), id).heat;
  await h.advance(1);
  captureStill(h, "blocked");
  const closed = towerOf(h.snapshot(), id).heat;

  assertCloseTo(
    (opened - closed) / DT,
    EXPECTED_RATE,
    RATE_DIGITS,
    `heat per second an ${TOWER} at ${HEAT} with its ${BLOCKED_FACE} face ` +
      `flush against a neighbour sheds`,
  );
});
