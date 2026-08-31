// Meltdown — movers/movers-do-not-conduct: a mover conducts nothing.
//
// `specs/heat.md` is explicit that a mover is not a thermal body: "Movers carry no
// heat, so they neither conduct with an emitter nor exchange with each other. They
// only drive the flows above into and out of the emitters they touch." Conduction
// is stated for emitters alone — `conduct(T)` is "summed over every emitter `N`
// that `T` touches" — so a Forge with a hot gun on one side and a cold gun on the
// other is not a bridge between them.
//
// THE ARRANGEMENT IS THE TRAP THIS POINT EXISTS TO CATCH. A level-I Forge with an
// Arc at `90` flush against its west face and an Arc at `10` flush against its
// east face. The two Arcs touch the same mover and touch each other NOWHERE — two
// tiles of Forge sit between them — so any movement of one toward the other has
// gone through the mover, which is the fault.
//
// AND THE READING IS A CONTRAST, NOT A FIGURE, which is what keeps this point
// about the bridge alone. Three arrangements stand on one floor and are read in
// one frame:
//
//   - the pair, hot and cool either side of one Forge;
//   - the hot Arc against a Forge with NOTHING on its far side;
//   - the cool Arc against a Forge with NOTHING on its far side.
//
// Each gun's change over the frame must be exactly what it was WITHOUT the other
// gun on the mover's far side. That is the requirement stated as an experiment,
// and it holds whatever the Forge's own flow turns out to be: a build whose
// `FORGE_K`, whose setpoint table or whose clamp at the setpoint is wrong reads
// the same wrong number in both arrangements and passes this point, failing
// `movers/forge-warms`, `movers/forge-setpoint-scales` or
// `movers/forge-caps-at-its-setpoint` for that instead. What CANNOT survive the
// contrast is a mover that carries heat: a bridge across `90 - 10` degrees at
// `COND_K` `3.5` per shared edge-tile per second moves both guns by whole heat
// points a frame, and only in the arrangement where both are present.
//
// EVERY OTHER FLOW IS POSED OUT OF EVERY GUN. Each has its three remaining faces
// walled by a plain tower AT ITS OWN HEAT, so the air term is exactly zero and
// those contacts conduct nothing — a gradient of zero rather than a faculty
// switched off. It is ONE FRAME, so no wall's own cooling can reach any gun:
// every term of a frame is computed from the heats the frame opened with.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  COND_K,
  FORGE_SETPOINT,
  type Tile,
  type TowerType,
} from "../constants";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  poseTower,
  seconds,
  startRun,
  type Harness,
} from "../harness";
import { sizeOf } from "../thermal";
import { BOXED_SITES, SLOT, WALL, massOf, readHeat } from "./contact";

/** The two guns, and the heats they open at. */
const GUN: TowerType = "arc";
const HOT = 90;
const COOL = 10;

/** The Forge's level, and the setpoint `specs/towers.md` gives it there. */
const LEVEL = 1;
const SETPOINT = FORGE_SETPOINT[LEVEL - 1];

/** A 2x2 face is two edge-tiles, so each gun's contact with the Forge is two. */
const SHARED_EDGES = sizeOf(GUN);

/** The frame every reading is taken over, in seconds of game time. */
const DT = seconds(1);

/**
 * What a build bridging two guns through a mover would move each of them by, in
 * heat points over the frame, at its very weakest.
 *
 * Not a requirement — it is the yardstick the bound below is a fraction of. The
 * weakest such build is one whose mover carries its own setpoint rather than a
 * neighbour's heat, which still conducts across `90 - 72` degrees of difference
 * at `COND_K` `3.5` per shared edge-tile per second. A mover carrying the far
 * gun's heat outright conducts across all eighty.
 */
const WEAKEST_BRIDGE =
  (COND_K * SHARED_EDGES * (HOT - SETPOINT) * DT) / massOf(GUN);

/**
 * How far a gun's change may differ between the two arrangements, in heat
 * points.
 *
 * The specification requires the two to be identical, so the figure is float
 * slack and nothing else: one percent of the weakest bridge a build could build.
 * A build that conducts through the mover misses by a hundred times this, and one
 * whose mover carries a neighbour's heat outright by four thousand times.
 */
const DRIFT = 0.01 * WEAKEST_BRIDGE;

/**
 * Where each arrangement stands: a Forge on a quiet anchor with a gun flush
 * against its west face, its east face, or both.
 *
 * Geometry, not a tolerance. Each anchor is clear of both vent corridors and of
 * the others (`movers/contact.ts`), and a gun is one footprint away on the column
 * axis, so it abuts the Forge along a full face and — when both are present —
 * abuts the other gun at no tile and no corner.
 */
const ARRANGEMENTS = [
  { site: BOXED_SITES[0], hot: true, cool: true, of: "the pair" },
  { site: BOXED_SITES[1], hot: true, cool: false, of: "the hot gun alone" },
  { site: BOXED_SITES[2], hot: false, cool: true, of: "the cool gun alone" },
] as const;

/** Pose a gun at `heat` with its three faces away from the Forge walled. */
async function poseGun(
  h: Harness,
  at: Tile,
  heat: number,
  away: "E" | "W",
): Promise<number> {
  const id = await poseIdleTower(h, GUN, at.col, at.row, { heat });
  const outward =
    away === "E"
      ? { col: at.col + SLOT, row: at.row }
      : { col: at.col - SLOT, row: at.row };
  for (const wall of [
    { col: at.col, row: at.row - SLOT },
    { col: at.col, row: at.row + SLOT },
    outward,
  ]) {
    await poseIdleTower(h, WALL, wall.col, wall.row, { heat });
  }
  return id;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("A mover conducts nothing", async () => {
  await startRun(h);
  const posed = [];
  for (const plan of ARRANGEMENTS) {
    const forge = await poseTower(h, "forge", plan.site.col, plan.site.row);
    if (LEVEL !== 1) await h.debug.setTowerLevel(forge, LEVEL);
    posed.push({
      of: plan.of,
      hot: plan.hot
        ? await poseGun(
            h,
            { col: plan.site.col - SLOT, row: plan.site.row },
            HOT,
            "W",
          )
        : null,
      cool: plan.cool
        ? await poseGun(
            h,
            { col: plan.site.col + SLOT, row: plan.site.row },
            COOL,
            "E",
          )
        : null,
    });
  }

  /** Each gun's heat before the frame, by arrangement. */
  const opened = [];
  for (const arrangement of posed) {
    opened.push({
      hot:
        arrangement.hot === null
          ? null
          : await readHeat(h, arrangement.hot, `the hot Arc of ${arrangement.of}`),
      cool:
        arrangement.cool === null
          ? null
          : await readHeat(
              h,
              arrangement.cool,
              `the cool Arc of ${arrangement.of}`,
            ),
    });
  }
  await h.advance(1);
  await captureStill(h, "inert");
  const moved = [];
  for (const [index, arrangement] of posed.entries()) {
    moved.push({
      hot:
        arrangement.hot === null
          ? null
          : (await readHeat(
              h,
              arrangement.hot,
              `the hot Arc of ${arrangement.of}, a frame on`,
            )) - (opened[index].hot ?? 0),
      cool:
        arrangement.cool === null
          ? null
          : (await readHeat(
              h,
              arrangement.cool,
              `the cool Arc of ${arrangement.of}, a frame on`,
            )) - (opened[index].cool ?? 0),
    });
  }

  const pairHot = moved[0].hot ?? Number.NaN;
  const pairCool = moved[0].cool ?? Number.NaN;
  const loneHot = moved[1].hot ?? Number.NaN;
  const loneCool = moved[2].cool ?? Number.NaN;

  assertGreaterThan(
    loneCool,
    0,
    `the level-${LEVEL} Forge really warms the ${GUN} at ${COOL} it touches, ` +
      "so the arrangement this point contrasts is a live one",
  );
  assertLessThanOrEqual(
    Math.abs(pairHot - loneHot),
    DRIFT,
    `the heat the ${GUN} at ${HOT} moves by with a ${GUN} at ${COOL} on the ` +
      `Forge's far side, against the ${loneHot.toFixed(4)} it moves by with ` +
      "nothing there; apart by",
  );
  assertLessThanOrEqual(
    Math.abs(pairCool - loneCool),
    DRIFT,
    `the heat the ${GUN} at ${COOL} moves by with a ${GUN} at ${HOT} on the ` +
      `Forge's far side, against the ${loneCool.toFixed(4)} it moves by with ` +
      "nothing there; apart by",
  );
});
