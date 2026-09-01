// Floe — placing and removing the bodies, and what each is standing on.
//
// The critter and the bears are made here and read here; how they MOVE is in
// `src/sim.ts` (the hop) and `src/hunter.ts` (the glide). What is in this file is
// everything both of those and the debug surface need in the same words: how a
// body is placed on a tile, what its footing is, and what a fresh one looks like.

import type { World } from "@test-cabinet/structured-2d";
import {
  MAX_BEARS,
  ROW_BAYS,
  ROW_NEAR,
  SECOND_BEAR_LEVEL,
  START_COL,
  TAGS,
  colAt,
  rowAt,
  tileCX,
  tileCY,
} from "./constants";
import type { Critter } from "./bodies";
import { Bear, Fish, bearsOf, fishOf } from "./bodies";
import { bayCenterX, isWaterRow } from "./grid";
import { floeAtPoint } from "./lanes";
import type { FloeState, Footing, HuntSlot } from "./game";

/** Put a body's center somewhere, leaving no interpolation trail behind it. */
export function placeCenter(
  body: { transform: { x: number; y: number }; prevX: number; prevY: number },
  x: number,
  y: number,
): void {
  body.transform.x = x;
  body.transform.y = y;
  body.prevX = x;
  body.prevY = y;
}

/** The tile the critter is on, which follows its center. */
export function critterCol(critter: Critter): number {
  return colAt(critter.transform.x);
}

/** The row the critter is on, which follows its center. */
export function critterRow(critter: Critter): number {
  return rowAt(critter.transform.y);
}

/**
 * Put the critter on a tile, present, facing up, ready to hop
 * (specs/instrumentation.md).
 */
export function placeCritter(critter: Critter, col: number, row: number): void {
  placeCenter(critter, tileCX(col), tileCY(row));
  critter.present = true;
  critter.facing = "up";
  critter.hopCooldown = 0;
  critter.bestRow = row;
}

/** The pose a fresh crossing begins from (specs/progression.md). */
export function freshCritter(critter: Critter): void {
  placeCritter(critter, START_COL, ROW_NEAR);
}

/**
 * What a body standing at `x` on `row` is on (specs/strait.md).
 *
 * Read for the critter, and read again for the tile a bear is travelling into,
 * because a bear's speed depends on the same three-way answer.
 */
function footingAt(world: World, x: number, row: number): Footing {
  if (!isWaterRow(row)) return "solid";
  return floeAtPoint(world, x, row) === null ? "water" : "floe";
}

/** The critter's footing. */
export function critterFooting(world: World, critter: Critter): Footing {
  return footingAt(world, critter.transform.x, critterRow(critter));
}

/** The hunt's slots for a level: one below `SECOND_BEAR_LEVEL`, two from it. */
export function freshSlots(level: number): HuntSlot[] {
  const count = level >= SECOND_BEAR_LEVEL ? MAX_BEARS : 1;
  return Array.from({ length: count }, () => ({ bearId: null, emptyFor: 0 }));
}

/** A bear settled on a tile, hunting its own tile, every faculty on. */
export function spawnBear(
  world: World,
  state: FloeState,
  col: number,
  row: number,
): Bear {
  return world.spawn(Bear, {
    transform: { x: tileCX(col), y: tileCY(row) },
    tags: [TAGS.bear],
    configure: (bear) => {
      bear.id = state.nextId++;
      bear.col = col;
      bear.row = row;
      bear.stepCol = col;
      bear.stepRow = row;
      bear.prevX = tileCX(col);
      bear.prevY = tileCY(row);
      bear.facing = "up";
      bear.target = { col, row };
      bear.sense = true;
      bear.routing = true;
      bear.travel = true;
      bear.carry = 0;
    },
  });
}

/**
 * Take a bear off the strait, and empty the slot it filled.
 *
 * Every removal runs through here — traffic, a death, a completed crossing, and
 * the debug surface alike — so a slot can never be left holding a bear that is
 * no longer on the strait.
 */
export function dropBear(state: FloeState, bear: Bear): void {
  bear.destroy();
  for (const slot of state.slots) {
    if (slot.bearId === bear.id) {
      slot.bearId = null;
      slot.emptyFor = 0;
    }
  }
}

/**
 * Record a bear put on the strait through the surface against the first slot
 * standing empty (`specs/instrumentation.md`, `addBear`).
 *
 * A placed bear fills a hunting slot, so the hunt's own emerging does not put a
 * second bear behind the one the caller placed. Where every slot the level has is
 * already filled, the placed bear is simply an extra the hunt does not track.
 */
export function claimSlot(state: FloeState, id: number): void {
  const slot = state.slots.find((entry) => entry.bearId === null);
  if (slot !== undefined) slot.bearId = id;
}

/** Take every bear off the strait and empty every slot. */
export function dropAllBears(world: World, state: FloeState): void {
  for (const bear of bearsOf(world)) bear.destroy();
  for (const slot of state.slots) {
    slot.bearId = null;
    slot.emptyFor = 0;
  }
}

/**
 * Bring the bonus catch's actor into line with `fishBay`.
 *
 * `fishBay` is the authoritative field the snapshot reports and every pose sets;
 * the actor is what a player sees and what `world.byTag(TAGS.fish)` finds, so it
 * is created, moved and removed to follow it.
 */
export function syncFish(world: World, state: FloeState): void {
  const fish = fishOf(world);
  const bay = state.fishBay;
  if (bay === null) {
    if (fish !== null) fish.destroy();
    return;
  }
  if (fish === null) {
    world.spawn(Fish, {
      transform: { x: bayCenterX(bay), y: tileCY(ROW_BAYS) },
      tags: [TAGS.fish],
      configure: (spawned) => {
        spawned.bay = bay;
      },
    });
    return;
  }
  if (fish.bay !== bay) {
    fish.bay = bay;
    fish.transform.x = bayCenterX(bay);
    fish.transform.y = tileCY(ROW_BAYS);
  }
}
