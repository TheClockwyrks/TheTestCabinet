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
// with it posed to a quarter of that. The unit's arrival has to paint that strip,
// which is the bar being drawn, and posing the unit down to a quarter of its
// health has to redraw it, which is the bar following the health it reads. Neither
// reading says what the bar looks like: a fill that shortens, a strip that
// recolours, a bar that fades, and a numeric readout all satisfy this, and how good
// any of them looks is the reviewer's presentation rating.
//
// The unit is held rather than walking, so the strip it is read in is the strip it
// is still standing under, and the wave is deep enough that nothing here is a
// question of the unit dying.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  DRAWN,
  type Harness,
  lattice,
  maxDistance,
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws a health bar above a unit, and empties it as health falls", async () => {
  openYard(h, { wave: WAVE });

  const strip = lattice(ABOVE, 1);
  const bare = await sample(h, strip);

  const unit = parkUnit(h, "mote", STAND);
  const full = await sample(h, strip);
  captureStill(h, "bar");

  const painted: number[] = [];
  for (let i = 0; i < strip.length; i += 1) {
    if (rgbDistance(bare[i]!, full[i]!) > DRAWN) painted.push(i);
  }
  assertGreaterThan(
    painted.length,
    0,
    `how many points of the yard the unit's arrival painted in the strip ` +
      `above it (x ${ABOVE.x}–${ABOVE.x + ABOVE.w}, y ${ABOVE.y}–` +
      `${ABOVE.y + ABOVE.h}), which is where specs/enemies.md puts its ` +
      "health bar",
  );

  const maxHp = unitById(h.snapshot(), unit).maxHp;
  h.debug.setUnitHp(unit, Math.max(1, Math.round(maxHp / 4)));
  const quarter = await sample(h, strip);

  assertGreaterThan(
    maxDistance(full, quarter),
    DRAWN,
    "how far the strip above the unit reads from how it read at full health, " +
      "once the same unit is posed to a quarter of it, which is the bar " +
      "specs/enemies.md depletes as the unit takes damage",
  );
});
