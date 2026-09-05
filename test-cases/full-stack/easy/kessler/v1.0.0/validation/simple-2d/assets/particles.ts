// assets — reading the produced particle systems off the workspace, handing
// each to the runtime the build must play it through, and showing a simulated
// moment as the evidence a system point leaves behind. CASE-PROVIDED.
//
// NOT A `.test.ts`, so vitest never collects it: it is the shared reading half
// of the three `assets/*-system-produced` points, which are about FILES rather
// than about a drive. `specs/assets.md` fixes each system's path — `burst`,
// `spark` and `burnup` under `assets/particles/` — and what accepts it: "Play
// them through `@clockwyrks/particle-runtime`, an installed dependency
// imported by its bare name", where "a player is constructed over a parsed
// system" and "the package's own types are the authoritative API". So the
// authority on whether a file IS a particle system is the runtime itself: the
// file is parsed as JSON and handed to the package's own simulator, and
// whatever that package takes without throwing is a system it accepts. No
// schema is re-stated here, because a schema written here would fail files the
// runtime happily plays.
//
// THE RUNTIME IS IMPORTED, NOT REIMPLEMENTED — and imported dynamically, so a
// build that dropped the dependency fails the point with its reason named
// rather than crashing the suite on load.
//
// THE EVIDENCE. These points drive no game, so the still each leaves is a
// picture of the FILE: the system simulated by the runtime's own simulator and
// its particles plotted over a dark ground. Nothing drawn there is read by an
// assertion.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ParticleSimulator,
  ParticleSystem,
  RenderParticle,
} from "@clockwyrks/particle-runtime";
import { PARTICLE_FILES as PARTICLE_PATHS } from "../constants";
import { WORKSPACE, type Harness } from "../harness";

/** The three produced systems, at the paths `specs/assets.md` fixes. */
export const PARTICLE_FILES = {
  burst: `assets/${PARTICLE_PATHS.burst}`,
  spark: `assets/${PARTICLE_PATHS.spark}`,
  burnup: `assets/${PARTICLE_PATHS.burnup}`,
} as const;

/** How many simulated frames the evidence sweeps, at most. */
const EVIDENCE_MAX_FRAMES = 240;

/** What reading a produced system through the runtime came back with. */
export interface SystemRead {
  /** The parsed system the runtime accepted, or `null` where it did not. */
  system: ParticleSystem | null;
  /** Why not, worded for the point to fail with. */
  reason: string | null;
  /**
   * The fullest moment of a seeded play, for the evidence plot: the captured
   * frame of the simulation that held the most live particles. Empty when the
   * file never reached the simulator.
   */
  particles: RenderParticle[];
}

/**
 * Read one produced system and hand it to the runtime.
 *
 * The stages are the point's own claims, in order: the file exists, it parses
 * as JSON, and `@clockwyrks/particle-runtime`'s own `ParticleSimulator`
 * constructs over it and steps through one full duration without throwing —
 * which is what "a particle system the runtime accepts" is. Each stage that
 * cannot be passed comes back as the `reason`.
 */
export async function readSystem(file: string): Promise<SystemRead> {
  let bytes: Buffer;
  try {
    bytes = readFileSync(join(WORKSPACE, file));
  } catch {
    return { system: null, reason: `no file at ${file}`, particles: [] };
  }
  if (bytes.length === 0) {
    return { system: null, reason: `${file} is empty`, particles: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    return {
      system: null,
      reason: `${file} is not JSON: ${String(error)}`,
      particles: [],
    };
  }

  let Simulator: typeof ParticleSimulator;
  try {
    ({ ParticleSimulator: Simulator } =
      await import("@clockwyrks/particle-runtime"));
  } catch (error) {
    return {
      system: null,
      reason: `@clockwyrks/particle-runtime could not be imported: ${String(error)}`,
      particles: [],
    };
  }

  let simulator: ParticleSimulator;
  try {
    simulator = new Simulator(parsed as ParticleSystem, { seed: 1 });
  } catch (error) {
    return {
      system: null,
      reason: `the runtime's ParticleSimulator rejected ${file}: ${String(error)}`,
      particles: [],
    };
  }

  // One full seeded play at the system's own frame rate, keeping the fullest
  // captured frame as the evidence. The sweep is bounded so a long looping
  // system cannot stall the suite.
  const system = simulator.system;
  const fps = Number.isFinite(system.fps) && system.fps > 0 ? system.fps : 60;
  const dt = 1000 / fps;
  const frames = Math.min(
    EVIDENCE_MAX_FRAMES,
    Math.max(1, Math.ceil((system.durationMs || 0) / dt)),
  );
  let fullest: RenderParticle[] = [];
  try {
    for (let frame = 0; frame < frames; frame += 1) {
      simulator.step(dt);
      const captured = simulator.capture();
      if (captured.length > fullest.length) fullest = captured;
    }
  } catch (error) {
    return {
      system: null,
      reason: `the runtime threw while playing ${file}: ${String(error)}`,
      particles: fullest,
    };
  }

  return { system, reason: null, particles: fullest };
}

/** One particle readied for the evidence canvas. */
export interface PlottedDot {
  x: number;
  y: number;
  radius: number;
  color: string;
  alpha: number;
}

/** Scale a captured frame into dots on a `side x side` evidence viewport. */
export function plotDots(
  particles: readonly RenderParticle[],
  side: number,
): PlottedDot[] {
  if (particles.length === 0) return [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let maxSize = 0;
  for (const p of particles) {
    minX = Math.min(minX, p.position[0]);
    maxX = Math.max(maxX, p.position[0]);
    minY = Math.min(minY, p.position[1]);
    maxY = Math.max(maxY, p.position[1]);
    maxSize = Math.max(maxSize, p.size);
  }
  const span = Math.max(maxX - minX, maxY - minY, 1e-6);
  const scale = (side - 80) / span;
  const toByte = (linear: number): number =>
    Math.round(255 * Math.pow(Math.min(Math.max(linear, 0), 1), 1 / 2.2));
  return particles.map((p) => ({
    x: side / 2 + (p.position[0] - (minX + maxX) / 2) * scale,
    y: side / 2 + (p.position[1] - (minY + maxY) / 2) * scale,
    radius: 2 + 8 * (maxSize > 0 ? p.size / maxSize : 0),
    color: `rgb(${toByte(p.color[0])},${toByte(p.color[1])},${toByte(p.color[2])})`,
    alpha: Math.min(Math.max(p.opacity, 0.1), 1),
  }));
}

/**
 * Plot a simulated moment of a system over the harness's canvas, so the still
 * a system point captures is a picture of the file it read.
 *
 * The particles are scaled to fit the canvas and drawn as round dots with the
 * color, opacity and relative size the runtime derived. Nothing here is read
 * by an assertion, and a read that never produced particles leaves an empty
 * ground with the file's name on it.
 */
export function showParticleSystem(
  h: Harness,
  file: string,
  particles: readonly RenderParticle[],
): void {
  const { ctx, canvas } = h;
  const side = Math.min(canvas.width, canvas.height);
  const dots = plotDots(particles, side);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#0b0d12";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const dot of dots) {
    ctx.globalAlpha = dot.alpha;
    ctx.fillStyle = dot.color;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, dot.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#c9d4e4";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.font = "14px monospace";
  ctx.fillText(
    `${file} — ${dots.length} particles, simulated by @clockwyrks/particle-runtime`,
    canvas.width / 2,
    canvas.height - 16,
  );
  ctx.restore();
}
