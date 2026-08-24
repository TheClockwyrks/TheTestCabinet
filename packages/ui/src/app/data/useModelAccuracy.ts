import { useEffect, useState } from "react";
import { useOptionalBackend } from "../../client/context";
import type { ModelAccuracy } from "../../client/types";

// The async state of the deployment-wide per-model accuracy fold. `unavailable`
// covers a host whose transport has no aggregation endpoint (the static site) —
// distinct from a `ready` result that simply has no entry for a given model,
// which means no gg run recorded the needed figures.
export type ModelAccuracyState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "error"; message: string }
  | { status: "ready"; accuracy: ModelAccuracy };

/**
 * Per-model RaC and tool-calling accuracy folded from stored gg runs
 * (`GET /stats/model-accuracy`), read once on mount. The response covers every
 * model; a consumer selects the entries for the ids it cares about.
 */
export function useModelAccuracy(): ModelAccuracyState {
  const client = useOptionalBackend()?.client ?? null;
  const getModelAccuracy = client?.getModelAccuracy?.bind(client) ?? null;
  const [state, setState] = useState<ModelAccuracyState>(
    getModelAccuracy ? { status: "loading" } : { status: "unavailable" },
  );

  useEffect(() => {
    if (!getModelAccuracy) {
      setState({ status: "unavailable" });
      return;
    }
    let active = true;
    getModelAccuracy()
      .then((accuracy) => {
        if (active) setState({ status: "ready", accuracy });
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
