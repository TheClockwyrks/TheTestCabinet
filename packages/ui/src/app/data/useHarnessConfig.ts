import { useMemo } from "react";
import { useBackend } from "../../client/context";
import type { HarnessConfigEntry } from "../../client/types";
import { useGalleryData } from "./galleryContext";

// The per-harness configuration capability, bound to the active backend client.
// This is what the Harnesses settings read and write — the maximum-parallelism knob
// the backend's claim enforces.
//
// `list` is an open read, present wherever a console can execute (`canExecute`) and
// the transport exposes it (the static site's snapshot transport does not).
// `setMaxParallelism` is `null` when the transport has no setter, so the page shows
// a read-only list rather than a control that cannot work.
export interface HarnessConfigApi {
  /** Every harness with its current configuration (`GET /harness-config`). */
  list(): Promise<HarnessConfigEntry[]>;
  /** Set a harness's maximum parallelism (`null` = no limit), or `null` when the
   * transport cannot. Resolves to the refreshed list. */
  setMaxParallelism:
    | ((
        slug: string,
        maxParallelism: number | null,
      ) => Promise<HarnessConfigEntry[]>)
    | null;
}

/**
 * The harness-configuration capability, or `null` when reading harness config is
 * not possible here (a read-only host, or a transport without the endpoint).
 * `setMaxParallelism` is separately `null` when the transport has no setter.
 */
export function useHarnessConfig(): HarnessConfigApi | null {
  const { canExecute } = useGalleryData();
  const { client } = useBackend();

  return useMemo<HarnessConfigApi | null>(() => {
    if (!canExecute || !client?.listHarnessConfigs) {
      return null;
    }
    const { listHarnessConfigs, setHarnessMaxParallelism } = client;
    return {
      list: () => listHarnessConfigs(),
      setMaxParallelism: setHarnessMaxParallelism
        ? (slug, maxParallelism) =>
            setHarnessMaxParallelism(slug, maxParallelism)
        : null,
    };
  }, [canExecute, client]);
}
