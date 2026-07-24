// The plan panel: gg's planning pass rendered live (see gg/planning). Planning is
// a read-only exploration phase that produces a plan, followed by a fresh-context
// implementation phase seeded from the original prompt plus that plan. It is
// transient but important context — it is the deliberate shape the run committed to
// before touching the workspace — so this view surfaces the current phase
// prominently and shows the plan text once it has been submitted.
//
// `useGgRunState` keeps the latest planning transition. This view renders a phase
// banner (read-only exploration → plan submitted → implementing from the plan) and,
// once a plan exists, the plan body. When no planning happened it shows a tidy
// empty state, so a planning-off run simply reads as "no plan".

import type { GgPlanPhase } from "@test-cabinet/run-record/gg";
import type { PlanState } from "./useGgRunState";
import styles from "./GgPanels.module.scss";

interface PlanViewProps {
  plan: PlanState | null;
}

// How each phase presents in the banner: a short label, a one-line descriptor of
// what the phase means, and whether the workspace is still read-only (exploration)
// or the run has begun implementing from the plan.
const PHASE_PRESENTATION: Record<
  GgPlanPhase,
  { label: string; detail: string; mode: "read-only" | "implementing" }
> = {
  entered: {
    label: "Planning",
    detail:
      "Read-only exploration — the agent can read and reason, but not mutate.",
    mode: "read-only",
  },
  submitted: {
    label: "Plan submitted",
    detail: "The plan is ready; implementation restarts from a fresh context.",
    mode: "read-only",
  },
  implementing: {
    label: "Implementing",
    detail:
      "Building from the plan — fresh context, the original prompt plus the plan.",
    mode: "implementing",
  },
};

export function PlanView({ plan }: PlanViewProps) {
  if (!plan) {
    return (
      <p className={styles.empty}>
        No planning pass — the planning capability runs a read-only exploration
        that produces a plan, then implements from a fresh context seeded with
        it. Nothing streams here when planning is off (or was never elected
        mid-run).
      </p>
    );
  }

  const phase = PHASE_PRESENTATION[plan.phase];
  return (
    <div className={styles.plan}>
      <div className={styles.planBanner} data-mode={phase.mode}>
        <span className={styles.planDot} aria-hidden="true" />
        <div className={styles.planBannerText}>
          <span className={styles.planPhase}>{phase.label}</span>
          <span className={styles.planPhaseDetail}>{phase.detail}</span>
        </div>
      </div>

      {plan.implementTurn != null && (
        <p className={styles.planTransition}>
          Implementation began from a fresh context at turn {plan.implementTurn}{" "}
          — the exploration history was cleared and the plan carried across.
        </p>
      )}

      {plan.plan ? (
        <div className={styles.planDoc}>
          <span className={styles.planDocLabel}>Plan</span>
          <pre className={styles.planText}>{plan.plan}</pre>
        </div>
      ) : (
        <p className={styles.caption}>
          The plan appears here once the read-only pass submits it.
        </p>
      )}
    </div>
  );
}
