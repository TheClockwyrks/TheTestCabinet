// Deepcore — the values the engine's debug overlay shows
// (specs/instrumentation.md, Diagnostics).
//
// The overlay itself is the engine's: it owns the panel, the backtick key that
// toggles it, and its read-only-ness. Deepcore's whole part is to name the values
// it wants on it, which is what this file does.
//
// Every source is a PURE READ of the state it is handed — the state current at
// the moment the overlay reads it, which the engine passes in because the state
// is a value that every frame replaces. Nothing is closed over, so watching the
// overlay never changes what the simulation does, and each line is short enough
// to read at a glance while the game runs.

import { cutProgress } from "./drill";
import {
  cargoCap,
  depthMeters,
  liftLimitKg,
  loadKg,
  maxFuel,
  maxHull,
  overloaded,
  slotsUsed,
} from "./figures";
import type { DeepcoreState } from "./game";
import { isGrounded } from "./physics";
import { tileAt } from "./state";
import type { InitApi } from "@clockwyrks/simple-2d";

function n0(value: number): string {
  return value.toFixed(0);
}

function n1(value: number): string {
  return value.toFixed(1);
}

/** Register every diagnostic source, each a read of the state it is given. */
export function registerDiagnostics(
  api: Pick<InitApi<DeepcoreState>, "diagnostics">,
): void {
  api.diagnostics.register(
    "screen",
    (state) => `${state.screen}   panel ${state.panel ?? "-"}`,
  );
  api.diagnostics.register(
    "world",
    (state) => `${state.mode}   ${state.worldSize}   core row ${state.coreRow}`,
  );
  api.diagnostics.register(
    "miner",
    (state) =>
      `${n0(state.miner.x)},${n0(state.miner.y)}  v ${n0(state.miner.vx)},${n0(state.miner.vy)}`,
  );
  api.diagnostics.register(
    "pose",
    (state) =>
      `${state.miner.state}  facing ${state.miner.facing}` +
      `  grounded ${isGrounded(state.grid, state.miner)}`,
  );
  api.diagnostics.register(
    "fuel",
    (state) =>
      `${n1(state.miner.fuel)}/${n1(maxFuel(state.tiers))}` +
      `   hull ${n1(state.miner.hull)}/${n1(maxHull(state.tiers))}`,
  );
  api.diagnostics.register("cut", (state) => {
    const cut = state.miner.drilling;
    if (!cut) return "none";
    const tile = tileAt(state.grid, cut.col, cut.row);
    const progress = tile ? cutProgress(tile) : 0;
    return `${cut.dir} (${cut.col},${cut.row}) ${(progress * 100).toFixed(0)}%`;
  });
  api.diagnostics.register(
    "credits",
    (state) => `${state.credits}   depth ${n0(depthMeters(state.miner))} m`,
  );
  api.diagnostics.register(
    "cargo",
    (state) =>
      `${slotsUsed(state.cargo)}/${cargoCap(state.tiers)} slots` +
      `  ${n0(loadKg(state.cargo))}/${n0(liftLimitKg(state.tiers))} kg` +
      `${overloaded(state.cargo, state.tiers) ? "  OVERLOAD" : ""}`,
  );
  api.diagnostics.register(
    "satchel",
    (state) =>
      `res ${state.satchel.resonite}  cry ${state.satchel.cryenite}` +
      `  core ${state.satchel.coreSample}`,
  );
  api.diagnostics.register(
    "tiers",
    (state) =>
      `F${state.tiers.fuel} D${state.tiers.drill} C${state.tiers.cargo}` +
      ` H${state.tiers.hull} J${state.tiers.jetpack} R${state.tiers.radiator}` +
      ` S${state.tiers.scanner}`,
  );
  api.diagnostics.register("core", (state) =>
    state.coreTimer === null ? "no sample" : `${n1(state.coreTimer)} s`,
  );
  api.diagnostics.register("scanner", (state) =>
    state.scan.locked
      ? `${state.scan.target} at ${n1(state.scan.distanceTiles ?? 0)} tiles`
      : "no lock",
  );
}
