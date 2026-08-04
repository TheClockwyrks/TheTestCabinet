import { useCallback, useEffect, useMemo, useState } from "react";
import type { GgCapabilitySet, GgConfig } from "@test-cabinet/run-record/gg";
import { useAuth } from "../../../../client/auth";
import { useBackend } from "../../../../client/context";
import { type GgConfigDraft, draftFromCapabilitySet } from "./ggConfigDraft";

/**
 * One pickable gg configuration — always one the signed-in account registered.
 *
 * There are no shared read-only built-ins: every configuration an operator can pick is
 * one they wrote. A configuration nobody can edit is one whose first use is always to
 * duplicate it, and the copies then drift from a "standard arm" that was never anyone's.
 */
export interface GgConfigOption {
  /** Stable picker value: `saved:<id>`. */
  key: string;
  name: string;
  description: string;
  /** The capability set a run launched from it carries (before the model binds). */
  capabilitySet: GgCapabilitySet;
  /** The same configuration in editable form (what the editor mounts). */
  draft: GgConfigDraft;
}

/** The picker value for a saved configuration. */
export function savedKey(id: string): string {
  return `saved:${id}`;
}

/**
 * The gg configurations available to the signed-in operator — whatever the account has
 * registered (`GET /gg/configs`).
 *
 * Both the account section's gg tab and the new-run form's configuration picker drive
 * off this, so the set an operator manages is exactly the set they can launch. Signed
 * out (or on a transport without the endpoint) there are none to offer: a configuration
 * belongs to an account.
 */
export function useGgConfigs() {
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const [saved, setSaved] = useState<GgConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<GgConfig[]> => {
    if (!backend?.listGgConfigs || !token) return [];
    return backend.listGgConfigs(token);
  }, [backend, token]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    load()
      .then((configs) => {
        if (!active) return;
        setSaved(configs);
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
    setSaved(await load());
  }, [load]);

  const options = useMemo<GgConfigOption[]>(
    () =>
      saved.map((config) => ({
        key: savedKey(config.id),
        name: config.name,
        description: config.description,
        capabilitySet: config.capabilitySet,
        draft: draftFromCapabilitySet(config.capabilitySet),
      })),
    [saved],
  );

  return {
    /** Every configuration, as a picker offers them. */
    options,
    /** The same configurations, as stored. */
    saved,
    loading,
    error,
    reload,
  };
}
