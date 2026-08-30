// Floe — the values the engine's debug overlay shows
// (`specs/instrumentation.md`).
//
// The overlay itself is the engine's: it owns the panel, the backtick key that
// toggles it, and its read-only-ness. This build's whole part is to NAME the values
// it wants on it, which is what this file does.
//
// Every source is a PURE READ of the state it is handed — the state current at the
// moment the overlay reads it — so watching the overlay never changes what the
// simulation does. Nothing is closed over, and each line is short enough to read at
// a glance while the game is running.

import { TOTAL_LEVELS } from "./constants";
import { critterCol, critterRow, footingOf } from "./critter";
import { swimming } from "./hunter";
import { toSim } from "./sim";
import type { FloeState } from "./game";
import type { InitApi } from "@test-cabinet/simple-2d";

/** One decimal place: enough to see motion, short enough to fit on a line. */
function fixed(value: number): string {
  return value.toFixed(1);
}

/** Register every diagnostic source, each a read of the state it is given. */
export function registerDiagnostics(
  api: Pick<InitApi<FloeState>, "diagnostics">,
): void {
  api.diagnostics.register(
    "screen",
    (state) => `${state.screen} / ${state.phase} ${fixed(state.phaseTimer)}s`,
  );
  api.diagnostics.register(
    "run",
    (state) =>
      `level ${state.level}/${TOTAL_LEVELS}  lives ${state.lives}  ` +
      `score ${state.score}  timer ${fixed(state.timer)}s`,
  );
  api.diagnostics.register("critter", (state) => {
    const sim = toSim(state);
    const where = sim.critter.present ? "" : " (out of play)";
    return (
      `tile ${critterCol(sim)},${critterRow(sim)}  ` +
      `at ${fixed(sim.critter.x)},${fixed(sim.critter.y)}  ` +
      `${sim.critter.facing}  ${footingOf(sim)}${where}`
    );
  });
  api.diagnostics.register("bears", (state) => {
    const sim = toSim(state);
    if (sim.bears.length === 0) return "none";
    return sim.bears
      .map((bear) => {
        const swim = swimming(sim, bear) ? " swim" : "";
        return (
          `#${bear.id} ${bear.col},${bear.row}` +
          `>${bear.stepCol},${bear.stepRow} ` +
          `at ${fixed(bear.x)},${fixed(bear.y)} ${bear.facing}${swim} ` +
          `hunting ${bear.target.col},${bear.target.row}`
        );
      })
      .join(" | ");
  });
  api.diagnostics.register(
    "strait",
    (state) => `${state.vehicles.length} vehicles  ${state.floes.length} floes`,
  );
  api.diagnostics.register("bays", (state) => {
    const marks = state.bays.map((filled) => (filled ? "#" : ".")).join("");
    const fish =
      state.fishBay === null ? "no fish" : `fish in ${state.fishBay}`;
    return `${marks}  ${fish}`;
  });
}
