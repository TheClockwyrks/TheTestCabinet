import type { Comparison } from "@clockwyrks/backend-api/comparison";
import { useCallback, useEffect, useState } from "react";
import { useOptionalBackend } from "../../client/context";
import { useGalleryData } from "./galleryContext";

export interface ComparisonsState {
  /** The signed-in identity's comparisons, each already fully aggregated by the
   * backend (no separate stats fetch); on the static site, the published set. */
  comparisons: Comparison[];
  loading: boolean;
  error: string | null;
  /** Re-fetch the list, e.g. after a create/delete elsewhere navigates back here. */
  reload: () => Promise<void>;
}

// The comparisons this host shows. On a console it is the signed-in identity's
// saved comparisons, fetched from `GET /comparisons` (mirroring `useGgConfigs`). On
// the read-only static site it is the published comparisons the snapshot baked
// into the gallery ({@link GalleryDataInput.comparisons}) — public and review-less.
export function useComparisons(): ComparisonsState {
  // Optional, not asserted: this hook backs the Comparisons tab, which renders on
  // the static site too — and that host mounts no backend provider at all. The
  // load path below already treats a backend that cannot list comparisons as
  // "read the published set instead", so demanding the provider only turned the
  // supported case into a crash.
  const backend = useOptionalBackend()?.client ?? null;
  const { comparisons: publishedComparisons } = useGalleryData();
  const [comparisons, setComparisons] = useState<Comparison[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<Comparison[]> => {
    // A console fetches the identity's comparisons; a read-only host (static site)
    // reads the published set from the gallery instead.
    if (backend?.listComparisons) {
      return backend.listComparisons();
    }
    return publishedComparisons ?? [];
  }, [backend, publishedComparisons]);

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
