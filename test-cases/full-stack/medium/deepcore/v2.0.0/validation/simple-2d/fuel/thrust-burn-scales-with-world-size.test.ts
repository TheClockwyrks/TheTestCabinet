// fuel/thrust-burn-scales-with-world-size — only the thrust burn is scaled.
//
// specs/character.md: the thrust burn is multiplied by the world size's
// `THRUST_BURN_SIZE_MULT` — `2` in a Quick mine, `1` in a Standard one, `0.67`
// in a Marathon one — and "only the thrust burn is scaled by the world size".
//
// So the check reads the same two spans at each of the three sizes. The thrust
// span is posed in the open sky with the body held still, so it runs at a fixed
// upward speed of `0` and the reading is the multiplier alone. The drill span is
// posed on a rock cell in the topsoil — `row 12` falls in the topsoil at all
// three sizes — and its spend is the drill's `DRILL_HIT_FUEL` plus the
// life-support trickle, neither of which the specification scales, so the three
// readings must agree with one another.

import { afterEach, beforeEach, it } from "vitest";
import {
  DRILL_HIT_INTERVAL,
  THRUST_BURN_SIZE_MULT,
  WORLD_SIZES,
} from "../../src/constants";
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import {
  ACTION_KEY,
  bandOfRow,
  captureReplay,
  createHarness,
  openScene,
  pinDrill,
  pinMiner,
  standOn,
  TICK_HZ,
  type Harness,
  type WorldSize,
} from "../harness";
import { thrustBurnAt } from "./burn";
import { standInSky } from "./sky";

/** A column and a row well clear of the camp, the cave mouth, and the Core. */
const COL = 8;
const ROW = 12;

/** How long each span runs, in seconds. */
const THRUST_SECONDS = 1;
const DRILL_SECONDS = 3 * DRILL_HIT_INTERVAL;

/** How far two spends of the same unscaled drains may sit apart, in fuel. */
const AGREEMENT = 0.02;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The fuel a held key spends over `seconds`, from wherever the miner stands. */
async function spend(code: string, seconds: number): Promise<number> {
  const before = h.snapshot();
  h.hold(code);
  try {
    await h.advance(Math.round(seconds * TICK_HZ));
  } finally {
    h.release(code);
  }
  return before.miner.fuel - h.snapshot().miner.fuel;
}

it("scales the thrust burn by the size and leaves the drill's alone", async () => {
  const thrust: Partial<Record<WorldSize, number>> = {};
  const drill: Partial<Record<WorldSize, number>> = {};

  await captureReplay(h, "sizes", async () => {
    for (const size of WORLD_SIZES) {
      openScene(h, { size });
      assertEqual(h.snapshot().worldSize, size, "specs/world.md");

      // The thrust span: in the sky, held still, so nothing but thrust is billed.
      standInSky(h, COL);
      pinMiner(h);
      pinDrill(h);
      thrust[size] = await spend(ACTION_KEY.up, THRUST_SECONDS);

      // The drill span: the same topsoil cell at every size.
      h.debug.setMinerDrill(true);
      h.debug.setTile(COL, ROW, "rock");
      standOn(h, COL, ROW);
      assertEqual(bandOfRow(h.snapshot(), ROW), "topsoil", "specs/world.md");
      drill[size] = await spend(ACTION_KEY.down, DRILL_SECONDS);
    }
  });

  for (const size of WORLD_SIZES) {
    const rate = thrustBurnAt(0) * THRUST_BURN_SIZE_MULT[size];
    const tolerance = (2 * rate) / TICK_HZ;
    assertBetween(
      thrust[size] ?? Number.NaN,
      rate * THRUST_SECONDS - tolerance,
      rate * THRUST_SECONDS + tolerance,
      `the thrust burn in a ${size} mine (specs/character.md)`,
    );
  }

  // And the drill's spend, which the size does not touch, is the same at all
  // three — read against the Standard one rather than against a rate, so the
  // check is the sizes agreeing rather than the drill's own figure.
  const standard = drill.standard ?? Number.NaN;
  for (const size of WORLD_SIZES) {
    assertBetween(
      drill[size] ?? Number.NaN,
      standard - AGREEMENT,
      standard + AGREEMENT,
      `the drill's spend in a ${size} mine (specs/character.md)`,
    );
  }
  // And it really did spend something, so the agreement above is an agreement
  // between three measured drains rather than between three zeroes.
  assertGreaterThan(standard, 0, "specs/character.md");
});
