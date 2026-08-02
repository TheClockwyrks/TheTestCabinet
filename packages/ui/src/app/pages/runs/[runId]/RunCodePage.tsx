import { useEffect, useState } from "react";
import { MetricTile, Spinner } from "@test-cabinet/ui";
import type { RunRecord } from "@test-cabinet/run-record";
import type { CodeAnalysisDocument } from "@test-cabinet/run-record/code-analysis";
import { RunDetailLayout } from "../../../layouts/runs/RunDetailLayout";
import { useBackend } from "../../../../client/context";
import {
  CodeCyclesCallout,
  CodeExplorer,
  CodeFigures,
  CodeOutliers,
  CodeProvenanceStrip,
  formatCodeNumber,
} from "../code";
import styles from "../code/CodePanels.module.scss";

// The Code tab (`/runs/:runId/code`): a deterministic, execute-nothing static read of the
// source the run's model wrote.
//
// It answers the question no other measurement in The Test Cabinet touches — not what the
// run cost or whether it worked, but *how the model built it*: did it split the work or
// write one god-file, did it abstract or copy-paste, did it annotate its own API, did it
// leave a knot of import cycles behind.
//
// Two tiers feed the page, and the split is why it renders in two stages. The bounded
// summary rides on the run record, so the provenance, the headline figures and the full
// figure table are on screen the moment the record is. The unbounded document — every
// file, every function, every edge, every cycle, every clone group — is a separate
// artifact, fetched here, and it is what the explorer, the rankings and the cycle list
// are built from. A transport that cannot reach per-run media (the static site) simply
// never gets the second tier, and the page says so rather than looking broken.
//
// Nothing here is a score. A run is judged on what it built, never on what a metric said
// about it — the polarity the catalog carries orients a sort and picks an arrow, and that
// is the whole of its authority.
export function RunCodePage() {
  return (
    <RunDetailLayout tab="code">
      {({ run }) => <RunCodeBody run={run} />}
    </RunDetailLayout>
  );
}

type LoadState =
  | { kind: "loading" }
  /** The transport cannot reach per-run media at all. */
  | { kind: "unsupported" }
  /** The route resolved, but the run has no stored document. */
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "ready"; document: CodeAnalysisDocument };

function RunCodeBody({ run }: { run: RunRecord }) {
  const summary = run.codeAnalysis;
  const { client } = useBackend();
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    if (!client?.readCodeAnalysis) {
      setLoad({ kind: "unsupported" });
      return;
    }
    let cancelled = false;
    setLoad({ kind: "loading" });
    client
      .readCodeAnalysis(run.id)
      .then((document) => {
        if (cancelled) return;
        setLoad(document ? { kind: "ready", document } : { kind: "empty" });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoad({ kind: "error", message: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [run.id, client]);

  // Reachable by typing the URL for a run recorded before the analyzer shipped — the tab
  // itself is not offered for one. Says which of the two it is, because "not analysed" and
  // "analysed and found nothing" are very different facts about a run.
  if (!summary) {
    return (
      <section className={styles.page}>
        <p className={styles.empty}>
          This run carries no code analysis. The corpus is not backfilled, so a
          run recorded before the analyzer shipped has none.
        </p>
      </section>
    );
  }

  const cyclomatic =
    summary.complexity.functions > 0 ? summary.complexity.meanCyclomatic : null;

  return (
    <section className={styles.page}>
      <CodeProvenanceStrip summary={summary} />

      {/* The handful of figures that characterise a tree, before any of the ninety
          below it. */}
      <div className={styles.kpis}>
        <MetricTile
          label="Files"
          value={formatCodeNumber(summary.size.files)}
        />
        <MetricTile
          label="Code lines"
          value={formatCodeNumber(summary.size.codeLines)}
        />
        <MetricTile
          label="Functions"
          value={formatCodeNumber(summary.complexity.functions)}
        />
        <MetricTile
          label="Mean cyclomatic"
          value={cyclomatic === null ? "—" : cyclomatic.toFixed(1)}
        />
        <MetricTile
          label="Import cycles"
          value={formatCodeNumber(summary.graph.cycles)}
        />
        <MetricTile
          label="Duplicated"
          value={`${(summary.duplication.clonedLineRatio * 100).toFixed(1)}%`}
        />
      </div>

      <h3 className={styles.sectionHeading}>Where the code went</h3>
      <DetailTier load={load}>
        {(document) => <CodeExplorer document={document} />}
      </DetailTier>

      <h3 className={styles.sectionHeading}>Outliers</h3>
      <DetailTier load={load}>
        {(document) => (
          <>
            <CodeOutliers document={document} />
            <CodeCyclesCallout document={document} />
          </>
        )}
      </DetailTier>

      <h3 className={styles.sectionHeading}>Every figure</h3>
      <CodeFigures summary={summary} />
    </section>
  );
}

// The second tier's states, in one place so the explorer and the outliers cannot disagree
// about whether the document arrived.
function DetailTier({
  load,
  children,
}: {
  load: LoadState;
  children: (document: CodeAnalysisDocument) => React.ReactNode;
}) {
  switch (load.kind) {
    case "loading":
      // A div rather than a paragraph: the spinner is itself a block, and a block
      // inside a `<p>` is invalid HTML the browser silently reparents.
      return (
        <div className={styles.empty}>
          <Spinner /> Loading the full analysis…
        </div>
      );
    case "unsupported":
      return (
        <p className={styles.empty}>
          The per-file detail isn&rsquo;t available here. The figures below are
          the whole of what this run&rsquo;s record carries.
        </p>
      );
    case "empty":
      return (
        <p className={styles.empty}>
          This run&rsquo;s full analysis document wasn&rsquo;t stored, so only
          its summary figures are available.
        </p>
      );
    case "error":
      return (
        <p className={`${styles.empty} ${styles.error}`}>
          Couldn&rsquo;t load the full analysis: {load.message}
        </p>
      );
    case "ready":
      return <>{children(load.document)}</>;
  }
}
