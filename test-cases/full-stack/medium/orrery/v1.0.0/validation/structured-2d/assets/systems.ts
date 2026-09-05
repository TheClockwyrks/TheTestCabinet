// assets/systems — playing a produced particle system to its end, telling two of
// them apart, and the pictures those points leave.
//
// A PRIVATE MODULE OF THIS DIRECTORY, named for the thing it plays rather than
// for a review item, and no manifest entry points at it — the precedent
// `validation/README.md` sets with `collision/examples.ts`. IT ASSERTS NOTHING:
// it plays a file through the runtime and hands back what the runtime reported,
// and the suite that called it decides the point. It is the same text in all
// three projects, like everything here that is not `harness.ts` or `surface.ts`.
//
// WHY IT SITS BESIDE `particles.ts` RATHER THAN INSIDE IT. The case-provided
// `particles.ts` answers one question — does the runtime ACCEPT this file — and
// plays exactly one duration to answer it. Two of `specs/assets.md`'s claims need
// more than that:
//
//   1. "Each is authored one-shot, its timeline set with `set-timeline --loop
//      false`, so it decays to empty rather than settling into a steady state."
//      A one-shot's particles may legitimately outlive the duration its timeline
//      declares — the fault system's do — so what shows a system decaying is a
//      play that runs PAST that duration and finds nothing left and nothing
//      re-fired. {@link playSystem} is that play.
//   2. "Produce each of these with `particle-2d`": three systems, three files.
//      Whether two files are the SAME system is a comparison of what the runtime
//      parsed, which {@link canonicalSystem} renders as one string apiece.
//
// THE RUNTIME IS IMPORTED, NOT REIMPLEMENTED, and imported dynamically for the
// reason `particles.ts` gives: a build that dropped the dependency fails the point
// with its reason named rather than crashing the suite on load.

import { createCanvas, type Canvas } from "@napi-rs/canvas";
import type {
  ParticleSimulator,
  ParticleSystem,
  RenderParticle,
} from "@clockwyrks/particle-runtime";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WORKSPACE, writeImageBytes } from "../media";
import { paintParticleSystem } from "./particles";

/**
 * How many of the system's own declared durations a decay play runs for.
 *
 * `specs/assets.md` fixes no lifetime for a particle, so a one-shot whose
 * particles outlive the duration its timeline declares is conformant and is
 * still decaying. Three whole durations is the runtime's own reading of the
 * property — its `simulator.test.ts` plays two past the first and requires the
 * population to stay at nothing — and it is far past any lifetime an effect
 * fired on one hex of a hex field would sensibly carry.
 */
export const DECAY_PLAYS = 3;

/** How many frames a decay play runs at most, whatever the system declares. */
const MAX_DECAY_FRAMES = 3000;

/** How many moments of the play the filmstrip shows. */
const STRIP_MOMENTS = 6;

/** The side of one square plot in the pictures below, in pixels. */
const PLOT_SIDE = 300;

/** One sampled moment of a play: when it was, and what was live then. */
export interface Moment {
  /** Milliseconds into the play. */
  tMs: number;
  /** How many particles were live. */
  live: number;
  /** Those particles, as the runtime captured them. */
  particles: RenderParticle[];
}

/** What playing one produced system past its own duration came back with. */
export interface SystemPlay {
  /** The file, relative to the repository root. */
  file: string;
  /** The system the runtime accepted, or `null` where it did not. */
  system: ParticleSystem | null;
  /** Why not, worded for a point to fail with. */
  reason: string | null;
  /** How many particles were live after each simulated frame, in order. */
  live: number[];
  /** The most any one frame held. */
  peakLive: number;
  /** How many were live when the play ended, {@link DECAY_PLAYS} durations in. */
  liveAtEnd: number;
  /**
   * Whether the population ever reached nothing and stayed there: the frame it
   * first held nothing was followed by no frame holding anything.
   *
   * A looping timeline re-fires at its duration, so it recovers from nothing and
   * this is `false`; a one-shot never does.
   */
  settled: boolean;
  /** Evenly spaced moments of the play, for the filmstrip. */
  moments: Moment[];
}

/**
 * Play one produced system for {@link DECAY_PLAYS} of its own durations, and
 * hand back what the runtime reported frame by frame.
 *
 * The stages are the claims a point makes of the file, in order: it is there, it
 * parses as JSON, and `@clockwyrks/particle-runtime`'s own `ParticleSimulator`
 * constructs over it and steps without throwing. Each stage that cannot be passed
 * comes back as the `reason`.
 */
export async function playSystem(file: string): Promise<SystemPlay> {
  const empty = {
    file,
    system: null,
    live: [],
    peakLive: 0,
    liveAtEnd: 0,
    settled: false,
    moments: [],
  };

  let bytes: Buffer;
  try {
    bytes = readFileSync(join(WORKSPACE, file));
  } catch {
    return { ...empty, reason: `no file at ${file}` };
  }
  if (bytes.length === 0) return { ...empty, reason: `${file} is empty` };

  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    return { ...empty, reason: `${file} is not JSON: ${String(error)}` };
  }

  let Simulator: typeof ParticleSimulator;
  try {
    ({ ParticleSimulator: Simulator } =
      await import("@clockwyrks/particle-runtime"));
  } catch (error) {
    return {
      ...empty,
      reason: `@clockwyrks/particle-runtime could not be imported: ${String(error)}`,
    };
  }

  let simulator: ParticleSimulator;
  try {
    simulator = new Simulator(parsed as ParticleSystem, { seed: 1 });
  } catch (error) {
    return {
      ...empty,
      reason: `the runtime's ParticleSimulator rejected ${file}: ${String(error)}`,
    };
  }

  const system = simulator.system;
  const fps = Number.isFinite(system.fps) && system.fps > 0 ? system.fps : 60;
  const dt = 1000 / fps;
  const frames = Math.min(
    MAX_DECAY_FRAMES,
    Math.max(1, Math.ceil((DECAY_PLAYS * (system.durationMs || 0)) / dt)),
  );
  const every = Math.max(1, Math.floor(frames / STRIP_MOMENTS));

  const live: number[] = [];
  const moments: Moment[] = [];
  try {
    for (let frame = 0; frame < frames; frame += 1) {
      simulator.step(dt);
      const captured = simulator.capture();
      live.push(captured.length);
      if (frame % every === 0 && moments.length < STRIP_MOMENTS) {
        moments.push({
          tMs: Math.round((frame + 1) * dt),
          live: captured.length,
          particles: captured,
        });
      }
    }
  } catch (error) {
    return {
      ...empty,
      live,
      peakLive: live.length === 0 ? 0 : Math.max(...live),
      moments,
      reason: `the runtime threw while playing ${file}: ${String(error)}`,
    };
  }

  const firstEmpty = live.indexOf(0);
  return {
    file,
    system,
    reason: null,
    live,
    peakLive: live.length === 0 ? 0 : Math.max(...live),
    liveAtEnd: live[live.length - 1] ?? 0,
    settled: firstEmpty >= 0 && live.slice(firstEmpty).every((n) => n === 0),
    moments,
  };
}

/**
 * One parsed system rendered as a single string, with every object's keys in a
 * fixed order, so two systems are the same exactly when their strings are.
 *
 * WHY THE PARSED SYSTEM RATHER THAN THE FILE'S BYTES. Two files that differ only
 * in their whitespace or in the order they wrote their keys are the same system,
 * and a point about "one system shipped three times under three names" would be
 * answered wrongly by comparing bytes. What the runtime parsed is what plays.
 */
export function canonicalSystem(system: ParticleSystem): string {
  const order = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(order);
    if (value !== null && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, held]) => held !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return Object.fromEntries(
        entries.map(([key, held]) => [key, order(held)]),
      );
    }
    return value;
  };
  return JSON.stringify(order(system));
}

/* ---- Evidence pictures ----------------------------------------------------- */

const INK = "#c9d4e4";
const PAPER = "#0b0d12";

/** A caption over a plot, so a reviewer reads what the moment is. */
function caption(canvas: Canvas, text: string): Canvas {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = INK;
  ctx.font = "13px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(text, canvas.width / 2, 8);
  return canvas;
}

/**
 * The play as a filmstrip — one plot per sampled moment, left to right, with the
 * live population under it — and keep it as the review item's `outputId` output.
 *
 * Nothing painted here is read by an assertion. A read that never reached the
 * runtime leaves an empty strip with the file's name and the reason on it.
 */
export function showDecay(outputId: string, play: SystemPlay): void {
  const columns = Math.max(1, play.moments.length);
  const canvas = createCanvas(columns * PLOT_SIDE, PLOT_SIDE + 76);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const [index, moment] of play.moments.entries()) {
    const plot = paintParticleSystem(play.file, moment.particles);
    ctx.drawImage(
      plot as unknown as never,
      index * PLOT_SIDE,
      40,
      PLOT_SIDE,
      PLOT_SIDE,
    );
    ctx.fillStyle = INK;
    ctx.font = "13px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(
      `${moment.tMs} ms — ${moment.live} live`,
      index * PLOT_SIDE + PLOT_SIDE / 2,
      PLOT_SIDE + 48,
    );
  }

  ctx.fillStyle = INK;
  ctx.font = "15px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(
    play.reason === null
      ? `${play.file} — loop ${String(play.system?.loop)}, ` +
          `${play.system?.durationMs ?? 0} ms x ${DECAY_PLAYS}, ` +
          `peak ${play.peakLive}, ${play.liveAtEnd} live at the end`
      : `${play.file} — ${play.reason}`,
    16,
    14,
  );
  writeImageBytes(outputId, canvas.toBuffer("image/png"));
}

/** One system's fullest moment, for the side-by-side picture. */
export interface Plotted {
  file: string;
  particles: readonly RenderParticle[];
  note: string;
}

/**
 * Several systems plotted side by side, each captioned with what was read off
 * it, and kept as the review item's `outputId` output.
 */
export function showSystems(
  outputId: string,
  plotted: readonly Plotted[],
): void {
  const columns = Math.max(1, plotted.length);
  const canvas = createCanvas(columns * PLOT_SIDE, PLOT_SIDE + 40);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const [index, one] of plotted.entries()) {
    ctx.drawImage(
      caption(
        paintParticleSystem(one.file, one.particles),
        one.file,
      ) as unknown as never,
      index * PLOT_SIDE,
      0,
      PLOT_SIDE,
      PLOT_SIDE,
    );
    ctx.fillStyle = INK;
    ctx.font = "13px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(one.note, index * PLOT_SIDE + PLOT_SIDE / 2, PLOT_SIDE + 12);
  }
  writeImageBytes(outputId, canvas.toBuffer("image/png"));
}
