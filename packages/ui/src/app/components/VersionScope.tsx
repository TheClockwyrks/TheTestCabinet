// The version-scope control shared by a test case's Metrics and Leaderboard tabs.
// Both tabs aggregate a case's runs across versions, and both need the same
// answer to "which versions am I looking at?" — so the scope vocabulary, the
// membership test, and the control that picks it live here rather than being
// stated twice (and drifting).

import { useState } from "react";
import { SegmentedControl, type SegmentedOption } from "@test-cabinet/ui";
import type { TestCaseSummary } from "../data/testCases";
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

// A version's numeric parts. Versions are `v<major>.<minor>.<revision>` strings
// (e.g. `v1.2.0`); there is no shared semver parser, so the scopes parse the two
// they compare on the fly.
interface Semver {
  major: number;
  minor: number;
  revision: number;
}

// Parse a `v1.2.0`-style version into its numeric parts, or null when it doesn't
// match (a scope then falls back to an exact string compare rather than silently
// matching nothing).
function parseVersion(version: string): Semver | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    revision: Number(match[3]),
  };
}

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
        <select
          className={styles.versionSelect}
          value={state.specificVersion}
          onChange={(event) => state.setSpecificVersion(event.target.value)}
          aria-label="Version"
        >
          {state.versions.map((version) => (
            <option key={version} value={version}>
              {version}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
