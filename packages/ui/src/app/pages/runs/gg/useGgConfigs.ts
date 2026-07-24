import { useCallback, useEffect, useMemo, useState } from "react";
import type { GgCapabilitySet, GgConfig } from "@test-cabinet/run-record/gg";
import { useAuth } from "../../../../client/auth";
import { useBackend } from "../../../../client/context";
import {
  BUILT_IN_GG_CONFIGS,
  capabilitySetFromDraft,
  type GgConfigDraft,
  draftFromCapabilitySet,
  cloneDraft,
} from "./ggConfigDraft";

/**
 * One pickable gg configuration — either a read-only built-in every operator
 * shares, or one the signed-in account registered. The new-run form offers both in
 * one list (built-ins first), and the account tab lists them in two sections.
 */
export interface GgConfigOption {
  /** Stable picker value: `builtin:<name>` or `saved:<id>`. */
  key: string;
  name: string;
  description: string;
  /** Whether this is a shared, read-only built-in. */
  builtIn: boolean;
  /** The capability set a run launched from it carries (before the model binds). */
  capabilitySet: GgCapabilitySet;
  /** The same configuration in editable form (what the editor mounts). */
  draft: GgConfigDraft;
}

/** The picker value for a built-in / saved configuration. */
export function builtInKey(name: string): string {
  return `builtin:${name}`;
}
export function savedKey(id: string): string {
  return `saved:${id}`;
}

/** The built-ins as pickable options — constant, so computed once. */
const BUILT_IN_OPTIONS: ReadonlyArray<GgConfigOption> = BUILT_IN_GG_CONFIGS.map(
  (config) => ({
    key: builtInKey(config.name),
    name: config.name,
    description: config.description,
    builtIn: true,
    capabilitySet: capabilitySetFromDraft(config.draft, config.name),
    draft: config.draft,
  }),
);

/** A fresh, unaliased copy of a built-in's draft — the seed for a duplicate. */
export function builtInDraft(name: string): GgConfigDraft | null {
  const found = BUILT_IN_GG_CONFIGS.find((c) => c.name === name);
  return found ? cloneDraft(found.draft) : null;
}

/**
 * The gg configurations available to the signed-in operator: the shared read-only
 * built-ins plus whatever the account has registered (`GET /gg/configs`).
 *
 * Both the account section's gg tab and the new-run form's configuration picker
 * drive off this, so the set an operator manages is exactly the set they can
 * launch. Signed out (or on a transport without the endpoint) only the built-ins
 * are offered — they need no account.
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

  const savedOptions = useMemo<GgConfigOption[]>(
    () =>
      saved.map((config) => ({
        key: savedKey(config.id),
        name: config.name,
        description: config.description,
        builtIn: false,
        capabilitySet: config.capabilitySet,
        draft: draftFromCapabilitySet(config.capabilitySet),
      })),
    [saved],
  );

  const options = useMemo<GgConfigOption[]>(
    () => [...BUILT_IN_OPTIONS, ...savedOptions],
    [savedOptions],
  );

  return {
    /** Every configuration, built-ins first — what a picker offers. */
    options,
    /** Only the account's own configurations, as stored. */
    saved,
    /** The shared read-only built-ins. */
    builtIns: BUILT_IN_OPTIONS,
    loading,
    error,
    reload,
  };
}
