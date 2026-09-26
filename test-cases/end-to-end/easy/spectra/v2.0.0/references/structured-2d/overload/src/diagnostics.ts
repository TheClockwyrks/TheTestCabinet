// Spectra — the values the engine's debug overlay shows
// (specs/instrumentation.md, Diagnostics).
//
// The overlay itself is the engine's: it owns the panel, the backtick key that
// toggles it, and its read-only-ness. Spectra's whole part is to name the values it
// wants on it, registered through `world.diagnostics` from the game mode's
// `beginPlay`.
//
// Every source is a function of no arguments, invoked at each read, and every one
// is a PURE READ of the live state it reaches through the given accessor — the
// world the mode holds — so the panel reports the frame being drawn and watching
// the overlay never changes what the simulation does. Each line is short enough to
// read at a glance while the game runs.

import type { DiagnosticValue, World } from "@clockwyrks/structured-2d";
import { RESONANCE_MAX, fluxHold, isChallengeStage } from "./constants";
import { droneEffectiveBand, shimmering } from "./bands";
import { spectraState, type SpectraState } from "./game";

/**
 * A drone's stored band, and the band it READS as when the two differ.
 *
 * Spelled out rather than lettered. specs/instrumentation.md asks for both bands
 * per drone and asks the line to stay short; the words are what make the line
 * readable at a glance, and what let anything reading the panel tell `cyan` from
 * `magenta` without knowing this file's abbreviations.
 */
function bands(stored: string, effective: string): string {
  return stored === effective ? stored : `${stored}>${effective}`;
}

/**
 * The sources, each named and each a read through `read` at the call. Split from
 * the registration so the build's own tests can drive the same sources over a
 * state of their own.
 */
export function diagnosticSources(
  read: () => SpectraState,
): [string, () => DiagnosticValue][] {
  return [
    [
      "screen",
      () => {
        const state = read();
        const challenge = isChallengeStage(state.stage) ? " challenge" : "";
        return `${state.screen} / ${state.phase}  stage ${state.stage}${challenge}`;
      },
    ],
    [
      "run",
      () => {
        const state = read();
        return `score ${state.score}  lives ${state.lives}`;
      },
    ],
    [
      "resonance",
      () => {
        const state = read();
        const ready = state.resonance >= RESONANCE_MAX ? " READY" : "";
        return `${state.resonance.toFixed(0)} / ${RESONANCE_MAX}${ready}`;
      },
    ],
    [
      "inversion",
      () => {
        const state = read();
        return state.inversion > 0
          ? `active ${state.inversion.toFixed(2)}s`
          : "none";
      },
    ],
    [
      "ship",
      () => {
        const state = read();
        return `x ${state.ship.x.toFixed(0)}  ${state.ship.band}  lockout ${state.ship.lockout.toFixed(2)}`;
      },
    ],
    [
      "drones",
      () => {
        const state = read();
        if (state.drones.length === 0) return "-";
        return state.drones
          .map((drone) => {
            const marks = [
              drone.kind === "flux" && shimmering(drone, state.stage)
                ? "shimmer"
                : "",
              drone.kind === "prism"
                ? drone.shellAlive
                  ? "shell"
                  : "core"
                : "",
              drone.charge > 0 ? `+${drone.charge}` : "",
            ].filter(Boolean);
            const tail = marks.length > 0 ? ` ${marks.join(" ")}` : "";
            return `#${drone.id} ${drone.kind} ${bands(drone.band, droneEffectiveBand(drone, state))} ${drone.phase} (${drone.x.toFixed(0)}, ${drone.y.toFixed(0)})${tail}`;
          })
          .join(" | ");
      },
    ],
    [
      "flux window",
      () => {
        const state = read();
        return `hold ${fluxHold(state.stage).toFixed(2)}s`;
      },
    ],
    [
      "field",
      () => {
        const state = read();
        return `bullets ${state.bullets.length}  bursts ${state.bursts.length}`;
      },
    ],
  ];
}

/** Register every source with the world's overlay registry. */
export function registerDiagnostics(world: World): void {
  for (const [name, source] of diagnosticSources(() => spectraState(world))) {
    world.diagnostics.register(name, source);
  }
}
