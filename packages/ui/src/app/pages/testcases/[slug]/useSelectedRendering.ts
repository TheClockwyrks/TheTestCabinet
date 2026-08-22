import { useCallback } from "react";
import { useSearchParams } from "react-router";
import { DEFAULT_ENGINE_SLUG, orderEngines } from "../../../data/engines";
import type { TestCaseDetail } from "../../../data/testCases";

// The query-string keys the selected rendering is carried in. Like the variant
// (see `useSelectedVariant`), the selection lives in the URL rather than in
// component state so a specific rendering of a case's inputs is linkable — which
// is most of the point of being able to read an older version at all.
//
// `version` is deliberately the same key the Runs tab's version facet uses (see
// `useRunFilters`), because the detail layout carries the query string across
// tabs and the two mean the same thing: which version of THIS case is being
// looked at. Narrowing the run list to a version and then opening Inputs shows
// that version's inputs, and the reverse holds too.
const VERSION_PARAM = "version";
const ENGINE_PARAM = "engine";

/** Which rendering of a case's inputs is being read, and how to change it. */
export interface SelectedRendering {
  /** The selected version — one of {@link versions}, defaulting to the latest. */
  version: string;
  setVersion: (version: string) => void;
  /** Every published version of the case, newest first. */
  versions: readonly string[];
  /** The selected engine — one of {@link engines}, defaulting to the engineless
   * rendering when the version supports it and to its first engine otherwise. */
  engine: string;
  setEngine: (engine: string) => void;
  /** The engines the selected version's inputs can be read under, in catalog
   * order. Never empty. */
  engines: readonly string[];
}

/**
 * Resolve which rendering of a case's inputs the visitor is reading — the case
 * version and the engine — from the `?version=` and `?engine=` query string,
 * falling back to the latest version rendered engineless.
 *
 * Both are dimensions of the inputs themselves, not of the case: a case's
 * `prompt.hbs` and its `.hbs` specs branch on the selected engine, and two
 * versions of one case are two different deliverables. Without them a reader sees
 * only the latest version's engineless rendering, which for a case supporting an
 * engine is a set of inputs no run on that engine was ever given, and for a
 * superseded version is not the deliverable those runs were judged against.
 *
 * Each selection is derived rather than stored, so a stale one can never survive:
 * picking a version whose engines differ falls back to that version's default
 * instead of holding an engine it has no rendering for. Both writes replace the
 * history entry so flipping between renderings does not pile up back-button stops,
 * and each drops its parameter at the default so the ordinary URL stays clean.
 */
export function useSelectedRendering(
  testCase: TestCaseDetail,
): SelectedRendering {
  const [params, setParams] = useSearchParams();

  const versions = testCase.versions;
  const requestedVersion = params.get(VERSION_PARAM);
  const version =
    requestedVersion && versions.includes(requestedVersion)
      ? requestedVersion
      : testCase.latestVersion;

  // The engines this version's inputs can be read under, in catalog order. A
  // version the host carries no entry for still offers the engineless rendering:
  // it is what every host publishes as the variant's own prompt and specs.
  const engines = orderEngines(
    testCase.enginesByVersion[version] ?? [DEFAULT_ENGINE_SLUG],
  );
  const defaultEngine = defaultEngineOf(engines);
  const requestedEngine = params.get(ENGINE_PARAM);
  const engine =
    requestedEngine && engines.includes(requestedEngine)
      ? requestedEngine
      : defaultEngine;

  const setVersion = useCallback(
    (next: string) => {
      setParams(
        (prev) => {
          const search = new URLSearchParams(prev);
          if (next === testCase.latestVersion) {
            search.delete(VERSION_PARAM);
          } else {
            search.set(VERSION_PARAM, next);
          }
          // A version supports its own set of engines. Carrying a selection the
          // new version has no rendering for would leave the URL naming an engine
          // the page is not showing, so drop it and let the new version's default
          // stand.
          const nextEngines = testCase.enginesByVersion[next] ?? [
            DEFAULT_ENGINE_SLUG,
          ];
          const selected = search.get(ENGINE_PARAM);
          if (selected && !nextEngines.includes(selected)) {
            search.delete(ENGINE_PARAM);
          }
          return search;
        },
        { replace: true },
      );
    },
    [setParams, testCase.enginesByVersion, testCase.latestVersion],
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

  return { version, setVersion, versions, engine, setEngine, engines };
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
