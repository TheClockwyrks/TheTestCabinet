// Spectra — the values the engine's debug overlay shows
// (`specs/instrumentation.md`).
//
// The overlay itself is the engine's: it owns the panel, the backtick key that
// toggles it, and its read-only-ness. This build's whole part is to name the values
// it wants on it, which is what this file does.
//
// Every source is a PURE READ of the state it is handed, which is the state current
// at the moment the overlay reads it, so watching the overlay never changes what the
// simulation does. Nothing is closed over, and each line is short enough to read at
// a glance while the game is running.

import { isChallengeStage } from "./constants";
import { dischargeReady, effectiveDroneBand, shimmering } from "./bands";
import type { SpectraState } from "./game";
import type { InitApi } from "@test-cabinet/simple-2d";

/** One decimal place: enough to see motion, short enough to fit on a line. */
function fixed(value: number): string {
  return value.toFixed(1);
}

/** A band, as one letter, so a per-drone line stays readable. */
function letter(band: string): string {
  return band === "cyan" ? "C" : "M";
}

/** Register every diagnostic source, each a read of the state it is given. */
export function registerDiagnostics(
  api: Pick<InitApi<SpectraState>, "diagnostics">,
): void {
  api.diagnostics.register("screen", (state) => {
    const challenge = isChallengeStage(state.stage) ? " challenge" : "";
    return (
      `${state.screen} / ${state.phase} ${fixed(state.phaseTimer)}s  ` +
      `stage ${state.stage}${challenge}`
    );
  });

  api.diagnostics.register("run", (state) => {
    const ready = dischargeReady(state.resonance) ? " READY" : "";
    return (
      `score ${state.score}  lives ${state.lives}  ` +
      `resonance ${fixed(state.resonance)}${ready}`
    );
  });

  api.diagnostics.register("inversion", (state) =>
    state.inversion > 0 ? `active ${fixed(state.inversion)}s` : "none",
  );

  api.diagnostics.register(
    "ship",
    (state) =>
      `x ${fixed(state.ship.x)}  band ${state.ship.band}  ` +
      `lockout ${fixed(state.ship.lockout)}s`,
  );

  api.diagnostics.register("drones", (state) =>
    state.drones.length === 0
      ? "none"
      : state.drones
          .map((drone) => {
            const stored = letter(drone.band);
            const effective = letter(
              effectiveDroneBand(drone, state.stage, state.inversion),
            );
            const shimmer = shimmering(drone, state.stage) ? " shimmer" : "";
            const shell =
              drone.kind === "prism" && !drone.shellAlive ? " core" : "";
            return (
              `#${drone.id} ${drone.kind} ${stored}/${effective} ` +
              `${fixed(drone.x)},${fixed(drone.y)} ${drone.phase}` +
              `${shimmer}${shell} chg ${drone.charge}`
            );
          })
          .join(" | "),
  );

  api.diagnostics.register("bullets", (state) => state.bullets.length);
  api.diagnostics.register("bursts", (state) => state.bursts.length);
}
