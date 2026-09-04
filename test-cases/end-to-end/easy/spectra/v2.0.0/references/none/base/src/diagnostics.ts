// Spectra — the values the runtime's debug overlay shows.
//
// The overlay itself is the runtime's (`src/overlay.ts`): it owns the panel, the
// backtick key that toggles it, and its read-only-ness. Spectra's whole part is to
// name the values it wants on it (specs/instrumentation.md), which is what this
// file does.
//
// Every source is a PURE READ of the one live state object, so watching the
// overlay never changes what the simulation does, and each line is short enough
// to read at a glance while the game is running. The per-drone lines are folded
// into one source per drone, capped, so a full formation does not run off the
// bottom of the screen.

import {
  dischargeReady,
  effectiveDroneBand,
  inversionActive,
  isShimmering,
} from "./bands";
import { isChallengeStage } from "./constants";
import type { InitApi } from "./runtime";
import type { Drone, SpectraState } from "./types";

/** The most drones the overlay lists individually. */
const DRONE_LINES = 8;

/** One decimal place: enough to see motion, short enough to fit on a line. */
function fixed(value: number): string {
  return value.toFixed(1);
}

/** One drone, as one short line. */
function droneLine(state: SpectraState, drone: Drone): string {
  const bands = `${drone.band}/${effectiveDroneBand(state, drone)}`;
  const flags = [
    drone.kind === "flux"
      ? isShimmering(state, drone)
        ? "shimmer"
        : "held"
      : "",
    drone.kind === "prism" ? (drone.shellAlive ? "shell" : "core") : "",
  ]
    .filter((flag) => flag !== "")
    .join(" ");
  return (
    `#${drone.id} ${drone.kind} ${bands} ` +
    `${fixed(drone.x)},${fixed(drone.y)} ${drone.phase}` +
    (flags === "" ? "" : ` ${flags}`)
  );
}

/** Register every diagnostic source over the live state. */
export function registerDiagnostics(api: InitApi, state: SpectraState): void {
  api.diagnostics.register(
    "screen",
    () =>
      `${state.screen}/${state.phase} ${fixed(state.phaseTimer)}s` +
      (state.screen === "title" || state.screen === "howto"
        ? ""
        : ` menu ${state.menuIndex}`),
  );
  api.diagnostics.register(
    "stage",
    () =>
      `${state.stage}${isChallengeStage(state.stage) ? " CHALLENGE" : ""}` +
      (isChallengeStage(state.stage) ? ` hits ${state.challengeHits}` : ""),
  );
  api.diagnostics.register(
    "run",
    () =>
      `score ${state.score} lives ${state.lives}` +
      (state.extraLifeAwarded ? " (+1 paid)" : ""),
  );
  api.diagnostics.register(
    "resonance",
    () =>
      `${fixed(state.resonance)}${dischargeReady(state) ? " READY" : ""}` +
      (state.discharge.active
        ? ` wave r=${fixed(state.discharge.radius)}`
        : ""),
  );
  api.diagnostics.register("inversion", () =>
    inversionActive(state) ? `active ${fixed(state.inversion)}s` : "off",
  );
  api.diagnostics.register(
    "ship",
    () =>
      `x ${fixed(state.ship.x)} ${state.ship.band}` +
      ` lockout ${fixed(state.ship.lockout)} cooldown ${fixed(state.ship.cooldown)}`,
  );
  api.diagnostics.register(
    "wave",
    () =>
      `entry ${state.waveEntry ? "on" : "off"} ${fixed(state.entryClock)}s` +
      ` dive ${state.diveLaunching ? "on" : "off"} ` +
      `${fixed(state.diveClock)}/${fixed(state.diveGap)}s`,
  );
  api.diagnostics.register(
    "rosters",
    () =>
      `${state.drones.length} drones ` +
      `${state.bullets.length} bullets ${state.bursts.length} bursts`,
  );
  for (let i = 0; i < DRONE_LINES; i += 1) {
    api.diagnostics.register(`drone ${i}`, () => {
      const drone = state.drones[i];
      return drone === undefined ? "-" : droneLine(state, drone);
    });
  }
  api.diagnostics.register("simTime", () => `${fixed(state.simTime)}s`);
}
