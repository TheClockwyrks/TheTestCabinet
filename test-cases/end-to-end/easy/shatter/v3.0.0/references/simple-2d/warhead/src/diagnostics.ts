// Shatter — the values the engine's debug overlay shows
// (`specs/instrumentation.md`).
//
// The overlay itself is the engine's: it owns the panel, the backtick key that
// toggles it, and its read-only-ness. This build's whole part is to name the
// values it wants on it, which is what this file does.
//
// Every source is a PURE READ of the state it is handed, which is the state
// current at the moment the overlay reads it, so watching the overlay never
// changes what the simulation does. Nothing is closed over, and each line is
// short enough to read at a glance while the game is running.

import type { ShatterState } from "./game";
import type { InitApi } from "@clockwyrks/simple-2d";

/** One decimal place: enough to see motion, short enough to fit on a line. */
function fixed(value: number): string {
  return value.toFixed(1);
}

/** Register every diagnostic source, each a read of the state it is given. */
export function registerDiagnostics(
  api: Pick<InitApi<ShatterState>, "diagnostics">,
): void {
  api.diagnostics.register("screen", (state) => state.screen);
  api.diagnostics.register(
    "run",
    (state) =>
      `score ${String(state.score)}  lives ${String(state.lives)}  ` +
      `wave ${String(state.wave)}`,
  );
  api.diagnostics.register(
    "ship",
    (state) =>
      `${fixed(state.ship.x)}, ${fixed(state.ship.y)}  ` +
      `v ${fixed(state.ship.vx)}, ${fixed(state.ship.vy)}  ` +
      `spd ${fixed(Math.hypot(state.ship.vx, state.ship.vy))}  ` +
      `face ${fixed((state.ship.angle * 180) / Math.PI)}deg  ` +
      `inv ${fixed(state.ship.invuln)}s`,
  );
  api.diagnostics.register(
    "field",
    (state) =>
      `bullets ${String(state.bullets.length)}  ` +
      `rocks ${String(state.rocks.length)}`,
  );
  api.diagnostics.register("saucer", (state) =>
    state.saucer === null
      ? "none"
      : `#${String(state.saucer.id)} at ${fixed(state.saucer.x)}, ` +
        fixed(state.saucer.y),
  );
  api.diagnostics.register(
    "torpedo",
    (state) =>
      `charge ${state.torpedoCharge.toFixed(2)}  ` +
      `in flight ${String(state.torpedoes.length)}`,
  );
  api.diagnostics.register("simTime", (state) => `${fixed(state.simTime)}s`);
}
