// Shatter — the values the runtime's debug overlay shows.
//
// The overlay itself is the runtime's (`src/overlay.ts`): it owns the panel, the
// backtick key that toggles it, and its read-only-ness. Shatter's whole part is
// to NAME the values it wants on it, which `specs/instrumentation.md` lists, and
// which is what this file does.
//
// Every source is a PURE READ of the one live state object, so watching the
// overlay never changes what the simulation does — a snapshot taken with the
// panel up is identical to one taken with it down — and each line is short enough
// to read at a glance while the game is running.

import type { InitApi } from "./runtime";
import type { ShatterState } from "./types";

/** One decimal place: enough to see motion, short enough to fit on a line. */
function fixed(value: number): string {
  return value.toFixed(1);
}

/** Register every diagnostic source over the live state. */
export function registerDiagnostics(api: InitApi, state: ShatterState): void {
  api.diagnostics.register("screen", () => state.screen);
  api.diagnostics.register(
    "run",
    () => `score ${state.score}  lives ${state.lives}  wave ${state.wave}`,
  );
  api.diagnostics.register(
    "ship pos",
    () => `${fixed(state.ship.x)}, ${fixed(state.ship.y)}`,
  );
  api.diagnostics.register(
    "ship vel",
    () =>
      `${fixed(state.ship.vx)}, ${fixed(state.ship.vy)} ` +
      `(${fixed(Math.hypot(state.ship.vx, state.ship.vy))})`,
  );
  api.diagnostics.register("ship facing", () =>
    fixed((state.ship.angle * 180) / Math.PI),
  );
  api.diagnostics.register("invuln", () => fixed(state.ship.invuln));
  api.diagnostics.register(
    "field",
    () => `bullets ${state.bullets.length}  rocks ${state.rocks.length}`,
  );
  api.diagnostics.register("saucer", () =>
    state.saucer === null
      ? "none"
      : `${fixed(state.saucer.x)}, ${fixed(state.saucer.y)}`,
  );
  api.diagnostics.register(
    "torpedo",
    () =>
      `charge ${state.torpedoCharge.toFixed(2)}  in flight ${state.torpedoes.length}`,
  );
  api.diagnostics.register("sim time", () => fixed(state.simTime));
}
