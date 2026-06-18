import { useEffect, useState } from "react";
import {
  isTauri,
  listTestCases,
  resolveVersion,
  type TestCase,
  type VersionInfo,
} from "./api";

// Shared selection state for picking a test case, version, and variant. Both the
// run-configuration view and the specs reader drive off the same selection, so
// the catalog fetch and the cascading dropdowns live here.
export interface CatalogSelection {
  cases: TestCase[];
  slug: string;
  version: string;
  variant: string;
  versionInfo: VersionInfo | null;
  error: string | null;
  loading: boolean;
  setSlug: (slug: string) => void;
  setVersion: (version: string) => void;
  setVariant: (variant: string) => void;
}

export function useCatalog(): CatalogSelection {
  const [cases, setCases] = useState<TestCase[]>([]);
  const [slug, setSlugState] = useState("");
  const [version, setVersionState] = useState("");
  const [variant, setVariant] = useState("");
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Load the catalog once.
  useEffect(() => {
    if (!isTauri()) return;
    listTestCases()
      .then((cs) => {
        setCases(cs);
        const first = cs[0];
        if (first) {
          setSlugState(first.slug);
          if (first.versions[0]) setVersionState(first.versions[0]);
        }
      })
      .catch((e) => setError(String(e)));
  }, []);

  // Resolve the selected version (for its variants) whenever it changes.
  useEffect(() => {
    if (!isTauri() || !slug || !version) {
      setVersionInfo(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    resolveVersion(slug, version)
      .then((info) => {
        if (!active) return;
        setVersionInfo(info);
        setVariant(info.variants[0]?.slug ?? "");
      })
      .catch((e) => {
        if (active) setError(String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [slug, version]);

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
    setSlug,
    setVersion: setVersionState,
    setVariant,
  };
}
