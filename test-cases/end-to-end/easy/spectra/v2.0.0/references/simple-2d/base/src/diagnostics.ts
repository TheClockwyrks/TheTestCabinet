// Spectra — what the engine's debug overlay shows (`specs/instrumentation.md`).
//
// The overlay is the ENGINE's: it draws the panel, it owns the backtick key, and
// it keeps the panel read-only. Spectra's whole part is registering the values it
// wants on it, which is what this file does, once, in `initialize`.
//
// Every source is handed the state current at the read, so it reads off its
// argument rather than off the state `initialize` built — each frame replaces the
// state, and a source that closed over the opening object would report the
// opening game forever. Every source is a pure read, so watching the overlay
// leaves the game exactly as it is, and each is short enough to sit on one line.

import { isChallengeStage } from "./constants";
import { droneBand, inverted, isShimmering } from "./bands";
import { dischargeReady } from "./discharge";
import type { InitApi } from "@test-cabinet/simple-2d";
import type { SpectraState } from "./game";
import type { DeepReadonly } from "ts-essentials";

/** A number, short enough to read on a line. */
function n(value: number, places = 1): string {
  return value.toFixed(places);
}

/** One drone, on one line: who it is, what it reads as, and where it stands. */
function droneLine(
  drone: DeepReadonly<SpectraState>["drones"][number],
  state: DeepReadonly<SpectraState>,
): string {
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

/** Register every value the overlay carries. */
export function registerDiagnostics(
  api: Pick<InitApi<SpectraState>, "diagnostics">,
): void {
  api.diagnostics.register(
    "screen",
    (s) =>
      `${s.screen}/${s.phase} stage ${s.stage}` +
      `${isChallengeStage(s.stage) ? " challenge" : ""} t${n(s.phaseTimer, 2)}`,
  );
  api.diagnostics.register(
    "run",
    (s) =>
      `score ${s.score} lives ${s.lives} res ${n(s.resonance, 0)}` +
      `${dischargeReady(s.resonance) ? " READY" : ""}`,
  );
  api.diagnostics.register("inversion", (s) =>
    inverted(s.inversion) ? `active ${n(s.inversion, 2)}s` : "off",
  );
  api.diagnostics.register(
    "ship",
    (s) => `x ${n(s.ship.x, 0)} ${s.ship.band} lockout ${n(s.ship.lockout, 2)}`,
  );
  api.diagnostics.register(
    "field",
    (s) =>
      `drones ${s.drones.length} bullets ${s.bullets.length} bursts ${s.bursts.length}`,
  );
  api.diagnostics.register("drones", (s) =>
    s.drones.length === 0
      ? "none"
      : s.drones.map((drone) => droneLine(drone, s)).join(" | "),
  );
}
