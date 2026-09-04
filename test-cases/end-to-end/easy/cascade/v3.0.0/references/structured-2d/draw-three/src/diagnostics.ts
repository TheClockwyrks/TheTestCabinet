// Cascade — the values the engine's debug overlay shows
// (`specs/instrumentation.md`, Diagnostics).
//
// The overlay itself is the engine's: it owns the panel, the backtick key that
// toggles it, and its read-only-ness. Cascade's whole part is to NAME the values
// it wants on it, registered through `world.diagnostics` from the game mode's
// `beginPlay`.
//
// Every source is a function of no arguments, invoked at each read, and every one
// is a PURE READ of the live state it reaches through the given accessor — the
// world the mode holds — so the panel reports the frame being drawn and watching
// the overlay never changes what the game does. Each line is short enough to read
// at a glance while the game runs.

import type { DiagnosticValue, World } from "@test-cabinet/structured-2d";
import { DEAL_MODE, TURN_COUNT } from "./constants";
import { cascadeState, type CascadeState } from "./game";
import { wasteVisibleCount } from "./piles";

/**
 * The sources, each named and each a read through `read` at the call. They are
 * split from the registration so the build's own tests can drive the same sources
 * over a state of their own.
 */
export function diagnosticSources(
  read: () => CascadeState,
): [string, () => DiagnosticValue][] {
  return [
    ["screen", () => read().screen],
    ["deal", () => `${DEAL_MODE} / ${TURN_COUNT}`],
    ["stock", () => read().stock.length],
    [
      "waste",
      () => {
        const state = read();
        return `${state.waste.length} showing ${wasteVisibleCount(state)}`;
      },
    ],
    [
      "foundations",
      () =>
        read()
          .foundations.map((pile) => pile.length)
          .join(" "),
    ],
    [
      "columns",
      () =>
        read()
          .tableau.map((pile) => pile.length)
          .join(" "),
    ],
    [
      "drag",
      () => {
        const drag = read().drag;
        return drag === null
          ? "none"
          : `${drag.cards.length} from ${drag.fromPile}`;
      },
    ],
    [
      "cascade",
      () => {
        const state = read();
        return `launched ${state.launched} flying ${state.flyers.length}`;
      },
    ],
  ];
}

/** Register every source with the world's overlay registry. */
export function registerDiagnostics(world: World): void {
  for (const [name, source] of diagnosticSources(() => cascadeState(world))) {
    world.diagnostics.register(name, source);
  }
}
