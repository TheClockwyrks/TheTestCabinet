// Deepcore — the drill (specs/character.md, specs/mining.md).
//
// The miner cuts the cell it is moving into, down, left, or right, and never upward,
// and only while it rests on solid ground. A side cut begins once the box is flush
// against the cell beside it. Every minable cell carries its band's health; a hit
// lands every DRILL_HIT_INTERVAL, spends DRILL_HIT_FUEL, and removes the drill tier's
// damage. Damage persists on the cell, so an abandoned cut resumes where it stopped.
// A down cut sinks the miner into the cell in proportion to the cut's progress, so a
// held shaft reads as one continuous bore. A broken cell yields what it held.

import {
  CORE_TIMER,
  DRILL_HIT_FUEL,
  DRILL_HIT_INTERVAL,
  LAVA_DRILL_DAMAGE,
  MINER_H,
  MINER_W,
  TILE,
} from "./constants";
import { collectOre } from "./economy";
import { detonateGas } from "./hazards";
import { ease, isGrounded, minerCol, minerRow } from "./physics";
import type { DrillProgress, Tile } from "./types";
import {
  bandForRow,
  isMinableKind,
  isSolidKind,
  tileLeft,
  tileMaxHealth,
  tileTop,
} from "./world";
import type { Game } from "./game";

/** How near a cell's edge the box must be before a side cut begins. */
const EDGE_MARGIN = 5;
/** How fast the miner is eased into alignment with the cell it is cutting. */
const BRACE_RATE = 433;

/** The damage one hit removes at the miner's current drill tier. */
export function drillDamage(game: Game): number {
  return game.drillDamage();
}

function cellAt(game: Game, col: number, row: number): Tile | null {
  if (row < 0 || row >= game.grid.length) return null;
  const line = game.grid[row]!;
  if (col < 0 || col >= line.length) return null;
  return line[col]!;
}

/** The cut's progress, 0 to 1, as the target cell's health drains. */
export function cutProgress(tile: Tile): number {
  const max = tileMaxHealth(tile);
  if (max <= 0) return 0;
  const health = tile.health ?? max;
  return Math.min(1, Math.max(0, 1 - health / max));
}

/** Advance the drill one update. */
export function updateDrill(game: Game, dt: number): void {
  const m = game.miner;
  const input = game.input;

  // With the drill faculty held, no cut starts and none progresses.
  if (!m.drill) {
    m.drilling = null;
    return;
  }

  // A cut starts only while the miner rests on solid ground, which is what stops a
  // plunge down a shaft from cutting the air it is falling through.
  if (!isGrounded(game.grid, m)) {
    m.drilling = null;
    return;
  }

  // A down cut already under way stays locked on its cell while down is held: the
  // miner sinks into that cell as it drills, so reading the target back off its
  // position would step to the next cell early.
  const cur = m.drilling;
  const lockedDown =
    !!cur &&
    cur.dir === "down" &&
    input.down &&
    isMinableKind(cellAt(game, cur.col, cur.row)?.kind ?? "bedrock");

  // A down cut that is not being continued leaves the miner embedded in the cell it
  // was boring. Lift it back onto that cell before its own cell is read, or the
  // collision resolver reads the embedding as walking into a wall.
  if (!lockedDown && cur && cur.dir === "down") {
    const standY = tileTop(cur.row) - MINER_H - 0.01;
    if (m.y > standY) {
      m.y = standY;
      m.vy = 0;
    }
  }

  const col = minerCol(m);
  const row = minerRow(m);

  let dir: "down" | "left" | "right" | null = null;
  let tCol = col;
  let tRow = row;
  if (lockedDown && cur) {
    dir = "down";
    tCol = cur.col;
    tRow = cur.row;
  }

  if (!dir && input.down) {
    const t = cellAt(game, col, row + 1);
    if (t && isMinableKind(t.kind)) {
      dir = "down";
      tCol = col;
      tRow = row + 1;
    }
  }
  if (!dir && input.left && m.x - tileLeft(col) <= EDGE_MARGIN) {
    const t = cellAt(game, col - 1, row);
    if (t && isMinableKind(t.kind)) {
      dir = "left";
      tCol = col - 1;
      tRow = row;
    }
  }
  if (
    !dir &&
    input.right &&
    tileLeft(col + 1) - (m.x + MINER_W) <= EDGE_MARGIN
  ) {
    const t = cellAt(game, col + 1, row);
    if (t && isMinableKind(t.kind)) {
      dir = "right";
      tCol = col + 1;
      tRow = row;
    }
  }

  if (!dir) {
    m.drilling = null;
    return;
  }

  const target = cellAt(game, tCol, tRow)!;
  if (target.health === undefined) target.health = tileMaxHealth(target);
  if (
    !m.drilling ||
    m.drilling.col !== tCol ||
    m.drilling.row !== tRow ||
    m.drilling.dir !== dir
  ) {
    m.drilling = { col: tCol, row: tRow, dir, hitTimer: DRILL_HIT_INTERVAL };
  }

  // Brace against the cell being cut. A side cut eases the miner onto the floor it
  // stands on, so it never floats off the ground mid-cut and stays grounded.
  if (m.travel) {
    m.vx = 0;
    m.vy = 0;
    if (dir === "down")
      m.x = ease(m.x, tileLeft(tCol) + (TILE - MINER_W) / 2, BRACE_RATE, dt);
    else m.y = ease(m.y, tileTop(row + 1) - MINER_H - 0.01, BRACE_RATE, dt);
  }

  game.emitDrillDebris(dt, dir);

  // Land every hit that falls due this update, which is one per several frames at a
  // normal step and several at once over a long one.
  m.drilling.hitTimer -= dt;
  while (m.drilling && m.drilling.hitTimer <= 0) {
    m.drilling.hitTimer += DRILL_HIT_INTERVAL;
    target.health =
      (target.health ?? tileMaxHealth(target)) - drillDamage(game);
    m.fuel = Math.max(0, m.fuel - DRILL_HIT_FUEL);
    if (target.health <= 0) {
      const finished = m.drilling;
      const brokeGas = game.grid[finished.row]![finished.col]!.kind === "gas";
      completeCut(game, finished);
      m.drilling = null;
      // A gas break shoves the miner, so settling it would cancel the blast.
      if (finished.dir === "down" && !brokeGas)
        settleAfterDown(game, finished.col, finished.row);
      return;
    }
  }

  // The miner's feet travel from the top of the cell being cut to its bottom in
  // proportion to the cut's progress, so a held shaft reads as one continuous bore
  // and the miner arrives flush on the next cell exactly as this one breaks. With
  // open space or lava below it does not sink; it falls into the opening instead.
  if (m.travel && m.drilling && m.drilling.dir === "down") {
    const below = cellAt(game, tCol, tRow + 1);
    const continuous =
      !!below && isSolidKind(below.kind) && below.kind !== "lava";
    const sink = continuous ? cutProgress(target) * TILE : 0;
    m.y = tileTop(tRow) + sink - MINER_H;
  }
}

/**
 * Rest the miner on the next floor once a down cut clears a cell in a continuous
 * shaft. The miner has already sunk to the bottom of the cleared cell, so this is a
 * flush snap rather than a step down. Over open space or lava it is left to fall.
 */
function settleAfterDown(game: Game, col: number, clearedRow: number): void {
  if (!game.miner.travel) return;
  const belowRow = clearedRow + 1;
  const below = cellAt(game, col, belowRow);
  if (!below || !isSolidKind(below.kind) || below.kind === "lava") return;
  game.miner.y = tileTop(belowRow) - MINER_H - 0.01;
  game.miner.vy = 0;
}

/** Resolve a cell breaking: what it yields, and what it leaves behind. */
function completeCut(game: Game, d: DrillProgress): void {
  const tile = game.grid[d.row]![d.col]!;
  const band = bandForRow(d.row, game.coreRow);
  const cx = tileLeft(d.col) + TILE / 2;
  const cy = tileTop(d.row) + TILE / 2;

  const clear = (): void => {
    game.grid[d.row]![d.col] = { kind: "tunnel", band };
  };

  switch (tile.kind) {
    case "gas":
      detonateGas(game, d.col, d.row);
      break;
    case "lava": {
      game.miner.hull -= LAVA_DRILL_DAMAGE[band] * (1 - game.radiatorEffect());
      game.hurt();
      game.fxQueue.push({ kind: "lava-embers", x: cx, y: cy });
      game.sndQueue.push("lava-sizzle");
      game.raiseNotice("lava");
      clear();
      break;
    }
    case "ore": {
      const ore = tile.ore!;
      // The cut always succeeds, so a full bay never leaves a solid cell underfoot.
      clear();
      if (collectOre(game, ore)) {
        game.fxQueue.push({ kind: "ore-sparkle", x: cx, y: cy });
        game.sndQueue.push("ore-pickup");
      } else {
        game.note("CARGO FULL — ORE LOST");
      }
      break;
    }
    case "material": {
      const material = tile.material!;
      game.satchel[material]++;
      const node = game.nodes.find((n) => n.col === d.col && n.row === d.row);
      if (node) node.collected = true;
      clear();
      game.fxQueue.push({ kind: "material-shimmer", x: cx, y: cy });
      game.sndQueue.push("material-chime");
      game.note(
        material === "resonite" ? "RESONITE COLLECTED" : "CRYENITE COLLECTED",
      );
      break;
    }
    case "core": {
      // The Core is inexhaustible and is never removed, so another Sample is always
      // available. Only one Sample may be live at a time.
      if (game.coreTimer === null) {
        game.satchel.coreSample = true;
        game.coreTimer = CORE_TIMER;
        game.fxQueue.push({ kind: "core-extract", x: cx, y: cy });
        game.sndQueue.push("material-chime");
        game.note("CORE SAMPLE UNSTABLE — GET TO THE PAD");
      } else {
        game.note("A CORE SAMPLE IS ALREADY UNSTABLE");
      }
      tile.health = undefined;
      break;
    }
    default:
      clear();
      break;
  }
}
