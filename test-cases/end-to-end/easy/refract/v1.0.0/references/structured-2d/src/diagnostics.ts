// Refract — the values the engine's debug overlay shows.
//
// The overlay itself is the engine's: it owns the panel, the backtick key that
// toggles it, and its read-only-ness. Refract's whole part is to name the
// values it wants on it (specs/instrumentation.md, Diagnostics), registered
// through `world.diagnostics` from the game mode's `beginPlay`.
//
// Every source is a function of no arguments, invoked at each read, and every
// one is a PURE READ of the live state it reaches through the given accessor —
// the world the mode holds — so the panel reports the frame being drawn and
// watching the overlay never changes what the simulation does. Each line is
// short enough to read at a glance while the game runs.

import type { World } from "@test-cabinet/structured-2d";
import { CHANNELS } from "./constants";
import { refractState, type RefractState } from "./game";
import { beamComplete, boardSolved, spentAt } from "./rules";

/**
 * The sources, each named and each a read through `read` at the call. Split
 * from the registration so the build's tests can drive the same sources over
 * a state of their own.
 */
export function diagnosticSources(
  read: () => RefractState,
): [string, () => unknown][] {
  const sources: [string, () => unknown][] = [
    ["screen", () => read().screen],
    ["mode", () => read().mode],
    [
      "board",
      () => {
        const { board } = read();
        return `${board.cols}x${board.rows}`;
      },
    ],
  ];
  for (const channel of CHANNELS) {
    sources.push([
      `beam ${channel}`,
      () => {
        const state = read();
        const beam = state.beams.find((entry) => entry.channel === channel);
        if (!beam) return "-";
        const segments = Math.max(0, beam.cells.length - 1);
        return `${segments} seg${beamComplete(state.board, beam) ? ", complete" : ""}`;
      },
    ]);
  }
  sources.push(
    [
      "crystals",
      () => {
        const state = read();
        const crystals = state.board.nodes.filter(
          (node) => node.kind === "crystal",
        );
        if (crystals.length === 0) return "-";
        return crystals
          .map((node) => `${spentAt(state.beams, node)}/${node.charges}`)
          .join(" ");
      },
    ],
    [
      "solved",
      () => {
        const state = read();
        return boardSolved(state.board, state.beams);
      },
    ],
    [
      "pointer",
      () => {
        const { pointer } = read();
        return (
          `${pointer.x.toFixed(0)}, ${pointer.y.toFixed(0)}` +
          (pointer.down ? " down" : "")
        );
      },
    ],
  );
  return sources;
}

/** Register every source with the world's overlay registry. */
export function registerDiagnostics(world: World): void {
  for (const [name, source] of diagnosticSources(() => refractState(world))) {
    world.diagnostics.register(name, source);
  }
}
