// waves/pause-freezes-the-heat — while the game is paused, no heat changes.
//
// `specs/waves.md`, Pause and speed: "While the game is paused the simulation does
// not advance: nothing moves, no heat changes, no clock counts down ...".
//
// THE SAME MEASUREMENT AS `waves/pause-freezes-the-floor`, TURNED ON THE
// SIGNATURE SYSTEM, and its own item because a build can freeze one and not the
// other. A pause implemented as "stop advancing the surge" leaves every emitter
// heating and cooling behind the pause menu; a pause implemented as "stop drawing
// the frame" freezes neither. The floor item cannot see either defect, and this
// one cannot see a frozen clock over a sliding floor.
//
// IT IS MEASURED ON THE BUILD'S OWN CLOCK, for the reason the floor item states
// at length: `advance` is an operation of an instrumentation surface a build may
// gate separately from its own frame loop, so a check driven through it measures
// where the pause gate sits rather than whether the heat moved. Nothing inside the
// scope calls `advance` or anything built on it, and the pause is a real key
// pressed through Chromium.
//
// TWO WINDOWS OF THE SAME LENGTH, and the running one is not decoration: a tower
// whose heat never moves at all would satisfy a frozen paused window trivially, so
// the heat is required to have MOVED across the window before the press.
//
// THE HEAT IS MADE TO MOVE BY THE ONE FLOW THAT MOVES IT FASTEST. An Arc is stood
// over a stationary mark inside its `6.0`-tile range and left with every faculty
// on, so `specs/heat.md`'s `shotGain` runs: at the Arc's specified `2.0` shots a
// second and `10.3` heat a shot over a thermal mass of `1.0`, the window carries
// it tens of degrees from the `0` a placed tower starts at, while air cooling —
// which is proportional to heat and therefore nothing at all at `0` — never comes
// close to catching up. It stays far below `TRIP_HEAT` (`100`), so no trip
// interrupts the reading.
//
// THE MARK CANNOT INTERFERE. `poseTarget` holds its motion and gives it hp far
// past anything the window can remove, so it cannot walk out of range, cannot die
// and cannot leak — the tower simply has a target for the whole of both legs.
//
// BOTH READINGS OF THE PAUSED LEG COME FROM THE ONE SNAPSHOT TAKEN ON THE PRESS,
// so the pair spans the paused window and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { BINDINGS, isEmitter, TOWER_DEFS, TRIP_HEAT } from "../constants";
import {
  captureReplay,
  createHarness,
  poseTarget,
  poseTower,
  requireTower,
  startRun,
  type Harness,
} from "../harness";
import { GUN, MARK, poseWavePhase } from "./run";

/**
 * The real time each leg is measured over: a second and a half.
 *
 * Geometry rather than a tolerance. At the Arc's specified `2.0` shots a second
 * the window holds two or three shots, so the heat it produces is several times
 * the bound below however the shots fall inside it.
 */
const PAUSE_WINDOW_MS = 1500;

/**
 * How much heat must be gained across the running leg: `5`.
 *
 * Under half of the `10.3` a single Arc shot adds over its thermal mass of `1.0`
 * (`specs/towers.md`, `specs/heat.md`), so a build that lands even one shot inside
 * the window clears it with room to spare, and a tower whose heat never moves
 * cannot. It is deliberately far below the tens of degrees a conformant build
 * reaches: how much heat a shot adds is `heat.*`'s requirement, not this item's.
 */
const PAUSE_MIN_HEAT_GAIN = 5;

/**
 * How much the heat may move across the paused leg: `1`.
 *
 * The press and the reading are a round trip apart, so a build that resolves an
 * injected key on its next frame may run one more frame before freezing. That
 * frame can add at most one shot's `10.3` — but only if a shot falls exactly
 * inside it, one chance in thirty at sixty frames a second — and sheds air cooling
 * of well under a tenth. One degree covers the ordinary case and is a fifth of the
 * gain the running leg is held to, so a heat model that goes on running through
 * the paused window, in either direction, cannot hide inside it.
 */
const PAUSE_MAX_HEAT_DRIFT = 1;

/** The emitter whose heat is watched, and the mark it fires on. */
const GUN_TYPE = "arc";
const MARK_TYPE = "mote";

/** What one of this emitter's shots adds to its heat (`specs/towers.md`). */
const GUN_DEF = TOWER_DEFS[GUN_TYPE];
const HEAT_PER_SHOT = isEmitter(GUN_DEF) ? GUN_DEF.heatPerShot : 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("holds a firing tower's heat across a paused window it climbed across unpaused", async () => {
  await startRun(h);
  await poseWavePhase(h);
  const gun = await poseTower(h, GUN_TYPE, GUN.col, GUN.row);
  await poseTarget(h, MARK_TYPE, MARK.col, MARK.row);

  const legs = await captureReplay(h, "frozen", () =>
    h.withOwnClock(async (clock) => {
      const opened = await clock.read();
      await clock.settle(PAUSE_WINDOW_MS);
      await clock.press(BINDINGS.pause);
      // The ONE snapshot on the press: both readings of the paused leg come from
      // it, so the pair spans the paused window and nothing else.
      const pressed = await clock.read();
      await clock.settle(PAUSE_WINDOW_MS);
      return { opened, pressed, settled: await clock.read() };
    }),
  );

  const heatOf = (snapshot: typeof legs.opened) =>
    requireTower(snapshot, gun, "the two windows on the build's own clock")
      .heat;

  assertEqual(
    heatOf(legs.opened),
    0,
    `precondition: the ${GUN_TYPE} opened at the heat a placed tower starts at`,
  );
  assertGreaterThan(
    heatOf(legs.pressed) - heatOf(legs.opened),
    PAUSE_MIN_HEAT_GAIN,
    `the heat a firing ${GUN_TYPE} gained across the running window, against the ${HEAT_PER_SHOT} a shot adds`,
  );
  assertEqual(
    legs.pressed.screen,
    "paused",
    "precondition: the pause key reached the game and paused it",
  );
  assertLessThan(
    Math.abs(heatOf(legs.settled) - heatOf(legs.pressed)),
    PAUSE_MAX_HEAT_DRIFT,
    `the heat the ${GUN_TYPE} moved across the paused window of the same length, on a scale that runs to ${TRIP_HEAT}`,
  );
});
