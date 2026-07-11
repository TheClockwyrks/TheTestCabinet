/**
 * Sunfront — billboarded battlefield overlays: health bars and level pips
 * (specs/overview.md, specs/economy.md, specs/assets.md).
 *
 * These are the generated, camera-facing markers that ride above the provided models:
 * a **health bar** over any damaged unit / structure, shading healthy→critical by its HP
 * fraction; **level pips** over each build-grid spawner/extractor showing its level; and
 * the same pips carried over a unit emitted at a veteran level, so a levelled army reads
 * on the field. They are 2.5D — thin quads planted in the 3D scene and rotated to face
 * the command camera each frame — so they scale and occlude with the world without a
 * separate screen-space pass.
 *
 * Everything is pooled: the manager is fed a fresh list each frame ({@link begin} →
 * {@link healthBar}/{@link pips} → {@link end}) and reuses quad objects across frames,
 * hiding the surplus, so a heavy late-match field costs no per-frame allocation. Being UI
 * markers rather than inspectable geometry, they are kept out of the F4 wireframe registry
 * (like the placement ghost).
 */

import * as THREE from "three";
import { PALETTE } from "../constants";

/** Bar height in world units; width is per-entity (scaled to its footprint). */
const BAR_HEIGHT = 6;
/** Level-pip size and horizontal spacing in world units. */
const PIP_SIZE = 5;
const PIP_GAP = 3;
/** The maximum spawner/unit level shown as pips (specs/economy.md — three tiers). */
const MAX_PIPS = 3;

const HEALTHY = new THREE.Color(PALETTE.healthHealthy);
const CRITICAL = new THREE.Color(PALETTE.healthCritical);
const BACKING = new THREE.Color(PALETTE.yardPanel);
const PIP_DIM = new THREE.Color(PALETTE.rock);

interface BarRequest { x: number; topY: number; z: number; fraction: number; width: number; }
interface PipRequest { x: number; topY: number; z: number; level: number; accentHex: string; }

/** One pooled health bar: a dark backing quad with a coloured fill that grows from the left. */
class HealthBarQuad {
  readonly group = new THREE.Group();
  /** This frame's queued request (set by {@link OverlayManager.healthBar}), or none. */
  pending: BarRequest | undefined;
  private readonly bg: THREE.Mesh;
  private readonly fill: THREE.Mesh;
  private readonly fillMat: THREE.MeshBasicMaterial;

  /** `leftAnchoredQuad` is a unit quad whose left edge sits on the origin (grows rightward). */
  constructor(leftAnchoredQuad: THREE.BufferGeometry) {
    const bgMat = new THREE.MeshBasicMaterial({
      color: BACKING, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false,
    });
    this.bg = new THREE.Mesh(leftAnchoredQuad, bgMat);
    this.bg.renderOrder = 20;
    this.fillMat = new THREE.MeshBasicMaterial({
      color: HEALTHY, depthTest: false, depthWrite: false,
    });
    this.fill = new THREE.Mesh(leftAnchoredQuad, this.fillMat);
    this.fill.position.z = 0.2; // draw the fill in front of its backing
    this.fill.renderOrder = 21;
    this.group.add(this.bg, this.fill);
    this.group.visible = false;
  }

  /** Place, size, and colour the bar for this frame, facing the camera. */
  apply(cameraQuat: THREE.Quaternion): void {
    const p = this.pending;
    if (!p) { this.group.visible = false; return; }
    const f = THREE.MathUtils.clamp(p.fraction, 0, 1);
    this.group.position.set(p.x, p.topY, p.z);
    this.group.quaternion.copy(cameraQuat);
    // Centre the full-width backing on the group; the fill shares its left edge.
    this.bg.scale.set(p.width, BAR_HEIGHT, 1);
    this.bg.position.x = -p.width / 2;
    this.fill.scale.set(p.width * f, BAR_HEIGHT, 1);
    this.fill.position.x = -p.width / 2;
    this.fillMat.color.copy(CRITICAL).lerp(HEALTHY, f); // critical → healthy by fraction
    this.group.visible = true;
    this.pending = undefined;
  }

  hide(): void { this.group.visible = false; this.pending = undefined; }
}

/** One pooled row of up to {@link MAX_PIPS} level pips (filled to the current level). */
class PipRow {
  readonly group = new THREE.Group();
  /** This frame's queued request (set by {@link OverlayManager.pips}), or none. */
  pending: PipRequest | undefined;
  private readonly mats: THREE.MeshBasicMaterial[] = [];
  private readonly scratchAccent = new THREE.Color();

  constructor(quad: THREE.BufferGeometry) {
    for (let i = 0; i < MAX_PIPS; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: PIP_DIM, depthTest: false, depthWrite: false });
      const pip = new THREE.Mesh(quad, mat);
      pip.scale.set(PIP_SIZE, PIP_SIZE, 1);
      pip.renderOrder = 22;
      this.mats.push(mat);
      this.group.add(pip);
    }
    this.group.visible = false;
  }

  /** Show `level` bright pips (of {@link MAX_PIPS}) in the team accent, facing the camera. */
  apply(cameraQuat: THREE.Quaternion): void {
    const p = this.pending;
    if (!p) { this.group.visible = false; return; }
    this.group.position.set(p.x, p.topY, p.z);
    this.group.quaternion.copy(cameraQuat);
    const accent = this.scratchAccent.set(p.accentHex);
    const span = MAX_PIPS * PIP_SIZE + (MAX_PIPS - 1) * PIP_GAP;
    for (let i = 0; i < MAX_PIPS; i++) {
      this.group.children[i].position.x = -span / 2 + PIP_SIZE / 2 + i * (PIP_SIZE + PIP_GAP);
      this.mats[i].color.copy(i < p.level ? accent : PIP_DIM);
    }
    this.group.visible = true;
    this.pending = undefined;
  }

  hide(): void { this.group.visible = false; this.pending = undefined; }
}

export class OverlayManager {
  private readonly root = new THREE.Group();
  /** Shared geometries: a left-anchored quad (bars) and a centred quad (pips). */
  private readonly barQuad: THREE.PlaneGeometry;
  private readonly pipQuad: THREE.PlaneGeometry;

  private readonly bars: HealthBarQuad[] = [];
  private readonly pipRows: PipRow[] = [];
  private barsUsed = 0;
  private pipsUsed = 0;

  constructor(scene: THREE.Scene) {
    // Both are unit quads; the bar quad is translated so its left edge is the origin.
    this.barQuad = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0);
    this.pipQuad = new THREE.PlaneGeometry(1, 1);
    this.root.renderOrder = 20;
    scene.add(this.root);
  }

  /** Start a frame: reset the pool cursors (surplus quads are hidden in {@link end}). */
  begin(): void {
    this.barsUsed = 0;
    this.pipsUsed = 0;
  }

  /** Queue a health bar above an entity at world `(x, topY, z)` for HP `fraction`. */
  healthBar(x: number, topY: number, z: number, fraction: number, width: number): void {
    this.barAt(this.barsUsed++).pending = { x, topY, z, fraction, width };
  }

  /** Queue a level-pip row above an entity at world `(x, topY, z)` in a team accent hex. */
  pips(x: number, topY: number, z: number, level: number, accentHex: string): void {
    this.pipAt(this.pipsUsed++).pending = { x, topY, z, level, accentHex };
  }

  /** Finish the frame: billboard every queued marker to the camera and hide the surplus. */
  end(camera: THREE.Camera): void {
    const q = camera.quaternion;
    for (let i = 0; i < this.bars.length; i++) {
      if (i >= this.barsUsed) this.bars[i].hide();
      else this.bars[i].apply(q);
    }
    for (let i = 0; i < this.pipRows.length; i++) {
      if (i >= this.pipsUsed) this.pipRows[i].hide();
      else this.pipRows[i].apply(q);
    }
  }

  /** Hide every marker (restart / leaving a match clears the transient overlays). */
  clear(): void {
    this.begin();
    for (const b of this.bars) b.hide();
    for (const r of this.pipRows) r.hide();
  }

  dispose(): void {
    this.root.parent?.remove(this.root);
    this.barQuad.dispose();
    this.pipQuad.dispose();
  }

  private barAt(i: number): HealthBarQuad {
    while (this.bars.length <= i) {
      const bar = new HealthBarQuad(this.barQuad);
      this.bars.push(bar);
      this.root.add(bar.group);
    }
    return this.bars[i];
  }

  private pipAt(i: number): PipRow {
    while (this.pipRows.length <= i) {
      const row = new PipRow(this.pipQuad);
      this.pipRows.push(row);
      this.root.add(row.group);
    }
    return this.pipRows[i];
  }
}
