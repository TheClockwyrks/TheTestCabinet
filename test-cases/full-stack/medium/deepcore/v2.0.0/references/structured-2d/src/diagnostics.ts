// Deepcore — the values the engine's debug overlay shows
// (specs/instrumentation.md, Diagnostics).
//
// The overlay itself is the engine's: it owns the panel, the backtick key that
// toggles it, and its read-only-ness. Deepcore's whole part is to name the values
// it wants on it, registered through `world.diagnostics` from the game mode's
// `beginPlay` — the world's registry rather than the instance's, because
// everything below is read off the world's own game state.
//
// Every source is a function of no arguments, invoked at each read, and every one
// is a PURE READ of the live state it reaches through the given accessor, so the
// panel reports the frame being drawn and watching the overlay never changes what
// the simulation does. Each line is short enough to read at a glance while the
// game runs.

import type { World } from "@test-cabinet/structured-2d";
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
import { deepcoreState } from "./game";
import type { DeepcoreState } from "./game";
import { isGrounded } from "./physics";
import { tileAt } from "./state";

function n0(value: number): string {
  return value.toFixed(0);
}

function n1(value: number): string {
  return value.toFixed(1);
}

/**
 * The sources, each named and each a read through `read` at the call. Split from
 * the registration so the build's tests can drive the same sources over a state
 * of their own.
 */
export function diagnosticSources(
  read: () => DeepcoreState,
): [string, () => string][] {
  return [
    ["screen", () => `${read().screen}   panel ${read().panel ?? "-"}`],
    [
      "world",
      () => {
        const state = read();
        return `${state.mode}   ${state.worldSize}   core row ${state.coreRow}`;
      },
    ],
    [
      "miner",
      () => {
        const { miner } = read();
        return `${n0(miner.x)},${n0(miner.y)}  v ${n0(miner.vx)},${n0(miner.vy)}`;
      },
    ],
    [
      "pose",
      () => {
        const state = read();
        return (
          `${state.miner.state}  facing ${state.miner.facing}` +
          `  grounded ${isGrounded(state.grid, state.miner)}`
        );
      },
    ],
    [
      "fuel",
      () => {
        const state = read();
        return (
          `${n1(state.miner.fuel)}/${n1(maxFuel(state.tiers))}` +
          `   hull ${n1(state.miner.hull)}/${n1(maxHull(state.tiers))}`
        );
      },
    ],
    [
      "cut",
      () => {
        const state = read();
        const cut = state.miner.drilling;
        if (!cut) return "none";
        const tile = tileAt(state.grid, cut.col, cut.row);
        const progress = tile ? cutProgress(tile) : 0;
        return `${cut.dir} (${cut.col},${cut.row}) ${(progress * 100).toFixed(0)}%`;
      },
    ],
    [
      "credits",
      () => {
        const state = read();
        return `${state.credits}   depth ${n0(depthMeters(state.miner))} m`;
      },
    ],
    [
      "cargo",
      () => {
        const state = read();
        return (
          `${slotsUsed(state.cargo)}/${cargoCap(state.tiers)} slots` +
          `  ${n0(loadKg(state.cargo))}/${n0(liftLimitKg(state.tiers))} kg` +
          `${overloaded(state.cargo, state.tiers) ? "  OVERLOAD" : ""}`
        );
      },
    ],
    [
      "satchel",
      () => {
        const { satchel } = read();
        return (
          `res ${satchel.resonite}  cry ${satchel.cryenite}` +
          `  core ${satchel.coreSample}`
        );
      },
    ],
    [
      "tiers",
      () => {
        const { tiers } = read();
        return (
          `F${tiers.fuel} D${tiers.drill} C${tiers.cargo}` +
          ` H${tiers.hull} J${tiers.jetpack} R${tiers.radiator}` +
          ` S${tiers.scanner}`
        );
      },
    ],
    [
      "core",
      () => {
        const { coreTimer } = read();
        return coreTimer === null ? "no sample" : `${n1(coreTimer)} s`;
      },
    ],
    [
      "scanner",
      () => {
        const { scan } = read();
        return scan.locked
          ? `${scan.target} at ${n1(scan.distanceTiles ?? 0)} tiles`
          : "no lock";
      },
    ],
  ];
}

/** Register every source with the world's overlay registry. */
export function registerDiagnostics(world: World): void {
  for (const [name, source] of diagnosticSources(() => deepcoreState(world))) {
    world.diagnostics.register(name, source);
  }
}
