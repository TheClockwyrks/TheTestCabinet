// Kessler — the values the engine's debug overlay shows
// (specs/instrumentation.md, Diagnostics).
//
// The overlay itself is the engine's: it owns the panel, the backtick key
// that toggles it, and its read-only-ness. Kessler's whole part is to name
// the values it wants on it, which is what this file does.
//
// Every source is a PURE READ of the state it is handed — the state current
// at the moment the overlay reads it, which the engine passes in because the
// state is a value that every frame replaces. Nothing is closed over, so
// watching the overlay never changes what the simulation does, and each line
// is short enough to read at a glance while the game runs.

import type { InitApi } from "@clockwyrks/simple-2d";
import { liveFxCount } from "./fx";
import type { KesslerState } from "./flow";
import { liveTargetCount } from "./rings";
import { spanOf } from "./state";

/** Register every diagnostic source, each a read of the state it is given. */
export function registerDiagnostics(
  api: Pick<InitApi<KesslerState>, "diagnostics">,
): void {
  api.diagnostics.register("screen", (state) => state.screen);
  api.diagnostics.register("score", (state) => state.session.score);
  api.diagnostics.register("lives", (state) => state.session.lives);
  api.diagnostics.register("wave", (state) => state.session.wave);
  api.diagnostics.register(
    "paddle",
    (state) =>
      `${state.session.paddleAngleDeg.toFixed(1)} deg / ` +
      `${spanOf(state.session)} deg`,
  );
  api.diagnostics.register("balls", (state) => state.session.balls.length);
  api.diagnostics.register("targets", (state) =>
    liveTargetCount(state.session.rings),
  );
  api.diagnostics.register("pods", (state) => state.session.pods.length);
  api.diagnostics.register(
    "widen",
    (state) => `${state.session.effects.widenTicks} ticks`,
  );
  api.diagnostics.register(
    "narrow",
    (state) => `${state.session.effects.narrowTicks} ticks`,
  );
  api.diagnostics.register(
    "pierce",
    (state) => `${state.session.effects.pierceTicks} ticks`,
  );
  api.diagnostics.register("shield", (state) =>
    state.session.effects.shieldActive ? "active" : "down",
  );
  api.diagnostics.register("ticks", (state) => state.ticks);
  api.diagnostics.register("fx", () => liveFxCount());
}
