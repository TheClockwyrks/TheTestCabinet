// The tasks panel: the model's lightweight to-do list rendered as the live
// blocked-by DAG (see gg/tasks.md). Rather than a fragile custom graph layout, we
// render a dependency-aware grouping — tasks bucketed by their live state (in
// progress / ready / blocked / done) in add order within each bucket — which
// reads the plan's shape at a glance while naming the exact edges that hold a task
// back. A task is READY when it is not done and every blocker is done; BLOCKED
// when a blocker is still incomplete (matching gg's backend semantics), and
// ACTIVE when it is the one being worked (status `in_progress`).

import type { GgTaskEntry } from "@clockwyrks/run-record/gg";
import styles from "./GgPanels.module.scss";

interface TaskDagViewProps {
  tasks: GgTaskEntry[];
}

// The live state of a task: derived from its status and the completion of its
// blockers, not stored. `blocked` names the reason (its incomplete blockers).
type TaskState = "active" | "ready" | "blocked" | "done";

// Derive a task's live state and its still-incomplete blockers. A done task is
// done; otherwise an incomplete blocker makes it blocked, an in-progress status
// makes it active, and everything else is ready to be picked up.
function derive(
  task: GgTaskEntry,
  byId: Map<string, GgTaskEntry>,
): { state: TaskState; incomplete: string[] } {
  if (task.status === "done") return { state: "done", incomplete: [] };
  const incomplete = task.blockedBy.filter(
    (id) => byId.get(id)?.status !== "done",
  );
  if (incomplete.length) return { state: "blocked", incomplete };
  return {
    state: task.status === "in_progress" ? "active" : "ready",
    incomplete: [],
  };
}

// The buckets, in the order they are shown: what's happening now, then what can be
// picked up, then what's waiting, then what's finished.
const GROUP_ORDER: readonly TaskState[] = [
  "active",
  "ready",
  "blocked",
  "done",
];
const GROUP_LABELS: Record<TaskState, string> = {
  active: "In progress",
  ready: "Ready",
  blocked: "Blocked",
  done: "Done",
};

export function TaskDagView({ tasks }: TaskDagViewProps) {
  if (tasks.length === 0) {
    return (
      <p className={styles.empty}>
        No tasks yet. The model builds its to-do list as it plans, and the tasks
        capability streams it here.
      </p>
    );
  }

  const byId = new Map(tasks.map((t) => [t.id, t]));

  // Bucket in a single pass, preserving add order inside each bucket.
  const groups: Record<TaskState, GgTaskEntry[]> = {
    active: [],
    ready: [],
    blocked: [],
    done: [],
  };
  for (const task of tasks) groups[derive(task, byId).state].push(task);

  return (
    <div className={styles.taskGroups}>
      {GROUP_ORDER.filter((state) => groups[state].length > 0).map((state) => (
        <section key={state} className={styles.taskGroup}>
          <h3 className={styles.taskGroupHead}>
            {GROUP_LABELS[state]}
            <span className={styles.taskGroupCount}>
              {groups[state].length}
            </span>
          </h3>
          <ul className={styles.taskList}>
            {groups[state].map((task) => {
              const { incomplete } = derive(task, byId);
              return (
                <li
                  key={task.id}
                  className={styles.taskRow}
                  data-task-state={state}
                >
                  <span className={styles.taskBadge} data-task-state={state}>
                    {state}
                  </span>
                  <div className={styles.taskBody}>
                    <div className={styles.taskHead}>
                      <span
                        className={styles.taskTitle}
                        data-status={task.status}
                      >
                        {task.title}
                      </span>
                      <span className={styles.taskId}>{task.id}</span>
                    </div>
                    {task.description && (
                      <span className={styles.taskDesc}>
                        {task.description}
                      </span>
                    )}
                    {task.blockedBy.length > 0 && (
                      <Blockers
                        task={task}
                        byId={byId}
                        incomplete={new Set(incomplete)}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

// The blocked-by edges of one task, as named chips. Each blocker shows whether it
// is satisfied (done) or still outstanding, so the reason a task cannot start is
// legible without drawing the graph. The label reads "blocked by" while any edge
// is outstanding, and "depends on" once they are all satisfied.
function Blockers({
  task,
  byId,
  incomplete,
}: {
  task: GgTaskEntry;
  byId: Map<string, GgTaskEntry>;
  incomplete: Set<string>;
}) {
  const anyOutstanding = incomplete.size > 0;
  return (
    <div className={styles.taskBlockers}>
      <span className={styles.taskBlockersLabel}>
        {anyOutstanding ? "blocked by" : "depends on"}
      </span>
      <span className={styles.taskBlockerChips}>
        {task.blockedBy.map((id) => {
          const done = !incomplete.has(id);
          return (
            <span
              key={id}
              className={styles.taskBlocker}
              data-done={done ? "" : undefined}
            >
              {done ? "✓ " : ""}
              {byId.get(id)?.title ?? id}
            </span>
          );
        })}
      </span>
    </div>
  );
}
