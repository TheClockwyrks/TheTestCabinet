// Cascade — the values the runtime's debug overlay shows.
//
// The overlay itself is the runtime's (`src/overlay.ts`): it owns the panel, the
// backtick key that toggles it, and its read-only-ness. Cascade's whole part is to
// NAME the values it wants on it (specs/instrumentation.md), which is what this
// file does.
//
// Every source is a pure read of the one live state object, so watching the
// overlay never changes what the game does, and each line is short enough to read
// at a glance while the game is running.

import { DEAL_MODE_LABEL } from "./constants";
import type { InitApi } from "./runtime";
import type { CascadeState } from "./state";
import { wasteVisibleCount } from "./waste";

/** Register every diagnostic source over the live state. */
export function registerDiagnostics(api: InitApi, state: CascadeState): void {
  api.diagnostics.register("screen", () => state.screen);
  api.diagnostics.register("deal", () => DEAL_MODE_LABEL);
  api.diagnostics.register("stock", () => state.stock.length);
  api.diagnostics.register(
    "waste",
    () => `${state.waste.length} (showing ${wasteVisibleCount(state)})`,
  );
  api.diagnostics.register("foundations", () =>
    state.foundations.map((pile) => pile.length).join(" "),
  );
  api.diagnostics.register("columns", () =>
    state.tableau.map((pile) => pile.length).join(" "),
  );
  api.diagnostics.register("hand", () =>
    state.drag === null ? "empty" : `${state.drag.cards.length} card(s)`,
  );
  api.diagnostics.register(
    "cascade",
    () => `launched ${state.launched}  flying ${state.flyers.length}`,
  );
}
