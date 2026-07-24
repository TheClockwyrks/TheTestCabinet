// The Agents panel: the signature Phase-4 view of a multi-agent gg run. gg is
// headless, so this live tree — who spawned whom, and who is running versus
// blocked waiting on their subagents — is the only window into the run's
// delegation shape (see gg/subagents.md). Alongside the tree it shows the two
// other things a multi-agent run needs that a single-model view cannot express:
// the per-(slot, model) usage/cost breakdown (a gg run spans several models, one
// per slot, so there is no single figure — see gg/multi-model.md) and the
// declared-workflow stage structure (fan-out + sequencing — see gg/workflows.md).
//
// Everything reads from `GgRunState`: `agentTree` (always rooted at "root", so a
// single-agent run is a one-node tree), `slotUsage` (latest rollup per pair, empty
// on a single-model run), and `workflows` (empty when no workflow ran).

import type {
  AgentTreeNode,
  SlotUsage,
  Workflow,
  WorkflowStage,
} from "./useGgRunState";
import { shortTokens } from "./useGgRunState";
import type { GgAgentStatus } from "@test-cabinet/run-record/gg";
import styles from "./GgPanels.module.scss";

interface AgentTreeViewProps {
  tree: AgentTreeNode;
  slotUsage: SlotUsage[];
  workflows: Workflow[];
}

// The human label for an agent's lifecycle status. `blocked` is called out as
// "waiting" because that is the state that matters at a glance in a multi-agent
// run — an agent that has released its slot and is waiting on its subagents.
const STATUS_LABELS: Record<GgAgentStatus, string> = {
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

export function AgentTreeView({
  tree,
  slotUsage,
  workflows,
}: AgentTreeViewProps) {
  // A single-agent run is just the root with no children; say so plainly rather
  // than drawing a one-node "tree" with no context.
  const soloRun = tree.children.length === 0;

  return (
    <div className={styles.agents}>
      {workflows.length > 0 && <WorkflowStrip workflows={workflows} />}

      <section className={styles.agentSection}>
        <span className={styles.subPanelLabel}>Agent tree</span>
        {soloRun ? (
          <p className={styles.empty}>
            A single agent so far — the root agent is working on the main tree.
            As it delegates, spawned subagents (and their models and worktrees)
            join the tree here.
          </p>
        ) : (
          <ul className={styles.agentTree}>
            <AgentBranch node={tree} />
          </ul>
        )}
      </section>

      {slotUsage.length > 0 && <SlotUsagePanel slotUsage={slotUsage} />}
    </div>
  );
}

// One node of the tree and its children, rendered as a nested list so the
// parent/child nesting reads as connected rows (the nested `<ul>` carries the
// connector rule).
function AgentBranch({ node }: { node: AgentTreeNode }) {
  return (
    <li className={styles.agentBranch}>
      <AgentRow node={node} />
      {node.children.length > 0 && (
        <ul className={styles.agentChildren}>
          {node.children.map((child) => (
            <AgentBranch key={child.id} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

// A single agent node: its id + status, its slot/model + depth, the brief it was
// dispatched with, a worktree indicator when it ran in an isolated worktree, and
// its return summary once it returned. Running / waiting / done / failed are the
// glanceable states, so the status chip leads.
function AgentRow({ node }: { node: AgentTreeNode }) {
  const isRoot = node.parentId == null;
  return (
    <div className={styles.agentRow} data-status={node.status}>
      <div className={styles.agentHead}>
        <span className={styles.agentStatus} data-status={node.status}>
          <span className={styles.agentStatusDot} aria-hidden="true" />
          {STATUS_LABELS[node.status]}
        </span>
        <span className={styles.agentId}>{isRoot ? "root" : node.id}</span>
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
function SlotUsagePanel({ slotUsage }: { slotUsage: SlotUsage[] }) {
  return (
    <section className={styles.agentSection}>
      <span className={styles.subPanelLabel}>Per-slot usage</span>
      <ul className={styles.slotList}>
        {slotUsage.map((usage) => (
          <li key={`${usage.slot} ${usage.modelId}`} className={styles.slotRow}>
            <span className={styles.slotName}>{usage.slot}</span>
            <span className={styles.slotModel}>{usage.modelId}</span>
            <span className={styles.slotTokens}>
              {shortTokens(slotTokenTotal(usage))} tok
            </span>
            <span className={styles.slotCost}>
              {formatCost(usage.cost?.comparable ?? null)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// The declared-workflow strip: each workflow's stages in order, a fan-out boundary
// each. A stage reads as in-flight until its `finished` arrives; its item count is
// how many subagents it fanned out (those agents show as nodes in the tree above,
// so this just labels the stage structure).
function WorkflowStrip({ workflows }: { workflows: Workflow[] }) {
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
