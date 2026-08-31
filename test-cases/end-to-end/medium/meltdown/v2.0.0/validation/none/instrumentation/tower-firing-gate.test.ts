// Meltdown — instrumentation/tower-firing-gate: `setTowerFiring(id, false)` holds
// one tower's guns, and turning it back on gives them back.
//
// THE RULE. `specs/instrumentation.md` gives `firingEnabled` as holding "The
// tower's targeting and firing: acquiring a target, resolving a shot, the damage
// and splash the shot deals, the slow a Rime applies, and the `heatPerShot` the
// shot adds."
//
// WHY EVERY THERMAL READING IN THIS PROJECT DEPENDS ON IT. `poseIdleTower` — the
// atom under every `heat/*` and `movers/*` scenario — is exactly this gate turned
// off, so that a cooling rate is a measurement of one flow rather than of a flow
// racing a gun. A build whose gate does nothing puts `heatPerShot` into every one
// of those readings the moment a unit strays into range, and each of them fails
// naming a flow constant.
//
// FOUR READINGS, AND ALL FOUR MUST TURN. The specification's sentence names
// targeting, the shot, its damage and its heat as one faculty, so the gate off
// must show all four still and the gate on must show all four moving: the
// reported `firing` flag, the tower's own `damageDealt` tally, the target's hp,
// and the tower's heat. A build that stopped only the damage, or only the flag,
// reads as three of four rather than as a pass.
//
// POSED AT HEAT `0`, WHICH IS WHAT MAKES "GAINS NO HEAT" AN EXACT READING. Air
// cooling is proportional to `H / 100` (`specs/heat.md`), so a lone tower at `0`
// has no flow of any kind running through it: `shotGain` is the only term that
// can move its heat, and with the guns held the heat is still exactly `0` a second
// later. There is no tolerance to argue about and no thermal gate involved, which
// matters — pinning the heat here would hide the very term being read.
//
// THE TARGET IS HELD STILL AND MADE EFFECTIVELY UNKILLABLE, so it cannot walk out
// of range or die part way through and turn "no shot" into "nothing left to shoot
// at". Its hp is far past what the window can remove.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLessThan,
} from "../assert";
import { TOWER_DEFS, isEmitter } from "../constants";
import { FREE_SITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  framesForShots,
  poseTarget,
  poseTower,
  requireTower,
  requireUnit,
  startRun,
  type Harness,
} from "../harness";

/** The emitter read, and the shots the window is long enough for. */
const TOWER = "arc";
const SHOTS = 2;

/**
 * Where the target stands, in tiles to the right of the footprint's anchor.
 *
 * The Arc's range is `6.0` tiles from its footprint's centre (`specs/towers.md`,
 * `specs/combat.md`); this leaves the Mote about four and a half tiles out, well
 * inside it and well clear of the boundary, so nothing here is a reading of the
 * range. Geometry, not a threshold.
 */
const TARGET_OFFSET = 5;

/** Hp far past what this window can remove, so no death interrupts the reading. */
const TARGET_HP = 5000;

/**
 * How close the held tower's heat must stay to `0`, in decimal places: within
 * `5e-7`.
 *
 * Not a behavioural tolerance. A lone tower at heat `0` has every flow in
 * `specs/heat.md` proportional to `H / 100` and therefore zero, so the only term
 * that can move it is the `shotGain` this gate holds. A conformant build writes
 * back the same `0`.
 */
const PINNED_DIGITS = 6;

let h: Harness;

/** Pose one emitter with one held, unkillable target inside its range. */
async function poseTheDuel(): Promise<{ tower: number; target: number }> {
  await startRun(h);
  const tower = await poseTower(h, TOWER, FREE_SITE.col, FREE_SITE.row);
  await h.debug.setTowerHeat(tower, 0);
  const target = await poseTarget(
    h,
    "mote",
    FREE_SITE.col + TARGET_OFFSET,
    FREE_SITE.row,
    TARGET_HP,
  );
  return { tower, target };
}

/** Frames covering `SHOTS` shots of this emitter at level I, and no further. */
function windowFrames(): number {
  const def = TOWER_DEFS[TOWER];
  if (!isEmitter(def)) throw new TypeError(`${TOWER} is not an emitter`);
  return framesForShots(SHOTS, def.fireRate);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the guns with the gate off", async () => {
  const { tower, target } = await poseTheDuel();
  await h.debug.setTowerFiring(tower, false);

  await h.advance(windowFrames());
  await captureStill(h, "gated");

  const s = await h.snapshot();
  const held = requireTower(s, tower, "the tower with its guns held");
  assertEqual(held.firing, false, "the held tower's reported firing");
  assertEqual(held.damageDealt, 0, "the held tower's damageDealt");
  assertEqual(held.kills, 0, "the held tower's kills");
  assertCloseTo(held.heat, 0, PINNED_DIGITS, "the held tower's heat");
  assertEqual(
    requireUnit(s, target, "the target the held tower faced").hp,
    TARGET_HP,
    "the target's hp against a tower with its guns held",
  );
});

it("fires, damages and heats with the gate on", async () => {
  const { tower, target } = await poseTheDuel();

  await h.advance(windowFrames());
  await captureStill(h, "firing");

  const s = await h.snapshot();
  const live = requireTower(s, tower, "the tower with its guns running");
  assertEqual(live.firing, true, "the firing tower's reported firing");
  assertGreaterThan(live.damageDealt, 0, "the firing tower's damageDealt");
  assertGreaterThan(live.heat, 0, "the firing tower's heat");
  assertLessThan(
    requireUnit(s, target, "the target the firing tower faced").hp,
    TARGET_HP,
    "the target's hp against a tower with its guns running",
  );
});
