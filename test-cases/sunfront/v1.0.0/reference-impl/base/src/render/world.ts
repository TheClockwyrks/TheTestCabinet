/**
 * Sunfront — the 3D world (specs/overview.md rendering/camera/performance).
 *
 * Owns the WebGL renderer, the lit scene, the generated terrain, the low oblique
 * command camera, and the GPU-instanced unit renderer, and drives them each frame.
 * It keeps the rendered view a fixed **16:9**, uniformly scaled to fit the window and
 * **letterboxed** with the background colour — correct and centred at any window size
 * and pixel density on the first paint. Panning runs **along the diagonal** (arrows /
 * WASD / edge-scroll); there is no zoom. Two developer overlays live here: **F3** live
 * FPS and **F4** wireframe (specs/overview.md).
 *
 * The world never reads simulation state directly: each frame the caller hands it a
 * flat {@link RenderEntity} list for the instanced units and updates its singletons.
 */

import * as THREE from "three";
import { PALETTE, ASPECT_RATIO, MONO_FONT_STACK } from "../constants";
import type { LoadedAssets, RenderEntity, UnitType } from "../types";
import { MaterialRegistry, createUnitMaterial } from "./materials";
import { CommandCamera, PAN_SPEED } from "./camera";
import { buildTerrain } from "./terrain";
import { InstancedUnitRenderer } from "./instanced";

const EDGE_SCROLL_PX = 24;

export class World {
  readonly scene = new THREE.Scene();
  readonly registry = new MaterialRegistry();
  readonly camera = new CommandCamera();
  readonly units: InstancedUnitRenderer;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly unitTypes: ReadonlySet<string>;

  // Input state for held-key / edge panning.
  private readonly held = new Set<string>();
  private pointer = { x: -1, y: -1, inside: false };

  // FPS overlay (F3).
  private readonly fpsEl: HTMLDivElement;
  private fpsVisible = true;
  private fpsAccum = 0;
  private fpsFrames = 0;

  constructor(container: HTMLElement, assets: LoadedAssets) {
    this.unitTypes = new Set(assets.units.keys());

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setClearColor(new THREE.Color(PALETTE.sand));
    Object.assign(this.renderer.domElement.style, { position: "absolute", left: "0", top: "0" });
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(PALETTE.sand);
    this.addLighting();
    buildTerrain(this.scene, this.registry);

    this.units = new InstancedUnitRenderer(this.scene, assets.units, createUnitMaterial(this.registry));

    this.fpsEl = this.createFpsOverlay(container);

    this.fit();
    window.addEventListener("resize", () => this.fit());
    this.bindInput(container);
  }

  /** Warm low sun plus soft hemisphere fill — sunlit desert war (specs/overview.md). */
  private addLighting(): void {
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
    sun.position.set(-0.5, 1.0, -0.35).multiplyScalar(1000);
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(0xfff2d6, 0x2a2214, 0.95));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.15));
  }

  /** Sync the instanced units for this frame (only unit-type entities are drawn here). */
  syncUnits(entities: readonly RenderEntity[], typeOf: (e: RenderEntity) => UnitType): void {
    this.units.sync(entities, (e) => {
      const t = typeOf(e);
      return this.unitTypes.has(t) ? t : null;
    });
  }

  /** Advance input-driven panning and render one frame. Call every rAF with real dt. */
  render(dtSeconds: number): void {
    this.applyPan(dtSeconds);
    this.renderer.render(this.scene, this.camera.camera);
    this.tickFps(dtSeconds);
  }

  // --- Panning (specs/overview.md — along the diagonal only) ------------------

  private applyPan(dt: number): void {
    let dir = 0;
    if (this.held.has("ArrowUp") || this.held.has("KeyW")) dir += 1;
    if (this.held.has("ArrowDown") || this.held.has("KeyS")) dir -= 1;
    if (this.pointer.inside) {
      const el = this.renderer.domElement;
      const h = el.clientHeight;
      if (this.pointer.y <= EDGE_SCROLL_PX) dir += 1;
      else if (this.pointer.y >= h - EDGE_SCROLL_PX) dir -= 1;
    }
    if (dir !== 0) this.camera.pan(dir * PAN_SPEED * dt);
  }

  private bindInput(container: HTMLElement): void {
    window.addEventListener("keydown", (e) => {
      this.held.add(e.code);
      if (e.code === "F3") { e.preventDefault(); this.toggleFps(); }
      if (e.code === "F4") { e.preventDefault(); this.registry.toggleWireframe(); }
      if (e.code === "KeyH" || e.code === "Home") this.camera.recenter();
    });
    window.addEventListener("keyup", (e) => this.held.delete(e.code));
    container.addEventListener("pointermove", (e) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.pointer.x = e.clientX - rect.left;
      this.pointer.y = e.clientY - rect.top;
      this.pointer.inside =
        this.pointer.x >= 0 && this.pointer.x <= rect.width &&
        this.pointer.y >= 0 && this.pointer.y <= rect.height;
    });
    container.addEventListener("pointerleave", () => { this.pointer.inside = false; });
  }

  // --- Letterboxed 16:9 fit (specs/overview.md) -------------------------------

  private fit(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    let vw = w;
    let vh = Math.round(w / ASPECT_RATIO);
    if (vh > h) {
      vh = h;
      vw = Math.round(h * ASPECT_RATIO);
    }
    const el = this.renderer.domElement;
    el.style.left = `${Math.round((w - vw) / 2)}px`;
    el.style.top = `${Math.round((h - vh) / 2)}px`;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(vw, vh);
    this.camera.camera.aspect = ASPECT_RATIO;
    this.camera.camera.updateProjectionMatrix();
  }

  // --- FPS overlay (F3, specs/overview.md performance) ------------------------

  private createFpsOverlay(container: HTMLElement): HTMLDivElement {
    const el = document.createElement("div");
    Object.assign(el.style, {
      position: "absolute",
      right: "10px",
      bottom: "8px",
      font: `12px ${MONO_FONT_STACK}`,
      color: PALETTE.textSecondary,
      background: "rgba(21,15,8,0.55)",
      padding: "2px 6px",
      borderRadius: "3px",
      pointerEvents: "none",
      zIndex: "10",
    });
    el.textContent = "-- FPS";
    container.appendChild(el);
    return el;
  }

  private toggleFps(): void {
    this.fpsVisible = !this.fpsVisible;
    this.fpsEl.style.display = this.fpsVisible ? "block" : "none";
  }

  private tickFps(dt: number): void {
    this.fpsAccum += dt;
    this.fpsFrames += 1;
    if (this.fpsAccum >= 0.5) {
      const fps = this.fpsFrames / this.fpsAccum;
      this.fpsEl.textContent = `${fps.toFixed(0)} FPS${this.registry.wireframe ? " · WIRE" : ""}`;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }
  }
}
