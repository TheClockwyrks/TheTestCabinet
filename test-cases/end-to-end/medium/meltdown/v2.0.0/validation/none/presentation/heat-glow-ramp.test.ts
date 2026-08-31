// presentation/heat-glow-ramp — an emitter's drawn colour tracks its heat.
//
// THE RULE. `specs/overview.md`'s legibility table: "An emitter's drawn color
// tracks its heat along a ramp, and the cold end and the near-redline end read
// plainly apart." Two claims, and both are read off the canvas: the two ENDS of
// the range are plainly apart, and what lies between them is a RAMP — a reading
// that moves with the heat at every step of it, rather than two or three states a
// build switched between.
//
// WHY NO COLOUR IS NAMED. `specs/overview.md`: "The palette, the type, the glow,
// and every other aspect of the look are yours", and it fixes no direction for
// the ramp either — cold may be the dark end or the bright one. So nothing here
// says what a heat looks like, only how far two heats look apart, and the ramp
// claim is a distance between neighbours rather than an ordering of brightness.
// A build whose ramp runs white-hot to deep blue reads exactly as one that runs
// the other way.
//
// WHERE THE READING IS TAKEN. The body ring of `read.ts`, on a Lance, whose 4x4
// footprint (`specs/towers.md`) is the roomiest body in the roster: the ring sits
// clear of the faces, where `specs/towers.md` puts the radiator marking, and clear
// of the centre, where `specs/hud.md` lets a build put a heat read. The tower is
// PINNED — its thermal model held (`specs/instrumentation.md`) — so the heat the
// check posed is the heat the frame drew, rather than a heat that decayed by
// air cooling between the pose and the render.
//
// WHAT IT DOES NOT DECIDE. Whether the heat READ on the footprint tracks the heat
// is `hud/on-floor-heat-read`'s item, and whether a TRIPPED tower reads apart from
// an online one is `presentation/tripped-reads-apart`'s. This item is the body
// colour of an online emitter, and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { TRIP_HEAT } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  posePinnedTower,
  requireTower,
  startRun,
  type Harness,
  type Rgb,
} from "../harness";
import { bodyColor, showRgb } from "./read";

/**
 * How far apart, out of the 441 the RGB cube spans, the cold end and the
 * near-redline end of the ramp must read.
 *
 * This group's figure for "plainly apart" (`specs/overview.md`), used by every
 * item in it. 60 is about a seventh of the scale: two colours that far apart are
 * a different shade at a glance under any lighting a build chooses, while two
 * within 25 read as one material — which is why 25 is the allowance this group
 * and `floor/casing-band` both grant a build's own art direction over the same
 * patch. Below 60 a build could satisfy the letter of the legibility table with
 * two shades of one hue and leave a player unable to see a tower approaching its
 * redline, which is the whole game.
 */
const ENDS_APART_MIN = 60;

/**
 * How far apart two neighbouring heats on the ramp must read, out of 441.
 *
 * A RAMP, not a switch. The five heats below are evenly spread across the range,
 * so a ramp that only just clears {@link ENDS_APART_MIN} end to end moves about
 * 15 at each of its four steps. 12 leaves a fifth of that as slack for a ramp
 * that spends its contrast unevenly — the specification fixes no shape for it —
 * and still refuses a build that draws heat as two or three states: two
 * neighbouring heats it lumped together read 0 here.
 */
const STEP_APART_MIN = 12;

/**
 * The five heats the ramp is read at.
 *
 * `specs/heat.md` puts heat on `0` to `TRIP_HEAT` (`100`), and 99 rather than 100
 * is the top because 100 is the trip's own crossing value and a tower drawn there
 * is what `presentation/tripped-reads-apart` is about. Evenly spread, so no step
 * is asked to carry more of the ramp than another.
 */
const HEATS: readonly number[] = [0, 25, 50, 75, TRIP_HEAT - 1];

/** Where the Lance stands: clear of the casing, the openings and both corridors. */
const AT = { col: 10, row: 6 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws an emitter along a ramp whose ends read plainly apart", async () => {
  await startRun(h);
  const id = await posePinnedTower(h, "lance", AT.col, AT.row, HEATS[0]);

  const readings: Rgb[] = [];
  for (const heat of HEATS) {
    await h.debug.setTowerHeat(id, heat);
    await h.advance(1);
    if (heat === HEATS[HEATS.length - 1]) await captureStill(h, "ramp");
    const tower = requireTower(await h.snapshot(), id, "the ramp");
    readings.push(await bodyColor(h, tower));
  }

  const shown = readings
    .map((colour, index) => `${HEATS[index]}: ${showRgb(colour)}`)
    .join(", ");

  assertGreaterThanOrEqual(
    colorDistance(readings[0], readings[readings.length - 1]),
    ENDS_APART_MIN,
    `a Lance at heat ${HEATS[0]} against the same Lance at heat ` +
      `${HEATS[HEATS.length - 1]} (specs/overview.md: the cold end and the ` +
      `near-redline end read plainly apart); the ramp read ${shown}`,
  );
});

it("moves the reading at every step of the ramp", async () => {
  await startRun(h);
  const id = await posePinnedTower(h, "lance", AT.col, AT.row, HEATS[0]);

  const readings: Rgb[] = [];
  for (const heat of HEATS) {
    await h.debug.setTowerHeat(id, heat);
    await h.advance(1);
    const tower = requireTower(await h.snapshot(), id, "the ramp");
    readings.push(await bodyColor(h, tower));
  }

  for (let index = 1; index < HEATS.length; index += 1) {
    assertGreaterThanOrEqual(
      colorDistance(readings[index - 1], readings[index]),
      STEP_APART_MIN,
      `a Lance from heat ${HEATS[index - 1]} (${showRgb(readings[index - 1])}) ` +
        `to heat ${HEATS[index]} (${showRgb(readings[index])}): the drawn ` +
        `colour tracks the heat rather than holding across the step ` +
        `(specs/overview.md)`,
    );
  }
});
