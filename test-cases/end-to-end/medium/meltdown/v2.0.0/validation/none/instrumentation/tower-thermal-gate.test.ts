// Meltdown — instrumentation/tower-thermal-gate: `setTowerThermal(id, false)` pins
// one tower's heat against every flow the model can drive into it.
//
// THE RULE. `specs/instrumentation.md` gives `thermalEnabled` as holding "The
// tower's part in the heat model: its air cooling, its conduction with its
// neighbours, the flow a Forge or a Sink drives into or out of it, and its trip.
// Off, an emitter's heat holds exactly where it was posed."
//
// WHY EVERY COMBAT READING IN THIS PROJECT DEPENDS ON IT. `posePinnedTower` — the
// atom under every `combat/*` scenario — is exactly this gate turned off, because
// a shot's damage is `baseDamage * heatMultiplier(H, redline)` at the heat the
// shot resolved at (`specs/combat.md`). Without a pin, every damage reading in the
// suite is taken while the number that decides it moves underneath, and each of
// them fails naming the damage curve.
//
// THREE ARRANGEMENTS, ONE PER FLOW THE GATE MUST HOLD. `specs/heat.md` gives an
// emitter three ways to change temperature that this floor can reach: air cooling
// off its open faces, a Forge warming it toward a setpoint above where it stands,
// and a Sink draining it. All three are posed on the one floor, on separate quiet
// anchors far enough apart that no group touches another, so a build whose gate
// holds one flow and not another reads as the wrong tower rather than as a pass.
//
// AND THE SAME FLOOR IS READ WITH THE GATE ON, which is what makes the pin mean
// anything. Each arrangement is chosen so that its unpinned direction is
// unmistakable and DIFFERENT from its neighbours': the lone tower cools, the
// Forge's neighbour WARMS — its setpoint is `72` against the `60` posed
// (`specs/towers.md`) — and the Sink's neighbour cools faster than the lone one.
// A build reporting a constant, or reporting one tower's heat for another, cannot
// satisfy all three.
//
// THE GUNS ARE HELD ON EVERY POSED EMITTER. There is nothing on this floor to fire
// at, but holding them is what makes the arrangement exercise only the faculty
// under test, and it is the reason no `shotGain` term can enter any of the six
// readings.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThan, assertLessThan } from "../assert";
import { TOWER_DEFS, type TowerType } from "../constants";
import { freeSite } from "../fixtures";
import {
  captureStill,
  createHarness,
  framesFor,
  poseTower,
  requireTower,
  startRun,
  type Harness,
} from "../harness";

/** The emitter read in all three arrangements, and the heat it is posed at. */
const TOWER: TowerType = "arc";
const POSED_HEAT = 60;
/** The span each arrangement is driven over, in seconds of game time. */
const SPAN_SECONDS = 1;

/**
 * How close a pinned heat must stay to where it was posed, in decimal places:
 * within `5e-5`.
 *
 * Not a behavioural tolerance. "Holds exactly where it was posed" is a value
 * carried unchanged across a hundred and twenty frames, so a conformant build
 * writes back the same float. Every unpinned flow on this floor moves the heat by
 * whole points in a second — air cooling alone takes `60` down past `49` — so the
 * bound is four orders below anything a real flow produces.
 */
const PINNED_DIGITS = 6;

/**
 * How far an unpinned heat must have moved for the contrast to have been read at
 * all, in heat points.
 *
 * Half a point. This decides only that the flow was running; how much each flow
 * moves is `heat/*`'s question, one item per flow, and asserting a figure here
 * would grade those rules twice.
 */
const MIN_MOVE = 0.5;

/** The three arrangements: the anchor of each emitter and its neighbour, if any. */
const ALONE = freeSite(0);
const BESIDE_FORGE = freeSite(1);
const BESIDE_SINK = freeSite(2);

let h: Harness;

/**
 * Pose the three arrangements and hand back the three emitters' ids.
 *
 * Each neighbour is anchored flush against its emitter's east face, so it shares
 * that whole face and drives its flow across it (`specs/heat.md`). The three
 * groups sit six columns apart on the quiet anchors of `fixtures.ts`, which leaves
 * clear tiles between them, so no group's faces reach another's.
 */
async function poseTheThree(pinned: boolean): Promise<{
  alone: number;
  warmed: number;
  drained: number;
}> {
  await startRun(h);
  const size = TOWER_DEFS[TOWER].size;
  const ids: number[] = [];
  const anchors = [ALONE, BESIDE_FORGE, BESIDE_SINK];
  const neighbours: (TowerType | null)[] = [null, "forge", "sink"];

  for (const [index, anchor] of anchors.entries()) {
    const id = await poseTower(h, TOWER, anchor.col, anchor.row);
    await h.debug.setTowerFiring(id, false);
    if (pinned) await h.debug.setTowerThermal(id, false);
    // The heat AFTER the gate, so nothing can be added to it on the way in.
    await h.debug.setTowerHeat(id, POSED_HEAT);
    ids.push(id);

    const neighbour = neighbours[index];
    if (neighbour !== null) {
      await poseTower(h, neighbour, anchor.col + size, anchor.row);
    }
  }
  return { alone: ids[0], warmed: ids[1], drained: ids[2] };
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("pins the heat in open air, beside a Forge and beside a Sink", async () => {
  const posed = await poseTheThree(true);

  await h.advance(framesFor(SPAN_SECONDS));
  await captureStill(h, "pinned");

  const s = await h.snapshot();
  for (const [what, id] of Object.entries(posed)) {
    assertCloseTo(
      requireTower(s, id, `the pinned ${TOWER} (${what})`).heat,
      POSED_HEAT,
      PINNED_DIGITS,
      `the pinned ${TOWER}'s heat after ${SPAN_SECONDS} second (${what})`,
    );
  }
});

it("lets all three heats move with the gate on", async () => {
  const posed = await poseTheThree(false);

  await h.advance(framesFor(SPAN_SECONDS));
  await captureStill(h, "moving");

  const s = await h.snapshot();
  const alone = requireTower(s, posed.alone, "the lone Arc").heat;
  const warmed = requireTower(s, posed.warmed, "the Arc beside the Forge").heat;
  const drained = requireTower(
    s,
    posed.drained,
    "the Arc beside the Sink",
  ).heat;

  // Open air: the only flow is air cooling, which runs downward.
  assertLessThan(
    alone,
    POSED_HEAT - MIN_MOVE,
    `the lone ${TOWER}'s heat after ${SPAN_SECONDS} second, from ${POSED_HEAT}`,
  );
  // Beside a Forge: its setpoint is above where the tower stands, so it warms.
  assertGreaterThan(
    warmed,
    POSED_HEAT + MIN_MOVE,
    `the ${TOWER} beside a Forge, whose setpoint is above ${POSED_HEAT}`,
  );
  // Beside a Sink: the drain runs alongside the air cooling, so it cools further
  // than the lone tower did.
  assertLessThan(
    drained,
    alone - MIN_MOVE,
    `the ${TOWER} beside a Sink, against the lone one's heat`,
  );
});
