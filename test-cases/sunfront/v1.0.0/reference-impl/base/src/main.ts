/**
 * Sunfront — entry point.
 *
 * Phase-2 scaffold: boots three, fits a 16:9 letterboxed renderer that stays
 * correct and centred at any window size and pixel density (specs/overview.md), and
 * draws an empty lit scene with the sand ground plane through a fixed low-oblique
 * command camera. Later phases fill this with the generated arena, the GPU-instanced
 * voxel roster, the simulation, the fog, the HUD, and the state machine. The asset
 * bundle (specs/assets.md) is loaded here so the whole roster is ready for those
 * phases; the scaffold itself only proves the app boots and renders.
 */

import * as THREE from "three";
import {
  PALETTE,
  ASPECT_RATIO,
  ARENA_SIZE,
  PLAYER_MUSTER,
} from "./constants";
import { loadAssets } from "./assets";
import type { LoadedAssets } from "./types";

const app = document.getElementById("app")!;

// --- Renderer -------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setClearColor(new THREE.Color(PALETTE.sand));
app.appendChild(renderer.domElement);
Object.assign(renderer.domElement.style, {
  position: "absolute",
  left: "0",
  top: "0",
});

// --- Scene ----------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sand);

// A warm low sun plus soft fill so the models read against the sand
// (specs/overview.md — sunlit desert war).
const sun = new THREE.DirectionalLight(0xfff0d8, 2.1);
sun.position.set(-0.6, 1.0, -0.4).multiplyScalar(600);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xfff2d6, 0x2a2214, 0.9));

// Placeholder sand ground plane (the generated arena replaces this in Phase 3).
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE),
  new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.sand),
    roughness: 1,
  }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.set(ARENA_SIZE / 2, 0, ARENA_SIZE / 2);
scene.add(ground);

// --- Camera: fixed low-oblique command view (specs/overview.md) -----------
// Centred on the player's corner by default; the full ~480-unit corridor width is
// framed; the diagonal (toward the enemy corner) recedes into the screen. Panning
// and precise framing are refined in Phase 3.
const camera = new THREE.PerspectiveCamera(45, ASPECT_RATIO, 1, 6000);

function positionCamera(): void {
  const target = new THREE.Vector3(PLAYER_MUSTER.x, 0, PLAYER_MUSTER.z);
  const diag = new THREE.Vector3(1, 0, 1).normalize();
  const back = 320;
  const height = 380;
  camera.position.copy(target).addScaledVector(diag, -back);
  camera.position.y = height;
  camera.lookAt(target);
}
positionCamera();

// --- Letterboxed 16:9 fit (specs/overview.md) -----------------------------
function fit(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  let vw = w;
  let vh = Math.round(w / ASPECT_RATIO);
  if (vh > h) {
    vh = h;
    vw = Math.round(h * ASPECT_RATIO);
  }
  const left = Math.round((w - vw) / 2);
  const top = Math.round((h - vh) / 2);
  renderer.domElement.style.left = `${left}px`;
  renderer.domElement.style.top = `${top}px`;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(vw, vh);
  camera.aspect = ASPECT_RATIO;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", fit);
fit();

// --- Render loop ----------------------------------------------------------
function frame(): void {
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- Load the asset bundle for later phases -------------------------------
// The scaffold does not yet place the models; loading here surfaces any asset
// wiring problem early and hands the ready templates to the next phase.
let assets: LoadedAssets | null = null;
loadAssets()
  .then((loaded) => {
    assets = loaded;
    console.info(
      `[sunfront] loaded ${assets.units.size} units, ${assets.structures.size} structures, ` +
        `${assets.spawners.size} spawners, ${assets.effects.size} effects, aegis ready`,
    );
  })
  .catch((err) => console.error("[sunfront] asset load failed", err));
