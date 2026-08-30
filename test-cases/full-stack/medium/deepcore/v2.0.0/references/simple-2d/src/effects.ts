// Deepcore — the produced particle effects, played live (specs/assets.md).
//
// Every world event — a drill bite, a jetpack plume, an ore glint, a gas blast,
// the core extraction and its detonation, the launch column, a death burst —
// fires the matching produced `system.json`, simulated live through
// `@test-cabinet/particle-runtime`'s pure simulator and drawn into the context
// the engine hands `render`. Being simulated rather than baked, a burst varies
// shot to shot.
//
// WHY THE POOL SITS BESIDE THE STATE. A running simulation is not a value: it
// carries its own generator and its own live particles, and stepping it is
// exactly the write the state contract forbids. So the effects that are on
// screen live here, in the one place in this build that holds mutable data
// across a frame, and the SIMULATION NEVER READS THEM. The traffic runs one way:
// a frame's rules push `FxEvent`s onto the draft, `update` drains them here once
// the frame's rules have all run, and `render` draws whatever is playing. Take
// the pool away and the game plays identically, minus the sparks.
//
// The particles are drawn straight into the mine's own transform, in world
// units, so a burst sits where its event happened and scrolls with the mine. A
// system whose file is missing simply never spawns, which is what lets the
// project build and run before the assets land.

import { ParticleSimulator } from "@test-cabinet/particle-runtime";
import type { ParticleSystem } from "@test-cabinet/particle-runtime";

/** The twelve effects `specs/assets.md` names, by the file each lands at. */
export const FX_KINDS = [
  "gas-seep",
  "drill-debris",
  "jetpack-exhaust",
  "ore-sparkle",
  "material-shimmer",
  "gas-explosion",
  "lava-embers",
  "impact-dust",
  "core-extract",
  "core-detonation",
  "launch-exhaust",
  "death-burst",
] as const;

export type FxKind = (typeof FX_KINDS)[number];

/** A burst request, in world units. `scale` grows the footprint of a big blast. */
export interface FxEvent {
  readonly kind: FxKind;
  readonly x: number;
  readonly y: number;
  readonly scale?: number;
}

/** The world footprint each effect's field maps onto, in units. */
const FOOTPRINT: Readonly<Record<FxKind, number>> = {
  "gas-seep": 88,
  "drill-debris": 144,
  "jetpack-exhaust": 168,
  "ore-sparkle": 120,
  "material-shimmer": 156,
  "gas-explosion": 288,
  "lava-embers": 132,
  "impact-dust": 168,
  "core-extract": 330,
  "core-detonation": 780,
  "launch-exhaust": 600,
  "death-burst": 270,
};

/** Fire and energy read best composited additively; smoke and debris do not. */
const ADDITIVE: Readonly<Record<FxKind, boolean>> = {
  "gas-seep": false,
  "drill-debris": false,
  "jetpack-exhaust": true,
  "ore-sparkle": true,
  "material-shimmer": true,
  "gas-explosion": true,
  "lava-embers": true,
  "impact-dust": false,
  "core-extract": true,
  "core-detonation": true,
  "launch-exhaust": true,
  "death-burst": true,
};

/** The most bursts that play at once, so a long dig cannot grow without bound. */
const MAX_LIVE = 48;

/** Milliseconds a finished burst is kept for while its last particles decay. */
const TAIL_MS = 200;

/** One burst on screen. */
interface Burst {
  readonly simulator: ParticleSimulator;
  readonly additive: boolean;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly fieldW: number;
  readonly fieldH: number;
  readonly pixelRadius: number;
  readonly durationMs: number;
  ageMs: number;
}

let systems: Partial<Record<FxKind, ParticleSystem>> = {};
let live: Burst[] = [];

/** Hand the pool the produced systems, once, and empty whatever was playing. */
export function installSystems(
  produced: Partial<Record<FxKind, ParticleSystem>>,
): void {
  systems = produced;
  live = [];
}

/** Take every burst off the screen at once, which a reset does. */
export function clearEffects(): void {
  live = [];
}

/** How many bursts are playing. The diagnostics overlay reads this. */
export function liveEffectCount(): number {
  return live.length;
}

/** Start a burst for each event the frame raised. */
export function spawnEffects(events: readonly FxEvent[]): void {
  for (const event of events) spawn(event);
}

function spawn(event: FxEvent): void {
  const system = systems[event.kind];
  if (!system) return;
  const fieldW = Math.max(system.field.width, 1);
  const fieldH = Math.max(system.field.height, 1);
  live.push({
    simulator: new ParticleSimulator(system),
    additive: ADDITIVE[event.kind],
    x: event.x,
    y: event.y,
    size: FOOTPRINT[event.kind] * (event.scale ?? 1),
    fieldW,
    fieldH,
    pixelRadius: Math.max(fieldW, fieldH) * 0.02,
    durationMs: system.durationMs,
    ageMs: 0,
  });
  if (live.length > MAX_LIVE) live.shift();
}

/** Step every burst by the frame's delta, and retire the ones that are done. */
export function advanceEffects(dt: number): void {
  for (const burst of live) {
    burst.simulator.step(dt * 1000);
    burst.ageMs += dt * 1000;
  }
  live = live.filter(
    (burst) =>
      burst.ageMs < burst.durationMs + TAIL_MS || burst.simulator.liveCount > 0,
  );
}

/**
 * Draw every burst, in world units, into the transform the mine is drawn under.
 *
 * Each particle is a soft radial disc, exactly as the runtime's own canvas
 * binding draws one; the difference is only that the discs land in the mine's
 * own space rather than on a field of their own, so a burst scrolls with the
 * cell it happened at.
 */
export function drawEffects(ctx: CanvasRenderingContext2D): void {
  const previous = ctx.globalCompositeOperation;
  for (const burst of live) {
    ctx.globalCompositeOperation = burst.additive ? "lighter" : "source-over";
    const sx = burst.size / burst.fieldW;
    const sy = burst.size / burst.fieldH;
    const rScale = (sx + sy) * 0.5;
    const left = burst.x - burst.size / 2;
    const bottom = burst.y + burst.size / 2;
    for (const particle of burst.simulator.capture()) {
      const r = Math.max(particle.size * burst.pixelRadius * rScale, 0.5);
      const px = left + particle.position[0] * sx;
      // The field's `y` runs up; the mine's runs down.
      const py = bottom - particle.position[1] * sy;
      const [cr, cg, cb] = channels(particle.color);
      const gradient = ctx.createRadialGradient(px, py, 0, px, py, r);
      gradient.addColorStop(
        0,
        `rgba(${cr}, ${cg}, ${cb}, ${particle.opacity})`,
      );
      gradient.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalCompositeOperation = previous;
}

/** A linear `0..1` RGB triple as `0..255` integer channels. */
function channels(
  color: readonly [number, number, number],
): [number, number, number] {
  return [clamp255(color[0]), clamp255(color[1]), clamp255(color[2])];
}

function clamp255(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}
