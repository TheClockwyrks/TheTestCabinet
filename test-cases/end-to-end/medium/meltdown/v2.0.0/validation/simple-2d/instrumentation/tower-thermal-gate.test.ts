// Meltdown — instrumentation/tower-thermal-gate: thermal off pins a tower's heat.
//
// specs/instrumentation.md, the faculty gates: `thermalEnabled` holds "The tower's
// part in the heat model: its air cooling, its conduction with its neighbours, the
// flow a Forge or a Sink drives into or out of it, and its trip. Off, an emitter's
// heat holds exactly where it was posed."
//
// THREE ARRANGEMENTS, ONE PER FLOW THE GATE HOLDS. specs/heat.md moves an emitter's
// heat by air cooling, by conduction, and by the two movers; a build that holds only
// the air term is a build whose Forge still heats a pinned tower, and every
// scenario in this suite that pins a heat to read something else would then be
// reading a heat that drifted. So the same Arc is posed at `60` three times over —
// standing in open air, with a Forge against its east face, and with a Sink against
// it — and every one of them must still read `60` a second later.
//
// AND EVERY ARRANGEMENT IS READ TWICE, because "holds exactly where it was posed" is
// a claim about the GATE and not about a tower that cannot move. With the gate on,
// each of the three must move the heat, and each moves it a different way: open air
// sheds it, the Forge drives it up toward its `72` setpoint, and the Sink drains it.
// A build whose heat model does nothing at all passes all three pinned legs and
// fails all three running ones.
//
// WHY `60`, AND WHY EACH LEG MOVES BY MORE THAN THE BOUND. specs/heat.md sheds
// `(RAD_K * radiatorEdges + BASE_K * plainEdges) * H / 100` per second, which is
// over eleven degrees a second for a 2x2 Arc at `60` in open air; the Forge drives
// `FORGE_K * sharedEdges * (setpoint - H)` into it, more than twenty a second across
// the two shared edge-tiles of a 2x2 face at a `12`-degree gap; the Sink drains
// `output * sharedEdges * H / 100`, more than nineteen. All three are an order of
// magnitude past the movement bound below, and all three stay clear of both ends of
// the scale over one second, so no leg is reading a clamp and none reaches the trip.
//
// THE NEIGHBOUR IS A 2x2 CENTRED ON THE FACE IT COVERS, which is what `boxIn` poses:
// the mover abuts the Arc along both edge-tiles of one face and reaches round no
// corner, so the arrangement carries exactly the one flow it is named for.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThan } from "../assert";
import {
  boxIn,
  captureStill,
  createHarness,
  poseTower,
  startRun,
  ticksFor,
  towerOf,
  type Harness,
  type TowerType,
} from "../harness";
import { GUN } from "./scenes";

/** The emitter read, and the heat it is posed at. */
const TYPE = "arc";
const HEAT = 60;

/** The window each leg is read over: one second of game time. */
const WINDOW_TICKS = ticksFor(1);

/** The three arrangements: open air, and one against each mover. */
const NEIGHBOURS: ReadonlyArray<{ name: string; type: TowerType | null }> = [
  { name: "in open air", type: null },
  { name: "beside a Forge", type: "forge" },
  { name: "beside a Sink", type: "sink" },
];

/**
 * How closely a pinned heat must sit at the value it was posed at, as decimal
 * places.
 *
 * Six places is `5e-7`. A held faculty takes no part in the frame's resolution at
 * all, so a conforming build has nothing to change and no slack to need beyond the
 * representation of the number it is holding. What the bound has to exclude is the
 * smallest of the three flows, which moves this tower by more than eleven degrees
 * over the same second.
 */
const PINNED_DIGITS = 6;

/**
 * How far a running heat must move for the pinned reading to mean anything, in
 * degrees.
 *
 * One degree. The smallest of the three specified flows is over eleven degrees a
 * second (see the head), so this is under a tenth of it: enough to say the heat
 * model is RUNNING, without asserting a rate that `heat` owns.
 */
const MOVEMENT_DEGREES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Pose the arrangement with the thermal gate as named, and read what the heat did. */
async function heatMovedOver(
  neighbour: TowerType | null,
  gate: boolean,
  output?: string,
): Promise<number> {
  startRun(h);
  const gun = poseTower(h, TYPE, GUN.col, GUN.row);
  if (neighbour !== null) boxIn(h, gun, { E: neighbour });
  h.debug.setTowerThermal(gun, gate);
  h.debug.setTowerHeat(gun, HEAT);

  const opened = towerOf(h.snapshot(), gun).heat;
  await h.advance(WINDOW_TICKS);
  const closed = towerOf(h.snapshot(), gun).heat;
  if (output !== undefined) captureStill(h, output);
  return closed - opened;
}

it("pins the heat against air, against a Forge and against a Sink", async () => {
  for (const [index, arrangement] of NEIGHBOURS.entries()) {
    const moved = await heatMovedOver(
      arrangement.type,
      false,
      index === 0 ? "pinned" : undefined,
    );
    assertCloseTo(
      moved,
      0,
      PINNED_DIGITS,
      `with thermal off ${arrangement.name}: degrees the heat moved over a second`,
    );
  }
});

it("lets the heat move again in every one of those arrangements", async () => {
  for (const [index, arrangement] of NEIGHBOURS.entries()) {
    const moved = await heatMovedOver(
      arrangement.type,
      true,
      index === 0 ? "moving" : undefined,
    );
    assertGreaterThan(
      Math.abs(moved),
      MOVEMENT_DEGREES,
      `with thermal on ${arrangement.name}: degrees the heat moved over a second`,
    );
  }
});
