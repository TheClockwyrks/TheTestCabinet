// The version-scope control shared by a test case's Metrics and Leaderboard tabs.
// Both tabs aggregate a case's runs across versions, and both need the same
// answer to "which versions am I looking at?" — so the scope vocabulary, the
// membership test, and the control that picks it live here rather than being
// stated twice (and drifting).

import { useId, useState } from "react";
import { SegmentedControl, type SegmentedOption } from "@test-cabinet/ui";
import type { TestCaseSummary } from "../data/testCases";
import { parseVersion } from "../data/versions";
import styles from "./VersionScope.module.scss";

// Which versions of the case a tab draws from, all relative to the case's
// latest version:
// - `current`: the same major AND minor as the latest (the revision may differ).
// - `major`: the same major as the latest (minor and revision may differ).
// - `specific`: one exact version the visitor picks.
// - `all`: every version.
export type VersionScope = "current" | "major" | "specific" | "all";

const SCOPE_OPTIONS: ReadonlyArray<SegmentedOption<VersionScope>> = [
  { value: "current", label: "Current version" },
  { value: "major", label: "Current major" },
  { value: "specific", label: "Specific" },
  { value: "all", label: "All" },
];

// Whether a run's `testCaseVersion` falls within the selected scope, measured
// against the case's latest version (or, for `specific`, the picked version).
// Unparseable versions fall back to an exact string match so a malformed value
// only ever matches its own kind.
export function versionInScope(
  runVersion: string,
  scope: VersionScope,
  latestVersion: string,
  specificVersion: string,
): boolean {
  if (scope === "all") return true;
  if (scope === "specific") return runVersion === specificVersion;
  const run = parseVersion(runVersion);
  const base = parseVersion(latestVersion);
  if (!run || !base) return runVersion === latestVersion;
  if (scope === "major") return run.major === base.major;
  return run.major === base.major && run.minor === base.minor;
}

/** The scope a tab has selected, plus what it needs to render and apply it. */
export interface VersionScopeState {
  scope: VersionScope;
  setScope: (scope: VersionScope) => void;
  /** The exact version the `specific` scope filters on. */
  specificVersion: string;
  setSpecificVersion: (version: string) => void;
  /** Every version of the case, for the `specific` picker. */
  versions: readonly string[];
  /** Whether the control is worth showing — a single-version case has nothing
   * to scope, and every one of its runs is in scope regardless. */
  show: boolean;
  /** Whether a run of `runVersion` is in the selected scope. Stable-by-value:
   * it closes over the scope state, so a memo that filters with it should list
   * the state fields (or the `VersionScopeState`) in its deps. */
  inScope: (runVersion: string) => boolean;
}

// Track the version scope for one case. The default `current` scope keeps a
// single-version case's runs whole (every run shares the latest version), so a
// case with nothing to scope needs no special-casing beyond hiding the control.
export function useVersionScope(testCase: TestCaseSummary): VersionScopeState {
  const [scope, setScope] = useState<VersionScope>("current");
  const [picked, setPicked] = useState(testCase.latestVersion);
  // A picked version the case no longer lists (the visitor navigated to another
  // case without the component remounting) would filter every run away; fall
  // back to the latest rather than showing an empty tab.
  const specificVersion = testCase.versions.includes(picked)
    ? picked
    : testCase.latestVersion;

  return {
    scope,
    setScope,
    specificVersion,
    setSpecificVersion: setPicked,
    versions: testCase.versions,
    show: testCase.versions.length > 1,
    inScope: (runVersion: string) =>
      versionInScope(
        runVersion,
        scope,
        testCase.latestVersion,
        specificVersion,
      ),
  };
}

// The exact-version dropdown, shared by the scope control's `specific` mode and
// the standalone picker below so the two read as one control.
function VersionSelect({
  versions,
  value,
  onChange,
  id,
  ariaLabel,
}: {
  versions: readonly string[];
  value: string;
  onChange: (version: string) => void;
  id?: string;
  ariaLabel?: string;
}) {
  return (
    <select
      id={id}
      className={styles.versionSelect}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
    >
      {versions.map((version) => (
        <option key={version} value={version}>
          {version}
        </option>
      ))}
    </select>
  );
}

// The control itself: the scope toggle, plus the exact-version picker when the
// `specific` scope is selected. Renders nothing for a case with one version.
export function VersionScopeControl({ state }: { state: VersionScopeState }) {
  if (!state.show) return null;
  return (
    <div className={styles.controls}>
      <SegmentedControl
        options={SCOPE_OPTIONS}
        value={state.scope}
        onChange={state.setScope}
        ariaLabel="Version scope"
      />
      {state.scope === "specific" && (
        <VersionSelect
          versions={state.versions}
          value={state.specificVersion}
          onChange={state.setSpecificVersion}
          ariaLabel="Version"
        />
      )}
    </div>
  );
}

/** One exact version of a case, for a view that can only ever show one. */
export interface VersionPickState {
  version: string;
  setVersion: (version: string) => void;
  versions: readonly string[];
  /** Whether the picker is worth showing — a single-version case has no choice
   * to make, and `version` is that one version regardless. */
  show: boolean;
}

// Track one exact version of a case, defaulting to its latest. This is the
// single-version sibling of `useVersionScope`, for a view whose figures are only
// comparable WITHIN one version — a performance case's fuel totals, which are
// only meaningful against the same scored scenario set — so it picks a cohort
// rather than widening across several.
export function useVersionPick(testCase: TestCaseSummary): VersionPickState {
  const [picked, setPicked] = useState(testCase.latestVersion);
  // A picked version the case no longer lists (the visitor navigated to another
  // case without the component remounting) would show an empty board; fall back
  // to the latest, as the scope hook does.
  const version = testCase.versions.includes(picked)
    ? picked
    : testCase.latestVersion;

  return {
    version,
    setVersion: setPicked,
    versions: testCase.versions,
    show: testCase.versions.length > 1,
  };
}

// The standalone version picker. Unlike the scope control it carries a visible
// label: on its own, a lone dropdown reading `v1.2.0` doesn't say what it
// selects. Renders nothing for a case with one version.
export function VersionPicker({ state }: { state: VersionPickState }) {
  // Hooks run before the single-version bail-out below, never after it.
  const selectId = useId();
  if (!state.show) return null;
  return (
    <div className={styles.controls}>
      <label className={styles.pickerLabel} htmlFor={selectId}>
        Version
      </label>
      <VersionSelect
        id={selectId}
        versions={state.versions}
        value={state.version}
        onChange={state.setVersion}
      />
    </div>
  );
}
