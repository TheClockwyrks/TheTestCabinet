/**
 * Sunfront — the generated battlefield terrain (specs/playfield.md).
 *
 * Everything here is generated in code (no art files): the **sand ground** with faint
 * **banding perpendicular to the diagonal** so motion toward the enemy corner reads,
 * the two dark **staging-yard panels** behind each base, and the player's **8×3 build
 * grid**. It all registers with the {@link MaterialRegistry} so the F4 wireframe
 * toggle reaches it. The fog of war is a later phase; this is the lit floor beneath
 * the roster.
 */

import * as THREE from "three";
import {
  PALETTE,
  ARENA_SIZE,
  BUILD_CELL_SIZE,
  BUILD_GRID_COLS,
  BUILD_GRID_ROWS,
  PLAYER_GRID_ORIGIN,
} from "../constants";
import type { Team } from "../types";
import type { MaterialRegistry } from "./materials";

/** World-space centre of build-grid cell `[col,row]` for a team (specs/playfield.md). */
export function gridCellCenter(team: Team, col: number, row: number): { x: number; z: number } {
  const x = PLAYER_GRID_ORIGIN.x + col * BUILD_CELL_SIZE;
  const z = PLAYER_GRID_ORIGIN.z + row * BUILD_CELL_SIZE;
  return team === "player" ? { x, z } : { x: ARENA_SIZE - x, z: ARENA_SIZE - z };
}

/** The player yard's covering rectangle (a little larger than the 8×3 grid). */
function playerYardRect(): { cx: number; cz: number; w: number; d: number } {
  const w = BUILD_GRID_COLS * BUILD_CELL_SIZE + 24;
  const d = BUILD_GRID_ROWS * BUILD_CELL_SIZE + 24;
  const cx = PLAYER_GRID_ORIGIN.x + ((BUILD_GRID_COLS - 1) * BUILD_CELL_SIZE) / 2;
  const cz = PLAYER_GRID_ORIGIN.z + ((BUILD_GRID_ROWS - 1) * BUILD_CELL_SIZE) / 2;
  return { cx, cz, w, d };
}

/** Bake a diagonal-banded sand texture: bands of constant `x + z` so advancing reads. */
function bandingTexture(): THREE.CanvasTexture {
  const S = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = PALETTE.sand;
  ctx.fillRect(0, 0, S, S);
  // A band every ~60 logical units, perpendicular to the diagonal (constant px+py).
  const bandPx = (60 / ARENA_SIZE) * S;
  ctx.fillStyle = PALETTE.banding;
  ctx.globalAlpha = 0.5;
  for (let s = 0; s < 2 * S; s += bandPx * 2) {
    // Fill the diagonal strip s <= px+py < s+bandPx as a quadrilateral.
    ctx.beginPath();
    ctx.moveTo(Math.max(0, s), Math.min(S, s));
    ctx.lineTo(Math.min(S, s), Math.max(0, s));
    ctx.lineTo(Math.min(S, s + bandPx), Math.max(0, s + bandPx));
    ctx.lineTo(Math.max(0, s + bandPx), Math.min(S, s + bandPx));
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A flat, ground-lying plane at height `y`. */
function groundPlane(w: number, d: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

export interface Terrain {
  readonly group: THREE.Group;
}

/** Build the terrain group and add it to the scene. */
export function buildTerrain(scene: THREE.Scene, registry: MaterialRegistry): Terrain {
  const group = new THREE.Group();

  // A large plain-sand underlay so the world reads beyond the arena edges.
  const underlay = groundPlane(
    ARENA_SIZE * 2.4,
    ARENA_SIZE * 2.4,
    registry.add(new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.sand), roughness: 1 })),
  );
  underlay.position.set(ARENA_SIZE / 2, -0.5, ARENA_SIZE / 2);
  group.add(underlay);

  // The banded arena floor.
  const arena = groundPlane(
    ARENA_SIZE,
    ARENA_SIZE,
    registry.add(new THREE.MeshStandardMaterial({ map: bandingTexture(), roughness: 1 })),
  );
  arena.position.set(ARENA_SIZE / 2, 0, ARENA_SIZE / 2);
  group.add(arena);

  // The two staging-yard panels (the enemy's is under permanent fog in a later phase).
  const yardMat = registry.add(
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.yardPanel), roughness: 1 }),
  );
  for (const team of ["player", "enemy"] as Team[]) {
    const r = playerYardRect();
    const cx = team === "player" ? r.cx : ARENA_SIZE - r.cx;
    const cz = team === "player" ? r.cz : ARENA_SIZE - r.cz;
    const panel = groundPlane(r.w, r.d, yardMat);
    panel.position.set(cx, 0.15, cz);
    group.add(panel);
  }

  // The player build grid: faint cell lines over the player yard.
  group.add(buildGridLines(registry));

  scene.add(group);
  return { group };
}

/** LineSegments for the player's 8×3 build-grid cells (specs/playfield.md). */
function buildGridLines(registry: MaterialRegistry): THREE.LineSegments {
  const pts: number[] = [];
  const y = 0.3;
  const x0 = PLAYER_GRID_ORIGIN.x - BUILD_CELL_SIZE / 2;
  const z0 = PLAYER_GRID_ORIGIN.z - BUILD_CELL_SIZE / 2;
  const x1 = x0 + BUILD_GRID_COLS * BUILD_CELL_SIZE;
  const z1 = z0 + BUILD_GRID_ROWS * BUILD_CELL_SIZE;
  for (let c = 0; c <= BUILD_GRID_COLS; c++) {
    const x = x0 + c * BUILD_CELL_SIZE;
    pts.push(x, y, z0, x, y, z1);
  }
  for (let rr = 0; rr <= BUILD_GRID_ROWS; rr++) {
    const z = z0 + rr * BUILD_CELL_SIZE;
    pts.push(x0, y, z, x1, y, z);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  const mat = registry.add(
    new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.textFaint), transparent: true, opacity: 0.7 }),
  );
  return new THREE.LineSegments(geom, mat);
}
