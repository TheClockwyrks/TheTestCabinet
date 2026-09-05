import { useCallback, useEffect, useState } from "react";
import type { GgSavedAgent } from "@clockwyrks/run-record/gg";
import { useAuth } from "../../../../client/auth";
import { useOptionalBackend } from "../../../../client/context";

/**
 * The gg agents the signed-in operator has saved (`GET /gg/agents`) — the library a
 * configuration imports profiles from.
 *
 * The account section's agent list, the configuration editor's import control and the
 * configuration loader all drive off this, so what an operator manages is exactly what a
 * configuration can follow. Signed out (or on a transport without the endpoint) there
 * are none: a saved agent belongs to an account.
 */
export function useGgAgents() {
  const { token } = useAuth();
  // Optional, not asserted: the comparison detail page resolves configurations and
  // renders on the static site, which mounts no backend provider.
  const backend = useOptionalBackend()?.client ?? null;
  const [agents, setAgents] = useState<GgSavedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<GgSavedAgent[]> => {
    if (!backend?.listGgAgents || !token) return [];
    return backend.listGgAgents(token);
  }, [backend, token]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    load()
      .then((next) => {
        if (!active) return;
        setAgents(next);
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
    setAgents(await load());
  }, [load]);

  return { agents, loading, error, reload };
}
