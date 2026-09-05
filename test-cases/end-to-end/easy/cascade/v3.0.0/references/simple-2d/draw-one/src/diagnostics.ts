// Cascade — the values the debug overlay shows (specs/instrumentation.md).
//
// The panel, its toggle key, and its formatting are the engine's; Cascade's part
// is registering the sources. Each is handed the state current at the read, so
// none of them closes over the state `initialize` built, and each is a pure read,
// so watching the overlay leaves the game exactly as it is.

import { DEAL_MODE, DEAL_MODE_LABEL } from "./constants";
import type { CascadeState } from "./game";
import type { InitApi } from "@clockwyrks/simple-2d";

/** How many cards each pile of a group holds, as one short line. */
function counts(piles: readonly (readonly unknown[])[]): string {
  return piles.map((pile) => pile.length).join(" ");
}

/** Register every source the overlay shows. */
export function registerDiagnostics(
  api: Pick<InitApi<CascadeState>, "diagnostics">,
): void {
  api.diagnostics.register("screen", (state) => state.screen);
  api.diagnostics.register("mode", () => DEAL_MODE);
  api.diagnostics.register("modeLabel", () => DEAL_MODE_LABEL);
  api.diagnostics.register("stock", (state) => state.stock.length);
  api.diagnostics.register("waste", (state) => state.waste.length);
  api.diagnostics.register("foundations", (state) => counts(state.foundations));
  api.diagnostics.register("columns", (state) => counts(state.tableau));
  api.diagnostics.register("dragging", (state) => state.drag !== null);
  api.diagnostics.register(
    "dragCards",
    (state) => state.drag?.cards.length ?? 0,
  );
  api.diagnostics.register("launched", (state) => state.launched);
  api.diagnostics.register("flying", (state) => state.flyers.length);
}
