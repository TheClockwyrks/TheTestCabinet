// The reusable pieces of a multi-agent gg run's read-out. gg is headless, so an
// agent's identity (who it is, what it runs on, the worktree it works in, what it
// returned) and the run's delegation structure are the only window into its shape
// (see gg/subagents.md, gg/configurations.md).
//
// The subagent *tree* itself is drawn by the Instances explorer's filesystem sidebar
// (see GgAgentsExplorer), so this module no longer renders it; it exports the
// per-agent identity row the explorer shows on an agent's Overview and the run-level
// process strip it shows on the root's Overview. Per-slot spend is not
// here either: it is part of the Dashboard's Cost widget, which accounts the whole
// run's money per slot and per model (see GgOverviewWidgets).

import type {
  AgentNode,
  AgentTransition,
  AgentTreeNode,
  FsmVisit,
} from "./useGgRunState";
import { ROOT_ID, moduleFate } from "./useGgRunState";
import type { GgAgentStatus } from "@test-cabinet/run-record/gg";
import styles from "./GgPanels.module.scss";

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
  const fate = moduleFate(arrival.modules);
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
// agent is and what it ran on is a distinct pair from its lifecycle.
export function AgentIdentity({
  node,
  turns,
  arrival,
}: {
  node: AgentNode;
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
    <div className={styles.agentRow} data-status={node.status}>
      <div className={styles.agentHead}>
        <span className={styles.agentStatus} data-status={node.status}>
          <span className={styles.agentStatusDot} aria-hidden="true" />
          {STATUS_LABELS[node.status]}
        </span>
        <span className={styles.agentId}>{isRoot ? "root" : node.id}</span>
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
      {node.profileId && (
        <div className={styles.agentNameRow}>
          {/* The profile's name, with the id it is addressed by in the tooltip: two
              profiles may read alike, and this row has one line for both. */}
          <span className={styles.agentName} title={node.profileId}>
            {node.profile ?? node.profileId}
          </span>
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

// The path an FSM agent walked (see gg/fsms): one chip per state entered, in order,
// with the modules each transition carried between them. It is the run's process
// structure — a whole-run fact,
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
    // What ARRIVED live, which for a state chip is what the reader is after: a module
    // the successor started fresh on is a module the state did not receive.
    carried.set(
      transition.toAgentId,
      transition.modules
        .filter((entry) => entry.disposition === "carried")
        .map((entry) => entry.kind),
    );
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
            <span className={styles.workflowStageItems} title={visit.profileId}>
              {visit.profile}
            </span>
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
