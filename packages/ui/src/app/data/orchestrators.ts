// The orchestrators a run can select — the strategy that conducts the harness
// sessions around the prompt. Like the `harnesses` catalog, the set surfaced in
// the run-launch picker is a fixed, code-defined list: the run-execution UI
// offers built-in orchestrators only (a worker has no access to a submitter's
// local directory, so the external `--orchestrator-dir` path is CLI-only). It
// mirrors core's built-in orchestrators (`orchestrators/<slug>/`) in catalog
// order, leading with the default, so the gallery never drifts from them.
//
// There is only one built-in session strategy — `one-shot`. The picker is shown
// regardless, because it is also where gg — The Test Cabinet's own run mode — is
// selected, and gg applies to every test type.

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

/**
 * The **gg** entry in the orchestrator picker. gg is not an orchestrator at all —
 * it is The Test Cabinet's own harness *and its own run mode*, with its own
 * executor and no orchestrator dimension. It is offered here because that is where
 * an operator chooses *how a run is conducted*: picking it swaps the harness column
 * for the operator's saved gg configurations (named capability sets) and submits
 * through gg's own enqueue endpoint rather than the flat launch body.
 */
export const GG_ORCHESTRATOR_SLUG = "gg";

/** Every built-in orchestrator the UI can select, in catalog order. */
export const BUILT_IN_ORCHESTRATORS: OrchestratorSummary[] = [
  {
    slug: "one-shot",
    displayName: "One-shot",
    description: "A single harness session driven to completion.",
  },
  {
    slug: GG_ORCHESTRATOR_SLUG,
    displayName: "gg",
    description:
      "The Test Cabinet's own harness, conducted by its own executor: the run " +
      "is configured by one of your saved gg configurations (a capability set) " +
      "instead of a harness.",
  },
];

/**
 * Whether the picked orchestrator selects the gg run mode — which changes what the
 * form collects (a gg configuration instead of a harness) and how it enqueues.
 */
export function isGgOrchestrator(slug: string): boolean {
  return slug === GG_ORCHESTRATOR_SLUG;
}
