// Deepcore — drilling (specs/character.md, specs/mining.md, specs/world.md).
//
// The miner drills the tile it is moving into — DOWN, LEFT, or RIGHT, NEVER UP — and ONLY
// while it is standing on solid ground: a falling miner does not drill (so a plunge down a
// shaft never side-drills or drills air). A side cut begins only once the miner is flush
// against the tile it is drilling (at the edge of its own tile), leaving room to move
// laterally within a wider tunnel first. Each tile takes hardness/drill-power seconds
// (specs/upgrades.md); while cutting, the miner braces against the tile (velocity held,
// eased into alignment) and the drill cycle + debris VFX play. On completion the tile
// becomes tunnel and yields its payload: an ore vein drops ore into cargo, a material node
// banks the exotic material, the Core yields the unstable Core Sample (starting its timer),
// and a gas pocket DETONATES instead of clearing cleanly. A finished DOWN cut steps the
// miner down onto the next tile so a held-down shaft digs continuously without free-falling.

import { CORE_TIMER_SECONDS, DRILL_TIME_BY_TIER, FUEL_PER_TILE, TILE_SIZE } from "./constants";
import { collectOre } from "./economy";
import { detonateGas } from "./hazards";
import { MINER_H, MINER_W, ease, minerCol, minerRow, solidBox } from "./physics";
import type { DrillProgress, Tile } from "./types";
import { bandForRow, isMinableKind, isSolidKind, tileLeft, tileTop } from "./world";
import { BANDS } from "./constants";
import type { Game } from "./game";

/** How close (px) to the tile edge the miner must be before a LEFT/RIGHT cut begins. */
const EDGE_MARGIN = 3;

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

  // Drilling requires standing on solid ground (specs/character.md). A falling miner does
  // not drill — this is what stops a plunge down a shaft from side-drilling or drilling the
  // air above a tile it has not yet landed on. (While already braced in a cut the miner
  // rests on the tile it is drilling, so this stays true through the cut.)
  const grounded = solidBox(game.grid, m.x, m.y + 2, MINER_W, MINER_H);
  if (!grounded) {
    m.drilling = null;
    return;
  }

  // Choose a target in priority order: down, then left, then right — never up. A side cut
  // begins ONLY once the miner is flush against the tile (within EDGE_MARGIN of its own
  // tile's edge), so pressing sideways in mid-tile walks first and lateral movement inside
  // a tunnel wider than the miner is possible before committing to a dig (specs/character.md).
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
  if (!dir && input.left && m.x - tileLeft(col) <= EDGE_MARGIN) {
    const t = tileAt(game, col - 1, row);
    if (t && isMinableKind(t.kind)) {
      dir = "left";
      tCol = col - 1;
      tRow = row;
    }
  }
  if (!dir && input.right && tileLeft(col + 1) - (m.x + MINER_W) <= EDGE_MARGIN) {
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

  // Brace: hold still and ease into alignment with the tile being cut. A side cut eases the
  // miner onto the floor it stands on (not the row's center) so it never floats off the
  // ground mid-cut and stays "grounded" for the check above.
  m.vx = 0;
  m.vy = 0;
  if (dir === "down") {
    m.x = ease(m.x, tileLeft(col) + (TILE_SIZE - MINER_W) / 2, 260, dt);
  } else {
    m.y = ease(m.y, tileTop(row + 1) - MINER_H - 0.01, 260, dt);
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
    const finished = m.drilling;
    completeDrill(game, finished);
    m.drilling = null;
    if (finished.dir === "down") descendAfterDown(game, finished.col, finished.row);
  }
}

/**
 * Step the miner down onto the next tile after a DOWN cut clears one, so a held-down shaft
 * digs continuously without ever free-falling through (or drilling) open air
 * (specs/character.md). Only steps down while down is still held and the tile below the
 * cleared one is solid ground to land on (not lava, which is routed around, and not open
 * space) — otherwise the miner is left to gravity and simply falls.
 */
function descendAfterDown(game: Game, col: number, clearedRow: number): void {
  if (!game.input.down) return;
  const belowRow = clearedRow + 1;
  const below = tileAt(game, col, belowRow);
  if (!below || !isSolidKind(below.kind) || below.kind === "lava") return;
  const m = game.miner;
  m.y = tileTop(belowRow) - MINER_H - 0.01; // rest the miner's feet on the next solid tile
  m.vy = 0;
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
