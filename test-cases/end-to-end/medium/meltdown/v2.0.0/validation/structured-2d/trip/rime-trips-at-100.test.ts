// Meltdown — trip/rime-trips-at-100: the Rime trips like any emitter.
//
// specs/towers.md puts the Rime's redline at `100`: "its redline sits at the
// trip, so it never reaches a plateau". specs/heat.md's trip is at `100` for
// every emitter with no exception. The two together are the point of this item —
// the Rime is the one tower whose redline and whose trip are the same number, and
// a build that reads the redline as "the heat this tower is BUILT to run at" can
// end up treating the Rime as the emitter that cannot fail. It can: the redline
// governs the damage curve and nothing else, and the Rime trips at `100` exactly
// as the Arc does at `100`.
//
// WHY THE FACES ARE BLOCKED, AND WHY THAT IS NOT A THUMB ON THE SCALE. A lone
// level-I Rime cannot reach `100` under the specification's own figures.
// specs/towers.md gives it a 2x2 footprint with radiator faces N, S and E,
// `heatPerShot` `7.0`, mass `1.1` and `2.4` shots a second, so standing on open
// floor six of its eight edge-tiles are radiator and two are plain, and
// specs/heat.md sheds `(3.6 * 6 + 1.1 * 2) * (H / 100)` a second, which mass turns
// into `21.6 * (H / 100)`. One shot adds `7.0 / 1.1`, which is `6.36`, and the
// `1 / 2.4` s between two shots costs about `9` at heat `100` — more than the shot
// puts on. A firing Rime alone on the floor therefore settles at about `74` and
// stays there. Driving it to the trip means taking the air term away, which is
// what the blanket does.
//
// THE BLANKET ADDS NOTHING OF ITS OWN. specs/heat.md: an edge-tile facing another
// tower sheds nothing to air, and movers "carry no heat, so they neither conduct
// with an emitter nor exchange with each other" — they only drive their own flow.
// A level-I Forge's flow is `FORGE_K * sharedEdges * max(0, setpoint - H)` with a
// setpoint of `72` (specs/towers.md), and the Rime here never sits below `95`, so
// `max(0, 72 - H)` is `0` and every one of the four Forges drives exactly nothing.
// What is left moving the Rime's heat is its own shots, one of which carries `95`
// past `100`. So the arrangement is the cleanest isolation available, not a
// scenario built to flatter one implementation.
//
// THE SWEEP IS BOUNDED BY THE SPECIFICATION. The arithmetic above puts the
// crossing on the first shot, one `1 / 2.4` s interval in; the bound below is
// nearly five of them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertTrue } from "../assert";
import { TRIP_HEAT, TRIP_TIME } from "../constants";
import {
  boxIn,
  captureStill,
  createHarness,
  poseTower,
  seconds,
  startRun,
  ticksFor,
  type Harness,
  type TowerType,
} from "../harness";
import { BOXED_SITE, poseMarkEast, towerOf } from "./bench";

/** The emitter driven over the line, and the heat it opens just under it at. */
const TOWER = "rime";
const OPENING_HEAT = 95;

/** What the four faces are blocked with: a mover that drives no flow up here. */
const BLANKET: readonly [TowerType, TowerType, TowerType, TowerType] = [
  "forge",
  "forge",
  "forge",
  "forge",
];

/** How long the sweep may run, in seconds of game time. */
const SWEEP_SECONDS = 2.0;

/**
 * How far below `100` the heat may read on the frame the trip is caught.
 *
 * One frame of the `TRIP_HEAT / TRIP_TIME` bleed, so a build that starts the
 * bleed on the crossing frame rather than the next is not held to the frame it
 * chose. What it excludes is a build that takes the Rime offline at some other
 * heat — at its `0.55` slow ceiling's zero point, say, or anywhere short of the
 * trip.
 */
const HEAT_FLOOR = TRIP_HEAT - (TRIP_HEAT / TRIP_TIME) * seconds(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("The Rime trips like any emitter", async () => {
  startRun(h);
  const id = poseTower(h, TOWER, BOXED_SITE.col, BOXED_SITE.row);
  h.debug.setTowerHeat(id, OPENING_HEAT);
  boxIn(h, id, BLANKET);
  poseMarkEast(h, TOWER, BOXED_SITE);

  assertEqual(
    towerOf(h.snapshot(), id).tripped,
    false,
    `whether a ${TOWER} posed at heat ${OPENING_HEAT} is already tripped`,
  );

  const swept = await h.until((s) => towerOf(s, id).tripped, {
    maxFrames: ticksFor(SWEEP_SECONDS),
  });
  captureStill(h, "trip");

  assertTrue(
    swept.hit,
    `a ${TOWER} firing from heat ${OPENING_HEAT} with its faces blocked to ` +
      `trip within ${SWEEP_SECONDS}s of game time, although its redline is ` +
      `the trip`,
  );

  const tower = towerOf(h.snapshot(), id);
  assertEqual(tower.tripped, true, `whether the ${TOWER} reports tripped`);
  assertGreaterThanOrEqual(
    tower.heat,
    HEAT_FLOOR,
    `the heat the ${TOWER} tripped at, which specs/heat.md puts at ` +
      `${TRIP_HEAT} for every emitter`,
  );
});
