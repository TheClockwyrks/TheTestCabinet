// **Discover** — the gg analysis query surface.
//
// One filter row (the time range), the editor, the field sidebar, and either the matching
// **documents** or the aggregated **buckets**. Which of the two is shown is not a
// preference: a query either has a `stats` stage or it does not, so the result shape
// follows from the query rather than from a toggle. An aggregated result gets its
// visualization *above* the bucket table rather than instead of it — a chart drops what
// it cannot honestly draw, so the table underneath is always reachable and is the record.
//
// Three pieces of state, and each lives exactly where it does for a reason:
//
// - **The query text is in the URL**, as text and never as its compiled form. That keeps
//   the property the surface this replaces got right — the URL *is* the query, pasteable
//   into an issue — and it keeps a relative `now-30d` relative, so a link shared on Monday
//   still means "the last thirty days" on Friday.
// - **The range is beside it**, not inside the text, because a dashboard has one range for
//   a whole board and because a range is the thing people change while leaving the
//   question alone.
// - **The compiled query is derived and never stored.** The client owns the parser; the
//   backend only ever sees absolute milliseconds and needs no clock of its own.
//
// The query runs when it is submitted, not on every keystroke: validation and completion
// are live, evaluation is not. A corpus-wide scan per character typed would be a
// self-inflicted load test, and a result list that reshuffles under a half-typed clause is
// harder to read than one that waits.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type {
  GgFieldCatalog,
  GgQuery,
  GgQueryResponse,
} from "@test-cabinet/run-record/gg-query";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import { compileQuery, parseQuery } from "./query";
import { GgBucketTable } from "./discover/GgBucketTable";
import { GgDocTable } from "./discover/GgDocTable";
import { GgFieldSidebar } from "./discover/GgFieldSidebar";
import { GgVizPanel } from "./discover/GgVizPanel";
import { QueryEditor } from "./discover/QueryEditor";
import {
  DEFAULT_RANGE,
  TimeRangePicker,
  rangeById,
  rangeFilter,
} from "./discover/TimeRangePicker";
import { GG_CHROME } from "./ggChrome";
import { routes } from "../../routes";
import styles from "./discover/GgDiscover.module.scss";

/** An empty catalog — what the sidebar and the completer read before the fields land, and
 *  on a transport that has no `/gg/fields` at all. */
const EMPTY_CATALOG: GgFieldCatalog = { documents: 0, fields: [] };

/** The result of an empty corpus, so the page renders its frame rather than nothing while
 *  the first query is in flight. */
const EMPTY_RESULT: GgQueryResponse = { totalRuns: 0, truncated: false };

/**
 * The query Discover opens on: every recorded session, newest first.
 *
 * Deliberately the document view rather than an aggregation. The first question anyone has
 * of a corpus is "what is in it", and an empty editor teaches nothing — this one shows a
 * result *and* shows that an empty filter is legal, which is the language's least obvious
 * rule.
 */
const DEFAULT_QUERY = "";

export function GgDiscoverPage() {
  const [params, setParams] = useSearchParams();
  const { token } = useAuth();
  const { client: backend } = useBackend();

  const urlQuery = params.get("q") ?? DEFAULT_QUERY;
  const range = rangeById(params.get("range"));

  // The draft is what the editor holds; the URL holds what was last run. They differ
  // exactly while an operator is typing, which is what makes the back button useful.
  const [draft, setDraft] = useState(urlQuery);
  const [catalog, setCatalog] = useState<GgFieldCatalog>(EMPTY_CATALOG);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [result, setResult] = useState<GgQueryResponse>(EMPTY_RESULT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A link opened, or the back button pressed: the URL is the source of truth for what
  // ran, so the draft follows it.
  useEffect(() => setDraft(urlQuery), [urlQuery]);

  const parse = useMemo(() => parseQuery(urlQuery), [urlQuery]);
  const draftParse = useMemo(() => parseQuery(draft), [draft]);

  // Compiled from what the URL carries, not from the draft, so the result on screen always
  // matches the address bar. `now` is read here — once per submitted query — which is what
  // makes a saved relative range re-resolve on every run.
  const compiled = useMemo<GgQuery>(() => {
    const query = compileQuery(parse.query);
    const scope = rangeFilter(range, Date.now());
    if (!scope) return query;
    return {
      ...query,
      filter: query.filter
        ? { kind: "and", clauses: [scope, query.filter] }
        : scope,
    };
  }, [parse.query, range]);

  const fetchFields = backend?.getGgFields;
  useEffect(() => {
    if (!fetchFields || !token) {
      setCatalogLoading(false);
      return;
    }
    let active = true;
    setCatalogLoading(true);
    fetchFields(token)
      .then((fields) => {
        if (!active) return;
        setCatalog(fields);
        setCatalogLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setCatalog(EMPTY_CATALOG);
        setCatalogLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchFields, token]);

  const runQuery = backend?.runGgQuery;
  useEffect(() => {
    if (!runQuery || !token) return;
    let active = true;
    setBusy(true);
    setError(null);
    runQuery(compiled, token)
      .then((response) => {
        if (!active) return;
        setResult(response);
        setBusy(false);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setResult(EMPTY_RESULT);
        setError(String(e));
        setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [runQuery, token, compiled]);

  /** Commit the draft: the URL is what runs, so submitting is a navigation. */
  const submit = useCallback(() => {
    const next = new URLSearchParams(params);
    if (draft.trim()) next.set("q", draft);
    else next.delete("q");
    setParams(next, { replace: false });
  }, [draft, params, setParams]);

  const setRange = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params);
      if (id === DEFAULT_RANGE.id) next.delete("range");
      else next.set("range", id);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  // Inserting from the sidebar appends to the draft with a separating space, because the
  // caret is in the editor and the sidebar is not the editor — trying to splice at a caret
  // the sidebar cannot see would be a guess.
  const insert = useCallback((text: string) => {
    setDraft((current) =>
      current && !current.endsWith(" ") ? `${current} ${text}` : `${current}${text}`,
    );
  }, []);

  // Read off the *response*, not the query: an aggregated result is the one that came
  // back with columns, and a query whose `stats` stage is still being typed compiles
  // without one.
  const aggregated = (result.columns?.length ?? 0) > 0;

  return (
    <PageLayout chrome={GG_CHROME}>
      <PromptHeader
        command="--gg query"
        comment={<>// find sessions, or aggregate over them</>}
      />

      <div className={styles.layout}>
        <GgFieldSidebar catalog={catalog} onInsert={insert} loading={catalogLoading} />

        <div className={styles.main}>
          <div className={styles.controls}>
            <TimeRangePicker value={range} onChange={(next) => setRange(next.id)} />
            {/* Saving carries the **text** and the range token, never the compiled
                query, so the saved question re-resolves `now-30d` every time it runs.
                It hands off to the Saved tab's form rather than opening a second
                editor here: one editor, one place a name is typed. */}
            <Link
              className={styles.savedLink}
              to={routes.ggAnalysisSaved({
                create: { query: urlQuery, range: range.id },
              })}
            >
              Save this query
            </Link>
          </div>

          <QueryEditor
            value={draft}
            onChange={setDraft}
            onSubmit={submit}
            parse={draftParse}
            catalog={catalog}
            interval={range.interval}
            busy={busy}
          />

          <p className={styles.summary}>
            {error ? (
              <span className={styles.error}>{error}</span>
            ) : (
              <>
                <strong>{result.totalRuns.toLocaleString("en-US")}</strong>{" "}
                {result.totalRuns === 1 ? "run" : "runs"} matched
                {aggregated && result.buckets
                  ? ` · ${result.buckets.length.toLocaleString("en-US")} ${
                      result.buckets.length === 1 ? "bucket" : "buckets"
                    }`
                  : ""}
                {result.truncated && " · showing the first rows only"}
              </>
            )}
          </p>

          {/* An aggregated result shows its buckets; an un-aggregated one shows the runs
              themselves. Both are first-class: a great deal of what this surface is for is
              *finding sessions*, not only counting them. */}
          {aggregated ? (
            <>
              <GgVizPanel
                buckets={result.buckets ?? []}
                columns={result.columns ?? []}
                groupBy={compiled.stats?.groupBy}
              />
              <GgBucketTable
                buckets={result.buckets ?? []}
                columns={result.columns ?? []}
                groupBy={compiled.stats?.groupBy}
              />
            </>
          ) : (
            <GgDocTable
              documents={result.documents ?? []}
              filter={compiled.filter}
              sort={compiled.sort}
            />
          )}
        </div>
      </div>
    </PageLayout>
  );
}
