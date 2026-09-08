import { useCallback } from "react";
import { useSearchParams } from "react-router";
import { DEFAULT_ENGINE_SLUG, orderEngines } from "../../../data/engines";
import type { TestCaseDetail, VariantRef } from "../../../data/testCases";

// The query-string keys the selected coordinate is carried in. Keeping the whole
// coordinate in the URL (rather than component state) is what lets the single
// page-level selector row drive every tab at once, survive navigation between
// them, and make a specific rendering of a case linkable.
//
// `version` is deliberately the key the cross-case run listings' version facet
// uses (see `useRunFilters`): the two mean the same thing — which version of a
// case is being looked at — so a link narrowed on one surface reads correctly on
// the other.
const VERSION_PARAM = "version";
const VARIANT_PARAM = "variant";
const ENGINE_PARAM = "engine";

/**
 * The coordinate a case detail page is anchored to — which deliverable is being
 * looked at — and how to change it.
 */
export interface SelectedCoordinate {
  /** The selected version — one of {@link versions}, defaulting to the latest. */
  version: string;
  /** Every published version of the case, newest first. */
  versions: readonly string[];
  /** The case's latest version — what {@link isLatest} compares against. */
  latestVersion: string;
  /** Whether the selected version is the case's latest. A superseded selection
   * is legitimate — its runs were judged against it — but surfaces mark it. */
  isLatest: boolean;
  /** The selected variant — one of {@link variants}, defaulting to the selected
   * version's first (default) variant. Undefined only when the case itself
   * resolves no variants. */
  variant: VariantRef | undefined;
  /** The variants the selected version declares, in declared order. */
  variants: readonly VariantRef[];
  /** The selected engine — one of {@link engines}, defaulting to the engineless
   * rendering when the version supports it and to its first engine otherwise. */
  engine: string;
  /** The engines the selected version supports, in catalog order. Never empty. */
  engines: readonly string[];
  setVersion: (version: string) => void;
  setVariant: (slug: string) => void;
  setEngine: (engine: string) => void;
  /** The query string (`?…`, or empty) a link anchoring the page to `version`
   * carries — exactly what {@link setVersion} would write, so a link and the
   * selector land on the same coordinate. */
  searchForVersion: (version: string) => string;
}

/**
 * Resolve the coordinate the visitor has selected for a case — the version, the
 * variant, and the engine — from the `?version=`, `?variant=` and `?engine=`
 * query string.
 *
 * Selection is canonical, derived rather than stored: an unknown version reads
 * as the latest, and a variant or engine the selected version does not declare
 * reads as that version's default, so a stale deep link can never leave the page
 * naming a deliverable it is not showing. Picking a version re-derives the other
 * two dimensions from what that version declares and actively drops a carried
 * selection the new version has no rendering for.
 *
 * Each write replaces the history entry so flipping selections does not pile up
 * back-button stops, and each drops its parameter at the default so the ordinary
 * URL stays clean.
 */
export function useSelectedCoordinate(
  testCase: TestCaseDetail | undefined,
): SelectedCoordinate {
  const [params, setParams] = useSearchParams();

  const versions = testCase?.versions ?? [];
  const latestVersion = testCase?.latestVersion ?? "";
  const requestedVersion = params.get(VERSION_PARAM);
  const version =
    requestedVersion && versions.includes(requestedVersion)
      ? requestedVersion
      : latestVersion;

  const variants = testCase?.variantsByVersion[version] ?? [];
  const requestedVariant = params.get(VARIANT_PARAM);
  const variant =
    variants.find((v) => v.slug === requestedVariant) ?? variants[0];

  // The engines this version supports, in catalog order. A version the host
  // carries no entry for still offers the engineless rendering: it is what every
  // host publishes as the variant's own prompt and specs.
  const engines = orderEngines(
    testCase?.enginesByVersion[version] ?? [DEFAULT_ENGINE_SLUG],
  );
  const defaultEngine = defaultEngineOf(engines);
  const requestedEngine = params.get(ENGINE_PARAM);
  const engine =
    requestedEngine && engines.includes(requestedEngine)
      ? requestedEngine
      : defaultEngine;

  const setVersion = useCallback(
    (next: string) => {
      if (!testCase) return;
      setParams((prev) => withVersion(testCase, prev, next), {
        replace: true,
      });
    },
    [setParams, testCase],
  );

  const searchForVersion = useCallback(
    (next: string) => {
      if (!testCase) return "";
      const search = withVersion(testCase, params, next).toString();
      return search ? `?${search}` : "";
    },
    [params, testCase],
  );

  const setVariant = useCallback(
    (slug: string) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (variants[0]?.slug === slug) {
            next.delete(VARIANT_PARAM);
          } else {
            next.set(VARIANT_PARAM, slug);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams, variants],
  );

  const setEngine = useCallback(
    (next: string) => {
      setParams(
        (prev) => {
          const search = new URLSearchParams(prev);
          if (next === defaultEngine) {
            search.delete(ENGINE_PARAM);
          } else {
            search.set(ENGINE_PARAM, next);
          }
          return search;
        },
        { replace: true },
      );
    },
    [setParams, defaultEngine],
  );

  return {
    version,
    versions,
    latestVersion,
    isLatest: version === latestVersion,
    variant,
    variants,
    engine,
    engines,
    setVersion,
    setVariant,
    setEngine,
    searchForVersion,
  };
}

// The query string anchoring the page to `next`, derived from the current one.
// A version declares its own variants and supports its own engines. Carrying a
// selection the new version has no rendering for would leave the URL naming a
// deliverable the page is not showing, so it is dropped and the new version's
// default stands.
function withVersion(
  testCase: TestCaseDetail,
  prev: URLSearchParams,
  next: string,
): URLSearchParams {
  const search = new URLSearchParams(prev);
  if (next === testCase.latestVersion) {
    search.delete(VERSION_PARAM);
  } else {
    search.set(VERSION_PARAM, next);
  }
  const nextVariants = testCase.variantsByVersion[next] ?? [];
  const selectedVariant = search.get(VARIANT_PARAM);
  if (
    selectedVariant &&
    !nextVariants.some((v) => v.slug === selectedVariant)
  ) {
    search.delete(VARIANT_PARAM);
  }
  const nextEngines = testCase.enginesByVersion[next] ?? [DEFAULT_ENGINE_SLUG];
  const selectedEngine = search.get(ENGINE_PARAM);
  if (selectedEngine && !nextEngines.includes(selectedEngine)) {
    search.delete(ENGINE_PARAM);
  }
  return search;
}

// The engine a version is read under when nothing is selected: the engineless
// rendering when the version offers it, otherwise the first engine it does offer
// (a case built against a runtime need not support the engineless run at all).
// Mirrors how the new-run form settles on an engine.
function defaultEngineOf(engines: readonly string[]): string {
  return (
    engines.find((slug) => slug === DEFAULT_ENGINE_SLUG) ??
    engines[0] ??
    DEFAULT_ENGINE_SLUG
  );
}
