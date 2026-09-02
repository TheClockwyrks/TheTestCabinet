// Meltdown — instrumentation/tower-firing-gate-leaves-the-thermal-model: firing
// off leaves the heat model running.
//
// `specs/instrumentation.md`, the gate table, on `firingEnabled`: "Off, the
// tower's thermal model runs exactly as an idle tower's does: it cools,
// conducts, exchanges with movers, and trips."
//
// SO THE READING IS A COMPARISON, NOT A FIGURE. What the specification promises
// is a SAMENESS — a held gun cools like an idle tower — and the honest way to read
// a sameness is to put both on the floor at once and subtract. That is also what
// keeps this point out of the heat group's territory: how much an Arc at heat
// `60` in open air sheds in a second is `heat/air-cooling-rate`'s figure, and a
// build that got that figure wrong should fail there and not twice over. What is
// read here is only that the gate did not change it.
//
// THE TWO TOWERS DIFFER IN EXACTLY ONE THING. Same type, same rotation, same
// heat, same open air with nothing abutting either of them, and the same second
// of game time. One has its guns held and a mark in range; the other has its guns
// free and nothing to shoot at, which `specs/combat.md` makes an idle tower — "On
// a frame in which it has no target ... the accumulator neither grows nor falls".
// A build that suspended a held tower's whole heat model, or that let a held
// tower go on adding `heatPerShot`, separates the two.
//
// THE MARK CANNOT REACH THE IDLE TOWER. `ground.ts` puts the second anchor thirty
// tiles east, more than twice the `12.0` tiles of the longest range
// `specs/towers.md` gives, so the idle tower is idle because there is nothing in
// its range and not because of anything this check posed on it.
//
// AND BOTH MUST HAVE COOLED. Two dead thermal models agree perfectly, so the
// sameness means nothing until each reading is known to have moved.

import { afterEach, beforeEach, it } from "vitest";
import { BASE_K } from "../constants";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  ticksFor,
  type Harness,
} from "../harness";
import { FAR_SITE, poseMarkFor, QUIET_SITE, readTower } from "./ground";

/** The type both towers are, and the heat both are posed at. */
const TYPE = "arc";
const POSED_HEAT = 60;

/** The game time both are given, in seconds. */
const WINDOW = 1;

/**
 * How far the two towers' cooling may differ, in heat.
 *
 * They are the same tower in the same air at the same heat for the same second,
 * so `specs/heat.md` gives them the identical sequence of frames and a
 * conformant build reaches the identical number twice. A millionth of a point of
 * heat is many orders above the float that separates two identical computations,
 * and many orders below the whole points of heat that separate a running thermal
 * model from a suspended one.
 */
const AGREEMENT = 1e-6;

/**
 * The least heat a second at `60` must remove, in points.
 *
 * `specs/heat.md` sheds `(RAD_K * radiatorEdges + BASE_K * plainEdges) * (H/100)`
 * per second, and a 2x2 footprint in open air has eight perimeter edge-tiles. Even
 * if every one of them were a plain face — the cheaper of the two rates — that is
 * `BASE_K * 8 * 0.60`, above five points. One point is comfortably under the
 * smallest cooling the specification allows here and far above nothing at all.
 */
const MIN_COOLING = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("cools a held gun by exactly what an idle tower of the same layout cools by", async () => {
  assertGreaterThan(
    BASE_K * 8 * (POSED_HEAT / 100),
    MIN_COOLING,
    "precondition: the specification's own floor for this cooling clears the bound read against",
  );

  startRun(h);

  // The held gun, with something in range for its guns to want.
  h.debug.addTower(TYPE, QUIET_SITE.col, QUIET_SITE.row, 0);
  const held = h.snapshot().towers[0].id;
  h.debug.setTowerFiring(held, false);
  h.debug.setTowerHeat(held, POSED_HEAT);
  poseMarkFor(h, QUIET_SITE);

  // The idle tower, guns free, thirty tiles away with nothing in reach.
  h.debug.addTower(TYPE, FAR_SITE.col, FAR_SITE.row, 0);
  const idle = h.snapshot().towers[1].id;
  h.debug.setTowerHeat(idle, POSED_HEAT);

  const opened = h.snapshot();
  assertEqual(
    readTower(opened, held, "the held gun").firingEnabled,
    false,
    "precondition: the gun's firing faculty is held",
  );
  assertEqual(
    readTower(opened, idle, "the idle tower").firingEnabled,
    true,
    "precondition: the idle tower's firing faculty is free",
  );
  assertEqual(
    readTower(opened, idle, "the idle tower").firing,
    false,
    "precondition: the idle tower has nothing in range to fire on",
  );

  await h.advance(ticksFor(WINDOW));
  captureStill(h, "cooling");
  const after = h.snapshot();

  const heldCooling =
    POSED_HEAT - readTower(after, held, "the held gun after a second").heat;
  const idleCooling =
    POSED_HEAT - readTower(after, idle, "the idle tower after a second").heat;

  assertGreaterThan(
    heldCooling,
    MIN_COOLING,
    "the heat the held gun shed over a second at 60 in open air",
  );
  assertGreaterThan(
    idleCooling,
    MIN_COOLING,
    "the heat the idle tower shed over a second at 60 in open air",
  );
  assertLessThan(
    Math.abs(heldCooling - idleCooling),
    AGREEMENT,
    "the heat the held gun and the idle tower's coolings differ by",
  );
});
