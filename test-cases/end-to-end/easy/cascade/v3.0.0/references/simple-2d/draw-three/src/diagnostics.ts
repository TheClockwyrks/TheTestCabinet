// Cascade — what the debug overlay shows (`specs/instrumentation.md`).
//
// The panel, its backtick toggle and its default-off state are all the engine's.
// Cascade's whole part is to register the values it wants on it, once, and each
// source is a pure read of the state it is handed, so watching the overlay leaves
// the game exactly as it is.
//
// Each source reads the state it is GIVEN rather than the one `initialize` built:
// every frame replaces the state, so a source that closed over the opening object
// would report the opening table forever.

import { DEAL_MODE, DEAL_MODE_LABEL } from "./constants";
import { wasteShownCount } from "./layout";
import type { CascadeState } from "./game";
import type { InitApi } from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";

/** Register every source the overlay draws. */
export function registerDiagnostics(api: InitApi<CascadeState>): void {
  api.diagnostics.register("screen", (s) => s.screen);
  api.diagnostics.register("mode", () => `${DEAL_MODE} (${DEAL_MODE_LABEL})`);
  api.diagnostics.register("stock", (s) => s.stock.length);
  api.diagnostics.register(
    "waste",
    (s: DeepReadonly<CascadeState>) =>
      `${String(s.waste.length)} (${String(wasteShownCount(s))} shown)`,
  );
  api.diagnostics.register("foundations", (s) =>
    s.foundations.map((pile) => pile.length).join(" "),
  );
  api.diagnostics.register("columns", (s) =>
    s.tableau.map((pile) => pile.length).join(" "),
  );
  api.diagnostics.register("drag", (s) =>
    s.drag === null ? "none" : `held ${String(s.drag.cards.length)} cards`,
  );
  api.diagnostics.register(
    "cascade",
    (s) => `launched ${String(s.launched)} / flying ${String(s.flyers.length)}`,
  );
}
