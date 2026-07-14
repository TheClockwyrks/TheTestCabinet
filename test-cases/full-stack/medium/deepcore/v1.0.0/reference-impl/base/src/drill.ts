// Deepcore — drilling (specs/character.md, specs/mining.md, specs/world.md).
//
// The miner drills the tile it is moving into — DOWN, LEFT, or RIGHT, NEVER UP. Each tile
// takes hardness/drill-power seconds (specs/upgrades.md); while cutting, the miner braces
// against the tile (velocity held, eased into alignment) and the drill cycle + debris VFX
// play. On completion the tile becomes tunnel and yields its payload: an ore vein drops
// ore into cargo, a material node banks the exotic material, the Core yields the unstable
// Core Sample (starting its timer), and a gas pocket DETONATES instead of clearing cleanly.

import { CORE_TIMER_SECONDS, DRILL_TIME_BY_TIER, FUEL_PER_TILE, TILE_SIZE } from "./constants";
import { collectOre } from "./economy";
import { detonateGas } from "./hazards";
import { MINER_H, MINER_W, ease, minerCol, minerRow } from "./physics";
import type { DrillProgress, Tile } from "./types";
import { bandForRow, isMinableKind, tileLeft, tileTop } from "./world";
import { BANDS } from "./constants";
import type { Game } from "./game";

/** Drill time for a tile, from the miner's drill tier and the tile's band hardness. */
export function drillTime(game: Game, tile: Tile): number {
  const hardness = BANDS[tile.band].hardness; // 1..4
  return DRILL_TIME_BY_TIER[game.tiers.drill - 1]![hardness - 1]!;
}

function tileAt(game: Game, col: number, row: number): Tile | null {
  if (row < 0 || row >= game.grid.length) return null;
  const line = game.grid[row]!;
  if (col < 0 || col >= line.length) return null;
  return line[col]!;
}

/** Advance the drill state machine one fixed step (called before physics in game.ts). */
export function updateDrill(game: Game, dt: number): void {
  const m = game.miner;
  const col = minerCol(m);
  const row = minerRow(m);
  const input = game.input;

  // Choose a target in priority order: down, then left, then right — never up.
  let dir: "down" | "left" | "right" | null = null;
  let tCol = col;
  let tRow = row;
  if (input.down) {
    const t = tileAt(game, col, row + 1);
    if (t && isMinableKind(t.kind)) {
      dir = "down";
      tCol = col;
      tRow = row + 1;
    }
  }
  if (!dir && input.left) {
    const t = tileAt(game, col - 1, row);
    if (t && isMinableKind(t.kind)) {
      dir = "left";
      tCol = col - 1;
      tRow = row;
    }
  }
  if (!dir && input.right) {
    const t = tileAt(game, col + 1, row);
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

  // Start a new cut, or continue the current one.
  if (!m.drilling || m.drilling.col !== tCol || m.drilling.row !== tRow || m.drilling.dir !== dir) {
    const target = tileAt(game, tCol, tRow)!;
    m.drilling = { col: tCol, row: tRow, dir, elapsed: 0, total: drillTime(game, target) };
  }

  // Brace: hold still and ease into alignment with the tile being cut.
  m.vx = 0;
  m.vy = 0;
  if (dir === "down") {
    m.x = ease(m.x, tileLeft(col) + (TILE_SIZE - MINER_W) / 2, 260, dt);
  } else {
    m.y = ease(m.y, tileTop(row) + (TILE_SIZE - MINER_H) / 2, 260, dt);
  }

  m.drilling.elapsed += dt;

  // Emit drill-debris off the bit periodically (specs/assets.md).
  game.drillFxCd -= dt;
  if (game.drillFxCd <= 0) {
    game.drillFxCd = 0.09;
    const bit = bitPosition(m, dir);
    game.fxQueue.push({ kind: "drill-debris", x: bit.x, y: bit.y });
  }

  if (m.drilling.elapsed >= m.drilling.total) {
    completeDrill(game, m.drilling);
    m.drilling = null;
  }
}

/** World-space position of the drill bit for the current cut. */
function bitPosition(m: Game["miner"], dir: "down" | "left" | "right"): { x: number; y: number } {
  if (dir === "down") return { x: m.x + MINER_W / 2, y: m.y + MINER_H };
  if (dir === "left") return { x: m.x, y: m.y + MINER_H / 2 };
  return { x: m.x + MINER_W, y: m.y + MINER_H / 2 };
}

function completeDrill(game: Game, d: DrillProgress): void {
  const tile = game.grid[d.row]![d.col]!;
  const band = bandForRow(d.row);
  const cx = tileLeft(d.col) + TILE_SIZE / 2;
  const cy = tileTop(d.row) + TILE_SIZE / 2;

  const clearToTunnel = (): void => {
    game.grid[d.row]![d.col] = { kind: "tunnel", band };
  };
  const spendFuel = (): void => {
    game.miner.fuel = Math.max(0, game.miner.fuel - FUEL_PER_TILE);
  };

  switch (tile.kind) {
    case "gas": {
      detonateGas(game, d.col, d.row);
      spendFuel();
      break;
    }
    case "ore": {
      const ore = tile.ore!;
      if (collectOre(game, ore)) {
        clearToTunnel();
        game.fxQueue.push({ kind: "ore-sparkle", x: cx, y: cy });
        game.sndQueue.push("ore-pickup");
        spendFuel();
      } else {
        // Cargo full — leave the vein in the ground (specs/mining.md).
        game.note("CARGO FULL");
      }
      break;
    }
    case "material": {
      const mat = tile.material!;
      if (mat === "resonite") game.satchel.resonite++;
      else if (mat === "cryenite") game.satchel.cryenite++;
      const node = game.nodes.find((n) => n.col === d.col && n.row === d.row);
      if (node) node.collected = true;
      clearToTunnel();
      game.fxQueue.push({ kind: "material-shimmer", x: cx, y: cy });
      game.sndQueue.push("material-chime");
      game.note(mat === "resonite" ? "RESONITE COLLECTED" : "CRYENITE COLLECTED");
      spendFuel();
      break;
    }
    case "core": {
      if (!game.satchel.coreSample) {
        game.satchel.coreSample = true;
        game.coreTimer = CORE_TIMER_SECONDS;
        game.fxQueue.push({ kind: "core-extract", x: cx, y: cy });
        game.sndQueue.push("material-chime");
        game.note("CORE SAMPLE UNSTABLE — GET TO THE PAD");
      }
      clearToTunnel();
      spendFuel();
      break;
    }
    default: {
      clearToTunnel();
      spendFuel();
      break;
    }
  }
}
