import { useCallback, useEffect, useState } from "react";
import type { Comparison } from "@test-cabinet/run-record/comparison";
import { useAuth } from "../../client/auth";
import { useBackend } from "../../client/context";
import { useGalleryData } from "./galleryContext";

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

// The comparisons this host shows. On a console (signed in) it is the account's
// saved comparisons, fetched per-account from `GET /comparisons` (mirroring
// `useGgConfigs`). On the read-only static site it is the published comparisons the
// snapshot baked into the gallery ({@link GalleryDataInput.comparisons}) — public
// and review-less, so no sign-in is involved. A console signed out has neither and
// simply reports none (the list page shows a sign-in prompt).
export function useComparisons(): ComparisonsState {
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const { comparisons: publishedComparisons } = useGalleryData();
  const [comparisons, setComparisons] = useState<Comparison[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<Comparison[]> => {
    // A signed-in console fetches the account's comparisons; a read-only host
    // (static site) reads the published set from the gallery instead.
    if (backend?.listComparisons && token) {
      return backend.listComparisons(token);
    }
    return publishedComparisons ?? [];
  }, [backend, token, publishedComparisons]);

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
