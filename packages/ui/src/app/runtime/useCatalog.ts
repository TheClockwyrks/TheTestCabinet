import { useEffect, useState } from "react";
import { useBackend } from "../../client/context";
import type { TestCase, VersionInfo } from "../../client/types";

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

export function useCatalog(): CatalogSelection {
  const { client } = useBackend();
  const [cases, setCases] = useState<TestCase[]>([]);
  const [slug, setSlugState] = useState("");
  const [version, setVersionState] = useState("");
  const [variant, setVariant] = useState("");
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
        const first = cs[0];
        if (first) {
          setSlugState(first.slug);
          if (first.versions[0]) setVersionState(first.versions[0]);
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
        setVariant(info.variants[0]?.slug ?? "");
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
