// The reusable pieces of a multi-agent gg run's read-out. gg is headless, so an
// agent's identity (who it is, what it runs on, the worktree it works in, what it
// returned) and the run's delegation structure (per-slot cost, declared workflows,
// best-of-K speculations) are the only window into its shape (see gg/subagents.md,
// gg/multi-model.md, gg/workflows.md, gg/speculative-execution.md).
//
// The subagent *tree* itself is drawn by the Agents explorer's filesystem sidebar
// (see GgAgentsExplorer), so this module no longer renders it; it exports the
// per-agent identity row the explorer shows on an agent's Overview, the run-level
// structure panels (per-slot usage / workflows / speculation) it shows on the
// root's Overview, and the winner/loser classification the sidebar marks the tree
// with.

import type {
  AgentNode,
  AgentTreeNode,
  SlotUsage,
  SpeculationState,
  Workflow,
  WorkflowStage,
} from "./useGgRunState";
import { shortTokens } from "./useGgRunState";
import type {
  GgAgentStatus,
  GgSpeculationPhase,
} from "@test-cabinet/run-record/gg";
import { useFindModelOptional } from "../../../data/useModels";
import styles from "./GgPanels.module.scss";

// A per-agent speculation role, derived from the speculations plus the tree: the
// winning attempt (kept, merged) reads distinct, a losing attempt (discarded) is
// de-emphasized. The judge and non-attempt nodes carry no role.
export type SpeculationRole = "winner" | "loser";

// The phase label for the speculation summary. `fanned_out` reads as the K attempts
// still racing; `judged` as a winner picked; `merged` as the winner folded back in.
const SPECULATION_PHASE_LABELS: Record<GgSpeculationPhase, string> = {
  fanned_out: "fanned out",
  judged: "judged",
  merged: "merged",
};

// Classify each agent's role in a speculation, so the winning attempt can be marked
// and the discarded losers de-emphasized on the tree. The `speculation` events name
// only the winner (by agent id) and K, not the attempt ids, so the attempt set is
// read off the tree: a winner's co-attempts are its siblings that ran in their own
// worktree (each attempt fans out in isolation), the winner being the one that
// merged and the rest the discarded losers. A sibling with no worktree — the judge —
// carries no role, so it is neither marked a winner nor dimmed.
export function classifySpeculationRoles(
  tree: AgentTreeNode,
  speculations: SpeculationState[],
): Map<string, SpeculationRole> {
  const roles = new Map<string, SpeculationRole>();
  const winnerIds = new Set(
    speculations.map((s) => s.winner).filter((w): w is string => w != null),
  );
  if (winnerIds.size === 0) return roles;
  const visit = (node: AgentTreeNode) => {
    // A parent of a winning attempt is a speculation's fan-out point; among its
    // children, the winner is the winner and the other worktree-bearing attempts are
    // the discarded losers.
    if (node.children.some((child) => winnerIds.has(child.id))) {
      for (const child of node.children) {
        if (winnerIds.has(child.id)) roles.set(child.id, "winner");
        else if (
          child.worktree != null ||
          child.worktreeOutcome === "discarded"
        )
          roles.set(child.id, "loser");
      }
    }
    node.children.forEach(visit);
  };
  visit(tree);
  return roles;
}

// The human label for an agent's lifecycle status. `blocked` is called out as
// "waiting" because that is the state that matters at a glance in a multi-agent
// run — an agent that has released its slot and is waiting on its subagents.
export const STATUS_LABELS: Record<GgAgentStatus, string> = {
  running: "running",
  blocked: "waiting",
  done: "done",
  failed: "failed",
};

// The label + tone for a worktree reconciliation outcome (once known).
const WORKTREE_OUTCOME: Record<
  NonNullable<AgentTreeNode["worktreeOutcome"]>,
  string
> = {
  merged: "merged",
  discarded: "discarded",
  conflict: "conflict",
};

function formatCost(n: number | null): string {
  return n == null ? "—" : `$${n.toFixed(4)}`;
}

// Sum a slot rollup's token classes into one figure for the compact per-slot row
// (the header carries the full per-class total; here a single number keeps the
// panel scannable).
function slotTokenTotal(usage: SlotUsage): number {
  const { uncachedInput, cachedInput, output, reasoning } = usage.tokens;
  return (
    (uncachedInput ?? 0) + (cachedInput ?? 0) + (output ?? 0) + (reasoning ?? 0)
  );
}

// An agent's identity card, shown on its Overview file in the Agents explorer: its
// id + status, its slot/model + depth, the brief it was dispatched with, a worktree
// indicator when it ran in an isolated worktree, and its return summary once it
// returned. Running / waiting / done / failed are the glanceable states, so the
// status chip leads. `role` marks the chosen best-of-K winner (its losing
// co-attempts read dimmed via `data-spec-role`).
export function AgentIdentity({
  node,
  role,
}: {
  node: AgentNode;
  role?: SpeculationRole;
}) {
  const isRoot = node.parentId == null;
  return (
    <div
      className={styles.agentRow}
      data-status={node.status}
      data-spec-role={role}
    >
      <div className={styles.agentHead}>
        <span className={styles.agentStatus} data-status={node.status}>
          <span className={styles.agentStatusDot} aria-hidden="true" />
          {STATUS_LABELS[node.status]}
        </span>
        <span className={styles.agentId}>{isRoot ? "root" : node.id}</span>
        {/* The chosen best-of-K winner: the attempt that was kept and merged. A
            losing attempt carries no badge — it is dimmed and shows its discarded
            worktree — so "K tried, this one won" reads at a glance. */}
        {role === "winner" && (
          <span className={styles.winnerBadge} title="chosen best-of-K attempt">
            ★ winner
          </span>
        )}
        {node.slot && (
          <span className={styles.agentSlot}>
            {node.slot}
            {node.modelId && (
              <span className={styles.agentModel}>{node.modelId}</span>
            )}
          </span>
        )}
        {node.depth != null && (
          <span className={styles.agentDepth}>depth {node.depth}</span>
        )}
        {node.worktree && (
          <span
            className={styles.agentWorktree}
            data-outcome={node.worktreeOutcome ?? "pending"}
            title={
              node.worktreeOutcome
                ? `worktree ${node.worktree} — ${WORKTREE_OUTCOME[node.worktreeOutcome]}`
                : `isolated worktree ${node.worktree}`
            }
          >
            ⑃ {node.worktree}
            {node.worktreeOutcome && (
              <span className={styles.agentWorktreeOutcome}>
                {WORKTREE_OUTCOME[node.worktreeOutcome]}
              </span>
            )}
          </span>
        )}
      </div>
      {node.brief && (
        <p className={styles.agentBrief} title={node.brief}>
          {node.brief}
        </p>
      )}
      {node.returnSummary && (
        <p className={styles.agentReturn}>
          <span className={styles.agentReturnLabel}>returned</span>
          {node.returnSummary}
        </p>
      )}
    </div>
  );
}

// The per-(slot, model) usage read-out: a gg run spans several models (one per
// slot), so cost is accounted per slot rather than as one figure. The header total
// is the sum of these rollups, so this is the breakdown behind that number.
export function SlotUsagePanel({ slotUsage }: { slotUsage: SlotUsage[] }) {
  // Resolve each slot's model id to its catalog display name (the run records the
  // slug); fall back to the id itself where the catalog is absent (a bare harness
  // context that never mounts the gallery provider) or the model is unknown.
  const findModel = useFindModelOptional();
  return (
    <section className={styles.agentSection}>
      <span className={styles.subPanelLabel}>Per-slot usage</span>
      <ul className={styles.slotList}>
        {slotUsage.map((usage) => {
          const modelName = findModel?.(usage.modelId)?.name ?? usage.modelId;
          return (
            <li
              key={`${usage.slot} ${usage.modelId}`}
              className={styles.slotRow}
            >
              {/* First line: the slot label and its cost. */}
              <span className={styles.slotName}>{usage.slot}</span>
              <span className={styles.slotCost}>
                {formatCost(usage.cost?.comparable ?? null)}
              </span>
              {/* Second line: the model's display name and its token total. */}
              <span className={styles.slotModel} title={usage.modelId}>
                {modelName}
              </span>
              <span className={styles.slotTokens}>
                {shortTokens(slotTokenTotal(usage))} tok
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// The declared-workflow strip: each workflow's stages in order, a fan-out boundary
// each. A stage reads as in-flight until its `finished` arrives; its item count is
// how many subagents it fanned out (those agents show as nodes in the tree above,
// so this just labels the stage structure).
export function WorkflowStrip({ workflows }: { workflows: Workflow[] }) {
  return (
    <section className={styles.agentSection}>
      <span className={styles.subPanelLabel}>Workflows</span>
      <div className={styles.workflowStrip}>
        {workflows.map((workflow) => (
          <div key={workflow.workflowId} className={styles.workflow}>
            <span className={styles.workflowId}>{workflow.workflowId}</span>
            <ol className={styles.workflowStages}>
              {workflow.stages.map((stage) => (
                <StageChip key={stage.stageIndex} stage={stage} />
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}

function StageChip({ stage }: { stage: WorkflowStage }) {
  return (
    <li className={styles.workflowStage} data-phase={stage.phase}>
      <span className={styles.workflowStageName}>{stage.stage}</span>
      <span className={styles.workflowStageItems}>×{stage.itemCount}</span>
    </li>
  );
}

// The speculation summary: one row per best-of-K speculation (see
// gg/speculative-execution). Each names its K (best-of-N), its lifecycle phase
// (fanned out → judged → merged), and the winning attempt once picked — so the
// "K tried, this one won and merged" shape is legible above the tree, where the
// attempt nodes (winner marked, losers dimmed) are drawn.
export function SpeculationPanel({
  speculations,
}: {
  speculations: SpeculationState[];
}) {
  return (
    <section className={styles.agentSection}>
      <span className={styles.subPanelLabel}>Speculation</span>
      <ul className={styles.specList}>
        {speculations.map((spec) => (
          <li key={spec.key} className={styles.specRow} data-phase={spec.phase}>
            <span className={styles.specAttempts}>best-of-{spec.attempts}</span>
            <span className={styles.specPhase}>
              {SPECULATION_PHASE_LABELS[spec.phase]}
            </span>
            {spec.winner ? (
              <span className={styles.specWinner}>
                <span className={styles.specWinnerLabel}>winner</span>
                <span className={styles.specWinnerId}>{spec.winner}</span>
              </span>
            ) : (
              // A `judged` with no winner: no attempt produced usable work.
              spec.phase !== "fanned_out" && (
                <span className={styles.specNoWinner}>no winner</span>
              )
            )}
            {spec.rationale && (
              <span className={styles.specRationale} title={spec.rationale}>
                {spec.rationale}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
