// Spectra — the values the runtime's debug overlay shows
// (specs/instrumentation.md).
//
// The overlay itself is the runtime's (`src/overlay.ts`): it owns the panel, the
// backtick key that toggles it, and its read-only-ness. Spectra's whole part is to
// NAME the values it wants on it, which is what this file does.
//
// Every source is a PURE READ of the one live state object, so watching the overlay
// never changes what the simulation does — the snapshot is identical before and
// after a toggle. The drone roster is listed rather than counted, capped at
// {@link ROSTER_LINES} entries with the rest summarized, because a panel line that
// grew without bound would run off the canvas on an assembled formation of forty.

import { droneEffectiveBand } from "./bands";
import { fluxHold, isChallengeStage } from "./constants";
import { shimmering } from "./drones";
import { dischargeReady } from "./resonance";
import type { InitApi } from "./runtime";
import type { Drone, SpectraState } from "./types";

/** How many drones the panel names before it summarizes the rest. */
export const ROSTER_LINES = 4;

/** A position on the field reads better as a whole unit. */
function round(value: number): string {
  return String(Math.round(value));
}

/** One drone, as one short entry of the roster line. */
export function droneLine(state: SpectraState, drone: Drone): string {
  const inverted = state.inversion > 0;
  const parts = [
    `#${drone.id}`,
    drone.kind,
    `${drone.band}/${droneEffectiveBand(drone, inverted, state.stage)}`,
    `(${round(drone.x)}, ${round(drone.y)})`,
    drone.phase,
  ];
  if (drone.kind === "flux") {
    parts.push(
      shimmering(drone, state.stage)
        ? "shimmer"
        : `hold ${drone.bandClock.toFixed(2)}/${fluxHold(state.stage).toFixed(2)}`,
    );
  }
  if (drone.kind === "prism") parts.push(drone.shellAlive ? "shell" : "core");
  parts.push(`chg ${drone.charge}`);
  return parts.join(" ");
}

/** Register every diagnostic source over the live state. */
export function registerDiagnostics(api: InitApi, state: SpectraState): void {
  api.diagnostics.register(
    "screen",
    () =>
      `${state.screen} / ${state.phase}  stage ${state.stage}` +
      `${isChallengeStage(state.stage) ? " (challenge)" : ""}`,
  );
  api.diagnostics.register(
    "run",
    () =>
      `score ${state.score}  lives ${state.lives}  resonance ${state.resonance}` +
      `${dischargeReady(state) ? " READY" : ""}`,
  );
  api.diagnostics.register("inversion", () =>
    state.inversion > 0 ? `active ${state.inversion.toFixed(2)}s` : "off",
  );
  api.diagnostics.register(
    "ship",
    () =>
      `${round(state.ship.x)}  ${state.ship.band}  lockout ` +
      state.ship.lockout.toFixed(2),
  );
  api.diagnostics.register("drones", () =>
    roster(state.drones.map((drone) => droneLine(state, drone))),
  );
  api.diagnostics.register(
    "field",
    () => `bullets ${state.bullets.length}  bursts ${state.bursts.length}`,
  );
}

/** One roster as a single line: its entries, or `none` where it is empty. */
export function roster(entries: readonly string[]): string {
  if (entries.length === 0) return "none";
  if (entries.length <= ROSTER_LINES) return entries.join("  |  ");
  return `${entries.slice(0, ROSTER_LINES).join("  |  ")}  |  +${
    entries.length - ROSTER_LINES
  } more`;
}
