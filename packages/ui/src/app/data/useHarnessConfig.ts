import { useMemo } from "react";
import { useAuth } from "../../client/auth";
import { useBackend } from "../../client/context";
import type { HarnessConfigEntry } from "../../client/types";
import { useGalleryData } from "./galleryContext";

// The per-harness configuration capability, bound to the active backend client and
// (for the mutation) the signed-in token. This is the backend-backed half of the
// Harnesses settings — the maximum-parallelism knob the backend's claim enforces —
// so it works the same on the web console and the desktop app (both talk to the
// same backend over HTTP), unlike the Tauri-only harness *auth* capability.
//
// `list` is an open read, present wherever a console can execute (`canExecute`) and
// the transport exposes it (the static site's snapshot transport does not).
// `setMaxParallelism` additionally needs a signed-in `token`; it is `null` when the
// session is logged out, so the page shows a sign-in notice rather than a disabled,
// unexplained control — the same conjunction {@link useModelConfig} uses.
export interface HarnessConfigApi {
  /** Every harness with its current configuration (`GET /harness-config`). */
  list(): Promise<HarnessConfigEntry[]>;
  /** Set a harness's maximum parallelism (`null` = no limit), or `null` when the
   * session is logged out and cannot mutate. Resolves to the refreshed list. */
  setMaxParallelism:
    | ((slug: string, maxParallelism: number | null) => Promise<HarnessConfigEntry[]>)
    | null;
}

/**
 * The harness-configuration capability, or `null` when reading harness config is
 * not possible here (a read-only host, or a transport without the endpoint).
 * `setMaxParallelism` is separately `null` when logged out — the list still reads,
 * but editing needs a token.
 */
export function useHarnessConfig(): HarnessConfigApi | null {
  const { canExecute } = useGalleryData();
  const { client } = useBackend();
  const { token } = useAuth();

  return useMemo<HarnessConfigApi | null>(() => {
    if (!canExecute || !client?.listHarnessConfigs) {
      return null;
    }
    const { listHarnessConfigs, setHarnessMaxParallelism } = client;
    return {
      list: () => listHarnessConfigs(),
      setMaxParallelism:
        token && setHarnessMaxParallelism
          ? (slug, maxParallelism) =>
              setHarnessMaxParallelism(slug, maxParallelism, token)
          : null,
    };
  }, [canExecute, client, token]);
}
