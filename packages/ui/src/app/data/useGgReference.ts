import { useEffect, useRef, useState } from "react";
import type { GgProgramLanguage } from "@test-cabinet/run-record/gg";
import type {
  GgReference,
  GgReferenceApi,
} from "@test-cabinet/run-record/gg-reference";
import { useBackend } from "../../client/context";

export interface GgReferenceState {
  /** gg's reference index — families, tools, the arm list — or `null` until it has
   * loaded (and whenever this host has no backend to load it from). */
  data: GgReference | null;
  loading: boolean;
  error: string | null;
}

export interface GgReferenceApiState {
  /** One arm's responses-as-code surface, or `null` until it has loaded (and whenever
   * no arm is being asked for). */
  data: GgReferenceApi | null;
  loading: boolean;
  error: string | null;
}

// gg's model-facing reference, fetched from the backend the console is pointed at.
//
// Fetched rather than bundled: the console and the backend are deployed separately, and
// the authority on what *this* deployment's gg tells models is the gg that deployment
// ships. Nothing in the console could stand in for it — the documents are projected by
// `gg reference --out` from gg's own tool registry and its own documentation runtime, and
// the backend reads them from disk beside its binary. A copy compiled into this bundle
// would confidently describe some other gg.
//
// That is also why there is no reload and no cache invalidation: the documents are
// immutable for a given backend build, so one fetch per mount is the whole lifecycle.
//
// No token on either call. The reference is the one open read under `/gg` (see the
// endpoint's own docs), so both resolve for a signed-out console. A host whose transport
// lacks the call — the read-only static site, which has no backend behind it at all —
// reports "not loading, no data" and the page renders its empty state; it never stalls on
// a promise that will not arrive.

/**
 * The reference **index**: the half of gg's surface that belongs to no program language.
 *
 * Its `languages` list is what the API tab's arm picker is built from, so this load is a
 * prerequisite for {@link useGgReferenceApi} rather than a parallel to it.
 */
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
        setError(describe(e));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [backend]);

  return { data, loading, error };
}

/**
 * One arm's responses-as-code surface, fetched when a reader picks that arm.
 *
 * Pass `null` to fetch nothing — which is what the page does while the Tools tab is open.
 * The tools are language-independent, so a reader reading them should not be made to pull
 * ~90 KB of Kotlin signatures they never asked to see.
 *
 * **Arms already fetched are kept**, in a ref rather than in state so that re-reading one
 * costs no request and no render. Eleven arms are eleven immutable documents of a fixed
 * backend build, and a reader comparing the Rust and Swift spellings of one call flips
 * between two of them repeatedly — which is precisely the motion the picker exists for,
 * and precisely the motion a fetch-every-time would punish. The cache is per hook
 * instance, so it lives exactly as long as the page that owns it.
 */
export function useGgReferenceApi(
  language: GgProgramLanguage | null,
): GgReferenceApiState {
  const { client: backend } = useBackend();
  const cache = useRef(new Map<GgProgramLanguage, GgReferenceApi>());
  const [state, setState] = useState<GgReferenceApiState>({
    data: null,
    loading: language != null,
    error: null,
  });

  // A transport swap invalidates every cached arm: the documents belong to the backend
  // that served them, and a console re-pointed at a different deployment must not answer
  // a question about *that* gg out of the previous one's papers.
  useEffect(() => {
    cache.current = new Map();
  }, [backend]);

  useEffect(() => {
    let active = true;
    const fetchArm = backend?.ggReferenceApi;
    if (!fetchArm || language == null) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const cached = cache.current.get(language);
    if (cached) {
      setState({ data: cached, loading: false, error: null });
      return;
    }
    // No stale document under the spinner: showing the previous arm's entries while the
    // next one loads would put Rust spellings under a Swift heading, and the arm a
    // reader picked is exactly the thing they are checking.
    setState({ data: null, loading: true, error: null });
    fetchArm
      .call(backend, language)
      .then((arm) => {
        cache.current.set(language, arm);
        if (!active) return;
        setState({ data: arm, loading: false, error: null });
      })
      .catch((e) => {
        if (!active) return;
        setState({ data: null, loading: false, error: describe(e) });
      });
    return () => {
      active = false;
    };
  }, [backend, language]);

  return state;
}

/**
 * A failed fetch, as a line to put in front of a reader.
 *
 * The backend's `503` for a deployment with no reference documents is written to be read
 * by whoever is looking at the page — it names the script that writes them and the
 * environment variable that points at them — and the transport has already unwrapped it
 * into the `Error`'s message. `String(error)` would prefix that sentence with `Error:`,
 * which adds nothing and reads as a stack trace leaking onto a documentation page.
 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
