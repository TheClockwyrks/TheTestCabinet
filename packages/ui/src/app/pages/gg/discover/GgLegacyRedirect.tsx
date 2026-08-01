// The **legacy redirect** — an old aggregate URL, transcoded and forwarded to Discover.
//
// Mounted at both `/gg/aggregate` and `/gg/aggregate/results`, the two addresses the
// widget builder and its results page owned. It renders nothing: it reads the query
// string, hands it to the transcoder, and replaces the history entry so the back button
// does not bounce the operator straight back onto a route that no longer exists.
import { Navigate, useSearchParams } from "react-router";
import { routes } from "../../../routes";
import { legacyQueryText } from "./legacyQuery";

export function GgLegacyRedirect() {
  const [params] = useSearchParams();
  // `replace`, because the old URL is not a place to go back to — it has no page behind it
  // any more. The transcoded text lands in the editor, so what the link became is visible
  // and editable rather than silently assumed.
  return <Navigate replace to={routes.ggAnalysisDiscover(legacyQueryText(params))} />;
}
