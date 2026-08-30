// Wireworm — the values the engine's debug overlay shows
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

import type { WirewormState } from "./game";
import type { InitApi } from "@test-cabinet/simple-2d";

/** One decimal place: enough to see motion, short enough to fit on a line. */
function fixed(value: number): string {
  return value.toFixed(1);
}

/** Register every diagnostic source, each a read of the state it is given. */
export function registerDiagnostics(
  api: Pick<InitApi<WirewormState>, "diagnostics">,
): void {
  api.diagnostics.register(
    "screen",
    (state) => `${state.screen} / ${state.phase} ${fixed(state.phaseTimer)}s`,
  );
  api.diagnostics.register(
    "run",
    (state) =>
      `score ${state.score}  lives ${state.lives}  level ${state.level}`,
  );
  api.diagnostics.register("nodes", (state) => state.nodes.length);
  api.diagnostics.register("worms", (state) =>
    state.worms.length === 0
      ? "none"
      : state.worms
          .map((worm) => {
            const head = worm.segments[0];
            const at = head === undefined ? "-" : `${head.c},${head.r}`;
            const dive = worm.diving ? " dive" : "";
            return (
              `#${worm.id} len ${worm.segments.length} at ${at} ` +
              `dh ${worm.dh} dv ${worm.dv}${dive}`
            );
          })
          .join(" | "),
  );
  api.diagnostics.register("foes", (state) =>
    state.foes.length === 0
      ? "none"
      : state.foes
          .map(
            (foe) => `#${foe.id} ${foe.kind} ${fixed(foe.x)},${fixed(foe.y)}`,
          )
          .join(" | "),
  );
  api.diagnostics.register(
    "cursor",
    (state) => `${fixed(state.cursor.x)}, ${fixed(state.cursor.y)}`,
  );
  api.diagnostics.register("bolts", (state) => state.bolts.length);
}
