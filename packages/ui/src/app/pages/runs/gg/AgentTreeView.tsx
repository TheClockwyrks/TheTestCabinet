// The reusable pieces of a multi-agent gg run's read-out. gg is headless, so an
// agent's identity (who it is, what it runs on, the worktree it works in, what it
// returned) and the run's delegation structure (declared workflows, best-of-K
// speculations) are the only window into its shape (see gg/subagents.md,
// gg/multi-model.md, gg/workflows.md, gg/speculative-execution.md).
//
// The subagent *tree* itself is drawn by the Instances explorer's filesystem sidebar
// (see GgAgentsExplorer), so this module no longer renders it; it exports the
// per-agent identity row the explorer shows on an agent's Overview, the run-level
// structure panels (workflows / speculation) it shows on the root's Overview, and the
// winner/loser classification the sidebar marks the tree with. Per-slot spend is not
// here either: it is part of the Dashboard's Cost widget, which accounts the whole
// run's money per slot and per model (see GgOverviewWidgets).

import type {
  AgentNode,
  AgentTransition,
  AgentTreeNode,
  FsmVisit,
  SpeculationState,
  Workflow,
  WorkflowStage,
} from "./useGgRunState";
import { ROOT_ID, moduleFate } from "./useGgRunState";
import type {
  GgAgentStatus,
  GgSpeculationPhase,
} from "@test-cabinet/run-record/gg";
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
  forest: AgentTreeNode[],
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
  forest.forEach(visit);
  return roles;
}

// --- Successions (exec / fork / FSM transitions) ------------------------------

// How an agent instance came into being, when it did not simply get spawned: keyed by
// the instance that arrived, so any surface holding an agent id can ask "how did this
// one start?" without re-walking the transition list.
//
// gg mints a fresh id per incarnation (the successor needs its own self-contained
// message pool), and a successor's parent is its predecessor — so without this map an
// `exec` reads as an agent that spawned a subagent and then stopped, which is precisely
// the wrong story about what happened.
export function classifyArrivals(
  transitions: AgentTransition[],
): Map<string, AgentTransition> {
  return new Map(transitions.map((t) => [t.toAgentId, t] as const));
}

// Whether an arrival is a **succession** — the same agent continuing under a new
// profile or in a new state — rather than a fork, which really is a second agent
// working beside the one that made it.
export function isSuccession(arrival: AgentTransition | undefined): boolean {
  return arrival != null && arrival.kind !== "fork";
}

// The short marker a lineage carries in the tree: which of the three kinds of
// succession produced this node, named the way the run's configuration names it — by
// the machine state it entered whenever it entered one, and by the move itself
// otherwise. An `exec` onto a process is the case that needs both: gg resolves such a
// handoff to the machine's entry state, so the arrival really is an exec *into* a
// named state and the tag says so rather than dropping half of it.
export function arrivalTag(arrival: AgentTransition): string {
  if (arrival.kind === "fork") return "⑂ fork";
  if (arrival.state) {
    return arrival.kind === "fsm"
      ? `⇢ ${arrival.state}`
      : `⇢ exec → ${arrival.state}`;
  }
  return arrival.kind === "fsm" ? "⇢ state" : "⇢ exec";
}

// The lineage line on an agent's identity card: where this instance came from, and
// what came with it. The module fate is the whole point — a successor that carried the
// conversation and one that started on an empty window are the same two ids otherwise.
function AgentArrival({ arrival }: { arrival: AgentTransition }) {
  const label =
    arrival.kind === "fork"
      ? "forked from"
      : arrival.kind === "fsm"
        ? "transitioned from"
        : "continued from";
  const fate = moduleFate(
    arrival.transferred,
    arrival.dropped,
    arrival.initialized,
  );
  return (
    <p className={styles.agentArrival}>
      <span className={styles.agentFieldLabel}>{label}</span>
      <span className={styles.agentArrivalFrom}>{arrival.fromAgentId}</span>
      {arrival.kind === "fsm" && arrival.state && (
        <span className={styles.agentArrivalState}>
          into <strong>{arrival.state}</strong>
        </span>
      )}
      {fate && <span className={styles.agentArrivalModules}>{fate}</span>}
    </p>
  );
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

// An agent's identity card, shown on its Overview file in the Instances explorer: its
// status + id, its depth/turns, its agent name + model, what it is waiting on while
// it is blocked, the working directory its tools are rooted at, the brief it was
// dispatched with, a worktree indicator when it ran in an isolated worktree, and its
// return summary once it returned. Running / waiting / done / failed are the glanceable
// states, so the status pill leads the top row beside the agent's instance id; the
// agent's name and the model it ran on read on their own line beneath, so who the
// agent is and what it ran on is a distinct pair from its lifecycle. `role` marks the
// chosen best-of-K winner (its losing co-attempts read dimmed via `data-spec-role`).
export function AgentIdentity({
  node,
  role,
  turns,
  arrival,
}: {
  node: AgentNode;
  role?: SpeculationRole;
  /**
   * How many turns this agent took — one per model request/response cycle. Shown as
   * a chip beside the depth when provided (on an agent's Overview, which knows the
   * agent's reduced slice); omitted where only the tree node is in hand.
   */
  turns?: number;
  /**
   * The succession this instance arrived by — an `exec`, a `fork`, or a move into a
   * machine state — when it arrived by one rather than being spawned. It carries what
   * each module did, which is the difference between continuing an agent's work and
   * starting a fresh one under a new name.
   */
  arrival?: AgentTransition;
}) {
  // Only the main agent is "root" — a board-dispatched issue agent is parentless too
  // (it is its own top-level tree in the run's forest) but reads by its own
  // issue-derived id, which is exactly what names the work it was dispatched for.
  const isRoot = node.id === ROOT_ID;
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
        {node.depth != null && (
          <span className={styles.agentDepth}>depth {node.depth}</span>
        )}
        {node.depth != null && turns != null && (
          <span className={styles.agentMetaSep} aria-hidden="true">
            ·
          </span>
        )}
        {turns != null && (
          <span className={styles.agentTurns}>
            {turns} turn{turns === 1 ? "" : "s"}
          </span>
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
      {/* The agent's name and the model it ran on, on their own line beneath the
          status + instance id — a dot separates the two the way depth · turns is
          joined above. */}
      {node.slot && (
        <div className={styles.agentNameRow}>
          <span className={styles.agentName}>{node.slot}</span>
          {node.modelId && (
            <>
              <span className={styles.agentMetaSep} aria-hidden="true">
                ·
              </span>
              <span className={styles.agentModel}>{node.modelId}</span>
            </>
          )}
        </div>
      )}
      {/* Where this instance came from, when it did not simply get spawned — the line
          that turns two consecutive ids into one lineage. */}
      {arrival && <AgentArrival arrival={arrival} />}
      {/* What the agent is blocked on, while it is blocked. "waiting" alone reads the
          same as stuck; the condition is what says the run is making progress
          elsewhere and this agent is parked on it. */}
      {node.status === "blocked" && node.waitingOn && (
        <p className={styles.agentWaiting}>
          <span className={styles.agentFieldLabel}>waiting on</span>
          {node.waitingOn}
        </p>
      )}
      {/* Where the agent's tools are rooted — the directory a command it runs without
          a path executes in. On a worktree-isolated agent this is its private
          checkout, so it says on disk what the branch chip says in git. */}
      {node.cwd && (
        <p className={styles.agentCwd} title={node.cwd}>
          <span className={styles.agentFieldLabel}>cwd</span>
          <span className={styles.agentCwdPath}>{node.cwd}</span>
        </p>
      )}
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

// The path an FSM agent walked (see gg/fsms): one chip per state entered, in order,
// with the modules each transition carried between them. It is the run's process
// structure the way the workflow strip is its fan-out structure — a whole-run fact,
// so it reads on the main agent, and it is what turns N incarnations with N different
// ids into one legible lineage.
export function FsmPathStrip({
  path,
  transitions,
}: {
  path: FsmVisit[];
  transitions: AgentTransition[];
}) {
  // What each transition carried, keyed by the successor it produced — so a state chip
  // can say what arrived with it rather than leaving the reader to pair two streams.
  const carried = new Map<string, string[]>();
  for (const transition of transitions) {
    carried.set(transition.toAgentId, transition.transferred);
  }
  return (
    <section className={styles.agentSection}>
      <span className={styles.subPanelLabel}>
        Process{path[0] ? ` · ${path[0].fsm}` : ""}
      </span>
      <ol className={styles.workflowStages}>
        {path.map((visit) => (
          <li key={visit.agentId} className={styles.workflowStage}>
            <span className={styles.workflowStageName}>{visit.state}</span>
            <span className={styles.workflowStageItems}>{visit.agent}</span>
            {(carried.get(visit.agentId)?.length ?? 0) > 0 && (
              <span className={styles.workflowStageItems}>
                +{carried.get(visit.agentId)!.join(" +")}
              </span>
            )}
          </li>
        ))}
      </ol>
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
