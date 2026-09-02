// scoring/refused-hop-scores-nothing — a hop the rules refuse pays nothing,
// whichever rule refused it.
//
// specs/scoring.md: "Nothing else scores. A hop that is refused, a hop to a row
// already reached this crossing, and a life lost all add nothing."
// specs/hopping.md says the same from the other side: "A refused hop leaves
// everything as it was: the critter stays where it stands with the same facing,
// the cooldown is untouched, no life is lost, and nothing is scored."
//
// ALL FOUR REFUSALS THE SPECIFICATION FIXES ARE DRIVEN, one after another on one
// strait, and the score is read across each press on its own with the refusal
// named, so a failure says which rule's refusal paid out. specs/hopping.md
// refuses a hop whose target tile is outside the grid, on the cap, on the bay row
// at a column no bay covers, on the bay row at a filled bay, or covered by a
// vehicle; the four scenarios below are the solid far shore between two bays, a
// bay already filled, a vehicle, and the left edge of the strait. (The cap is
// reachable only from the bay row, which a crossing never stands on, so it is not
// a hop a scenario can pose from.)
//
// EACH REFUSAL IS READ AS A REFUSAL FIRST. The critter's tile is checked before
// the score, because "the refused hop paid nothing" is worth nothing of a hop the
// build actually TOOK: a build that let the critter through and then scored
// nothing must fail here, and it fails naming the tile it moved to. Which rule
// refuses which target is `hopping`'s own set of points; what is decided here is
// the payout.
//
// THE CROSSING TIMER IS LEFT WHERE A FRESH CROSSING PUTS IT — 30 s, held by the
// timer gate `startCrossing` shuts — because it is the distinguishing value: a
// build that treats a refused hop as a completed crossing reads 120 rather than
// 0, one that pays the row award on a refusal reads 10, and one that pays a time
// bonus alone reads 60.
//
// EACH SCENARIO IS POSED ON A STRAIT OF ITS OWN. The critter is moved to solid
// near shore, both rosters are emptied and all five bays are opened, and only
// then is the one thing the refusal turns on put back. So nothing carries between
// the four, and no scenario is decided by something a previous one left behind.
// The critter is put down fresh with `addCritter`, which takes `bestRow` to the
// row it lands on (specs/instrumentation.md), so no scenario's hop could reach a
// new row even if the build took it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  BAYS,
  ICE_BOTTOM,
  ROW_NEAR,
  START_COL,
  START_LIVES,
  WATER_TOP,
} from "../constants";
import {
  bayAt,
  captureReplay,
  createHarness,
  keyFor,
  poseLane,
  startCrossing,
  ticksFor,
  type FloeSnapshot,
  type Harness,
} from "../harness";

/** The column of solid far shore hopped at: three clear of bay 0 and four of bay 1. */
const SHORE_COL = 7;

/** The bay posed filled, and the column of it the hop is taken under. */
const FILLED_BAY = 3;
const FILLED_COL = BAYS[FILLED_BAY][0];

/** The column the vehicle covers, on the ice row the near shore looks up at. */
const VEHICLE_ROW = ICE_BOTTOM;
const VEHICLE_COL = START_COL;

/** The leftmost column, from which a hop left leaves the grid. */
const EDGE_COL = 0;

/** What every one of the four hops pays. */
const EXPECTED_AWARD = 0;

/** Frames run on after each refused press, so a refusal that only delays is caught. */
const SETTLE_FRAMES = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** One refused hop: the score standing before it, and the strait once it settled. */
interface Press {
  before: number;
  at: FloeSnapshot;
}

/**
 * Empty the strait for the next scenario.
 *
 * The critter goes to the near shore FIRST, which is solid across its whole width
 * (specs/strait.md), so it is never left standing on open water for a frame to
 * find (specs/water.md) — no frame runs between these poses, and the ordering
 * keeps it that way whatever a later edit adds.
 */
function emptyStrait(): void {
  h.debug.addCritter(START_COL, ROW_NEAR);
  h.debug.clearFloes();
  h.debug.clearVehicles();
  h.debug.clearBays();
}

/** Drive one hop, and report the score it opened on and the strait it left. */
async function press(direction: "up" | "left"): Promise<Press> {
  const before = h.snapshot().score;
  await h.tap(keyFor(direction));
  await h.advance(SETTLE_FRAMES);
  return { before, at: h.snapshot() };
}

it("pays nothing for a hop refused by the shore, a filled bay, a vehicle or an edge", async () => {
  // The column hopped at is only solid shore if the specification leaves it so,
  // and the filled one is only a bay's if the specification says it is.
  assertNull(bayAt(SHORE_COL), `column ${SHORE_COL} covered by no bay`);
  assertEqual(
    bayAt(FILLED_COL),
    FILLED_BAY,
    `column ${FILLED_COL} covered by bay ${FILLED_BAY}`,
  );

  startCrossing(h);

  const refusals = await captureReplay(h, "score", async () => {
    // The solid far shore between two bays. The critter stands on a still pan,
    // because row 2 is deep water and a critter no floe covers falls in on that
    // very frame (specs/water.md).
    emptyStrait();
    poseLane(h, WATER_TOP, "pan", [SHORE_COL]);
    h.debug.addCritter(SHORE_COL, WATER_TOP);
    const shore = await press("up");

    // A bay that is already filled, entered from its own column.
    emptyStrait();
    poseLane(h, WATER_TOP, "pan", [FILLED_COL]);
    h.debug.addCritter(FILLED_COL, WATER_TOP);
    h.debug.setBay(FILLED_BAY, true);
    const bay = await press("up");

    // A vehicle covering the target tile, hopped at from the near shore below it.
    // The lane is stopped, so the vehicle sits on the column it was laid on.
    emptyStrait();
    poseLane(h, VEHICLE_ROW, "car", [VEHICLE_COL]);
    h.debug.addCritter(VEHICLE_COL, ROW_NEAR);
    const vehicle = await press("up");

    // The left edge of the strait: the target tile is off the grid.
    emptyStrait();
    h.debug.addCritter(EDGE_COL, ROW_NEAR);
    const edge = await press("left");

    return { shore, bay, vehicle, edge };
  });

  const cases: readonly {
    label: string;
    press: Press;
    col: number;
    row: number;
  }[] = [
    {
      label: "the solid far shore",
      press: refusals.shore,
      col: SHORE_COL,
      row: WATER_TOP,
    },
    {
      label: "a filled bay",
      press: refusals.bay,
      col: FILLED_COL,
      row: WATER_TOP,
    },
    {
      label: "a vehicle",
      press: refusals.vehicle,
      col: VEHICLE_COL,
      row: ROW_NEAR,
    },
    {
      label: "the left edge",
      press: refusals.edge,
      col: EDGE_COL,
      row: ROW_NEAR,
    },
  ];

  for (const { label, press: refused, col, row } of cases) {
    const { before, at } = refused;
    // The hop must really have been refused, or "it scored nothing" decides
    // nothing. Which rule refuses which target is `hopping`'s point.
    assertEqual(
      at.critter.present,
      true,
      `${label}: the critter still crossing`,
    );
    assertEqual(at.critter.col, col, `${label}: the column it stood on`);
    assertEqual(at.critter.row, row, `${label}: the row it stood on`);
    assertEqual(
      at.lives,
      START_LIVES,
      `${label}: the lives the run began with`,
    );
    // The DIFFERENCE across the press, so that a build which scored something on
    // the pose that arranged the scenario fails the pose rather than this point.
    assertEqual(at.score - before, EXPECTED_AWARD, `${label}: nothing paid`);
  }
});
