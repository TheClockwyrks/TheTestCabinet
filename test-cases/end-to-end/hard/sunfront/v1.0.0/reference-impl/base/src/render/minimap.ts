/**
 * Sunfront — the click-to-jump minimap (specs/flow.md — required).
 *
 * A small overview of the whole combat corridor drawn as a 2D canvas in the HUD's
 * bottom-left corner, in the same palette and panel styling as the rest of the overlay.
 * The player's corner sits bottom-left and the enemy's top-right, so the diagonal lane
 * reads the way units advance up-screen. Each frame it plots, from a plain snapshot of
 * the live {@link Match}:
 *
 * - the **combat corridor** band along the diagonal (specs/playfield.md);
 * - **friendly** structures, units, bases, and the Reliquary (Ember);
 * - **enemy** units, base, Reliquary, and Aegis (Azure) — but ONLY where they fall
 *   inside the player's current vision, exactly as the 3D view fog-gates them, so the
 *   minimap never leaks the fogged enemy yard (specs/playfield.md fog of war);
 * - the **camera's current view region** — the on-ground footprint of the command
 *   camera, outlined so the player can see what is on screen.
 *
 * Clicking anywhere on it converts the pixel back to a ground `(x, z)` and asks the
 * renderer to jump the command camera there (`World.jumpCameraTo`), satisfying the
 * spec's required "minimap you can click to jump the camera".
 */

import { PALETTE, TEAM_COLORS, ARENA_SIZE, CORRIDOR_HALF_WIDTH } from "../constants";
import { pointVisible } from "../vision";
import { gridCellCenter } from "./terrain";
import type { Match } from "../match";
import type { World as RenderWorld } from "./world";

/** On-screen size of the square minimap, in CSS pixels. */
const MAP_PX = 150;
/** Inset from the panel edge to the plotted arena, in CSS pixels. */
const PAD = 7;
/** Side length of the plotted arena inside the panel. */
const INNER = MAP_PX - PAD * 2;

/** Called with a ground `(x, z)` when the player clicks the minimap. */
export type MinimapJump = (x: number, z: number) => void;

export class Minimap {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(parent: HTMLElement, private readonly onJump: MinimapJump) {
    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      position: "absolute",
      left: "16px",
      bottom: "16px",
      width: `${MAP_PX}px`,
      height: `${MAP_PX}px`,
      background: "rgba(21,15,8,0.82)",
      border: `1px solid ${PALETTE.textFaint}`,
      borderRadius: "4px",
      pointerEvents: "auto",
      cursor: "crosshair",
      display: "none",
    } satisfies Partial<CSSStyleDeclaration>);

    this.canvas = document.createElement("canvas");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = MAP_PX * dpr;
    this.canvas.height = MAP_PX * dpr;
    Object.assign(this.canvas.style, { width: `${MAP_PX}px`, height: `${MAP_PX}px`, display: "block" });
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Sunfront minimap: 2D canvas context unavailable");
    this.ctx = ctx;
    this.ctx.scale(dpr, dpr);

    this.root.appendChild(this.canvas);
    // A click jumps the command camera to the picked lane point (specs/flow.md).
    this.root.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const px = ((e.clientX - rect.left) / rect.width) * MAP_PX;
      const py = ((e.clientY - rect.top) / rect.height) * MAP_PX;
      const x = clamp01((px - PAD) / INNER) * ARENA_SIZE;
      const z = clamp01(1 - (py - PAD) / INNER) * ARENA_SIZE;
      this.onJump(x, z);
    });
    parent.appendChild(this.root);
  }

  show(): void { this.root.style.display = "block"; }
  hide(): void { this.root.style.display = "none"; }

  /** Redraw the minimap from the live match and the renderer's current view region. */
  update(match: Match, render: RenderWorld): void {
    if (this.root.style.display === "none") return;
    const w = match.world;
    const vision = match.vision;
    const c = this.ctx;

    c.clearRect(0, 0, MAP_PX, MAP_PX);

    // Sand field, then the brighter combat corridor band along the diagonal.
    c.fillStyle = "rgba(156,132,82,0.16)";
    c.fillRect(PAD, PAD, INNER, INNER);
    this.fillCorridor(c);

    // Friendly build-grid structures (always visible — the player's own yard).
    for (const s of w.structures) {
      if (s.team !== "player") continue;
      const g = gridCellCenter("player", s.col, s.row);
      this.dot(c, g.x, g.z, 2.1, PALETTE.ember, true);
    }

    // Bases and Reliquaries: the player's own always show; the enemy's only in vision.
    this.structureBlip(c, w.bases.player, PALETTE.ember, 5, true);
    this.structureBlip(c, w.reliquaries.player, PALETTE.neutral, 4.5, true);
    this.structureBlip(c, w.bases.enemy, TEAM_COLORS.enemy.base, 5, pointVisible(vision, w.bases.enemy.x, w.bases.enemy.z));
    this.structureBlip(
      c, w.reliquaries.enemy, PALETTE.neutral, 4.5,
      pointVisible(vision, w.reliquaries.enemy.x, w.reliquaries.enemy.z),
    );

    // Units + Aegis: friendly always; enemy fog-gated to the player's current vision.
    for (const u of w.units) {
      if (u.dead) continue;
      if (u.team === "enemy" && !pointVisible(vision, u.x, u.z)) continue;
      this.dot(c, u.x, u.z, 1.9, TEAM_COLORS[u.team].base, false);
    }
    for (const a of w.aegis) {
      if (a.dead) continue;
      if (a.team === "enemy" && !pointVisible(vision, a.x, a.z)) continue;
      this.dot(c, a.x, a.z, 3.4, TEAM_COLORS[a.team].accent, false);
    }

    // The command camera's on-ground footprint — what is currently on screen.
    this.strokeViewRegion(c, render.viewRegion());
  }

  /** Fill the |offset| <= 240 corridor strip, clipped to the plotted arena square. */
  private fillCorridor(c: CanvasRenderingContext2D): void {
    // The strip runs from the player corner to the enemy corner, half-width 240 across
    // the perpendicular anti-diagonal. Its quad corners lie partly outside the arena;
    // clip to the plotted square so the overhang is cropped cleanly.
    const h = CORRIDOR_HALF_WIDTH;
    const quad = [
      { x: h, z: -h }, { x: -h, z: h },
      { x: ARENA_SIZE - h, z: ARENA_SIZE + h }, { x: ARENA_SIZE + h, z: ARENA_SIZE - h },
    ];
    c.save();
    c.beginPath();
    c.rect(PAD, PAD, INNER, INNER);
    c.clip();
    c.beginPath();
    quad.forEach((p, i) => {
      const s = this.project(p.x, p.z);
      if (i === 0) c.moveTo(s.x, s.y);
      else c.lineTo(s.x, s.y);
    });
    c.closePath();
    c.fillStyle = "rgba(122,102,61,0.6)";
    c.fill();
    c.restore();
  }

  /** Outline the four-corner ground footprint of the current view. */
  private strokeViewRegion(c: CanvasRenderingContext2D, region: readonly { x: number; z: number }[]): void {
    if (region.length < 3) return;
    c.save();
    c.beginPath();
    c.rect(PAD, PAD, INNER, INNER);
    c.clip();
    c.beginPath();
    region.forEach((p, i) => {
      const s = this.project(p.x, p.z);
      if (i === 0) c.moveTo(s.x, s.y);
      else c.lineTo(s.x, s.y);
    });
    c.closePath();
    c.fillStyle = "rgba(255,192,97,0.12)";
    c.fill();
    c.lineWidth = 1.25;
    c.strokeStyle = "rgba(244,236,216,0.9)";
    c.stroke();
    c.restore();
  }

  /** Plot a friendly/enemy structure or base as a small square, if it should be shown. */
  private structureBlip(
    c: CanvasRenderingContext2D,
    e: { x: number; z: number; dead: boolean; hp: number },
    color: string,
    size: number,
    shown: boolean,
  ): void {
    if (!shown || e.dead || e.hp <= 0) return;
    const s = this.project(e.x, e.z);
    c.fillStyle = color;
    c.fillRect(s.x - size / 2, s.y - size / 2, size, size);
  }

  /** Plot a unit/structure as a filled dot (square when `structure`, else a circle). */
  private dot(c: CanvasRenderingContext2D, x: number, z: number, r: number, color: string, structure: boolean): void {
    const s = this.project(x, z);
    c.fillStyle = color;
    if (structure) {
      c.fillRect(s.x - r, s.y - r, r * 2, r * 2);
    } else {
      c.beginPath();
      c.arc(s.x, s.y, r, 0, Math.PI * 2);
      c.fill();
    }
  }

  /** Ground `(x, z)` -> minimap pixel (player corner bottom-left, enemy top-right). */
  private project(x: number, z: number): { x: number; y: number } {
    return {
      x: PAD + (x / ARENA_SIZE) * INNER,
      y: PAD + (1 - z / ARENA_SIZE) * INNER,
    };
  }
}

/** Clamp to `[0, 1]`. */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
