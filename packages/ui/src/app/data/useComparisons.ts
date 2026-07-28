import { useCallback, useEffect, useState } from "react";
import type { Comparison } from "@test-cabinet/run-record/comparison";
import { useAuth } from "../../client/auth";
import { useBackend } from "../../client/context";

export interface ComparisonsState {
  /** The signed-in account's comparisons, each already fully aggregated by the
   * backend (no separate stats fetch). Empty (not loading) when signed out or
   * when the active transport can't reach the endpoint (the static site). */
  comparisons: Comparison[];
  loading: boolean;
  error: string | null;
  /** Re-fetch the list, e.g. after a create/delete elsewhere navigates back here. */
  reload: () => Promise<void>;
}

// The account's saved harness/gg-config/model comparisons (`GET /comparisons`),
// mirroring `useGgConfigs`/the coverage plans list: console-only, per-account, and
// simply empty (not an error) when signed out or the transport omits the endpoint
// — the list page and the "Other" tab degrade to their own sign-in prompt rather
// than surfacing a fetch error for an expected absence.
export function useComparisons(): ComparisonsState {
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const [comparisons, setComparisons] = useState<Comparison[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<Comparison[]> => {
    if (!backend?.listComparisons || !token) return [];
    return backend.listComparisons(token);
  }, [backend, token]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    load()
      .then((list) => {
        if (!active) return;
        setComparisons(list);
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(String(e));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [load]);

  const reload = useCallback(async () => {
    setComparisons(await load());
  }, [load]);

  return { comparisons, loading, error, reload };
}
