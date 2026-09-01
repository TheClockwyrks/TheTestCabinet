import { useCallback, useEffect, useMemo, useState } from "react";
import type { GgCapabilitySet, GgConfig } from "@test-cabinet/run-record/gg";
import { useAuth } from "../../../../client/auth";
import { useOptionalBackend } from "../../../../client/context";
import { attachAgentSources, resolveCapabilitySet } from "./ggAgentLibrary";
import { type GgConfigDraft, draftFromCapabilitySet } from "./ggConfigDraft";
import { useGgAgents } from "./useGgAgents";

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
  /**
   * The capability set a run launched from it carries (before the model binds), with
   * every [imported agent](./ggAgentLibrary) resolved against the library as it stands.
   */
  capabilitySet: GgCapabilitySet;
  /** The same configuration in editable form (what the editor mounts). */
  draft: GgConfigDraft;
}

/** The picker value for a saved configuration. */
export function savedKey(id: string): string {
  return `saved:${id}`;
}

/**
 * The offered configuration a stored reference names, or undefined when the account no
 * longer holds it.
 *
 * A stored reference keeps whatever arrived — a picker's `saved:<id>` key, or the bare
 * id a client built by hand — so both spellings resolve. The exact key wins over the
 * prefixed one, so an option is never matched by a spelling the list also holds
 * literally.
 *
 * One lookup for every surface that resolves a reference back to a configuration (a
 * coverage cell's trigger, the combination picker's slots), because a surface that
 * resolved a reference its neighbour could not would report the operator's own
 * configuration as deleted on one screen and offer it on the next.
 */
export function findGgConfig(
  options: GgConfigOption[],
  reference: string,
): GgConfigOption | undefined {
  return (
    options.find((o) => o.key === reference) ??
    options.find((o) => o.key === savedKey(reference))
  );
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
  // An agent a configuration imported is resolved here rather than stored resolved, so
  // a configuration follows the saved agent as it stands now in every field it does not
  // override. gg still sees a set whose agents are whole: the resolution happens before
  // the option is offered to anything that launches or edits it.
  const {
    agents: library,
    loading: libraryLoading,
    error: libraryError,
  } = useGgAgents();
  // Optional, not asserted: the comparison detail page reads this and renders on
  // the static site, which mounts no backend provider. "No backend" is already
  // one of the two ways this resolves to no configurations at all.
  const backend = useOptionalBackend()?.client ?? null;
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
      // Nothing is offered until the library is in hand. A configuration resolved
      // against an empty library is the copy it was last saved with, which is exactly
      // what an import exists to stop a launch from carrying.
      libraryLoading
        ? []
        : saved.map((config) => {
            const capabilitySet = resolveCapabilitySet(config, library);
            return {
              key: savedKey(config.id),
              name: config.name,
              description: config.description,
              capabilitySet,
              draft: attachAgentSources(
                draftFromCapabilitySet(capabilitySet),
                config.agentSources,
                library,
              ),
            };
          }),
    [saved, library, libraryLoading],
  );

  return {
    /** Every configuration, as a picker offers them. */
    options,
    /** The same configurations, as stored. */
    saved,
    loading: loading || libraryLoading,
    // A library that failed to load is reported as a fault of this hook: a
    // configuration resolved without it is the copy it was last saved with, and nothing
    // downstream could tell that from the real thing.
    error: error ?? libraryError,
    reload,
  };
}
