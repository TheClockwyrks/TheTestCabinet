// The orchestrators a run can select — the strategy that conducts the harness
// sessions around the prompt (a single session, a resume loop, …). Like the
// `harnesses` catalog, the set surfaced in the run-launch picker is a fixed,
// code-defined list: the run-execution UI offers built-in orchestrators only (a
// worker has no access to a submitter's local directory, so the external
// `--orchestrator-dir` path is CLI-only). It mirrors core's built-in
// orchestrators (`orchestrators/<slug>/`) in catalog order, leading with the
// default, so the gallery never drifts from them.
//
// Orchestrator selection is limited to the end-to-end test type; other test
// types always run `one-shot` and the picker is hidden for them (see
// docs/components/core/orchestrators.md, "Selecting an orchestrator").

/** One built-in orchestrator the run-launch picker can offer. */
export interface OrchestratorSummary {
  /** The stable slug, matching run records and core's built-in orchestrators. */
  slug: string;
  /** The human-facing name shown in the run-configuration picker. */
  displayName: string;
  /** A one-line summary of how the orchestrator drives the harness sessions. */
  description: string;
}

/** The default orchestrator (a single harness session driven to completion). */
export const DEFAULT_ORCHESTRATOR_SLUG = "one-shot";

/** Every built-in orchestrator the UI can select, in catalog order. */
export const BUILT_IN_ORCHESTRATORS: OrchestratorSummary[] = [
  {
    slug: "one-shot",
    displayName: "One-shot",
    description: "A single harness session driven to completion.",
  },
  {
    slug: "ralph",
    displayName: "Ralph Loop",
    description:
      "Re-runs the harness session — recording progress to a status file and " +
      "resuming from it — until the work is marked done.",
  },
];
