import { useEffect, useRef, useState } from "react";
import { useBackend } from "../../client/context";
import type { TestCase, VersionInfo } from "../../client/types";

// An initial test case / version / variant to select once the catalog (and the
// version's variants) load, used when the new-run form is reached from a test
// case's Run button. Each field is matched against what the catalog actually
// offers and ignored when it does not match, so a stale link falls back to the
// default selection rather than wedging on a missing case.
export interface CatalogPreselect {
  slug?: string | null;
  version?: string | null;
  variant?: string | null;
}

// Shared selection state for picking a test case, version, and variant when
// configuring a run. The catalog fetch and the cascading dropdowns live here; it
// comes from the active backend — never from a worker. (Lifted out of the old
// console so the run-configuration page can reuse it once the console is retired.)
export interface CatalogSelection {
  cases: TestCase[];
  slug: string;
  version: string;
  variant: string;
  versionInfo: VersionInfo | null;
  error: string | null;
  loading: boolean;
  /** True when no backend is configured/reachable to resolve the catalog. */
  noBackend: boolean;
  setSlug: (slug: string) => void;
  setVersion: (version: string) => void;
  setVariant: (variant: string) => void;
}

export function useCatalog(preselect?: CatalogPreselect): CatalogSelection {
  const { client } = useBackend();
  const [cases, setCases] = useState<TestCase[]>([]);
  const [slug, setSlugState] = useState("");
  const [version, setVersionState] = useState("");
  const [variant, setVariant] = useState("");
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // The desired initial selection, applied once as the catalog loads. Captured
  // in a ref so it only steers the first resolution: after that, the dropdowns
  // own the selection and a re-render (e.g. a new query-param object identity)
  // never reapplies it over a choice the user has since made. The variant is
  // consumed (cleared) once spent so changing case/version later defaults to the
  // first variant rather than re-forcing the linked one.
  const wanted = useRef<CatalogPreselect>({
    slug: preselect?.slug,
    version: preselect?.version,
    variant: preselect?.variant,
  });

  // Load the catalog whenever the active backend changes.
  useEffect(() => {
    if (!client) {
      setCases([]);
      return;
    }
    let active = true;
    client
      .listTestCases()
      .then((cs) => {
        if (!active) return;
        setCases(cs);
        // Honor a requested case when it is in the catalog; otherwise lead with
        // the first. Likewise for its version.
        const wantSlug = wanted.current.slug;
        const chosen =
          (wantSlug && cs.find((c) => c.slug === wantSlug)) ?? cs[0];
        if (chosen) {
          setSlugState(chosen.slug);
          const wantVersion = wanted.current.version;
          const nextVersion =
            (wantVersion && chosen.versions.includes(wantVersion)
              ? wantVersion
              : chosen.versions[0]) ?? "";
          setVersionState(nextVersion);
        }
      })
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [client]);

  // Resolve the selected version (for its variants) whenever it changes.
  useEffect(() => {
    if (!client || !slug || !version) {
      setVersionInfo(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    client
      .resolveVersion(slug, version)
      .then((info) => {
        if (!active) return;
        setVersionInfo(info);
        // Honor a requested variant once, on the first resolution, when it
        // exists in the resolved version; then forget it so later case/version
        // changes default to the first variant.
        const wantVariant = wanted.current.variant;
        wanted.current.variant = undefined;
        const chosen =
          wantVariant && info.variants.some((v) => v.slug === wantVariant)
            ? wantVariant
            : (info.variants[0]?.slug ?? "");
        setVariant(chosen);
      })
      .catch((e) => active && setError(String(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [client, slug, version]);

  const setSlug = (next: string) => {
    setSlugState(next);
    const found = cases.find((c) => c.slug === next);
    setVersionState(found?.versions[0] ?? "");
  };

  return {
    cases,
    slug,
    version,
    variant,
    versionInfo,
    error,
    loading,
    noBackend: !client,
    setSlug,
    setVersion: setVersionState,
    setVariant,
  };
}
