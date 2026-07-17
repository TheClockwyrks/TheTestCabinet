// Deepcore — drilling (specs/character.md, specs/mining.md, specs/world.md).
//
// The miner drills the tile it is moving into — DOWN, LEFT, or RIGHT, NEVER UP — and ONLY
// while it is standing on solid ground: a falling miner does not drill (so a plunge down a
// shaft never side-drills or drills air). A side cut begins only once the miner is flush
// against the tile it is drilling (at the edge of its own tile), leaving room to move
// laterally within a wider tunnel first. Every minable tile has HEALTH (its band's
// `maxHealth`); the drill deals DAMAGE per hit (higher tiers hit harder) on a fixed cadence
// (HIT_INTERVAL), each hit spending fuel (FUEL_PER_HIT) and shaving the tile's health. The
// damage PERSISTS on the tile: drill partway and move away and the tile keeps its accrued
// damage (and cracks), so a resumed cut continues from where it left off and the fuel already
// spent is never refunded (specs/character.md). While cutting, the miner braces against the
// tile (velocity held, eased into alignment) and the drill cycle + debris VFX play. When the
// tile's health reaches 0 it BREAKS and yields its payload: an ore vein drops ore into cargo,
// a material node banks the exotic material, the Core yields the unstable Core Sample
// (starting its timer), and a gas pocket DETONATES instead of clearing cleanly. A finished
// DOWN cut steps the miner down onto the next tile so a held-down shaft digs continuously.

import { CORE_TIMER_SECONDS, DRILL_DAMAGE_BY_TIER, FUEL_PER_HIT, HIT_INTERVAL, TILE_SIZE } from "./constants";
import { collectOre } from "./economy";
import { detonateGas } from "./hazards";
import { MINER_H, MINER_W, ease, minerCol, minerRow, solidBox } from "./physics";
import type { DrillProgress, Tile } from "./types";
import { bandForRow, isMinableKind, isSolidKind, tileLeft, tileMaxHealth, tileTop } from "./world";
import type { Game } from "./game";

/** How close (px) to the tile edge the miner must be before a LEFT/RIGHT cut begins
 *  (scaled with the 80px tile). */
const EDGE_MARGIN = 5;

/** Damage the drill deals PER HIT at the miner's current drill tier (specs/upgrades.md). */
export function drillDamage(game: Game): number {
  return DRILL_DAMAGE_BY_TIER[game.tiers.drill - 1]!;
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
  const input = game.input;

  // Drilling requires standing on solid ground (specs/character.md). A falling miner does
  // not drill — this is what stops a plunge down a shaft from side-drilling or drilling the
  // air above a tile it has not yet landed on. (While already braced in a cut the miner
  // rests on the tile it is drilling — or sinks into it, below — so this stays true.)
  const grounded = solidBox(game.grid, m.x, m.y + 2, MINER_W, MINER_H);
  if (!grounded) {
    m.drilling = null;
    return;
  }

  // Choose a target. A DOWN cut already in progress on a still-minable tile is LOCKED as long
  // as down is held: the miner SINKS into the tile as it drills (below), so its centre row
  // drifts downward mid-cut — recomputing the target from position would jump it to the next
  // tile early. Keep drilling the tile we started until it breaks.
  const cur = m.drilling;
  const lockedDown =
    !!cur && cur.dir === "down" && input.down && isMinableKind(tileAt(game, cur.col, cur.row)?.kind ?? "bedrock");

  // A DOWN cut SINKS the miner into the tile it is boring (below), so mid-cut the miner is
  // embedded in that still-solid tile. If the cut is NOT being continued this step — down was
  // released, or the tile is gone — lift the miner back to rest on TOP of that tile (its true
  // standing position) BEFORE its cell is read or physics resolves collision. Otherwise the
  // physics collision resolver mistakes the vertical embedding for walking into a wall and
  // flings the miner a whole tile sideways (into a possibly-occupied tile) the instant a
  // left/right key is held while releasing down (specs/character.md).
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

  // Otherwise pick a fresh target in priority order: down, then left, then right — never up.
  // A side cut begins ONLY once the miner is flush against the tile (within EDGE_MARGIN of its
  // own tile's edge), so pressing sideways in mid-tile walks first and lateral movement inside
  // a tunnel wider than the miner is possible before committing to a dig (specs/character.md).
  if (!dir && input.down) {
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

  // Start a new cut, or continue the current one. The target tile's HEALTH lives on the tile
  // (seeded to the band's max the first time it is drilled), so a cut resumed on a
  // partly-drilled tile continues from its reduced health — accrued damage and the fuel
  // already spent are never lost (specs/character.md).
  const target = tileAt(game, tCol, tRow)!;
  if (target.health === undefined) target.health = tileMaxHealth(target);
  if (!m.drilling || m.drilling.col !== tCol || m.drilling.row !== tRow || m.drilling.dir !== dir) {
    m.drilling = { col: tCol, row: tRow, dir, hitTimer: HIT_INTERVAL };
  }

  // Brace against the tile being cut.
  m.vx = 0;
  m.vy = 0;
  if (dir === "down") {
    // Ease horizontally onto the tile's centre, and — for a CONTINUOUS shaft (solid ground
    // below the tile being cut) — SINK the miner smoothly into the tile as its health drains,
    // arriving flush on the next floor exactly as it breaks. This makes a held-down descent
    // read as one continuous bore instead of teleporting down a whole tile each time one
    // clears (specs/character.md). Above open space / lava the miner does NOT pre-sink — it
    // stays put and simply falls into the opening once the tile breaks.
    m.x = ease(m.x, tileLeft(tCol) + (TILE_SIZE - MINER_W) / 2, 433, dt);
    const below = tileAt(game, tCol, tRow + 1);
    const continuous = !!below && isSolidKind(below.kind) && below.kind !== "lava";
    const sink = continuous ? downProgress(game, target) * TILE_SIZE : 0;
    m.y = tileTop(tRow) + sink - MINER_H;
  } else {
    // A side cut eases the miner onto the floor it stands on (not the row's center) so it
    // never floats off the ground mid-cut and stays "grounded" for the check above.
    m.y = ease(m.y, tileTop(row + 1) - MINER_H - 0.01, 433, dt);
  }

  // Emit drill-debris off the bit periodically (specs/assets.md).
  game.drillFxCd -= dt;
  if (game.drillFxCd <= 0) {
    game.drillFxCd = 0.09;
    const bit = bitPosition(m, dir);
    game.fxQueue.push({ kind: "drill-debris", x: bit.x, y: bit.y });
  }

  // Advance the hit cadence and land whole hits that fall due this step (usually one per
  // several ticks at 60 Hz; the loop also handles a large dt landing several at once). Each
  // hit subtracts the drill's damage from the tile's health and spends FUEL_PER_HIT; when
  // the health reaches 0 the tile BREAKS.
  m.drilling.hitTimer -= dt;
  while (m.drilling && m.drilling.hitTimer <= 0) {
    m.drilling.hitTimer += HIT_INTERVAL;
    const broke = applyHit(game, target);
    if (broke) {
      const finished = m.drilling;
      // A gas break DETONATES (knockback + shove); don't settle it onto the floor or we'd
      // cancel the blast's impulse. Every other down break settles the miner flush on the
      // next tile (it has already sunk to there) so the shaft stays continuous.
      const brokeGas = game.grid[finished.row]![finished.col]!.kind === "gas";
      completeDrill(game, finished);
      m.drilling = null;
      if (finished.dir === "down" && !brokeGas) settleAfterDown(game, finished.col, finished.row);
      break;
    }
  }
}

/**
 * Continuous drill PROGRESS (0..1) of a tile being cut, blending the whole hits already landed
 * with the fraction of the current hit's interval elapsed — so the sink (above) advances every
 * frame, smoothly, rather than stepping once per discrete hit. Uses the miner's current drill
 * damage and the tile's remaining health (specs/character.md).
 */
function downProgress(game: Game, target: Tile): number {
  const maxH = tileMaxHealth(target);
  const dmg = drillDamage(game);
  const hitsTotal = Math.max(1, Math.ceil(maxH / dmg));
  const hitsRemaining = Math.max(0, Math.ceil((target.health ?? maxH) / dmg));
  const hitTimer = game.miner.drilling?.hitTimer ?? HIT_INTERVAL;
  const within = Math.max(0, Math.min(1, (HIT_INTERVAL - hitTimer) / HIT_INTERVAL));
  return Math.max(0, Math.min(1, (hitsTotal - hitsRemaining + within) / hitsTotal));
}

/**
 * Land one drill hit on the target tile: subtract the drill's damage-per-hit from the tile's
 * remaining health and spend FUEL_PER_HIT (never below 0). Returns true if the tile's health
 * reached 0 and it should now break (specs/character.md). Fuel spent is not refunded if the
 * cut is later abandoned — the damage stays on the tile.
 */
function applyHit(game: Game, target: Tile): boolean {
  target.health = (target.health ?? tileMaxHealth(target)) - drillDamage(game);
  game.miner.fuel = Math.max(0, game.miner.fuel - FUEL_PER_HIT);
  return target.health <= 0;
}

/**
 * Settle the miner onto the next floor after a DOWN cut clears a tile in a CONTINUOUS shaft,
 * so a held-down shaft digs continuously without ever free-falling through (or drilling) open
 * air (specs/character.md). Because the miner has already SUNK to the bottom of the cleared
 * tile while drilling it (updateDrill), this is only a tiny snap flush onto the next solid
 * tile — no visible jump. If the tile below the cleared one is open space or lava, the miner
 * is NOT settled: it is left where the sink put it and gravity carries it into the opening.
 */
function settleAfterDown(game: Game, col: number, clearedRow: number): void {
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

  // Fuel is spent PER HIT while cutting (applyHit), not on completion — by the time a tile
  // breaks its full fuel cost is already paid, so breaking only clears the tile and yields
  // its payload (specs/character.md).
  const clearToTunnel = (): void => {
    game.grid[d.row]![d.col] = { kind: "tunnel", band };
  };

  switch (tile.kind) {
    case "gas": {
      detonateGas(game, d.col, d.row);
      break;
    }
    case "ore": {
      const ore = tile.ore!;
      // The drilled tile ALWAYS becomes tunnel — the cut succeeds whether or not the ore
      // fits, so a full bay never leaves a solid tile under the miner and hard-locks the
      // dig (specs/mining.md). If the bay is full by slot count, the ore is left behind.
      clearToTunnel();
      if (collectOre(game, ore)) {
        game.fxQueue.push({ kind: "ore-sparkle", x: cx, y: cy });
        game.sndQueue.push("ore-pickup");
      } else {
        game.note("CARGO FULL — ORE LOST");
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
      break;
    }
    case "core": {
      // The Core is an INEXHAUSTIBLE source: it is never cleared to a tunnel, so after the
      // miner jettisons a Sample (a one-way discard, specs/items.md) it can return and drill
      // the Core again for another. A fresh Sample is taken only when none is currently live
      // — none carried AND none ticking on the ground (the single global coreTimer).
      if (game.coreTimer === null && !game.satchel.coreSample) {
        game.satchel.coreSample = true;
        game.coreTimer = CORE_TIMER_SECONDS;
        game.fxQueue.push({ kind: "core-extract", x: cx, y: cy });
        game.sndQueue.push("material-chime");
        game.note("CORE SAMPLE UNSTABLE — GET TO THE PAD");
      } else {
        game.note("A CORE SAMPLE IS ALREADY UNSTABLE");
      }
      // Re-seed the Core's health so the next extraction requires a fresh full drill; leave
      // the tile as `core` (never a tunnel) so the miner stays on top of the chamber.
      tile.health = undefined;
      break;
    }
    default: {
      clearToTunnel();
      break;
    }
  }
}
