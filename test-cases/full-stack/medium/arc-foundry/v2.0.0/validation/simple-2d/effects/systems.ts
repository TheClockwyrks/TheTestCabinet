// Arc Foundry — reading the produced particle systems off disk. CASE-PROVIDED.
//
// `specs/assets.md` names twelve effects, fixes the path of each at
// `assets/fx/<effect>.json`, and says what each one is authored with: "Author each
// with `particle-2d`, whose emit step writes the `system.json` that is the asset."
// The shape of that document is the particle runtime's own — the package is
// already a dependency of the project, and `specs/assets.md` calls its types "the
// authoritative API" — so a system is read here as the runtime's
// `ParticleSystem` and nothing about it is invented.
//
// WHAT IS READ, AND WHAT IS DELIBERATELY NOT. The emitters, the forces and the
// per-particle curves, because those are what `specs/assets.md` asks each effect to
// carry ("emitters, forces, and per-particle curves"), and the color stops,
// because it asks the slow, burn and aura systems to "each carry a color of their
// own". Nothing here plays a system or looks at what it renders: whether the
// effects reach the yard is decided by the points that drive the build.

import { existsSync, readFileSync } from "node:fs";
import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import { type EffectName, EFFECTS } from "../constants";
import { fail } from "../assert";
import { ASSETS } from "./produced";

export { EFFECTS, type EffectName } from "../constants";
export { ASSETS } from "./produced";

/**
 * The four effects a firing structure plays, which `specs/assets.md` escalates
 * with quality: "the same escalation applies to the chain, the spray, the ring,
 * and the arc bolt".
 */
export const FIRING_EFFECTS: readonly EffectName[] = [
  "bolt",
  "chain",
  "spray",
  "ring",
];

/** The three effects a unit or a support node carries, per `specs/assets.md`. */
export const STATUS_EFFECTS: readonly EffectName[] = ["slow", "burn", "aura"];

/** The path `specs/assets.md` fixes for one effect, under `assets/`. */
export function fileOf(effect: EffectName): string {
  return `fx/${effect}.json`;
}

/** Which of the twelve are not on disk. */
export function missing(): string[] {
  return EFFECTS.map(fileOf).filter((path) => !existsSync(ASSETS + path));
}

/** One produced system, parsed, or a failure naming the path and the fault. */
export function readSystem(effect: EffectName): ParticleSystem {
  const path = fileOf(effect);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(ASSETS + path, "utf8"));
  } catch (error) {
    return fail(
      `assets/${path} to be a particle system produced with particle-2d ` +
        `(specs/assets.md)`,
      existsSync(ASSETS + path)
        ? `it is on disk and did not parse: ${String(error)}`
        : "it is not on disk",
    );
  }
  const system = parsed as ParticleSystem;
  if (
    typeof system !== "object" ||
    system === null ||
    !Array.isArray(system.emitters)
  ) {
    return fail(
      `assets/${path} to parse as a particle system carrying an emitters list ` +
        `(specs/assets.md)`,
      `it parsed as ${JSON.stringify(parsed).slice(0, 120)}`,
    );
  }
  return system;
}

/** An `#rrggbb` stop as three channels, or `null` when it is not one. */
export function channelsOf(color: unknown): [number, number, number] | null {
  if (typeof color !== "string") return null;
  const match = /^#([0-9a-fA-F]{6})$/.exec(color.trim());
  if (match === null) return null;
  const hex = match[1]!;
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

/** Every color stop of every emitter of a system, as channels. */
export function colorStops(system: ParticleSystem): [number, number, number][] {
  const stops: [number, number, number][] = [];
  for (const emitter of system.emitters) {
    for (const stop of emitter.particle?.colorGradient ?? []) {
      const channels = channelsOf(stop.color);
      if (channels !== null) stops.push(channels);
    }
  }
  return stops;
}

/** The mean of a set of colors, channel by channel. */
export function meanColor(
  stops: readonly [number, number, number][],
): [number, number, number] {
  const n = stops.length;
  return [
    stops.reduce((t, s) => t + s[0], 0) / n,
    stops.reduce((t, s) => t + s[1], 0) / n,
    stops.reduce((t, s) => t + s[2], 0) / n,
  ];
}

/** The RGB distance between two colors, `0` to `441`. */
export function colorDistance(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * A system's AUTHORED SHAPE: its emitters, its forces and its per-particle curves,
 * with every color dropped.
 *
 * This is what `effects/systems-distinct` compares, because the review item asks
 * that "each pair differs in its emitters, its forces or its per-particle curves
 * rather than being one file committed twelve times" — so twelve recolorings of
 * one authored system are twelve copies of it, and dropping the colors is what
 * makes them read as such.
 */
export function authoredShape(system: ParticleSystem): string {
  return JSON.stringify({
    dimensions: system.dimensions,
    field: system.field,
    durationMs: system.durationMs,
    loop: system.loop,
    forces: system.forces ?? null,
    subEmitters: system.subEmitters ?? null,
    emitters: system.emitters.map((emitter) => ({
      shape: emitter.shape,
      position: emitter.position,
      extent: emitter.extent,
      emission: emitter.emission,
      lifetimeMs: emitter.lifetimeMs,
      lifetimeSpread: emitter.lifetimeSpread ?? null,
      speed: emitter.speed,
      speedSpread: emitter.speedSpread ?? null,
      direction: emitter.direction,
      coneAngle: emitter.coneAngle ?? null,
      forces: emitter.forces ?? null,
      sizeCurve: emitter.particle?.sizeCurve ?? null,
      opacityCurve: emitter.particle?.opacityCurve ?? null,
      rotation: emitter.particle?.rotation ?? null,
      stretch: emitter.particle?.stretch ?? null,
    })),
  });
}
