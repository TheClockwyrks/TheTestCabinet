// Fathom — the values the engine's debug overlay shows
// (`specs/instrumentation.md`).
//
// The overlay itself is the engine's: it owns the panel, the backtick key that
// toggles it, and its read-only-ness. Fathom's whole part is to name the values
// it wants on it, which is what this file does.
//
// Every source is a PURE READ of the state it is handed — the state current at
// the moment the overlay reads it, which the engine passes in because the state
// is a value every frame replaces. Nothing is closed over, so watching the
// overlay leaves the simulation exactly as it is, and each line is short enough
// to read at a glance while the game is running.

import { DEN_ORDER, ROSTER_CAP } from "./constants";
import { bodyTile } from "./entities";
import { visionRadius } from "./sensing";
import type { FathomState } from "./state";
import type { InitApi } from "@clockwyrks/simple-2d";

/** The deepest roster, which is what fixes how many predator lines there are. */
const MAX_ROSTER = DEN_ORDER.length * ROSTER_CAP;

/** Two decimal places: enough to see a value move, short enough to fit a line. */
function fixed(value: number): string {
  return value.toFixed(2);
}

/** Register every diagnostic source, each a read of the state it is given. */
export function registerDiagnostics(api: InitApi<FathomState>): void {
  api.diagnostics.register(
    "screen",
    (state) => `${state.screen}  depth ${state.depth}`,
  );
  api.diagnostics.register(
    "run",
    (state) => `score ${state.score}  lives ${state.lives}`,
  );
  api.diagnostics.register(
    "light",
    (state) =>
      `G ${fixed(state.brightness)}  V ${Math.round(visionRadius(state.brightness))}`,
  );
  api.diagnostics.register(
    "cooldowns",
    (state) =>
      `sonar ${fixed(state.sonarCooldown)}s  ink ${fixed(state.inkCooldown)}s`,
  );
  api.diagnostics.register("plankton", (state) => state.planktonRemaining);
  api.diagnostics.register("forager", (state) => {
    const at = bodyTile(state.forager);
    return `(${at.tx},${at.ty}) ${state.forager.facing}${state.forager.heading !== null ? " moving" : ""}`;
  });
  // One line per predator, so the roster reads down the panel in release order.
  for (let index = 0; index < MAX_ROSTER; index++) {
    api.diagnostics.register(`predator ${index}`, (state) => {
      const p = state.predators[index];
      if (p === undefined) return "-";
      const at = bodyTile(p);
      return (
        `${p.kind} ${p.mode} (${at.tx},${at.ty}) ` +
        `spd ${Math.round(p.speed)}${p.alertIn > 0 ? " ALERT" : ""}`
      );
    });
  }
}
