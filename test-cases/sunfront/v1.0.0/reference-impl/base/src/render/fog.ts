/**
 * Sunfront — the fog-of-war ground overlay (specs/playfield.md).
 *
 * A single ground-plane decal drawn over the whole arena that darkens everything the
 * player cannot currently see. Each frame we rasterize the player's vision (the union
 * of reveal discs from `../vision`) into a low-res mask texture — one channel for
 * **currently visible**, a sticky one for **ever explored** — and a small unlit shader
 * turns that into the fog colour: **opaque fog where never seen** (so the enemy staging
 * yard in the far corner stays a solid fogged region), a **dim veil where explored but
 * not currently in vision**, and **clear where a base/Reliquary/unit is looking right
 * now**. Enemy units, base, and Reliquary are additionally culled from the scene when
 * outside vision (the caller gates them), so nothing pokes up through the fog as a ghost.
 *
 * The overlay floats just above the sand as a transparent, depth-tested decal, so it
 * blends over the floor while opaque units still draw in front of it. It is intentionally
 * NOT part of the F4 wireframe set — fog is not geometry to inspect.
 */

import * as THREE from "three";
import { ARENA_SIZE, PALETTE } from "../constants";
import type { VisionSource } from "../vision";

/** Mask resolution (texels per arena edge); ~9.4 logical units/texel at 128. */
const MASK_N = 128;

const VERT = /* glsl */ `
  uniform float uArena;
  varying vec2 vUv;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vUv = wp.xz / uArena;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uMask;
  uniform vec3 uFog;
  uniform float uExploredAlpha;
  varying vec2 vUv;
  void main() {
    if (vUv.x < 0.0 || vUv.x > 1.0 || vUv.y < 0.0 || vUv.y > 1.0) discard;
    vec2 m = texture2D(uMask, vUv).rg;
    float vis = m.r;   // currently visible (0..1)
    float expl = m.g;  // ever explored (0..1, sticky)
    float baseFog = mix(1.0, uExploredAlpha, expl); // opaque if never seen, dim if explored
    float a = mix(baseFog, 0.0, vis);               // clear where currently in vision
    if (a < 0.004) discard;
    gl_FragColor = vec4(uFog, a);
  }
`;

export class FogOverlay {
  readonly mesh: THREE.Mesh;
  private readonly data: Uint8Array;
  private readonly texture: THREE.DataTexture;

  constructor(scene: THREE.Scene) {
    this.data = new Uint8Array(MASK_N * MASK_N * 4);
    for (let i = 0; i < MASK_N * MASK_N; i++) this.data[i * 4 + 3] = 255; // opaque alpha channel

    this.texture = new THREE.DataTexture(this.data, MASK_N, MASK_N, THREE.RGBAFormat);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uMask: { value: this.texture },
        uArena: { value: ARENA_SIZE },
        uFog: { value: new THREE.Color(PALETTE.fog) },
        uExploredAlpha: { value: 0.55 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // A little larger than the arena so the fogged enemy corner reaches past the edge.
    const geo = new THREE.PlaneGeometry(ARENA_SIZE * 1.1, ARENA_SIZE * 1.1);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(ARENA_SIZE / 2, 0.5, ARENA_SIZE / 2);
    this.mesh.renderOrder = 5; // draw after the opaque world
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** Wipe both channels back to fully-fogged for a fresh match (specs/flow.md restart). */
  reset(): void {
    const d = this.data;
    for (let i = 0; i < MASK_N * MASK_N; i++) {
      d[i * 4] = 0;
      d[i * 4 + 1] = 0;
    }
    this.texture.needsUpdate = true;
  }

  /**
   * Rasterize the player's vision discs into the mask for this frame: clear the
   * currently-visible channel, stamp each disc into both the visible and (sticky)
   * explored channels, and upload. `sources` are the player's reveal discs.
   */
  update(sources: readonly VisionSource[]): void {
    const d = this.data;
    for (let i = 0; i < MASK_N * MASK_N; i++) d[i * 4] = 0; // reset current visibility

    for (const s of sources) {
      const cx = (s.x / ARENA_SIZE) * MASK_N;
      const cz = (s.z / ARENA_SIZE) * MASK_N;
      const rr = (s.r / ARENA_SIZE) * MASK_N;
      const r2 = rr * rr;
      const x0 = Math.max(0, Math.floor(cx - rr));
      const x1 = Math.min(MASK_N - 1, Math.ceil(cx + rr));
      const z0 = Math.max(0, Math.floor(cz - rr));
      const z1 = Math.min(MASK_N - 1, Math.ceil(cz + rr));
      for (let row = z0; row <= z1; row++) {
        for (let col = x0; col <= x1; col++) {
          const dx = col + 0.5 - cx;
          const dz = row + 0.5 - cz;
          if (dx * dx + dz * dz <= r2) {
            const i = (row * MASK_N + col) * 4;
            d[i] = 255; // currently visible
            d[i + 1] = 255; // explored (sticky)
          }
        }
      }
    }
    this.texture.needsUpdate = true;
  }
}
