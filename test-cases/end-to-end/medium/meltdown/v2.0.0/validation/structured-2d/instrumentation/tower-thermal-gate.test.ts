// Meltdown — instrumentation/tower-thermal-gate: thermal off pins a tower's heat.
//
// `specs/instrumentation.md`, the gate table: `thermalEnabled` holds "The tower's
// part in the heat model: its air cooling, its conduction with its neighbours,
// the flow a Forge or a Sink drives into or out of it, and its trip. Off, an
// emitter's heat holds exactly where it was posed".
//
// THREE ARRANGEMENTS, BECAUSE THE GATE NAMES SEVERAL FLOWS AND A BUILD COULD
// HOLD ONE WITHOUT HOLDING THE REST. `specs/heat.md` moves an emitter's heat
// through air cooling and through the flow a Forge or a Sink drives, and the same
// tower is posed against each: in open air, where only the air term acts; against
// a Forge, whose setpoint of `72` at level I is ABOVE the posed `60` so the flow
// runs INTO it; and against a Sink, whose flow runs out of it. A build that held
// the air term and left a mover's flow running is caught by the second and third;
// one that held the movers and left the air running is caught by the first.
// (Conduction between two emitters is the one flow left out, because it is one
// flow shared by two towers rather than a term of one, and `heat/` owns the items
// that read it.)
//
// THE POSED HEAT IS `60`, WHICH IS WHY THE THREE READ DIFFERENTLY WHEN THE GATE
// IS OPEN. It is under the Forge's setpoint, so the Forge pushes the heat up; it
// is well above `0`, so the air pulls it down; and it is far from the `100` where
// `specs/heat.md` trips a tower, so no trip can interrupt a reading and no clamp
// can flatten one. A tower posed at `0` would hold at `0` in open air whether the
// gate were closed or not, and this point would read nothing at all.
//
// THE WHOLE FLOOR IS POSED TWICE, once with every emitter pinned and once with
// every one free, on a floor reset between the two — so the two legs differ in the
// gate and in nothing else, and each leaves a still of its own for the reviewer.
// The two halves of the reading need each other: the pinned leg alone passes a
// build whose whole heat model is dead, and the free leg alone says nothing about
// the gate.
//
// NOTHING ON THE FLOOR CAN FIRE. No unit is posed, so every tower here is idle
// under `specs/combat.md` and no `heatPerShot` lands in the middle of a
// measurement. The guns are left free deliberately: holding them would pose away
// the faculty this gate is supposed to leave alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThan } from "../assert";
import { BASE_K, FORGE_SETPOINT } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  ticksFor,
  type Harness,
  type Tile,
  type TowerType,
} from "../harness";
import { readTower } from "./ground";

/** The emitter posed in all three arrangements, and the heat all three carry. */
const TYPE = "arc";
const POSED_HEAT = 60;

/** The game time each leg is given, in seconds. */
const WINDOW = 1;

/**
 * How far a pinned tower's heat may sit from the figure it was posed at.
 *
 * The gate holds the heat "exactly where it was posed", so a conformant build
 * reports the posed figure itself; the allowance is for the float it stores it
 * in. It is six orders of magnitude below the smallest movement any of the three
 * arrangements produces.
 */
const PINNED_TOLERANCE = 1e-6;

/**
 * The least a free tower's heat must move over the window, in points.
 *
 * The weakest of the three is open air, where `specs/heat.md` sheds
 * `(RAD_K * radiatorEdges + BASE_K * plainEdges) * (H/100)` per second and a 2x2
 * footprint has eight perimeter edge-tiles: even at the cheaper of the two rates
 * on every one of them that is `BASE_K * 8 * 0.60`, above five points a second,
 * and the second falls slower than that only as the heat itself falls. One point
 * is comfortably under it — and under the Forge's `FORGE_K * 2 * (72 - 60)` and
 * the Sink's per-edge draw as well — while being far above nothing at all.
 */
const MIN_MOVEMENT = 1;

/** Where each emitter stands, and the mover — if any — put against its east face. */
interface Arrangement {
  name: string;
  at: Tile;
  neighbour: TowerType | null;
}

/**
 * The three arrangements.
 *
 * Every anchor is clear of the left corridor's rows `16..19` and the top
 * corridor's columns `22..29` (`specs/floor.md`), and they are eight rows apart so
 * nothing of one abuts anything of another. A mover sits two columns east of its
 * emitter, which is a 2x2 footprint's width, so the two share a whole face.
 */
const ARRANGEMENTS: readonly Arrangement[] = [
  { name: "in open air", at: { col: 4, row: 4 }, neighbour: null },
  { name: "beside a Forge", at: { col: 4, row: 12 }, neighbour: "forge" },
  { name: "beside a Sink", at: { col: 4, row: 24 }, neighbour: "sink" },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * A fresh run carrying all three arrangements, every emitter posed at
 * `POSED_HEAT` with its thermal faculty set to `thermal`, and their ids.
 *
 * Nothing else stands on the floor and no unit is posed, so every tower here is
 * idle and the only thing that can move a heat is the heat model itself.
 */
function poseFloor(thermal: boolean): number[] {
  startRun(h);
  const ids: number[] = [];
  for (const arrangement of ARRANGEMENTS) {
    h.debug.addTower(TYPE, arrangement.at.col, arrangement.at.row, 0);
    const towers = h.snapshot().towers;
    const id = towers[towers.length - 1].id;
    h.debug.setTowerHeat(id, POSED_HEAT);
    h.debug.setTowerThermal(id, thermal);
    if (arrangement.neighbour !== null) {
      h.debug.addTower(
        arrangement.neighbour,
        arrangement.at.col + 2,
        arrangement.at.row,
        0,
      );
    }
    ids.push(id);
  }
  return ids;
}

it("holds a pinned tower at the heat it was posed at, in open air and against either mover", async () => {
  assertGreaterThan(
    BASE_K * 8 * (POSED_HEAT / 100),
    MIN_MOVEMENT,
    "precondition: the specification's own floor for open-air cooling clears the bound read against",
  );
  assertGreaterThan(
    FORGE_SETPOINT[0],
    POSED_HEAT,
    "precondition: a level I Forge's setpoint is above the posed heat, so its flow runs in",
  );

  // Leg one: the whole floor, every emitter pinned.
  const pinned = poseFloor(false);
  await h.advance(ticksFor(WINDOW));
  captureStill(h, "pinned");
  const held = h.snapshot();

  // Leg two: the identical floor, every emitter free.
  const free = poseFloor(true);
  await h.advance(ticksFor(WINDOW));
  captureStill(h, "moving");
  const running = h.snapshot();

  ARRANGEMENTS.forEach((arrangement, index) => {
    assertLessThan(
      Math.abs(
        readTower(held, pinned[index], `the pinned tower ${arrangement.name}`)
          .heat - POSED_HEAT,
      ),
      PINNED_TOLERANCE,
      `the heat of a pinned tower ${arrangement.name}, after a second`,
    );
    assertGreaterThan(
      Math.abs(
        readTower(running, free[index], `the free tower ${arrangement.name}`)
          .heat - POSED_HEAT,
      ),
      MIN_MOVEMENT,
      `the heat a free tower ${arrangement.name} moved by, after a second`,
    );
  });
});
