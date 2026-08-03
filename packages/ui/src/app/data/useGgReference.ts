import { useEffect, useState } from "react";
import type { GgReference } from "@test-cabinet/run-record/gg-reference";
import { useBackend } from "../../client/context";

export interface GgReferenceState {
  /** gg's tool + responses-as-code reference, or `null` until it has loaded (and
   * whenever this host has no backend to load it from). */
  data: GgReference | null;
  loading: boolean;
  error: string | null;
}

// gg's model-facing reference, fetched from the backend the console is pointed at
// (`GET /gg/reference`).
//
// Fetched rather than imported, even though the payload is a committed artifact that
// could be bundled: the console and the backend are deployed separately, and the
// authority on what *this* deployment's gg tells models is the gg that deployment
// ships — a bundled copy would confidently describe a different one. That is also why
// there is no reload and no cache invalidation: the document is immutable for a given
// backend build, so one fetch per mount is the whole lifecycle.
//
// No token. The reference is the one open read under `/gg` (see the endpoint's own
// docs), so this resolves for a signed-out console too. A host whose transport lacks
// the call — the read-only static site, which has no backend behind it at all —
// reports "not loading, no data" and the page renders its empty state; it never
// stalls on a promise that will not arrive.
export function useGgReference(): GgReferenceState {
  const { client: backend } = useBackend();
  const [data, setData] = useState<GgReference | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // `active` guards every setState against a transport swap (or an unmount)
    // landing an earlier backend's answer on top of a later one's.
    let active = true;
    const fetchReference = backend?.ggReference;
    if (!fetchReference) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetchReference
      .call(backend)
      .then((reference) => {
        if (!active) return;
        setData(reference);
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
  }, [backend]);

  return { data, loading, error };
}
