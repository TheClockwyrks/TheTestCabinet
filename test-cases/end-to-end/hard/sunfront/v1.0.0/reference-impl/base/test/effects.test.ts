/**
 * Sunfront — headless effects + destruction drive (a Phase-7 gate).
 *
 * The muzzle-flash layer and the destruction cue are exercised without a browser: the
 * particle runtime and the posing math are pure (no WebGL context is created — only
 * `THREE.Scene`/`Points`/`BufferGeometry`/`ShaderMaterial`, all CPU-side), so we can drive
 * {@link EffectsManager} on node and observe the point cloud, and step the pure
 * {@link World} to observe a unit die and be culled.
 *
 * Asserts (specs/assets.md, specs/units.md): a firing unit's shot plays ONE fresh
 * one-shot flash that spawns live particles and then fully decays and is recycled (so the
 * flash rate tracks the fire rate, not one instance held on); and a unit at 0 HP is
 * flagged dead (it flashes white), stays on the field through its flash window, then is
 * removed. Run via `test/effects.run.mjs`; it exits non-zero on any failed assertion.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as THREE from "three";
import { EffectsManager } from "../src/render/effects";
import type { ModelSpec, ParticleSystem } from "../src/runtime";
import type { MuzzleKind, MuzzleMount, RigBounds } from "../src/types";
import { World } from "../src/sim/world";

// The bundle runs from a temp dir, so resolve assets against the project root (cwd),
// where `test/effects.run.mjs` is launched.
const assetsDir = path.join(process.cwd(), "public", "assets");
const readJson = (p: string): unknown => JSON.parse(fs.readFileSync(p, "utf8"));

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string): void {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); return; }
  failed++;
  console.error(`  ✗ ${msg}`);
}

// --- Muzzle flash: one fresh one-shot per shot, then recycled -----------------

const system = readJson(path.join(assetsDir, "effects", "muzzle-small-arms.json")) as ParticleSystem;
const effects = new Map<MuzzleKind, ParticleSystem>([["small-arms", system]]);
const scene = new THREE.Scene();
const mgr = new EffectsManager(scene, effects);

const rig = readJson(path.join(assetsDir, "sentinel", "rig.json")) as ModelSpec;
const clip = (rig.animations ?? []).find((a) => a.name === "fire");
const mount: MuzzleMount = { kind: "small-arms", part: "rifle", local: [0, 0, 0], scale: 6 };
const bounds: RigBounds = { minY: 0, centerX: 0, centerZ: 0, sizeX: 0, sizeY: 0, sizeZ: 0 };

const before = scene.children.length;
mgr.flash(mount, rig, clip, undefined, 0, { x: 300, z: 300, altitude: 0, yaw: 0.7 }, bounds);
check(scene.children.length === before + 1, "a shot adds exactly one flash to the scene");

const points = scene.children[scene.children.length - 1] as THREE.Points;
mgr.update(1 / 60);
const live = (points.geometry.drawRange.count ?? 0);
check(live > 0, `the flash spawns live particles in sync (${live} at t=16ms)`);

// Run out the one-shot (duration 300ms + particle lifetimes): it must fully decay + recycle.
for (let i = 0; i < 90; i++) mgr.update(1 / 60);
check(scene.children.length === before, "the one-shot flash is disposed/recycled after it decays");

// A second shot must reuse the pool (no unbounded growth) and play again.
mgr.flash(mount, rig, clip, undefined, 0, { x: 300, z: 300, altitude: 0, yaw: 0.7 }, bounds);
mgr.update(1 / 60);
check(scene.children.length === before + 1, "a subsequent shot plays a fresh flash (pooled)");
mgr.clear();
check(scene.children.length === before, "clear() detaches every player");

// --- Destruction: a unit at 0 HP flashes then is removed ----------------------

const w = new World();
const u = w.spawnUnit("player", "scarab", 1, { x: 200, z: 200 }, 0);
u.hp = 0;
w.step(1 / 60);
check(u.dead === true, "a unit at 0 HP is flagged dead (begins the white flash)");
check(w.units.includes(u), "the dying unit stays on the field through its flash window");
let culled = false;
for (let i = 0; i < 60; i++) {
  w.step(1 / 60);
  if (!w.units.includes(u)) { culled = true; break; }
}
check(culled, "the unit is removed once its death flash elapses");

// --- Summary ------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
