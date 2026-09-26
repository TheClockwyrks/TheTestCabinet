import { useEffect, useState } from "react";
import { useOptionalBackend } from "../../client/context";
import type { ProviderStats } from "../../client/types";

// The async state of the deployment-wide provider statistics. `unavailable`
// covers a host whose transport has no aggregation endpoint (the static site) —
// distinct from a `ready` result with no provider data, which means no recorded
// run has named one yet.
export type ProviderStatsState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "error"; message: string }
  | { status: "ready"; stats: ProviderStats };

/**
 * Per-provider health folded from stored gg runs plus probe evidence
 * (`GET /stats/providers`), read once on mount. The fold is server-side and
 * cheap to re-request, but nothing on the page mutates it, so there is no
 * polling.
 */
export function useProviderStats(): ProviderStatsState {
  const client = useOptionalBackend()?.client ?? null;
  const getProviderStats = client?.getProviderStats?.bind(client) ?? null;
  const [state, setState] = useState<ProviderStatsState>(
    getProviderStats ? { status: "loading" } : { status: "unavailable" },
  );

  useEffect(() => {
    if (!getProviderStats) {
      setState({ status: "unavailable" });
      return;
    }
    let active = true;
    getProviderStats()
      .then((stats) => {
        if (active) setState({ status: "ready", stats });
      })
      .catch((e) => {
        if (active) setState({ status: "error", message: errorMessage(e) });
      });
    return () => {
      active = false;
    };
    // The bound method is a new function every render; the client identity is
    // the dependency that actually changes when a different backend connects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  return state;
}

// An Error's own message reads better than its stringification (no "Error: "
// prefix); anything else is stringified as-is.
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
