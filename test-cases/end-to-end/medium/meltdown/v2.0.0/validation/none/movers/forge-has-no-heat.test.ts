// Meltdown — movers/forge-has-no-heat: the Forge carries no heat.
//
// `specs/heat.md` puts both movers outside the heat scale altogether: "The Forge
// and the Sink carry no heat of their own and report `0` for it forever." It
// gives the consequence too — "Movers carry no heat, so they neither conduct with
// an emitter nor exchange with each other. They only drive the flows above into
// and out of the emitters they touch." So a Forge flush against the hottest thing
// on the floor is still at `0` a minute later.
//
// WHAT THE MINUTE IS FOR. A build that gave its movers a place in the heat model
// would have this one warmed by conduction across two shared edge-tiles at
// `COND_K` `3.5` per degree per second — hundreds of degrees per second of flow
// against a Lance at `99` — so it would be off `0` within the first frames and
// nowhere near it after sixty seconds. THE READING IS THEREFORE TAKEN TEN TIMES
// ACROSS THE MINUTE, and every one of them must be `0`: a
// build whose mover heats and then relaxes back toward a cooling floor cannot
// slip through on the last sample alone.
//
// WHY THE LANCE IS BOXED. `specs/towers.md` gives the Lance the highest mass and
// the highest redline on the roster, and posing it at `99` puts it a whisker under
// the trip without crossing it — a tower at `100` that opens a frame cooling does
// not trip, and this one never reaches `100` at all. Boxing it keeps the face the
// Forge is flush against hot: an edge-tile facing another tower sheds nothing to
// air (`specs/heat.md`), so the Lance holds its heat rather than shedding it out
// from under the reading, and the level-I Forge's own thermostat drives nothing
// into it because `99` is far above the `72` setpoint.
//
// NOTHING HERE READS THE LANCE. Where its heat ends up after a minute is the air
// and conduction model's business, decided by the `heat` group. What is decided
// here is the number on the Forge.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { FORGE_SETPOINT, TRIP_HEAT, type TowerType } from "../constants";
import {
  captureStill,
  createHarness,
  DRIVE_HZ,
  startRun,
  type Harness,
} from "../harness";
import { poseBoxed, readHeat } from "./contact";

/** The hot neighbour, and the heat it is posed at: a whisker under the trip. */
const HOT_GUN: TowerType = "lance";
const WHITE_HOT = TRIP_HEAT - 1;

/** The Forge's level. Its setpoint of 72 is far below the neighbour's heat. */
const LEVEL = 1;

/** The whole watch, and how often the Forge is read during it, in seconds. */
const WATCH_SECONDS = 60;
const SAMPLE_SECONDS = 6;

/**
 * How close the Forge's heat must come to zero, as decimal places.
 *
 * Six places is `5e-7`. The specification requires exactly `0`, so this is float
 * slack and nothing else — a mover has no heat to accumulate, so a build with the
 * rule right reports the literal zero it was born with. What the bound excludes
 * is a mover with any place at all in the heat model: conduction with a
 * neighbour at 99 would put tens of heat points on it inside one second.
 */
const ZERO_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("The Forge carries no heat", async () => {
  await startRun(h);
  const boxed = await poseBoxed(h, { type: HOT_GUN, heat: WHITE_HOT }, [
    { type: "forge", side: "N", slot: 0, level: LEVEL },
  ]);
  const forge = boxed.movers[0];

  let elapsed = 0;
  while (elapsed < WATCH_SECONDS) {
    const step = Math.min(SAMPLE_SECONDS, WATCH_SECONDS - elapsed);
    // Diced on the long-drive clock (`harness.ts`, The long-drive clock): the
    // minute is the requirement, the frame rate is this check's to choose.
    await h.skip(step, DRIVE_HZ);
    elapsed += step;
    assertCloseTo(
      await readHeat(h, forge, "the Forge against the white-hot Lance"),
      0,
      ZERO_DIGITS,
      `the heat a level-${LEVEL} Forge reports after ${elapsed}s flush ` +
        `against a ${HOT_GUN} posed at ${WHITE_HOT}, whose setpoint is ` +
        `${FORGE_SETPOINT[LEVEL - 1]}`,
    );
  }

  await h.advance(1);
  await captureStill(h, "cold");
  assertCloseTo(
    await readHeat(h, forge, "the Forge after the whole minute"),
    0,
    ZERO_DIGITS,
    `the heat that Forge reports after the whole ${WATCH_SECONDS}s`,
  );
});
