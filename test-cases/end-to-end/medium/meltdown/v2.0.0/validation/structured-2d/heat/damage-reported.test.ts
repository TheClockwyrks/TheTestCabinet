// Meltdown — heat/damage-reported — the reported damage follows the multiplier.
//
// A snapshot reports `damage` per tower (`specs/instrumentation.md`), and it is
// not a free number: `specs/combat.md` fixes per-shot damage as
// `baseDamage(level) * heatMultiplier(H, redline)`. So the readout is derived, and
// what this item decides is that it follows the heat the tower is carrying rather
// than sitting at the tower's cold figure.
//
// THE MULTIPLIER IS ITS OWN POINT. Whether `heatMult` itself follows the curve
// `specs/heat.md` fixes is `heat.heat-mult-reported`'s, so a build whose curve is
// wrong fails there; what fails HERE is a build whose damage does not follow
// whatever curve it reports. The expected figure is therefore `baseDamage` times
// the multiplier the specification states, which is the same reading a player is
// shown.
//
// FIVE HEATS, chosen to pin the whole shape of the curve on one tower: the cold
// end, two points on the quadratic climb, the redline itself, and one inside the
// plateau. A level-I Arc carries the reading, so its redline is `80` and its base
// damage `6`.
//
// NEITHER FACULTY RUNS. The tower is posed with its thermal model off, so the
// heat cannot drift between the pose and the read, and with its guns off, so
// nothing is fired: this item is about a readout, not about a shot. Each heat is
// followed by one frame, so a build that recomputes its readouts inside its
// update is read after that update rather than before it.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import {
  captureStill,
  createHarness,
  posePinnedTower,
  startRun,
  type Harness,
} from "../harness";
import { figuresOf, redlineOf, towerOf } from "./roster";
import { FREE_SITE } from "./sites";
import { heatMultiplierOf } from "./thermal";

/** The emitter read, and the two figures specs/towers.md gives it. */
const TOWER = "arc";
const REDLINE = redlineOf(TOWER);
const BASE_DAMAGE = figuresOf(TOWER).baseDamage;

/** The five heats: the cold end, two on the climb, the redline, and the plateau. */
const HEATS: readonly number[] = [0, 20, 40, REDLINE, 99];

const DAMAGE_DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("The reported damage follows the multiplier", async () => {
  startRun(h);
  const id = posePinnedTower(h, TOWER, FREE_SITE.col, FREE_SITE.row, 0);
  h.debug.setTowerFiring(id, false);

  for (const heat of HEATS) {
    h.debug.setTowerHeat(id, heat);
    await h.advance(1);
    const read = towerOf(h.snapshot(), id);
    captureStill(h, "damage");

    const expectedMult = heatMultiplierOf(heat, REDLINE);
    assertCloseTo(
      read.damage,
      BASE_DAMAGE * expectedMult,
      DAMAGE_DIGITS,
      `damage at heat ${heat}: baseDamage ${BASE_DAMAGE} * the multiplier`,
    );
  }
});
