// yard-drawing/health-bars — a unit carries a bar, and the bar empties.
//
// `specs/enemies.md`: "each unit carries a health bar above it that depletes as
// it takes damage", and `specs/hud.md` lists "each unit's health bar" among the
// few things the yard draws over the map. `specs/instrumentation.md` has
// `setUnitHp` leave the maximum alone, "so the unit stays the same type at the
// same wave scaling and its health bar reads the fraction it is on".
//
// THE READING. The strip of yard just above one parked unit is sampled three
// times: with nothing there, with the unit at the health its wave gives it, and
// with it posed to a quarter of that. What the unit's arrival painted is the bar;
// the colour that paint is mostly made of is the bar's FILL, since a full bar is
// mostly fill; and depleting the unit has to leave less of the stage carrying that
// colour. A build that draws a track behind the fill passes, because the track is
// not what is counted.
//
// The unit is held rather than walking, so the strip it is read in is the strip it
// is still standing under, and the wave is deep enough that nothing here is a
// question of the unit dying.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  DISTINCT,
  type Harness,
  lattice,
  openYard,
  parkUnit,
  rgbDistance,
  sample,
  unitById,
} from "../harness";

const WAVE = 30;
/** Clear of the chain's own drawing, and clear of the yard's edges. */
const STAND = { x: 500, y: 400 };
/** The strip above the unit: past its own 20-unit sprite, and wide enough for a bar. */
const ABOVE = { x: STAND.x - 30, y: STAND.y - 34, w: 60, h: 24 };

type Pixel = [number, number, number, number];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** How many of the sampled points carry `colour`. */
function carrying(pixels: readonly Pixel[], colour: Pixel): number {
  return pixels.filter((p) => rgbDistance(p, colour) <= DISTINCT).length;
}

it("draws a health bar above a unit, and empties it as health falls", async () => {
  await openYard(h, { wave: WAVE });

  const strip = lattice(ABOVE, 1);
  const bare = await sample(h, strip);

  const unit = await parkUnit(h, "mote", STAND);
  const full = await sample(h, strip);
  await captureStill(h, "bar");

  const painted: number[] = [];
  for (let i = 0; i < strip.length; i += 1) {
    if (rgbDistance(bare[i]!, full[i]!) > DISTINCT) painted.push(i);
  }
  assertGreaterThan(
    painted.length,
    0,
    `how many points of the yard the unit's arrival painted in the strip ` +
      `above it (x ${ABOVE.x}–${ABOVE.x + ABOVE.w}, y ${ABOVE.y}–` +
      `${ABOVE.y + ABOVE.h}), which is where specs/enemies.md puts its ` +
      "health bar",
  );

  // The colour that paint is mostly made of: a full bar is mostly its fill.
  let fill = full[painted[0]!]!;
  let best = 0;
  for (const i of painted) {
    const like = painted.filter(
      (j) => rgbDistance(full[i]!, full[j]!) <= DISTINCT,
    ).length;
    if (like > best) {
      best = like;
      fill = full[i]!;
    }
  }

  const maxHp = unitById(await h.snapshot(), unit).maxHp;
  await h.debug.setUnitHp(unit, Math.max(1, Math.round(maxHp / 4)));
  const quarter = await sample(h, strip);

  assertLessThan(
    carrying(quarter, fill),
    carrying(full, fill),
    "how much of the strip above the unit still carries the health bar's " +
      "fill colour at a quarter health, against how much carried it at full",
  );
});
