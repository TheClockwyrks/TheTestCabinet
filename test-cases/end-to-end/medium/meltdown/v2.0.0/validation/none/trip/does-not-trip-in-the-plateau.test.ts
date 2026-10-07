// Meltdown — trip/does-not-trip-in-the-plateau: the plateau is safe.
//
// `specs/heat.md` names the band outright: "The band from `R` to `100` is the
// plateau: full power, still online." The trip is at `100` and nowhere else, so
// an emitter anywhere from its redline up to `99` goes on firing and never
// reports `tripped`. The wrong model this item exists to name is a build that
// takes the redline for the failure point — the number is a per-tower figure and
// the tower is at full power there, so mistaking it for the trip is the easiest
// mistake in the heat model to make.
//
// TWO WRONG BUILDS, TWO LEGS, BECAUSE THE MISTAKE HAS TWO PLACES TO LIVE. A
// build can trip the tower in its heat model, and a build can simply refuse to
// fire above the redline. Neither leg would catch the other, and the faculty
// gates (`specs/instrumentation.md`) are what let each be read on its own:
//
//   - THE TRIP LEG runs the thermal model and holds the guns
//     (`poseIdleTower`). Nothing adds heat, so the tower cannot legitimately
//     reach `100` from anywhere in the band, and any `tripped` this leg sees is
//     the build's own reading of the redline. It is read ONE FRAME after the
//     pose, because a build that trips on the value trips on the first frame it
//     resolves, and because air cooling is proportional to heat and would
//     otherwise carry the reading down out of the band it is about.
//   - THE FIRING LEG holds the thermal model and runs the guns
//     (`posePinnedTower`), so the heat stays exactly at `99` — the last point
//     below the trip, and the furthest into the plateau a tower can be — while
//     the gun is watched. A build that goes offline above its redline reports
//     `firing` false there or removes no hp.
//
// THE THREE HEATS. The redline itself, where the band opens; `99`, the last
// point below the trip; and one point between the two, because a build could
// draw its failure line anywhere in between. `specs/towers.md` puts the Arc's
// redline at `80`, so the band read here is `80` to `99`.
//
// Nothing here reads the damage the plateau pays: that the multiplier holds flat
// at `3.5` across the band is `heat/plateau-holds`'s single requirement.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { TRIP_HEAT } from "../constants";
import {
  captureStill,
  createHarness,
  framesForShots,
  poseIdleTower,
  posePinnedTower,
  poseTarget,
  requireUnit,
  startRun,
  type Harness,
} from "../harness";
import {
  MARK_HP,
  MARK_OFFSET,
  MARK_TYPE,
  TRIP_SITE,
  emitterDefOf,
  figuresOf,
  readTower,
} from "./bench";

/** The emitter read, and the redline `specs/towers.md` gives it: 80. */
const TOWER = "arc";
const REDLINE = emitterDefOf(TOWER).redline;

/** The last heat below the trip: the top of the plateau. */
const TOP_OF_BAND = TRIP_HEAT - 1;

/**
 * The three heats in the band, from `specs/heat.md`'s "from `R` to `100`".
 *
 * The two ends and the midpoint between them. Geometry, not a tolerance: it says
 * where in the band the tower is posed, never how far a build may miss by.
 */
const PLATEAU_HEATS: readonly number[] = [
  REDLINE,
  (REDLINE + TOP_OF_BAND) / 2,
  TOP_OF_BAND,
];

/**
 * How many shots the firing leg waits for: one.
 *
 * `specs/combat.md` lands the first shot one full interval after the target is
 * acquired, so one interval is the shortest window in which a gun that fires can
 * be told from one that does not.
 */
const SHOTS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("The plateau is safe", async () => {
  // The trip leg: the thermal model runs, the guns are held, and nothing in the
  // band may report a trip.
  for (const heat of PLATEAU_HEATS) {
    await startRun(h);
    const id = await poseIdleTower(h, TOWER, TRIP_SITE.col, TRIP_SITE.row, {
      heat,
    });
    await h.advance(1);
    await captureStill(h, "plateau");
    const gun = await readTower(h, id, `the ${TOWER} posed at ${heat}`);

    assertEqual(
      gun.tripped,
      false,
      `a ${TOWER} at heat ${heat}, between its redline of ${REDLINE} and the ` +
        `trip at ${TRIP_HEAT}, to stay online: it resolved a frame at heat ` +
        `${gun.heat.toFixed(3)}`,
    );
    assertEqual(
      gun.tripTimer,
      0,
      `no cooldown on a ${TOWER} at heat ${heat}, which never crossed ${TRIP_HEAT}`,
    );
  }

  // The firing leg: the heat is pinned at the top of the band and the guns run.
  await startRun(h);
  const id = await posePinnedTower(
    h,
    TOWER,
    TRIP_SITE.col,
    TRIP_SITE.row,
    TOP_OF_BAND,
  );
  const mark = await poseTarget(
    h,
    MARK_TYPE,
    TRIP_SITE.col + MARK_OFFSET,
    TRIP_SITE.row,
    MARK_HP,
  );
  await h.advance(framesForShots(SHOTS, figuresOf(TOWER).fireRate));
  await captureStill(h, "plateau");
  const gun = await readTower(h, id, `the ${TOWER} pinned at ${TOP_OF_BAND}`);
  const struck = requireUnit(await h.snapshot(), mark, "the mark in range");

  assertEqual(
    gun.firing,
    true,
    `a ${TOWER} pinned at heat ${TOP_OF_BAND}, one point below the trip, to ` +
      `still report firing with a mark in range`,
  );
  assertGreaterThan(
    MARK_HP - struck.hp,
    0,
    `hp a ${TOWER} at heat ${TOP_OF_BAND} removes over ${SHOTS} fire interval`,
  );
});
