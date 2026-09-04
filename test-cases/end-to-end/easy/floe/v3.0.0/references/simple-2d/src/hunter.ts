// Floe — the bear (`specs/hunter.md`).
//
// A bear is a live pursuer that glides along the grid one axis at a time, turning
// only at a tile centre, routing toward the tile the critter is on around the same
// traffic the critter dodges, and swimming out over the open water after it.
//
// FOUR THINGS HAPPEN TO A BEAR IN A TICK, in this order, and each is gated on its
// own faculty (`specs/instrumentation.md`):
//
//   1. Its SENSE reads the critter's tile into its target.
//   2. Its TRAVEL carries it along the step it is on. A tick whose travel would
//      carry it past the centre it is heading for settles it exactly there, and the
//      travel left over is carried into the next tick, so no distance is lost at a
//      tile centre.
//   3. Its ROUTING commits the next step, where the travel has left it settled. It
//      runs AFTER the travel, in that same tick, which is why a turn always lands on
//      a tick whose centre IS a tile centre and why no tick ever changes both its
//      centre `x` and its centre `y`.
//   4. Traffic and the catch are tested, by the caller.
//
// THE ROUTE IS A BREADTH-FIRST PASS over the tiles open to a bear, from the target
// outward, so the step a bear commits is the first step of a shortest route made
// only of open tiles. The grid is `COLS x ROWS` — eight hundred tiles — so a whole
// pass per committed step costs microseconds and needs nothing from the engine.
// Where no such route exists the bear steps into whichever open neighbouring tile
// is least far from the target in tile distance, and where no neighbouring tile is
// open it stands still: the three branches `specs/hunter.md` states, in that order.

import {
  BEAR_AVOID_LEAD,
  BEAR_CATCH_DIST,
  BEAR_EMERGE_ADVANCE,
  BEAR_EMERGE_DELAY,
  BEAR_SECOND_ADVANCE,
  BEAR_SECOND_DELAY,
  COLS,
  MAX_BEARS,
  ROWS,
  ROW_BAYS,
  ROW_NEAR,
  SECOND_BEAR_LEVEL,
  TILE,
  bearIceSpeed,
  bearSwimSpeed,
  inBounds,
  tileCX,
  tileCY,
} from "./constants";
import { critterCol, critterRow } from "./critter";
import { laneWillCover } from "./lanes";
import {
  DIRECTIONS,
  STEPS,
  anyCoversTile,
  isWaterRow,
  tileDistance,
} from "./strait";
import type { Direction } from "./strait";
import { takeId, type MutBear, type Sim } from "./sim";
import { expired } from "./timing";

/** How many bears hunt at `level` (`specs/hunter.md`). */
export function slotCount(level: number): number {
  return level >= SECOND_BEAR_LEVEL ? MAX_BEARS : 1;
}

/** The rows the critter must have advanced for slot `index` to fill. */
export function slotAdvance(index: number): number {
  return index === 0
    ? BEAR_EMERGE_ADVANCE
    : BEAR_EMERGE_ADVANCE + BEAR_SECOND_ADVANCE;
}

/** The seconds since slot `index` fell empty before it fills. */
export function slotDelay(index: number): number {
  return index === 0
    ? BEAR_EMERGE_DELAY
    : BEAR_EMERGE_DELAY + BEAR_SECOND_DELAY;
}

/** Whether a bear is settled on its tile rather than travelling into another. */
export function settled(bear: MutBear): boolean {
  return bear.stepCol === bear.col && bear.stepRow === bear.row;
}

/**
 * Whether a bear travelling into `(col, row)` is swimming: a water-band tile no
 * floe covers (`specs/hunter.md`).
 */
export function swimmingInto(sim: Sim, col: number, row: number): boolean {
  return isWaterRow(row) && !anyCoversTile(sim.floes, col, row);
}

/** Whether this bear is swimming, by the tile it is travelling into. */
export function swimming(sim: Sim, bear: MutBear): boolean {
  return swimmingInto(sim, bear.stepCol, bear.stepRow);
}

/** A bear's speed in tiles per second: the footing of the tile it is entering. */
export function bearSpeed(sim: Sim, bear: MutBear): number {
  return swimming(sim, bear)
    ? bearSwimSpeed(sim.level)
    : bearIceSpeed(sim.level);
}

/**
 * Whether a tile is CLOSED to a bear (`specs/hunter.md`): off the grid, on the far
 * shore, or covered by a vehicle. A step into a closed tile is refused.
 */
export function closedToBear(sim: Sim, col: number, row: number): boolean {
  if (!inBounds(col, row)) return true;
  if (row <= ROW_BAYS) return true;
  return anyCoversTile(sim.vehicles, col, row);
}

/**
 * Whether a tile is OPEN to a bear: not closed, and no vehicle of its lane will
 * cover it within `BEAR_AVOID_LEAD` at that lane's current motion.
 */
export function openToBear(sim: Sim, col: number, row: number): boolean {
  if (closedToBear(sim, col, row)) return false;
  return !laneWillCover(sim, col, row, BEAR_AVOID_LEAD);
}

/** The index of tile `(col, row)` in a full-grid array. */
function indexOf(col: number, row: number): number {
  return row * COLS + col;
}

/**
 * The tile distance to `(tc, tr)` along routes made only of open tiles, one entry
 * per tile of the grid, `-1` where the target cannot be reached.
 *
 * The pass runs OUTWARD FROM THE TARGET, so one pass answers the question for every
 * neighbour of the bear at once and the step chosen is the first step of a shortest
 * route.
 */
export function routeField(sim: Sim, tc: number, tr: number): Int16Array {
  const field = new Int16Array(COLS * ROWS).fill(-1);
  if (!openToBear(sim, tc, tr)) return field;
  // The target itself is entered by a step like any other, so the frontier starts
  // there and only open tiles are ever added behind it.
  field[indexOf(tc, tr)] = 0;
  let frontier = [{ col: tc, row: tr }];
  let distance = 0;
  while (frontier.length > 0) {
    distance += 1;
    const next: { col: number; row: number }[] = [];
    for (const tile of frontier) {
      for (const name of DIRECTIONS) {
        const step = STEPS[name];
        const col = tile.col + step.dc;
        const row = tile.row + step.dr;
        if (!inBounds(col, row)) continue;
        const index = indexOf(col, row);
        if (field[index] !== -1) continue;
        if (!openToBear(sim, col, row)) continue;
        field[index] = distance;
        next.push({ col, row });
      }
    }
    frontier = next;
  }
  return field;
}

/**
 * The step a bear settled on its tile commits to, or `null` where none is open
 * (`specs/hunter.md`'s three branches).
 */
export function chooseStep(sim: Sim, bear: MutBear): Direction | null {
  const { col, row } = bear;
  const target = bear.target;
  if (col === target.col && row === target.row) return null;

  const field = routeField(sim, target.col, target.row);

  // The order the four directions are tried in breaks a tie between two steps that
  // shorten the route by the same amount, so the choice is fixed rather than
  // arbitrary: the axis with the more ground left to make up goes first.
  const order = orderedDirections(col, row, target.col, target.row);

  let routed: Direction | null = null;
  let routedDistance = Number.POSITIVE_INFINITY;
  let closest: Direction | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const name of order) {
    const step = STEPS[name];
    const nc = col + step.dc;
    const nr = row + step.dr;
    if (!openToBear(sim, nc, nr)) continue;

    const along = field[indexOf(nc, nr)];
    if (along !== -1 && along < routedDistance) {
      routedDistance = along;
      routed = name;
    }
    const away = tileDistance(nc, nr, target.col, target.row);
    if (away < closestDistance) {
      closestDistance = away;
      closest = name;
    }
  }

  return routed ?? closest;
}

/** The four directions, the axis with the greater remaining difference first. */
function orderedDirections(
  col: number,
  row: number,
  tc: number,
  tr: number,
): readonly Direction[] {
  const dc = tc - col;
  const dr = tr - row;
  const horizontal: Direction[] = dc === 0 ? [] : dc < 0 ? ["left"] : ["right"];
  const vertical: Direction[] = dr === 0 ? [] : dr < 0 ? ["up"] : ["down"];
  const toward =
    Math.abs(dr) >= Math.abs(dc)
      ? [...vertical, ...horizontal]
      : [...horizontal, ...vertical];
  const rest = DIRECTIONS.filter((name) => !toward.includes(name));
  return [...toward, ...rest];
}

/** Commit a bear to travelling one tile in `direction`, or refuse the step. */
export function commitStep(
  sim: Sim,
  bear: MutBear,
  direction: Direction,
): boolean {
  const step = STEPS[direction];
  const col = bear.col + step.dc;
  const row = bear.row + step.dr;
  // A step into a closed tile is refused: the bear stays settled where it is, on
  // the strait and unharmed. The avoidance lead is a routing concern rather than a
  // rule about which tiles exist, so a posed step is held to `closedToBear` alone.
  if (closedToBear(sim, col, row)) return false;
  bear.stepCol = col;
  bear.stepRow = row;
  bear.facing = direction;
  return true;
}

/**
 * Let a settled bear's own routing commit its next step, where it has one.
 *
 * This runs AFTER the tick's travel, so a bear commits on the tick it is settled on
 * a tile and travels along the new step from the next tick. That is what makes
 * `specs/hunter.md`'s property hold on every tick without exception: the tick a
 * bear's step changes on is always a tick whose centre is exactly a tile centre,
 * whether it settled there this tick or was standing there already.
 */
function routeStep(sim: Sim, bear: MutBear): void {
  if (!settled(bear)) return;
  if (bear.routing) {
    const direction = chooseStep(sim, bear);
    if (direction !== null) commitStep(sim, bear, direction);
  }
  // Nowhere open to go, or the step refused: the bear holds the tile it is on and
  // chooses again next tick, so nothing is carried into a step it never took.
  if (settled(bear)) bear.carry = 0;
}

/** Carry a bear along the step it is on by one tick (`specs/hunter.md`). */
function travelBear(sim: Sim, bear: MutBear, dt: number): void {
  if (!bear.travel) return;
  if (settled(bear)) {
    // Standing on a tile with no step to travel on. The tick's travel is CARRIED
    // rather than spent, exactly as the travel left over at a tile centre is, so a
    // bear that commits a step this tick loses nothing by having committed it at a
    // centre; a bear that commits none has its carry dropped below.
    bear.carry += bearSpeed(sim, bear) * TILE * dt;
    return;
  }

  const goalX = tileCX(bear.stepCol);
  const goalY = tileCY(bear.stepRow);
  const dx = goalX - bear.x;
  const dy = goalY - bear.y;
  const remaining = Math.abs(dx) + Math.abs(dy);
  const travel = bearSpeed(sim, bear) * TILE * dt + bear.carry;
  bear.carry = 0;

  if (travel >= remaining) {
    // It settles exactly on the centre for this tick, and the travel left over
    // goes to the next one, so no distance is lost at a tile centre.
    bear.x = goalX;
    bear.y = goalY;
    bear.col = bear.stepCol;
    bear.row = bear.stepRow;
    bear.carry = travel - remaining;
    return;
  }

  // One axis at a time: the step is along one, so only one of the two moves.
  if (dx !== 0) bear.x += Math.sign(dx) * travel;
  else bear.y += Math.sign(dy) * travel;
}

/** One tick of every bear on the strait: sense, route, travel. */
export function stepBears(sim: Sim, dt: number): void {
  const hasCritter = sim.critter.present;
  const targetCol = hasCritter ? critterCol(sim) : 0;
  const targetRow = hasCritter ? critterRow(sim) : 0;

  for (const bear of sim.bears) {
    if (bear.sense && hasCritter) {
      bear.target = { col: targetCol, row: targetRow };
    }
    travelBear(sim, bear, dt);
    routeStep(sim, bear);
  }
}

/** Add one bear settled on a tile, appended to the roster with a fresh id. */
export function addBear(sim: Sim, col: number, row: number): MutBear {
  const bear: MutBear = {
    id: takeId(sim),
    col,
    row,
    stepCol: col,
    stepRow: row,
    x: tileCX(col),
    y: tileCY(row),
    facing: "up",
    target: { col, row },
    sense: true,
    routing: true,
    travel: true,
    carry: 0,
  };
  sim.bears.push(bear);
  return bear;
}

/** Reconcile the hunt's slots with the roster: a slot whose bear is gone is empty. */
export function reconcileSlots(sim: Sim): void {
  sim.slots.forEach((slot, index) => {
    if (slot.bearId === null) return;
    if (!sim.bears.some((bear) => bear.id === slot.bearId)) {
      slot.bearId = null;
      slot.fillIn = slotDelay(index);
    }
  });
}

/** Every slot falls empty, which is what the start of a crossing does. */
export function emptySlots(sim: Sim): void {
  sim.slots.forEach((slot, index) => {
    slot.bearId = null;
    slot.fillIn = slotDelay(index);
  });
}

/** Record a bear added through the surface against the first slot standing empty. */
export function claimSlot(sim: Sim, id: number): void {
  const slot = sim.slots
    .slice(0, slotCount(sim.level))
    .find((entry) => entry.bearId === null);
  if (slot !== undefined) slot.bearId = id;
}

/**
 * Fill whichever slots have met both of their conditions (`specs/hunter.md`).
 *
 * A bear appears settled on the near shore in the critter's column, facing up. A
 * crossing with no critter in play hunts nothing, so no slot fills while the
 * critter is off the strait.
 */
export function emergeBears(sim: Sim, dt: number): void {
  reconcileSlots(sim);
  const advanced = ROW_NEAR - sim.critter.bestRow;
  const count = slotCount(sim.level);
  for (let index = 0; index < count; index += 1) {
    const slot = sim.slots[index];
    if (slot.bearId !== null) continue;
    slot.fillIn = Math.max(0, slot.fillIn - dt);
    if (!sim.gates.bearEmergence || !sim.critter.present) continue;
    if (advanced < slotAdvance(index)) continue;
    if (!expired(slot.fillIn)) continue;
    const bear = addBear(sim, critterCol(sim), ROW_NEAR);
    slot.bearId = bear.id;
  }
}

/** Every bear a vehicle has arrived on, by id (`specs/hunter.md`). */
export function bearsResetByTraffic(sim: Sim): number[] {
  const moving = sim.vehicles.filter((item) => {
    const lane = sim.iceLanes.find((entry) => entry.row === item.row);
    return lane !== undefined && lane.speed > 0;
  });
  return sim.bears
    .filter(
      (bear) =>
        anyCoversTile(moving, bear.col, bear.row) ||
        anyCoversTile(moving, bear.stepCol, bear.stepRow),
    )
    .map((bear) => bear.id);
}

/** The bear whose centre is within `BEAR_CATCH_DIST` of the critter's, if any. */
export function catcher(sim: Sim): MutBear | undefined {
  if (!sim.critter.present) return undefined;
  return sim.bears.find((bear) => {
    const dx = bear.x - sim.critter.x;
    const dy = bear.y - sim.critter.y;
    return Math.hypot(dx, dy) <= BEAR_CATCH_DIST;
  });
}
