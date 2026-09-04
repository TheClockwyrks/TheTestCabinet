// Meltdown — combat/rime-deals-its-damage: a Rime's shot removes damage like any
// other emitter's.
//
// `specs/combat.md` states the per-shot figure once, for every emitter, and then
// closes the door: "This is the damage every emitter's shot deals, with no
// exception: a Rime's shot removes `4 * heatMultiplier(H, 100)` at level I exactly
// as an Arc's shot removes `6 * heatMultiplier(H, 80)`." `specs/towers.md` agrees:
// "Its shots deal ordinary damage". The slow is an ADDITION to that damage, never
// a replacement for it.
//
// SO THIS POINT EXISTS TO FAIL A RIME THAT ONLY SLOWS, which is the reading a
// build arrives at from the tower's stance alone, and the one the panel's display
// convention invites — the Rime's inspector shows a slow percentage where another
// emitter shows a damage read (`specs/hud.md`), and that is a display rule and
// nothing more.
//
// THREE HEATS, BECAUSE THE RIME'S REDLINE IS THE THING THAT MAKES ITS CURVE ITS
// OWN. `specs/towers.md` puts it at `100`, the only emitter whose redline sits at
// the trip, "so it never reaches a plateau". At heats `0`, `50` and `100` the
// multiplier is therefore `0.35`, `1.1375` and `3.5`, and one shot removes `1.4`,
// `4.55` and `14` hp. A build that gave the Rime the Arc's redline of `80` reads
// `(1.4, 6.32, 14)` — right at both ends and two-fifths too big in the middle,
// which is why the middle sample is here. A build that removes nothing at all reads
// `(0, 0, 0)`.
//
// HEAT `100` IS REACHABLE HERE ONLY BECAUSE THE TOWER IS PINNED.
// `posePinnedTower` holds the tower's part in the heat model, and the trip belongs
// to that model (`specs/instrumentation.md`), so the Rime sits at the top of the
// scale and goes on firing — which is exactly the reading the plateau sample needs
// and which `trip/*` decides on the real path.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import {
  captureStill,
  createHarness,
  framesForShots,
  type Harness,
} from "../harness";
import {
  NEAR_UNITS,
  fireRateOf,
  poseGun,
  poseMarkEast,
  readHp,
  shotDamage,
} from "./duel";

/** The emitter read, at level I, and the unit its shot is read against. */
const TOWER = "rime";
const LEVEL = 1;
const MARK = "mote";

/** The cold end, the middle of the climb, and the Rime's redline of 100. */
const HEATS: readonly number[] = [0, 50, 100];

/**
 * How close each removal must come, as decimal places of a hit point.
 *
 * Three places is `0.0005` hp. The reading is one subtraction of two hp values a
 * build computed from an exact product of specified figures, so the room a
 * conformant build needs is orders below the bound; the nearest wrong model — the
 * Arc's redline given to the Rime, read at heat `50` — is `1.77` hp away.
 */
const DAMAGE_DIGITS = 3;

/** The hp one shot removes from a mark, with the Rime pinned at `heat`. */
async function oneShot(harness: Harness, heat: number): Promise<number> {
  await poseGun(harness, TOWER, heat, LEVEL);
  const mark = await poseMarkEast(harness, TOWER, MARK, NEAR_UNITS);
  const opened = await readHp(harness, mark);
  await harness.advance(framesForShots(1, fireRateOf(TOWER, LEVEL)));
  return opened - (await readHp(harness, mark));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("A Rime's shot removes damage like any other emitter's", async () => {
  const removed: number[] = [];
  for (const heat of HEATS) removed.push(await oneShot(h, heat));
  await captureStill(h, "damage");

  for (const [index, heat] of HEATS.entries()) {
    assertCloseTo(
      removed[index],
      shotDamage(TOWER, LEVEL, heat),
      DAMAGE_DIGITS,
      `hp one level-${LEVEL} ${TOWER} shot removed at heat ${heat}`,
    );
  }
});
