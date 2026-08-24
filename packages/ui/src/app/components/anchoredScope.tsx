// The anchored run scope shared by a test case's Runs, Leaderboard and Metrics
// tabs. Those tabs aggregate runs rather than render the selected deliverable,
// and they scope *relative to* the page's anchored coordinate instead of
// selecting one of their own: the anchored version can be widened to its
// `major.minor` line, its major line, or every version, and the anchored engine
// and variant can each be widened to all. The vocabulary, the membership test,
// and the control row live here so the three tabs describe the same cohort.
//
// The scope lives in the query string (`?scope=`, `?engines=`, `?variants=`,
// each omitted at its default) and the detail layout carries the query string
// across tabs, so widening the board widens the run list too and a scoped view
// is linkable.

import { useCallback } from "react";
import { useSearchParams } from "react-router";
import { SegmentedControl, type SegmentedOption } from "@test-cabinet/ui";
import { parseVersion } from "../data/versions";
import styles from "./anchoredScope.module.scss";

// Which versions of the case a tab draws from, all relative to the anchored
// version:
// - `version`: exactly the anchored version.
// - `minor`: the anchored version's `major.minor` line (the revision may
//   differ). The default — revisions of one minor are the same spec.
// - `major`: the anchored version's major line.
// - `all`: every version.
export type AnchoredVersionScope = "version" | "minor" | "major" | "all";

// Whether a widenable dimension (engine, variant) holds to the anchor or spans
// every value the case's runs record.
export type AnchoredWidening = "anchor" | "all";

const SCOPE_PARAM = "scope";
const ENGINES_PARAM = "engines";
const VARIANTS_PARAM = "variants";
const DEFAULT_VERSION_SCOPE: AnchoredVersionScope = "minor";

/**
 * Whether a run recorded at `runVersion` falls inside an anchored version
 * scope. Unparseable versions fall back to an exact string match so a malformed
 * value only ever matches its own kind.
 */
export function versionInAnchoredScope(
  runVersion: string,
  scope: AnchoredVersionScope,
  anchorVersion: string,
): boolean {
  if (scope === "all") return true;
  if (scope === "version") return runVersion === anchorVersion;
  const run = parseVersion(runVersion);
  const anchor = parseVersion(anchorVersion);
  if (!run || !anchor) return runVersion === anchorVersion;
  if (scope === "major") return run.major === anchor.major;
  return run.major === anchor.major && run.minor === anchor.minor;
}

/** The scope a tab has selected, plus what it needs to render and apply it. */
export interface AnchoredScopeState {
  /** The version the relative scopes are measured against. */
  anchorVersion: string;
  /** Every published version of the case, newest first. */
  versions: readonly string[];
  versionScope: AnchoredVersionScope;
  setVersionScope: (scope: AnchoredVersionScope) => void;
  engineScope: AnchoredWidening;
  setEngineScope: (widening: AnchoredWidening) => void;
  variantScope: AnchoredWidening;
  setVariantScope: (widening: AnchoredWidening) => void;
  /** Whether a run of `runVersion` is in the selected version scope.
   * Stable-by-value: it closes over the scope state, so a memo that filters
   * with it should list the state (or its fields) in its deps. */
  inVersionScope: (runVersion: string) => boolean;
  /** The concrete catalog versions the scope selects, newest first, or null for
   * the `all` scope. This is what a server-side listing query sends: the
   * catalog knows every published version, so a relative scope travels as an
   * explicit list. */
  versionsInScope: string[] | null;
  /** Whether the version segments are worth showing — a single-version case has
   * nothing to scope. */
  showVersions: boolean;
}

/**
 * Track the anchored scope for one case, against the page's anchored version.
 *
 * The defaults keep a tab describing the anchor: the anchored version's
 * `major.minor` line, the anchored engine, the anchored variant. Each
 * non-default choice is carried in the query string and dropped at its default,
 * and every write replaces the history entry.
 *
 * A widening is honored only where the tab declares it widenable — a stale
 * `?engines=all` left over from a version that offered the choice must not
 * silently change a cohort behind a control that is not on screen. A tab that
 * offers no widener for a dimension simply omits its flag and reads the
 * anchored value regardless of the URL.
 */
export function useAnchoredScope(anchor: {
  version: string;
  versions: readonly string[];
  /** Whether this tab offers the all-engines widening for the anchored
   * version (i.e. the version supports more than one engine). */
  engineWidenable?: boolean;
  /** Whether this tab offers the all-variants widening (i.e. the anchored
   * version declares more than one variant). */
  variantWidenable?: boolean;
}): AnchoredScopeState {
  const [params, setParams] = useSearchParams();

  const offered = offeredScopes(anchor.version);
  const requested = params.get(SCOPE_PARAM);
  const versionScope = offered.includes(requested as AnchoredVersionScope)
    ? (requested as AnchoredVersionScope)
    : defaultScope(offered);
  const engineScope: AnchoredWidening =
    anchor.engineWidenable && params.get(ENGINES_PARAM) === "all"
      ? "all"
      : "anchor";
  const variantScope: AnchoredWidening =
    anchor.variantWidenable && params.get(VARIANTS_PARAM) === "all"
      ? "all"
      : "anchor";

  const setChoice = useCallback(
    (param: string, value: string, isDefault: boolean) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (isDefault) {
            next.delete(param);
          } else {
            next.set(param, value);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const setVersionScope = useCallback(
    (scope: AnchoredVersionScope) => {
      const offeredNow = offeredScopes(anchor.version);
      setChoice(SCOPE_PARAM, scope, scope === defaultScope(offeredNow));
    },
    [setChoice, anchor.version],
  );
  const setEngineScope = useCallback(
    (widening: AnchoredWidening) =>
      setChoice(ENGINES_PARAM, widening, widening === "anchor"),
    [setChoice],
  );
  const setVariantScope = useCallback(
    (widening: AnchoredWidening) =>
      setChoice(VARIANTS_PARAM, widening, widening === "anchor"),
    [setChoice],
  );

  const versionsInScope =
    versionScope === "all"
      ? null
      : anchor.versions.filter((version) =>
          versionInAnchoredScope(version, versionScope, anchor.version),
        );

  return {
    anchorVersion: anchor.version,
    versions: anchor.versions,
    versionScope,
    setVersionScope,
    engineScope,
    setEngineScope,
    variantScope,
    setVariantScope,
    // Membership in the CATALOG versions the scope selects, not the bare
    // parse-and-compare predicate: the server-queried Runs tab sends
    // `versionsInScope`, so the client-filtered boards must count exactly the
    // same cohort — a run recorded against a version the catalog does not list
    // (a hidden experimental version, say) is counted by no tab rather than by
    // some.
    inVersionScope: (runVersion: string) =>
      versionsInScope === null || versionsInScope.includes(runVersion),
    versionsInScope,
    showVersions: anchor.versions.length > 1,
  };
}

// The scopes an anchor can offer: an unparseable anchor version has no
// `major.minor` line to widen into, so it offers only itself and `all`.
function offeredScopes(anchorVersion: string): AnchoredVersionScope[] {
  return parseVersion(anchorVersion)
    ? ["version", "minor", "major", "all"]
    : ["version", "all"];
}

// The default is the anchored `major.minor` line — revisions of one minor are
// the same spec — narrowing to the exact version for an anchor with no line.
function defaultScope(offered: AnchoredVersionScope[]): AnchoredVersionScope {
  return offered.includes(DEFAULT_VERSION_SCOPE)
    ? DEFAULT_VERSION_SCOPE
    : "version";
}

// The version segments name concrete cohorts of the anchor (`v1.2.0`,
// `v1.2.x`, `v1.x`) rather than abstract ones ("this minor"), so the control
// reads as what it selects.
function versionOptions(
  anchorVersion: string,
): ReadonlyArray<SegmentedOption<AnchoredVersionScope>> {
  const anchor = parseVersion(anchorVersion);
  if (!anchor) {
    return [
      { value: "version", label: anchorVersion },
      { value: "all", label: "All versions" },
    ];
  }
  return [
    { value: "version", label: anchorVersion },
    { value: "minor", label: `v${anchor.major}.${anchor.minor}.x` },
    { value: "major", label: `v${anchor.major}.x` },
    { value: "all", label: "All versions" },
  ];
}

/**
 * The scope control row a tab renders above its content: the version segments,
 * and the engine and variant wideners a tab offers. Each control is shown only
 * when it offers a real choice; with nothing to offer the row is omitted
 * entirely, which is the common case for a single-version, engineless,
 * single-variant case.
 */
export function AnchoredScopeControls({
  state,
  engine,
  variant,
}: {
  state: AnchoredScopeState;
  /** The anchored engine's display name; pass only when the tab scopes by
   * engine and the selected version supports more than one. */
  engine?: { name: string };
  /** The anchored variant's display name; pass only when the tab offers the
   * all-variants widening and the version declares more than one variant. */
  variant?: { name: string };
}) {
  if (!state.showVersions && !engine && !variant) return null;
  return (
    <div className={styles.controls}>
      {state.showVersions && (
        <div className={styles.control}>
          <span className={styles.label}>Versions</span>
          <SegmentedControl
            options={versionOptions(state.anchorVersion)}
            value={state.versionScope}
            onChange={state.setVersionScope}
            ariaLabel="Version scope"
          />
        </div>
      )}
      {engine && (
        <div className={styles.control}>
          <span className={styles.label}>Engine</span>
          <SegmentedControl<AnchoredWidening>
            options={[
              { value: "anchor", label: engine.name },
              { value: "all", label: "All engines" },
            ]}
            value={state.engineScope}
            onChange={state.setEngineScope}
            ariaLabel="Engine scope"
          />
        </div>
      )}
      {variant && (
        <div className={styles.control}>
          <span className={styles.label}>Variants</span>
          <SegmentedControl<AnchoredWidening>
            options={[
              { value: "anchor", label: variant.name },
              { value: "all", label: "All variants" },
            ]}
            value={state.variantScope}
            onChange={state.setVariantScope}
            ariaLabel="Variant scope"
          />
        </div>
      )}
    </div>
  );
}
