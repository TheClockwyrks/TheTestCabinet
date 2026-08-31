// hud/inspector-damage-and-multiplier — the damage read is the live per-shot
// damage beside the live multiplier, and the multiplier stops at the redline.
//
// `specs/hud.md`, The damage read: "An emitter's damage read shows its live
// per-shot damage beside its live heat multiplier, so a player watches the
// multiplier climb with the heat and hold flat once the heat reaches the redline."
// The two figures are `specs/combat.md`'s and `specs/heat.md`'s:
//
//   damage       = baseDamage(level) * heatMultiplier(H, redline)
//   heatMultiplier(H, R) = 0.35 + 3.15 * (min(H, R) / R)^2
//
// FOUR HEATS, BECAUSE THE RULE HAS A SHAPE AND NOT A VALUE. An Arc, whose redline
// is `80`, is read at heat `0`, `40`, `80` and `100`:
//
//   H=0    multiplier 0.35    damage 2.10   — the floor, MIN_HEAT_MULT
//   H=40   multiplier 1.1375  damage 6.83   — halfway up in heat, an eighth of the
//                                             way up in power: the square
//   H=80   multiplier 3.5     damage 21.0   — the redline, MAX_HEAT_MULT
//   H=100  multiplier 3.5     damage 21.0   — the plateau: "Heat carried past the
//                                             redline buys no damage."
//
// A build reading a straight line rather than a square lands `1.925` at heat 40, a
// build that never scales the damage lands `6` at every heat, and a build that
// omitted the `min(H, R)` lands `5.27` and `31.6` at heat `100` — the last of which
// is named and required ABSENT, so a failure says which wrong model was
// implemented rather than only that a number was wrong.
//
// THE HEAT IS PINNED at each reading, through `setTowerThermal(id, false)`, which
// holds the tower's part in the heat model while its guns go on running
// (`specs/instrumentation.md`). The heat is the argument of both figures, so a
// reading taken while it drifted would be a reading of the cooling rate.
//
// WHY THE DAMAGE IS NOT READ AT HEAT 0. The Arc's damage there is `2.1`, and the
// shop draws a `2` for every 2x2 footprint on the strip, so no window wide enough
// to carry a build that rounds a damage to a whole number can tell `2.1` from
// those. The floor of the ramp is therefore read on the MULTIPLIER at heat 0,
// which is `MIN_HEAT_MULT` and is a figure nothing else on the panel is near, and
// the damage is read at the three heats where its value stands clear.
//
// WHAT IS NOT DECIDED HERE. That the two figures are drawn BESIDE one another.
// `specs/hud.md` fixes no layout inside the panel, so a build is free to put the
// damage and the multiplier on one line or on two; what is required is that both
// are drawn and that both are live.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  MAX_HEAT_MULT,
  MIN_HEAT_MULT,
  TOWER_DEFS,
  heatMultiplier,
  isEmitter,
} from "../constants";
import { FREE_SITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  posePinnedTower,
  requireTower,
  startRun,
  type Harness,
} from "../harness";
import { readPanel, reads } from "./panel";

/** The emitter read. Its redline of 80 leaves a plateau below 100 to read on. */
const TYPE = "arc" as const;
const DEF = TOWER_DEFS[TYPE];
const REDLINE = isEmitter(DEF) ? DEF.redline : 0;
const BASE = isEmitter(DEF) ? DEF.baseDamage : 0;

/** The four heats the multiplier is read at. */
const HEATS = [0, 40, REDLINE, 100] as const;

/** The heats the damage is read at too; see the header on why 0 is not one. */
const DAMAGE_HEATS = [40, REDLINE, 100] as const;

/** The multiplier a build that dropped the `min(H, R)` clamp reads at heat 100. */
const UNCLAMPED_MULT =
  MIN_HEAT_MULT + (MAX_HEAT_MULT - MIN_HEAT_MULT) * (100 / REDLINE) ** 2;

/** And the damage it reads there. */
const UNCLAMPED_DAMAGE = BASE * UNCLAMPED_MULT;

/**
 * How far a drawn multiplier may sit from the one it must be: a twentieth.
 *
 * The multiplier runs from `0.35` to `3.5`, so a build drawing it to two decimals
 * or to one lands within a twentieth of the exact figure either way — `1.14` and
 * `1.1` both carry `1.1375`. The four figures read here are `0.35`, `1.1375` and
 * `3.5`, no two of which are within half a unit of each other, so the window
 * cannot let one stand in for another.
 */
const MULT_ROUNDED = 0.05;

/**
 * And how far a drawn damage may: six tenths.
 *
 * Half a unit for a build that rounds the damage to a whole number, plus a tenth
 * for the rounding of a tenth. The three damages read are `2.1`, `6.83` and `21`,
 * which are four and fourteen apart.
 */
const DAMAGE_ROUNDED = 0.6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("reads the live damage and multiplier at four heats, holding flat past the redline", async () => {
  await startRun(h);
  const id = await posePinnedTower(h, TYPE, FREE_SITE.col, FREE_SITE.row, 0);
  await h.debug.setSelected(id);

  for (const heat of HEATS) {
    await h.debug.setTowerHeat(id, heat);
    const runs = await readPanel(h);
    if (heat === REDLINE) await captureStill(h, "damage");
    const tower = requireTower(await h.snapshot(), id, `the Arc at heat ${heat}`);

    const mult = heatMultiplier(heat, REDLINE);
    const damage = BASE * mult;

    assertEqual(tower.heat, heat, `precondition: the Arc's heat is pinned at ${heat}`);
    assertEqual(
      tower.tripped,
      false,
      `precondition: the Arc is online at heat ${heat}`,
    );
    assertTrue(
      reads(runs, mult, MULT_ROUNDED),
      `the inspector to read the live heat multiplier ${mult.toFixed(4)} at heat ${heat}`,
    );
    if ((DAMAGE_HEATS as readonly number[]).includes(heat)) {
      assertTrue(
        reads(runs, damage, DAMAGE_ROUNDED),
        `the inspector to read the live per-shot damage ${damage.toFixed(3)} at heat ${heat}`,
      );
    }
  }

  // The plateau, named as the wrong model rather than only as a bound: a build
  // that dropped `min(H, R)` reads these two at heat 100 instead.
  await h.debug.setTowerHeat(id, 100);
  const past = await readPanel(h);
  assertTrue(
    !reads(past, UNCLAMPED_MULT, MULT_ROUNDED),
    `the inspector not to read ${UNCLAMPED_MULT.toFixed(4)} at heat 100, which is the multiplier without the min(H, R) clamp`,
  );
  assertTrue(
    !reads(past, UNCLAMPED_DAMAGE, DAMAGE_ROUNDED),
    `the inspector not to read ${UNCLAMPED_DAMAGE.toFixed(3)} at heat 100, which is the damage without the clamp`,
  );
});
