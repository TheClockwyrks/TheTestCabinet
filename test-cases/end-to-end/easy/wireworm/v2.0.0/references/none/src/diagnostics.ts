// Wireworm — the values the runtime's debug overlay shows
// (specs/instrumentation.md).
//
// The overlay itself is the runtime's (`src/overlay.ts`): it owns the panel, the
// backtick key that toggles it, and its read-only-ness. Wireworm's whole part is
// to name the values it wants on it, which is what this file does.
//
// Every source is a PURE READ of the one live state object, so watching the
// overlay never changes what the simulation does, and each line is short enough
// to read at a glance while the game is running. The two rosters are listed
// rather than counted, capped at {@link ROSTER_LINES} entries with the rest
// summarized, because a panel line that grew without bound would run off the
// canvas on a board carrying a dozen worms.

import { TOTAL_LEVELS } from "./constants";
import { listNodes } from "./field";
import type { InitApi } from "./runtime";
import type { WirewormState } from "./types";

/** How many entries of a roster the panel names before it summarizes the rest. */
export const ROSTER_LINES = 4;

/** No decimals: a position on the board reads better as a whole unit. */
function round(value: number): string {
  return String(Math.round(value));
}

/** Register every diagnostic source over the live state. */
export function registerDiagnostics(api: InitApi, state: WirewormState): void {
  api.diagnostics.register("screen", () => `${state.screen} / ${state.phase}`);
  api.diagnostics.register(
    "run",
    () =>
      `score ${state.score}  lives ${state.lives}  level ${state.level}/${TOTAL_LEVELS}`,
  );
  api.diagnostics.register("nodes", () => listNodes(state.field).length);
  api.diagnostics.register("worms", () =>
    roster(
      state.worms.map((worm) => {
        const head = worm.segments[0];
        const at = head === undefined ? "-" : `${head.c},${head.r}`;
        return (
          `#${worm.id} len ${worm.segments.length} head ${at} ` +
          `dh ${worm.dh >= 0 ? "+1" : "-1"} dv ${worm.dv >= 0 ? "+1" : "-1"} ` +
          `dive ${worm.diving ? "y" : "n"}`
        );
      }),
    ),
  );
  api.diagnostics.register("foes", () =>
    roster(
      state.foes.map(
        (foe) => `#${foe.id} ${foe.kind} ${round(foe.x)},${round(foe.y)}`,
      ),
    ),
  );
  api.diagnostics.register(
    "cursor",
    () => `${round(state.cursor.x)},${round(state.cursor.y)}`,
  );
  api.diagnostics.register("bolts", () => state.bolts.length);
}

/** One roster as a single line: its entries, or `none` where it is empty. */
function roster(entries: readonly string[]): string {
  if (entries.length === 0) return "none";
  if (entries.length <= ROSTER_LINES) return entries.join("  |  ");
  return `${entries.slice(0, ROSTER_LINES).join("  |  ")}  |  +${
    entries.length - ROSTER_LINES
  } more`;
}
