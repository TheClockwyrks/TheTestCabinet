// Meltdown — trip/does-not-trip-in-the-plateau: the plateau is safe.
//
// specs/heat.md, Heat is damage: "The band from `R` to `100` is the plateau: full
// power, still online." The trip is at `100` and nowhere else, so an emitter
// anywhere from its redline up to `99` goes on firing exactly as it did below the
// redline. This is the OTHER direction of `trips-at-100`: that item shows the
// crossing happens, this one shows nothing below the crossing is one. A build
// that reads "redline" as the failure rather than as the top of the damage curve
// passes that item and fails this one, which is what tells the two apart.
//
// THE TOWER IS DRIVEN THROUGH THE WHOLE BAND WITH ITS THERMAL MODEL RUNNING, and
// that is the whole design of the check. `setTowerThermal(id, false)` would hold
// the tower at a chosen heat, but specs/instrumentation.md has that gate hold the
// tower's part in the heat model INCLUDING ITS TRIP — so a tower pinned in its
// plateau could not trip whatever the build believed, and the reading would pass
// every build alive. So nothing here is pinned: a Stutter is posed at its own
// redline, given a mark to shoot at, and left to climb the plateau under its own
// shots, and what is read is HOW FAR UP THE BAND IT GOT while still online.
//
// WHY THE STUTTER. specs/towers.md gives it the lowest redline on the roster,
// `60`, so its plateau is the widest — `60` to `99`, two fifths of the whole heat
// scale — and the sweep therefore crosses every heat a build might mistake for
// the failure. Its figures also climb: `4.2` heat a shot over mass `0.5` is `8.4`
// a shot at `7.0` shots a second, against air cooling of at most
// `(3.6 * 4 + 1.1 * 4) / 0.5`, which is `37.6` a second at heat `100`
// (specs/heat.md), so it takes on heat faster than it sheds it all the way up and
// reaches the trip about a second and a half in.
//
// WHAT THE READING IS. The highest heat the tower reported while it was still
// online. Under the specification that is a shade under `100` — the last rung of
// the ladder its shots climb. Under a build that trips at the redline it is `60`;
// at four fifths of the scale, `80`; anywhere in the band, that heat. So the
// failure does not merely say "it tripped": it says WHERE, which names the wrong
// model the build implemented.

import { afterEach, beforeEach, it } from "vitest";
import { TRIP_HEAT } from "../../src/constants";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  seconds,
  startRun,
  ticksFor,
  towerOf,
  type Harness,
} from "../harness";
import { heatPerShotOf, massOf, redlineOf } from "../thermal";
import { FREE_SITE, poseMarkEast } from "./bench";

/** The emitter driven up its own plateau: the widest band on the roster. */
const TOWER = "stutter";

/** specs/towers.md: the Stutter's redline, which is where its plateau opens. */
const REDLINE = redlineOf(TOWER);

/** specs/towers.md and specs/heat.md: the heat one of its shots adds, at level I. */
const SHOT_HEAT = heatPerShotOf(TOWER, 1) / massOf(TOWER);

/**
 * How long the climb may run, in seconds of game time.
 *
 * The head's figures carry a Stutter from `60` to `100` in about a second and a
 * half; six seconds is four times that. It is a ceiling on the sweep, not a
 * tolerance on a figure: a build that has not carried a firing Stutter to the top
 * of its own plateau in six seconds reads a low ceiling below and fails on that.
 */
const SWEEP_SECONDS = 6.0;

/**
 * How high up the plateau the tower must still be online, in heat.
 *
 * A firing tower climbs in steps of one shot, so the last heat it reports before
 * the trip is one step below `100` rather than `99`: specs/towers.md and
 * specs/heat.md put a Stutter's step near the trip at `8.4` of shot heat less the
 * `37.6 * (H / 100)` a second it sheds over the `1 / 7` s between two shots,
 * which is a little over `3`. Four heat points of room covers that step and the
 * float slack of a hundred frames' accumulation, and excludes every wrong model
 * this item exists to catch: a build that trips at the Stutter's redline reads
 * `60`, one that trips at four fifths of the scale reads `80`, one that trips at
 * `95` reads `95`.
 */
const STEP_ROOM = 4;
const ONLINE_CEILING = TRIP_HEAT - STEP_ROOM;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("The plateau is safe", async () => {
  startRun(h);
  const id = poseTower(h, TOWER, FREE_SITE.col, FREE_SITE.row);
  h.debug.setTowerHeat(id, REDLINE);
  poseMarkEast(h, TOWER, FREE_SITE);

  let highestOnline = towerOf(h.snapshot(), id).heat;
  for (let frame = 0; frame < ticksFor(SWEEP_SECONDS); frame += 1) {
    await h.advance(1);
    const tower = towerOf(h.snapshot(), id);
    if (tower.tripped) break;
    highestOnline = Math.max(highestOnline, tower.heat);
    assertEqual(
      tower.firing,
      true,
      `whether a ${TOWER} at heat ${tower.heat.toFixed(2)}, in its plateau ` +
        `above the redline ${REDLINE}, reports firing ` +
        `${seconds(frame + 1).toFixed(3)}s into the climb`,
    );
  }
  captureStill(h, "plateau");

  assertGreaterThanOrEqual(
    highestOnline,
    ONLINE_CEILING,
    `the highest heat a ${TOWER} climbing from its redline ${REDLINE} under ` +
      `its own shots, worth ${SHOT_HEAT.toFixed(1)} heat each, reported while ` +
      `it was still online; the plateau runs to ${TRIP_HEAT - 1} and only ` +
      `${TRIP_HEAT} is the trip`,
  );
});
