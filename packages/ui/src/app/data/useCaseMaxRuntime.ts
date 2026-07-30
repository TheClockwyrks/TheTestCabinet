import { useEffect, useState } from "react";
import { useOptionalBackend } from "../../client/context";

// The wall-clock ceiling a test-case version is run under — its manifest's
// `max_runtime_hours`, resolved to seconds — for the surfaces that state what a run is
// bounded by rather than only how long it has been going.
//
// It is not on the catalog summary (which carries a case's identity, variants, and scoring,
// not its execution knobs) and not on a run record either, so it is resolved from the
// backend's `GET /test-cases/{slug}/versions/{version}` the same way the new-run form reads
// the default it shows in its override field. That makes it a fetch rather than a selector,
// hence a hook of its own: the value is stable for the life of a version, so a resolved
// figure is held until the slug/version pair changes.
//
// Degrades to null wherever it cannot be known — no backend mounted (the static site), a
// case or version the backend does not carry, an unreachable request — and a caller states
// "no limit" rather than inventing one.
export function useCaseMaxRuntime(
  slug: string | null | undefined,
  version: string | null | undefined,
): number | null {
  const backend = useOptionalBackend();
  const client = backend?.client ?? null;
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!client || !slug || !version) {
      setSeconds(null);
      return;
    }
    let active = true;
    client
      .resolveVersion(slug, version)
      .then((info) => {
        if (active) setSeconds(info.maxRuntimeSeconds);
      })
      // A ceiling nobody could resolve is stated as unknown, not as an error: the surfaces
      // reading it are watching a run, and a failed lookup of a secondary figure must not
      // take over the page.
      .catch(() => {
        if (active) setSeconds(null);
      });
    return () => {
      active = false;
    };
  }, [client, slug, version]);

  return seconds;
}
