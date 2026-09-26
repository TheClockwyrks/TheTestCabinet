// Facet — the values the engine's debug overlay shows.
//
// The overlay itself is the engine's: it owns the panel, the backtick key that
// toggles it, and its read-only-ness (engine/diagnostics.md). Facet's whole
// part is to name the values it wants on it (specs/instrumentation.md,
// Diagnostics), registered through `world.diagnostics` from the game mode's
// `beginPlay` — the world's registry rather than the instance's, because every
// one of them is read off the world's game state, which the world owns.
//
// Every source is a function of NO ARGUMENTS, invoked at each read, and every
// one is a PURE READ of the LIVE state it reaches through the world at the call
// — never a state captured when the source was registered — so the panel
// reports the frame being drawn and watching the overlay never changes what the
// simulation does. Each line is short enough to read at a glance while the game
// runs, and the set below is exactly the set `specs/instrumentation.md` asks
// for: the same facts the snapshot reports, two or three to a line.

import type { DiagnosticValue, World } from "@clockwyrks/structured-2d";
import { lastFall, legalSwapExists, levelTarget, multiplierFor } from "./core";
import { boardToCore } from "./bridge";
import { facetState, type CellRef, type FacetState } from "./game";

/** A cell as one short line reads it, and `-` for no cell at all. */
function cellLabel(cell: CellRef | null): string {
  return cell ? `${cell.col},${cell.row}` : "-";
}

/**
 * The sources, each named and each a read through `read` at the call. Split
 * from the registration so the build's tests drive the same sources over a
 * state of their own.
 */
export function diagnosticSources(
  read: () => FacetState,
): [string, () => DiagnosticValue][] {
  return [
    ["screen", () => `${read().screen} / ${read().phase}`],
    ["board", () => `${read().board.cols}x${read().board.rows}`],
    ["score", () => read().score],
    [
      "level",
      () => {
        const state = read();
        return `${state.level}  ${state.levelScore}/${levelTarget(state.level)}`;
      },
    ],
    [
      "chain",
      () => {
        const state = read();
        return `step ${state.chainStep}  x${multiplierFor(state.chainStep)}`;
      },
    ],
    [
      "last step",
      () => {
        const state = read();
        return `${state.lastCleared} cells  ${state.lastPoints} pts`;
      },
    ],
    [
      "last motion",
      () => {
        const state = read();
        const fall = lastFall(boardToCore(state.board));
        return `${state.lastWaves} waves  ${fall} rows`;
      },
    ],
    [
      "best",
      () => {
        const state = read();
        return `move ${state.bestMove}  chain ${state.bestChain}`;
      },
    ],
    [
      "hold",
      () => {
        const state = read();
        return `${cellLabel(state.selection)} -> ${cellLabel(state.offer)}`;
      },
    ],
    ["legal swap", () => legalSwapExists(boardToCore(read().board))],
    [
      "pointer",
      () => {
        const { pointer } = read();
        return (
          `${pointer.x.toFixed(0)}, ${pointer.y.toFixed(0)} ${pointer.device}` +
          (pointer.down ? " down" : "")
        );
      },
    ],
  ];
}

/** Register every source with the world's overlay registry. */
export function registerDiagnostics(world: World): void {
  for (const [name, source] of diagnosticSources(() => facetState(world))) {
    world.diagnostics.register(name, source);
  }
}
