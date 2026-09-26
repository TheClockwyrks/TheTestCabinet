// Cascade — what the read-only debug overlay reports.
//
// `specs/instrumentation.md` names the values the build registers: the screen
// and the deal mode, the size of every pile, whether a run is in hand and how
// many cards it holds, and — while a cascade runs — the launched count and the
// number of cards in flight.
//
// Every source below is a PURE READ of the live state, called fresh on every
// draw, so watching the overlay leaves the game exactly as it is and a snapshot
// taken with the panel up matches one taken with it down.

import { DEAL_MODE, DEAL_MODE_LABEL } from "./constants";
import type { InitApi } from "./runtime";
import type { CascadeState } from "./state";

/** Name every diagnostic source, once, before the first frame. */
export function registerDiagnostics(api: InitApi, state: CascadeState): void {
  api.diagnostics.register("screen", () => state.screen);
  api.diagnostics.register("deal", () => `${DEAL_MODE} (${DEAL_MODE_LABEL})`);
  api.diagnostics.register("stock", () => state.stock.length);
  api.diagnostics.register("waste", () => state.waste.length);
  api.diagnostics.register("foundations", () =>
    state.foundations.map((pile) => pile.length).join(" "),
  );
  api.diagnostics.register("columns", () =>
    state.tableau.map((pile) => pile.length).join(" "),
  );
  api.diagnostics.register("drag", () =>
    state.drag === null ? "none" : `${state.drag.cards.length} cards`,
  );
  api.diagnostics.register("launched", () => state.launched);
  api.diagnostics.register("inflight", () => state.flyers.length);
}
