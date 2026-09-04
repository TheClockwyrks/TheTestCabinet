// Meltdown — what the debug overlay reports (specs/instrumentation.md).
//
// Every source is a PURE READ of the state it is handed, short enough to sit on
// one line, so watching the overlay leaves the game exactly as it is. The overlay
// itself belongs to the runtime (`src/overlay.ts`); this file only names the
// values.

import type { InitApi } from "./runtime";
import type { MeltdownState } from "./state";
import { modeFigures } from "./modes";
import { redlineOf } from "./towers";
import { exhaustOf, tileOf } from "./units";

/** How many towers and units the overlay lists before it stops. */
const LIST_LIMIT = 12;

/** Register every source the overlay draws. */
export function registerDiagnostics(api: InitApi<MeltdownState>): void {
  api.diagnostics.register(
    "screen",
    (state) => `${state.screen}/${state.phase}`,
  );
  api.diagnostics.register(
    "mode",
    (state) => `${state.mode}/${state.difficulty}`,
  );
  api.diagnostics.register("money", (state) => state.money);
  api.diagnostics.register("lives", (state) => state.lives);
  api.diagnostics.register(
    "wave",
    (state) =>
      `${state.wave}/${modeFigures(state.mode, state.difficulty).waveCount}`,
  );
  api.diagnostics.register("score", (state) => state.score);
  api.diagnostics.register("routes", (state) => {
    const left = state.floor.routeLength("left");
    const top = state.floor.routeLength("top");
    return `left ${fixed(left)}  top ${fixed(top)}`;
  });
  api.diagnostics.register("towers", (state) =>
    state.towers
      .slice(0, LIST_LIMIT)
      .map(
        (tower) =>
          `#${tower.id} ${tower.type} L${tower.level} h${tower.heat.toFixed(1)}/${redlineOf(tower)}` +
          `${tower.tripped ? " TRIPPED" : ""} k${tower.kills}`,
      ),
  );
  api.diagnostics.register("surge", (state) =>
    state.surge.slice(0, LIST_LIMIT).map((unit) => {
      const { c, r } = tileOf(unit);
      return (
        `#${unit.id} ${unit.type} (${c},${r}) hp${unit.hp.toFixed(0)}` +
        `${unit.slowFactor > 0 ? " slowed" : ""} -> ${exhaustOf(unit)}`
      );
    }),
  );
}

/** A route length as a short line, with an unreachable route named as such. */
function fixed(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : "none";
}
