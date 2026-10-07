// Fathom — the values the runtime's debug overlay shows.
//
// The overlay itself is the runtime's (`src/overlay.ts`): it owns the panel, the
// backtick key that toggles it, its read-only-ness, and the fact that it starts
// hidden. Fathom's whole part is to NAME the values it wants on it
// (`specs/instrumentation.md`), which is what this file does.
//
// Every source is a PURE READ of the one live state object, so watching the
// overlay leaves the simulation exactly as it is, and each line is short enough
// to read at a glance while the dive is running.

import { DEN_ORDER, ROSTER_CAP } from "./constants";
import type { FathomState } from "./game";
import { sonarRange, visionRadius, windowRadius } from "./readings";
import type { InitApi } from "./runtime";

/** The most predators any depth's roster holds, which is the panel's row count. */
const ROSTER_MAX = DEN_ORDER.length * ROSTER_CAP;

/** Two decimals: enough to watch a timer run down, short enough for a line. */
function seconds(value: number): string {
  return `${value.toFixed(2)}s`;
}

/** Register every diagnostic source over the live state. */
export function registerDiagnostics(api: InitApi, state: FathomState): void {
  api.diagnostics.register(
    "screen",
    () => `${state.screen}  depth ${state.depth}`,
  );
  api.diagnostics.register(
    "score",
    () => `${state.score}  lives ${state.lives}`,
  );
  api.diagnostics.register(
    "light",
    () =>
      `G ${state.forager.brightness.toFixed(2)}` +
      `  V ${Math.round(visionRadius(state))}` +
      `  R ${Math.round(windowRadius(state))}`,
  );
  api.diagnostics.register(
    "sonar",
    () =>
      `${seconds(state.sonarCooldown)}  range ${sonarRange(state.depth)}  ink ${seconds(state.inkCooldown)}`,
  );
  api.diagnostics.register("plankton", () => state.planktonRemaining);
  api.diagnostics.register("forager", () => {
    const f = state.forager;
    const facing = f.dir ?? f.facing;
    return `(${f.col},${f.row}) ${facing}${f.dir === null ? " at rest" : ""}`;
  });

  // One line per den slot rather than one per predator, so the panel's shape
  // holds still as the roster grows with the depth.
  for (let index = 0; index < ROSTER_MAX; index += 1) {
    api.diagnostics.register(`pred ${index}`, () => {
      const p = state.predators[index];
      if (p === undefined) return "—";
      return (
        `${p.kind} ${p.state} (${p.col},${p.row})` +
        ` ${Math.round(p.speed)}${p.alertT > 0 ? " ALERT" : ""}`
      );
    });
  }
}
