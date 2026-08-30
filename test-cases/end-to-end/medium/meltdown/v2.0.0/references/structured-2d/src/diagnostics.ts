// Meltdown — the values the engine's debug overlay shows.
//
// The overlay itself is the engine's: it owns the panel, the backtick key that
// toggles it, and its read-only-ness. Meltdown's whole part is to NAME the
// values it wants on it (specs/instrumentation.md, Diagnostics), registered
// through `world.diagnostics` from the game mode's `beginPlay` so they are
// dropped with the world they describe.
//
// Every source is a function of no arguments, invoked at each read, and every
// one is a pure read of the live state, so the panel reports the frame being
// drawn and watching the overlay never changes what the simulation does.

import type { World } from "@test-cabinet/structured-2d";
import { redlineOf } from "./stats";
import { unitTile } from "./surge";
import { figuresOf } from "./waves";
import { meltdownState, type MeltdownState } from "./game";

/** The sources, each named and each a read through `read` at the call. */
export function diagnosticSources(
  read: () => MeltdownState,
): [string, () => unknown][] {
  return [
    ["screen", () => `${read().screen} / ${read().phase}`],
    ["mode", () => `${read().mode} / ${read().difficulty}`],
    [
      "run",
      () => {
        const state = read();
        const { waveCount } = figuresOf(state);
        return (
          `money ${state.money}  lives ${state.lives}  ` +
          `wave ${state.wave}/${waveCount}  score ${state.score}`
        );
      },
    ],
    [
      "routes",
      () => {
        const { lengths } = read().routes;
        return `left ${lengths.left.toFixed(1)}  top ${lengths.top.toFixed(1)}`;
      },
    ],
    [
      "towers",
      () => {
        const towers = read().towers;
        if (towers.length === 0) return "none";
        return towers
          .map(
            (tower) =>
              `#${tower.id} ${tower.type} L${tower.level} ` +
              `${tower.heat.toFixed(0)}/${redlineOf(tower)}` +
              `${tower.tripped ? " TRIPPED" : ""} k${tower.kills}`,
          )
          .join("  ");
      },
    ],
    [
      "surge",
      () => {
        const surge = read().surge;
        if (surge.length === 0) return "none";
        return surge
          .map((unit) => {
            const tile = unitTile(unit);
            return (
              `#${unit.id} ${unit.type} (${tile.col},${tile.row}) ` +
              `${unit.hp.toFixed(0)}${unit.slowFactor > 0 ? " SLOW" : ""}`
            );
          })
          .join("  ");
      },
    ],
  ];
}

/** Register every source with the world's overlay registry. */
export function registerDiagnostics(world: World): void {
  for (const [name, source] of diagnosticSources(() => meltdownState(world))) {
    world.diagnostics.register(name, source);
  }
}
