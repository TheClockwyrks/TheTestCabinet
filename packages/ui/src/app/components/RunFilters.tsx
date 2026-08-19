import { useMemo } from "react";
import { harnesses } from "../data/harnesses";
import { useModels } from "../data/useModels";
import { useTestCases } from "../data/useTestCases";
import type { RunFacetName, RunFilterState } from "./useRunFilters";
import styles from "./RunFilters.module.scss";

// The run listings' filter bar: the free-text field, the equality facets, and the
// current-version toggle, over the URL-backed state in `useRunFilters`.
//
// Every control is a plain native `<select>` whose *unset* option names what it
// filters ("All test cases"), so the bar needs no separate labels and each control
// reads its own value back — a filtered listing says what it is filtered to
// without a second row of chips repeating the controls directly above it.
//
// The same bar serves the all-runs index, a model's Runs tab, and a case's Runs
// tab; each page passes the facets its route does not already pin.

/** One option in a facet dropdown. */
interface FacetOption {
  value: string;
  label: string;
}

export interface RunFiltersProps {
  state: RunFilterState;
  /** Which facets to offer, in order. A facet the route pins (a case's Runs tab is
   * one case) is simply left out. */
  facets: readonly RunFacetName[];
  /** The search field's placeholder. Pages word it for what their listing holds —
   * a model's tab has no point advertising a model search. */
  searchPlaceholder: string;
  /** The search field's accessible name. */
  searchLabel: string;
  /** The versions the `version` facet offers, newest first. Defaults to those of
   * the selected (or route-fixed) case, resolved from the catalog. */
  versions?: readonly string[];
}

export function RunFilters({
  state,
  facets,
  searchPlaceholder,
  searchLabel,
  versions,
}: RunFiltersProps) {
  const catalogVersions = useCaseVersions(state.facets.testCase);
  const options = useFacetOptions(versions ?? catalogVersions);

  return (
    <div className={styles.filters}>
      <input
        className={styles.search}
        type="search"
        placeholder={searchPlaceholder}
        value={state.query}
        onChange={(event) => state.setQuery(event.target.value)}
        aria-label={searchLabel}
      />
      <div className={styles.facets}>
        {facets.map((facet) => (
          <FacetSelect
            key={facet}
            facet={facet}
            state={state}
            options={options[facet]}
          />
        ))}
        {/* The toggle is moot once an exact version is picked — that version is
            either current or deliberately not — so it steps aside rather than
            sitting there contradicting the version beside it. */}
        {!state.facets.version && (
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={state.latestVersions}
              onChange={(event) =>
                state.setLatestVersions(event.target.checked)
              }
            />
            Current versions only
          </label>
        )}
        {state.activeCount > 0 && (
          <button type="button" className={styles.clear} onClick={state.clear}>
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

// The copy for each facet: its accessible name and the label of its unset option,
// which doubles as the control's own label.
const FACET_LABELS: Record<RunFacetName, { name: string; all: string }> = {
  testCase: { name: "Test case", all: "All test cases" },
  version: { name: "Version", all: "All versions" },
  harness: { name: "Harness", all: "All harnesses" },
  model: { name: "Model", all: "All models" },
};

function FacetSelect({
  facet,
  state,
  options,
}: {
  facet: RunFacetName;
  state: RunFilterState;
  options: readonly FacetOption[];
}) {
  const { name, all } = FACET_LABELS[facet];
  // A version number only means something within a case, so the version facet
  // waits for one rather than offering `v1.0.0` across the whole cabinet.
  const needsCase = facet === "version" && !state.facets.testCase;
  const value = state.facets[facet];

  return (
    <select
      className={styles.facet}
      value={value}
      disabled={needsCase}
      title={needsCase ? "Pick a test case to filter by version" : undefined}
      aria-label={name}
      data-set={value ? "true" : undefined}
      onChange={(event) => state.setFacet(facet, event.target.value)}
    >
      <option value="">{needsCase ? "Version — pick a case" : all}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
      {/* A value the catalog no longer offers (a pasted link, a pruned case) would
          otherwise silently snap the control back to "All …" while the listing
          stays filtered. Carry it as its own option so the bar tells the truth. */}
      {value && !options.some((option) => option.value === value) && (
        <option value={value}>{value}</option>
      )}
    </select>
  );
}

/** The versions of one case, newest first, or none when no case is selected. The
 * catalog already orders them newest-first. */
function useCaseVersions(slug: string): readonly string[] {
  const { testCases } = useTestCases();
  return useMemo(() => {
    if (!slug) return [];
    return testCases.find((testCase) => testCase.slug === slug)?.versions ?? [];
  }, [testCases, slug]);
}

/** The options each facet offers. Cases and models are labelled by their display
 * name but filter on the recorded identity the backend indexes. */
function useFacetOptions(
  versions: readonly string[],
): Record<RunFacetName, FacetOption[]> {
  const { testCases } = useTestCases();
  const { models } = useModels();

  return useMemo(
    () => ({
      testCase: [...testCases]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((testCase) => ({ value: testCase.slug, label: testCase.name })),
      version: versions.map((version) => ({ value: version, label: version })),
      harness: harnesses.map((harness) => ({
        value: harness.slug,
        label: harness.displayName,
      })),
      // The listing filters on a single recorded `modelId`, so a model that covers
      // several ids is offered by its primary one — the same approximation the
      // model Runs tab already makes for its own scope.
      model: [...models]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((model) => ({
          value: model.modelIds[0] ?? model.slug,
          label: model.name,
        })),
    }),
    [testCases, models, versions],
  );
}
