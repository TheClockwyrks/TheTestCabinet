// Floe — what the debug overlay reports.
//
// `specs/instrumentation.md` lists the facts the overlay shows and asks for each
// source to be a pure read, so watching the panel leaves the game as it is. The
// runtime draws and toggles the panel (`src/overlay.ts`); this file is Floe's
// whole part in it.
//
// Every source below reads the SAME state object the game advances, so the panel
// reports the tick being drawn rather than a reading taken when it registered.

import { TOTAL_LEVELS } from "./constants";
import {
  bearSwimming,
  critterCol,
  critterFooting,
  critterRow,
} from "./entities";
import type { InitApi } from "./runtime";
import type { FloeState } from "./types";

/** A number as a short line of the panel. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Name every value the overlay shows, in the order it reads them. */
export function registerDiagnostics(api: InitApi, state: FloeState): void {
  api.diagnostics.register("screen", () => `${state.screen}/${state.phase}`);
  api.diagnostics.register(
    "level",
    () => `${state.level}/${TOTAL_LEVELS} reached ${state.reachedLevel}`,
  );
  api.diagnostics.register("lives", () => state.lives);
  api.diagnostics.register("score", () => state.score);
  api.diagnostics.register("timer", () => round(state.timer));
  api.diagnostics.register("critter", () => {
    const critter = state.critter;
    if (!critter.present) return "off the strait";
    return `tile ${critterCol(critter)},${critterRow(critter)} at ${round(
      critter.x,
    )},${round(critter.y)} facing ${critter.facing} on ${critterFooting(state)}`;
  });
  api.diagnostics.register("bears", () =>
    state.bears.length === 0
      ? "none"
      : state.bears
          .map(
            (bear) =>
              `#${bear.id} tile ${bear.col},${bear.row} at ${round(
                bear.x,
              )},${round(bear.y)} facing ${bear.facing}${
                bearSwimming(state, bear) ? " swimming" : ""
              } hunting ${bear.target.col},${bear.target.row}`,
          )
          .join("  |  "),
  );
  api.diagnostics.register(
    "traffic",
    () => `${state.vehicles.length} vehicles, ${state.floes.length} floes`,
  );
  api.diagnostics.register("bays", () =>
    state.bays.map((filled) => (filled ? "#" : ".")).join(""),
  );
}
