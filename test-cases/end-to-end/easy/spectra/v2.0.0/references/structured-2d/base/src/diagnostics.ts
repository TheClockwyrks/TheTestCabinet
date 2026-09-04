// Spectra — what the engine's debug overlay shows (`specs/instrumentation.md`).
//
// The overlay is the ENGINE's: it draws the panel, it owns the backtick key, and
// it keeps the panel read-only. Spectra's whole part is registering the values it
// wants on it, through `world.diagnostics` from the game mode's `beginPlay`, which
// runs once per world after every declared actor has begun play.
//
// Every source is a function of no arguments, invoked at each read, and every one
// is a PURE READ of the live state it reaches through the given accessor — the
// world the mode holds — so the panel reports the frame being drawn and watching
// the overlay leaves the game exactly as it is. Each line is short enough to read
// at a glance while the game runs.

import { isChallengeStage } from "./constants";
import { droneBand, inverted, isShimmering } from "./bands";
import { dischargeReady } from "./discharge";
import { spectraState, type DroneState, type SpectraState } from "./game";
import type { World } from "@test-cabinet/structured-2d";

/** A number, short enough to read on a line. */
function n(value: number, places = 1): string {
  return value.toFixed(places);
}

/** One drone, on one line: who it is, what it reads as, and where it stands. */
function droneLine(drone: DroneState, state: SpectraState): string {
  const swapped = inverted(state.inversion);
  const kind = drone.kind[0]?.toUpperCase() ?? "?";
  const effective = droneBand(drone, state.stage, swapped);
  const band =
    drone.band === effective ? drone.band : `${drone.band}>${effective}`;
  const flags = [
    isShimmering(drone, state.stage) ? "shimmer" : "",
    drone.kind === "prism" ? (drone.shellAlive ? "shell" : "core") : "",
  ].filter((flag) => flag !== "");
  return `#${drone.id} ${kind} ${band} ${drone.phase} (${n(drone.x, 0)}, ${n(
    drone.y,
    0,
  )})${flags.length > 0 ? ` ${flags.join(" ")}` : ""}`;
}

/**
 * The sources, each named and each a read through `read` at the call. Split from
 * the registration so the build's own tests drive the same sources over a state
 * of their own.
 */
export function diagnosticSources(
  read: () => SpectraState,
): [string, () => unknown][] {
  return [
    [
      "screen",
      () => {
        const s = read();
        return (
          `${s.screen}/${s.phase} stage ${s.stage}` +
          `${isChallengeStage(s.stage) ? " challenge" : ""} t${n(s.phaseTimer, 2)}`
        );
      },
    ],
    [
      "run",
      () => {
        const s = read();
        return (
          `score ${s.score} lives ${s.lives} res ${n(s.resonance, 0)}` +
          `${dischargeReady(s.resonance) ? " READY" : ""}`
        );
      },
    ],
    [
      "inversion",
      () => {
        const s = read();
        return inverted(s.inversion) ? `active ${n(s.inversion, 2)}s` : "off";
      },
    ],
    [
      "ship",
      () => {
        const s = read();
        return `x ${n(s.ship.x, 0)} ${s.ship.band} lockout ${n(s.ship.lockout, 2)}`;
      },
    ],
    [
      "field",
      () => {
        const s = read();
        return `drones ${s.drones.length} bullets ${s.bullets.length} bursts ${s.bursts.length}`;
      },
    ],
    [
      "drones",
      () => {
        const s = read();
        return s.drones.length === 0
          ? "none"
          : s.drones.map((drone) => droneLine(drone, s)).join(" | ");
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
