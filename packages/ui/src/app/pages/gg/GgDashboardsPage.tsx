// **Dashboards** — the boards list, and the editor that makes one.
//
// The built-in overview sits at the top, read-only, exactly as the built-in gg
// configurations sit above the saved ones on the account's gg Configs tab: shared,
// not editable in place, and duplicated into an account's own board when someone
// wants to change it.
// It is defined as ordinary query text (`overviewDashboard.ts`) and rendered by the same
// view page a saved board is, so it cannot silently rot the way a hardcoded breakdown did.
//
// Saved boards are **per-account** — the corpus they query is not. That asymmetry is the
// whole saved-object model (owner decision Q3): a gg run belongs to the deployment, a
// question about it belongs to whoever asked it.
//
// The editor is deliberately a plain form rather than a drag-and-drop canvas. A panel is a
// title, a query and a width; a grid position that is not a width is a thing to maintain,
// and the twelve-column flow already lays a board out sensibly from widths alone.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import type {
  GgDashboard,
  GgDashboardInput,
  GgDashboardPanel,
} from "@test-cabinet/run-record/gg-query";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { routes } from "../../routes";
import { OVERVIEW_DASHBOARD } from "./dashboards/overviewDashboard";
import { TIME_RANGES } from "./discover/TimeRangePicker";
import { GG_CHROME } from "./ggChrome";
import styles from "./dashboards/GgDashboards.module.scss";
import { SubmitNotice } from "../../components/SubmitNotice";
import exec from "../runs/RunExec.module.scss";

/** A board's starting shape in the editor: one empty panel, because a board with no
 *  panels teaches nobody what a panel is. */
function blankBoard(): GgDashboardInput {
  return {
    name: "",
    description: "",
    rangeId: "all",
    panels: [{ title: "", query: "", width: 6 }],
  };
}

export function GgDashboardsPage() {
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const [boards, setBoards] = useState<GgDashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // `null` when no editor is open; otherwise the draft, with `editing` naming the board
  // it will replace (or `null` for a create).
  const [draft, setDraft] = useState<GgDashboardInput | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const list = backend?.listGgDashboards;
  const reload = useCallback(async () => {
    if (!list || !token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setBoards(await list(token));
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [list, token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(async () => {
    if (!draft || !token) return;
    setBusy(true);
    setError(null);
    try {
      if (editing && backend?.updateGgDashboard) {
        await backend.updateGgDashboard(editing, draft, token);
      } else if (backend?.createGgDashboard) {
        await backend.createGgDashboard(draft, token);
      }
      setDraft(null);
      setEditing(null);
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [backend, draft, editing, token, reload]);

  const remove = useCallback(
    async (board: GgDashboard) => {
      if (!backend?.deleteGgDashboard || !token) return;
      if (!window.confirm(`Delete the dashboard “${board.name}”?`)) return;
      setBusy(true);
      try {
        await backend.deleteGgDashboard(board.id, token);
        await reload();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [backend, token, reload],
  );

  /** Open the editor on a copy of an existing board — the same path "Duplicate the
   *  built-in overview" takes, which is the only way to make the overview yours. */
  const edit = (board: GgDashboard, id: string | null) => {
    setDraft({
      name: id ? board.name : `${board.name} (copy)`,
      description: board.description,
      rangeId: board.rangeId,
      panels: board.panels.map((panel) => ({ ...panel })),
    });
    setEditing(id);
  };

  const patchPanel = (index: number, patch: Partial<GgDashboardPanel>) =>
    setDraft((current) =>
      current
        ? {
            ...current,
            panels: current.panels.map((panel, i) =>
              i === index ? { ...panel, ...patch } : panel,
            ),
          }
        : current,
    );

  return (
    <PageLayout chrome={GG_CHROME}>
      <PromptHeader
        command="--gg dashboards"
        comment={<>// boards of saved questions, one range each</>}
        titleActions={
          token && !draft ? (
            <button
              type="button"
              className={exec.primary}
              onClick={() => {
                setDraft(blankBoard());
                setEditing(null);
              }}
            >
              + New dashboard
            </button>
          ) : undefined
        }
      />

      <SubmitNotice message={error} />

      {draft && (
        <div className={styles.form}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Name</span>
            <input
              className={styles.input}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Description</span>
            <input
              className={styles.input}
              value={draft.description}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Range (the whole board's)</span>
            <select
              className={styles.select}
              value={draft.rangeId}
              onChange={(e) => setDraft({ ...draft, rangeId: e.target.value })}
            >
              {TIME_RANGES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <p className={styles.fieldLabel}>
            Panels — a title, TCQ text, and how many of the twelve columns it
            spans.
          </p>
          {draft.panels.map((panel, index) => (
            <div className={styles.panelRow} key={index}>
              <input
                className={styles.input}
                aria-label={`Panel ${index + 1} title`}
                placeholder="Title"
                value={panel.title}
                onChange={(e) => patchPanel(index, { title: e.target.value })}
              />
              <input
                className={styles.queryInput}
                aria-label={`Panel ${index + 1} query`}
                placeholder="| stats count() by model"
                value={panel.query}
                onChange={(e) => patchPanel(index, { query: e.target.value })}
              />
              <input
                className={styles.input}
                aria-label={`Panel ${index + 1} width`}
                type="number"
                min={1}
                max={12}
                value={panel.width}
                onChange={(e) =>
                  patchPanel(index, { width: Number(e.target.value) || 1 })
                }
              />
              <button
                type="button"
                className={exec.secondary}
                onClick={() =>
                  setDraft({
                    ...draft,
                    panels: draft.panels.filter((_, i) => i !== index),
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}

          <div className={styles.formActions}>
            <button
              type="button"
              className={exec.secondary}
              onClick={() =>
                setDraft({
                  ...draft,
                  panels: [...draft.panels, { title: "", query: "", width: 6 }],
                })
              }
            >
              Add panel
            </button>
            <button
              type="button"
              className={exec.primary}
              disabled={busy}
              onClick={() => void save()}
            >
              {editing ? "Save dashboard" : "Create dashboard"}
            </button>
            <button
              type="button"
              className={exec.secondary}
              onClick={() => {
                setDraft(null);
                setEditing(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <p className={exec.sectionLabel}>Built-in</p>
      <div className={styles.list}>
        <div className={styles.rowCard}>
          <div className={styles.rowMain}>
            <Link
              className={styles.rowTitleLink}
              to={routes.ggAnalysisDashboard(OVERVIEW_DASHBOARD.id)}
            >
              {OVERVIEW_DASHBOARD.name}
            </Link>
            <span className={styles.rowSub}>
              {OVERVIEW_DASHBOARD.description} ·{" "}
              {OVERVIEW_DASHBOARD.panels.length} panels
            </span>
          </div>
          <span className={styles.rowActions}>
            {token && (
              <button
                type="button"
                className={exec.secondary}
                onClick={() => edit(OVERVIEW_DASHBOARD, null)}
              >
                Duplicate
              </button>
            )}
          </span>
        </div>
      </div>

      <p className={exec.sectionLabel}>Your dashboards</p>
      {!token ? (
        <p className={`${exec.notice} ${exec.warn}`}>
          Sign in to save your own dashboards — they are kept on your account.
          The built-in board above queries the same deployment-wide corpus
          either way.
        </p>
      ) : loading ? (
        <p className={styles.empty}>Loading dashboards…</p>
      ) : boards.length === 0 ? (
        <p className={styles.empty}>
          No dashboards yet. Duplicate the built-in overview to start from
          something that already works.
        </p>
      ) : (
        <div className={styles.list}>
          {boards.map((board) => (
            <div className={styles.rowCard} key={board.id}>
              <div className={styles.rowMain}>
                <Link
                  className={styles.rowTitleLink}
                  to={routes.ggAnalysisDashboard(board.id)}
                >
                  {board.name}
                </Link>
                <span className={styles.rowSub}>
                  {board.description ? `${board.description} · ` : ""}
                  {board.panels.length}{" "}
                  {board.panels.length === 1 ? "panel" : "panels"}
                </span>
              </div>
              <span className={styles.rowActions}>
                <button
                  type="button"
                  className={exec.secondary}
                  onClick={() => edit(board, board.id)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={exec.secondary}
                  onClick={() => edit(board, null)}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className={exec.danger}
                  disabled={busy}
                  onClick={() => void remove(board)}
                >
                  Delete
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </PageLayout>
  );
}
