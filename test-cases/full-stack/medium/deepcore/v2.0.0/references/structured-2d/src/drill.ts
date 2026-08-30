// Deepcore — the drill (specs/character.md, specs/mining.md).
//
// The miner cuts the cell it is moving into, down, left, or right, and never
// upward, and only while it rests on solid ground. A side cut begins once the
// box is flush against the cell beside it. Every minable cell carries its band's
// health; a hit lands every `DRILL_HIT_INTERVAL`, spends `DRILL_HIT_FUEL`, and
// removes the drill tier's damage. Damage persists on the cell, so an abandoned
// cut resumes where it stopped. A down cut sinks the miner into the cell in
// proportion to the cut's progress, so a held shaft reads as one continuous
// bore. A broken cell yields what it held.

import {
  CORE_TIMER,
  CUES,
  DRILL_HIT_FUEL,
  DRILL_HIT_INTERVAL,
  MINER_H,
  MINER_W,
  TILE,
} from "./constants";
import { cue } from "./audio";
import { collectOre } from "./economy";
import { fx, hurt, note, raiseNotice } from "./feedback";
import { drillDamage, radiatorEffect } from "./figures";
import { detonateGas } from "./hazards";
import { ease, isGrounded, minerCol, minerRow } from "./physics";
import { putTile, tileAt } from "./state";
import type { DeepcoreState, DrillProgress, Tile } from "./game";
import { LAVA_DRILL_DAMAGE } from "./tuning";
import {
  bandForRow,
  cellCenter,
  isMinableKind,
  isSolidKind,
  makeTile,
  tileLeft,
  tileMaxHealth,
  tileTop,
} from "./world";

/** How near a cell's edge the box must be before a side cut begins. */
export const EDGE_MARGIN = 5;

/** How fast the miner is eased into alignment with the cell it is cutting. */
const BRACE_RATE = 433;

/** Seconds between the debris bursts a running cut throws off the bit. */
const DRILL_FX_PERIOD = 0.09;

/** The cut's progress, `0` to `1`, as the target cell's health drains. */
export function cutProgress(tile: Tile): number {
  const max = tileMaxHealth(tile);
  if (max <= 0) return 0;
  const health = tile.health ?? max;
  return Math.min(1, Math.max(0, 1 - health / max));
}

/** Advance the drill one update. */
export function updateDrill(d: DeepcoreState, dt: number): void {
  const m = d.miner;
  const input = d.input;

  // With the drill faculty held, no cut starts and none progresses.
  if (!m.drill) {
    m.drilling = null;
    return;
  }

  // A cut starts only while the miner rests on solid ground, which is what stops
  // a plunge down a shaft from cutting the air it is falling through.
  if (!isGrounded(d.grid, m)) {
    m.drilling = null;
    return;
  }

  // A down cut already under way stays locked on its cell while down is held:
  // the miner sinks into that cell as it drills, so reading the target back off
  // its position would step to the next cell early.
  const cur = m.drilling;
  const lockedDown =
    !!cur &&
    cur.dir === "down" &&
    input.down &&
    isMinableKind(tileAt(d.grid, cur.col, cur.row)?.kind ?? "bedrock");

  // A down cut that is not being continued leaves the miner embedded in the cell
  // it was boring. Lift it back onto that cell before its own cell is read, or
  // the collision resolver reads the embedding as walking into a wall.
  // The lift-back is a move of the BODY, so it is gated on the travel faculty
  // like every other one: specs/instrumentation.md has the body hold its posed
  // position "whatever is held on the keyboard", with collision displacement
  // named among what moves it nowhere.
  if (!lockedDown && cur && cur.dir === "down" && m.travel) {
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
    const below = tileAt(d.grid, col, row + 1);
    if (below && isMinableKind(below.kind)) {
      dir = "down";
      tCol = col;
      tRow = row + 1;
    }
  }
  if (!dir && input.left && m.x - tileLeft(col) <= EDGE_MARGIN) {
    const beside = tileAt(d.grid, col - 1, row);
    if (beside && isMinableKind(beside.kind)) {
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
    const beside = tileAt(d.grid, col + 1, row);
    if (beside && isMinableKind(beside.kind)) {
      dir = "right";
      tCol = col + 1;
      tRow = row;
    }
  }

  if (!dir) {
    m.drilling = null;
    return;
  }

  // The first hit on a cell seeds its band's health, which then persists on the
  // cell whether or not the cut is seen through.
  const target = tileAt(d.grid, tCol, tRow);
  if (!target) {
    m.drilling = null;
    return;
  }
  if (target.health === null) {
    putTile(d, tCol, tRow, { ...target, health: tileMaxHealth(target) });
  }

  if (
    !m.drilling ||
    m.drilling.col !== tCol ||
    m.drilling.row !== tRow ||
    m.drilling.dir !== dir
  ) {
    m.drilling = { col: tCol, row: tRow, dir, hitTimer: DRILL_HIT_INTERVAL };
  }

  // Brace against the cell being cut. A side cut eases the miner onto the floor
  // it stands on, so it never floats off the ground mid-cut and stays grounded.
  if (m.travel) {
    m.vx = 0;
    m.vy = 0;
    if (dir === "down") {
      m.x = ease(m.x, tileLeft(tCol) + (TILE - MINER_W) / 2, BRACE_RATE, dt);
    } else {
      m.y = ease(m.y, tileTop(row + 1) - MINER_H - 0.01, BRACE_RATE, dt);
    }
  }

  emitDrillDebris(d, dt, dir);

  // Land every hit that falls due this update, which is one per several frames
  // at a normal step and several at once over a long one.
  m.drilling = { ...m.drilling, hitTimer: m.drilling.hitTimer - dt };
  while (m.drilling && m.drilling.hitTimer <= 0) {
    m.drilling = {
      ...m.drilling,
      hitTimer: m.drilling.hitTimer + DRILL_HIT_INTERVAL,
    };
    const cell = tileAt(d.grid, tCol, tRow);
    if (!cell) {
      m.drilling = null;
      return;
    }
    const health = (cell.health ?? tileMaxHealth(cell)) - drillDamage(d.tiers);
    putTile(d, tCol, tRow, { ...cell, health });
    m.fuel = Math.max(0, m.fuel - DRILL_HIT_FUEL);
    if (health <= 0) {
      const finished = m.drilling;
      const brokeGas = cell.kind === "gas";
      completeCut(d, finished);
      m.drilling = null;
      // A gas break shoves the miner, so settling it would cancel the blast.
      if (finished.dir === "down" && !brokeGas) {
        settleAfterDown(d, finished.col, finished.row);
      }
      return;
    }
  }

  // The miner's feet travel from the top of the cell being cut to its bottom in
  // proportion to the cut's progress, so a held shaft reads as one continuous
  // bore and the miner arrives flush on the next cell exactly as this one
  // breaks. With open space or lava below it does not sink; it falls into the
  // opening instead.
  if (m.travel && m.drilling && m.drilling.dir === "down") {
    const below = tileAt(d.grid, tCol, tRow + 1);
    const continuous =
      !!below && isSolidKind(below.kind) && below.kind !== "lava";
    const cell = tileAt(d.grid, tCol, tRow);
    const sink = continuous && cell ? cutProgress(cell) * TILE : 0;
    m.y = tileTop(tRow) + sink - MINER_H;
  }
}

/** Spray chips off the bit while a cut runs. */
function emitDrillDebris(
  d: DeepcoreState,
  dt: number,
  dir: "down" | "left" | "right",
): void {
  d.drillFxCd -= dt;
  if (d.drillFxCd > 0) return;
  d.drillFxCd = DRILL_FX_PERIOD;
  const m = d.miner;
  const at =
    dir === "down"
      ? { x: m.x + MINER_W / 2, y: m.y + MINER_H }
      : dir === "left"
        ? { x: m.x, y: m.y + MINER_H / 2 }
        : { x: m.x + MINER_W, y: m.y + MINER_H / 2 };
  fx(d, "drill-debris", at.x, at.y);
}

/**
 * Rest the miner on the next floor once a down cut clears a cell in a continuous
 * shaft. The miner has already sunk to the bottom of the cleared cell, so this
 * is a flush snap rather than a step down. Over open space or lava it is left to
 * fall.
 */
function settleAfterDown(
  d: DeepcoreState,
  col: number,
  clearedRow: number,
): void {
  if (!d.miner.travel) return;
  const belowRow = clearedRow + 1;
  const below = tileAt(d.grid, col, belowRow);
  if (!below || !isSolidKind(below.kind) || below.kind === "lava") return;
  d.miner.y = tileTop(belowRow) - MINER_H - 0.01;
  d.miner.vy = 0;
}

/** Resolve a cell breaking: what it yields, and what it leaves behind. */
function completeCut(d: DeepcoreState, cut: DrillProgress): void {
  const tile = tileAt(d.grid, cut.col, cut.row);
  if (!tile) return;
  const band = bandForRow(cut.row, d.coreRow);
  const at = cellCenter(cut.col, cut.row);
  const clear = (): void => {
    putTile(d, cut.col, cut.row, makeTile("tunnel", band));
  };

  switch (tile.kind) {
    case "gas":
      detonateGas(d, cut.col, cut.row);
      break;
    case "lava": {
      d.miner.hull -= LAVA_DRILL_DAMAGE[band] * (1 - radiatorEffect(d.tiers));
      hurt(d);
      fx(d, "lava-embers", at.x, at.y);
      cue(d, CUES.lavaSizzle);
      raiseNotice(d, "lava");
      clear();
      break;
    }
    case "ore": {
      const ore = tile.ore;
      // The cut always succeeds, so a full bay never leaves a solid cell
      // underfoot.
      clear();
      if (ore && collectOre(d, ore)) {
        fx(d, "ore-sparkle", at.x, at.y);
        cue(d, CUES.orePickup);
      } else {
        note(d, "CARGO FULL — ORE LOST");
      }
      break;
    }
    case "material": {
      const material = tile.material;
      if (material) {
        d.satchel[material] += 1;
        const node = d.nodes.find(
          (entry) => entry.col === cut.col && entry.row === cut.row,
        );
        if (node) node.collected = true;
        note(
          d,
          material === "resonite" ? "RESONITE COLLECTED" : "CRYENITE COLLECTED",
        );
      }
      clear();
      fx(d, "material-shimmer", at.x, at.y);
      cue(d, CUES.materialChime);
      break;
    }
    case "core": {
      // The Core is inexhaustible and is never removed, so another Sample is
      // always available. Only one Sample may be live at a time.
      if (d.coreTimer === null) {
        d.satchel.coreSample = true;
        d.coreTimer = CORE_TIMER;
        fx(d, "core-extract", at.x, at.y);
        cue(d, CUES.materialChime);
        note(d, "CORE SAMPLE UNSTABLE — GET TO THE PAD");
      } else {
        note(d, "A CORE SAMPLE IS ALREADY UNSTABLE");
      }
      // The Core's own health goes back to undrilled, so the next Sample takes
      // the same cut as this one did.
      putTile(d, cut.col, cut.row, { ...tile, health: null });
      break;
    }
    default:
      clear();
      break;
  }
}
