// The tasks panel: the model's lightweight to-do list. Design intent (see
// gg/tasks.md) is the live blocked-by DAG — a task is READY when it is not done
// and every blocker is done, otherwise BLOCKED by its incomplete blockers. This
// stub renders the tasks as a flat, add-order list with their status and readiness;
// the DAG layout lands in a later stage, fed by the same `tasks`.

import type { GgTaskEntry } from "@test-cabinet/run-record/gg";
import styles from "./GgPanels.module.scss";

interface TaskDagViewProps {
  tasks: GgTaskEntry[];
}

// A task is ready when it is not done and every blocker is done; otherwise it is
// blocked by its still-incomplete blockers.
function readiness(
  task: GgTaskEntry,
  byId: Map<string, GgTaskEntry>,
): { state: "done" | "ready" | "blocked"; blockers: string[] } {
  if (task.status === "done") return { state: "done", blockers: [] };
  const blockers = task.blockedBy.filter((id) => byId.get(id)?.status !== "done");
  return { state: blockers.length ? "blocked" : "ready", blockers };
}

export function TaskDagView({ tasks }: TaskDagViewProps) {
  if (tasks.length === 0) {
    return (
      <p className={styles.empty}>
        No tasks yet — the model builds its to-do list as it plans, and the tasks
        capability streams it here.
      </p>
    );
  }

  const byId = new Map(tasks.map((t) => [t.id, t]));

  return (
    <ul className={styles.taskList}>
      {tasks.map((task) => {
        const { state, blockers } = readiness(task, byId);
        return (
          <li key={task.id} className={styles.taskRow} data-task-state={state}>
            <span className={styles.taskBadge} data-task-state={state}>
              {state}
            </span>
            <div className={styles.taskBody}>
              <span className={styles.taskTitle} data-status={task.status}>
                {task.title}
              </span>
              {task.description && (
                <span className={styles.taskDesc}>{task.description}</span>
              )}
              {blockers.length > 0 && (
                <span className={styles.taskBlockers}>
                  blocked by{" "}
                  {blockers
                    .map((id) => byId.get(id)?.title ?? id)
                    .join(", ")}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
