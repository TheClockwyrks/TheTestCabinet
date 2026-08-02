// **Saved** — the operator's saved TCQ queries.
//
// A saved query stores its **source text**, not a compiled query. Two things follow, and
// both are why the text is the stored form:
//
// - A relative `started >= now-30d` stays relative. The question re-resolves every time it
//   is opened, instead of freezing the window it happened to be written in.
// - A later grammar addition can never invalidate a stored query, because nothing stored
//   is in the compiled shape the grammar produces.
//
// Saving happens **from Discover**, not here: the editor with its completer, its field
// sidebar and its live diagnostics is the place a question gets composed, so Discover's
// Save control navigates here with `?new=1&q=…&range=…` and this page's form opens
// prefilled. That keeps exactly one query editor in the console and one place a name is
// typed. The plain text input on this page is for adjusting a saved question in place —
// "Open in Discover" is one click away when it needs the real editor.
//
// Per-account, like the gg configurations and the coverage plans, over a corpus that is
// not (owner decision Q3): shared data, private views.
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type {
  GgSavedQuery,
  GgSavedQueryInput,
} from "@test-cabinet/run-record/gg-query";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { routes } from "../../routes";
import { TIME_RANGES, rangeById } from "./discover/TimeRangePicker";
import { GG_CHROME } from "./ggChrome";
import styles from "./dashboards/GgDashboards.module.scss";
import exec from "../runs/RunExec.module.scss";

export function GgSavedQueriesPage() {
  const [params, setParams] = useSearchParams();
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const [saved, setSaved] = useState<GgSavedQuery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<GgSavedQueryInput | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const list = backend?.listGgSavedQueries;
  const reload = useCallback(async () => {
    if (!list || !token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setSaved(await list(token));
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

  // Arriving from Discover's Save control. The parameters are consumed once and stripped
  // from the URL, so a reload after saving does not reopen the form on a question that is
  // already stored.
  useEffect(() => {
    if (params.get("new") !== "1") return;
    setDraft({
      name: "",
      description: "",
      query: params.get("q") ?? "",
      rangeId: rangeById(params.get("range")).id,
    });
    setEditing(null);
    const next = new URLSearchParams(params);
    next.delete("new");
    next.delete("q");
    next.delete("range");
    setParams(next, { replace: true });
  }, [params, setParams]);

  const save = useCallback(async () => {
    if (!draft || !token) return;
    setBusy(true);
    setError(null);
    try {
      if (editing && backend?.updateGgSavedQuery) {
        await backend.updateGgSavedQuery(editing, draft, token);
      } else if (backend?.createGgSavedQuery) {
        await backend.createGgSavedQuery(draft, token);
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
    async (query: GgSavedQuery) => {
      if (!backend?.deleteGgSavedQuery || !token) return;
      if (
        !window.confirm(
          `Delete the saved query “${query.name}”? Dashboards built from it keep ` +
            `their own copy of the text.`,
        )
      ) {
        return;
      }
      setBusy(true);
      try {
        await backend.deleteGgSavedQuery(query.id, token);
        await reload();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [backend, token, reload],
  );

  return (
    <PageLayout chrome={GG_CHROME}>
      <div className={exec.runsHeader}>
        <PromptHeader
          command="--gg saved"
          comment={<>// questions worth keeping</>}
        />
        {token && !draft && (
          <Link className={exec.primary} to={routes.ggAnalysisDiscover()}>
            Compose in Discover
          </Link>
        )}
      </div>

      {error && <p className={`${exec.notice} ${exec.error}`}>{error}</p>}

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
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Query</span>
            <input
              className={styles.queryInput}
              value={draft.query}
              placeholder="| stats count() by model"
              onChange={(e) => setDraft({ ...draft, query: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Range</span>
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
          <div className={styles.formActions}>
            <button
              type="button"
              className={exec.primary}
              disabled={busy}
              onClick={() => void save()}
            >
              {editing ? "Save query" : "Save new query"}
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

      {!token ? (
        <p className={`${exec.notice} ${exec.warn}`}>
          Sign in to save queries — they are kept on your account. The corpus they run
          over is deployment-wide either way.
        </p>
      ) : loading ? (
        <p className={styles.empty}>Loading saved queries…</p>
      ) : saved.length === 0 ? (
        <p className={styles.empty}>
          Nothing saved yet. Compose a question in Discover and use its Save control —
          the text comes across, so a relative range stays relative.
        </p>
      ) : (
        <div className={styles.list}>
          {saved.map((query) => (
            <div className={styles.rowCard} key={query.id}>
              <div className={styles.rowMain}>
                <Link
                  className={styles.rowTitleLink}
                  to={routes.ggAnalysisDiscover(query.query, {
                    range: query.rangeId,
                  })}
                >
                  {query.name}
                </Link>
                {query.description && (
                  <span className={styles.rowSub}>{query.description}</span>
                )}
                <span className={styles.rowQuery}>
                  {query.query || "(every session)"}
                </span>
              </div>
              <span className={styles.rowActions}>
                <button
                  type="button"
                  className={exec.secondary}
                  onClick={() => {
                    setDraft({
                      name: query.name,
                      description: query.description,
                      query: query.query,
                      rangeId: query.rangeId,
                    });
                    setEditing(query.id);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={exec.danger}
                  disabled={busy}
                  onClick={() => void remove(query)}
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
