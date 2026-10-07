import { useEffect, useState } from "react";
import { MetricTile, Panel, Spinner } from "@clockwyrks/ui";
import type { RunRecord } from "@clockwyrks/run-record";
import type { CodeAnalysisDocument } from "@clockwyrks/run-record/code-analysis";
import { HelpTip } from "../../../components/HelpTip";
import { RunDetailLayout } from "../../../layouts/runs/RunDetailLayout";
import { useGalleryData } from "../../../data/galleryContext";
import {
  CodeCyclesCallout,
  CodeExplorer,
  CodeFigures,
  CodeOutliers,
  CodeProvenanceStrip,
  ToolchainCoverage,
  ToolchainTests,
  formatCodeNumber,
  toolchainCoverage,
  toolchainTests,
} from "../code";
import styles from "../code/CodePanels.module.scss";

// The Code tab (`/runs/:runId/code`): what the run's model built, read two ways.
//
// Most of the page is a deterministic, execute-nothing static read of the source itself.
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
// The page also carries a second, EXECUTED tier, in the two bands the toolchain block
// feeds: the tests the model wrote, and what they covered of the code the model wrote.
// Those figures did not come from reading the source — they came from running it, host
// side, after the container was gone — and they belong here rather than on a page of
// their own because they answer the same question the static half asks and cannot: "how
// much test code did the model write" and "did any of it exercise anything" are the two
// halves of one judgement, and separating them is what let a reader read the static
// counts as coverage in the first place. Each band renders only when the run's case
// actually wrote a report file, so a run that carries none shows no band at all rather
// than an empty one, and the static tier is unchanged for it.
//
// The two tiers are labelled so they cannot be confused with each other, and — the thing
// that matters most on this page — neither can be confused with the test case's
// VALIDATORS, whose verdicts a reviewer sees on the same run. The validators are The Test
// Cabinet's own graders, a separate vitest project run by a separate code path with its
// own coverage deliberately disabled. Nothing they execute contributes a number to this
// page.
//
// Nothing here is a score. A run is judged on what it built, never on what a metric said
// about it — the polarity the catalog carries orients a sort and picks an arrow, and that
// is the whole of its authority. That holds for the executed tier too: a red suite and
// thin coverage are recorded and shown, and gate no rating, no verdict and no point.
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
  // The executed tier. Both gates test whether file-derived data was actually parsed —
  // never whether the manifest declared a `test` command — so a case that declares one
  // but still writes only a terminal table shows nothing at all.
  const coverage = toolchainCoverage(run);
  // A host hook, not a client call: a console reads the backend route, the static site
  // fetches the snapshot object the publish emitted, and the site mounts no backend
  // provider at all — so reaching for one here would throw on the very host this tier
  // was published for.
  const { readCodeAnalysis } = useGalleryData();
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    if (!readCodeAnalysis) {
      setLoad({ kind: "unsupported" });
      return;
    }
    let cancelled = false;
    setLoad({ kind: "loading" });
    readCodeAnalysis(run.id)
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
  }, [run.id, readCodeAnalysis]);

  // Reachable by typing the URL for a run recorded before the analyzer shipped — the tab
  // itself is not offered for one. Says which of the two it is, because "not analysed" and
  // "analysed and found nothing" are very different facts about a run.
  if (!summary) {
    return (
      <section className={styles.page}>
        <Panel>
          <p className={styles.empty}>
            This run carries no code analysis. The corpus is not backfilled, so
            a run recorded before the analyzer shipped has none.
          </p>
        </Panel>
        {/* The executed tier does not depend on the static one — they are read by
            different stages from different inputs — so it still renders here. In
            practice this pairing barely occurs, because the tab is only offered for a
            run that has an analysis; it is what makes the page honest for one reached by
            typing its URL. */}
        <ExecutedTier run={run} />
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

      {/* The executed tier, above the static bands: what the model's tests did is the
          first thing a reader wants after the headline figures, and putting it here is
          also what makes the coverage column in the explorer below read as a follow-on
          rather than as an unexplained column. */}
      <ExecutedTier run={run} />

      {/* Each band is its heading and the widgets under it, held together — the heading,
          and the lead sentence the executed bands carry, are the only things on this page
          that sit out on the backdrop, and they wear the halo for it. */}
      <div className={styles.band}>
        <h3 className={styles.sectionHeading}>Where the code went</h3>
        <DetailTier load={load}>
          {(document) => (
            <CodeExplorer document={document} coverage={coverage} />
          )}
        </DetailTier>
      </div>

      <div className={styles.band}>
        <h3 className={styles.sectionHeading}>Outliers</h3>
        <DetailTier load={load}>
          {(document) => (
            <>
              <CodeOutliers document={document} />
              <CodeCyclesCallout document={document} />
            </>
          )}
        </DetailTier>
      </div>

      <div className={styles.band}>
        <h3 className={styles.sectionHeading}>Every figure</h3>
        <CodeFigures summary={summary} />
      </div>
    </section>
  );
}

/** The distinction a reviewer must not get wrong, kept off the band lead and behind the
 * "?" beside it: the same reviewer sees the test case's validator verdicts on a sibling
 * surface, and the two have nothing to do with each other. */
const TESTS_HELP =
  "Read from the report file the run produced. The test case's validators are a separate suite that grades this run: nothing they do is counted here, and nothing here affects this run's rating, score or verdict.";

/** Coverage's own version of the same distinction. */
const COVERAGE_HELP =
  "The validators' suite has coverage disabled by design, so nothing it executed appears in these figures. Descriptive only: coverage gates nothing.";

/**
 * The two executed bands: the model's own test suite, and its coverage of the model's own
 * code.
 *
 * Each band — heading, lead sentence and widget together — lives wholly inside its own
 * `!== null` conditional, because "the case wrote no report file" is not a state with an
 * empty widget for it. A run whose case is not on the report-file contract, or whose
 * config still only printed a terminal table, gets neither band: no heading, no card, no
 * placeholder, no zero. Absence of the widget is the correct rendering. A block that IS
 * present with zeroes in it does render — `total: 0` is the runner saying the build
 * shipped no tests, which is a result worth showing.
 *
 * The two are gated independently because they come from two files, and a config can
 * write one without the other.
 *
 * Each band's lead is one line: whose tests these are, and what ran them. The rest of
 * what a reviewer must not get wrong — that the test case's validators are a different
 * suite entirely — is behind the "?" beside it rather than deleted, because a lead
 * paragraph longer than the widget under it is the complaint this page answers.
 */
function ExecutedTier({ run }: { run: RunRecord }) {
  const tests = toolchainTests(run);
  const coverage = toolchainCoverage(run);
  return (
    <>
      {tests && (
        <div className={styles.band}>
          <h3 className={styles.sectionHeading}>Tests the model wrote</h3>
          <p className={styles.bandLead}>
            The tests the model wrote, run over the code the model wrote by the
            case&rsquo;s <code>test</code> command.{" "}
            <HelpTip text={TESTS_HELP} />
          </p>
          <ToolchainTests tests={tests} />
        </div>
      )}

      {coverage && (
        <div className={styles.band}>
          <h3 className={styles.sectionHeading}>
            Coverage of the code the model wrote
          </h3>
          <p className={styles.bandLead}>
            What those tests reached in the model&rsquo;s own <code>src/</code>,
            measured by istanbul. <HelpTip text={COVERAGE_HELP} />
          </p>
          <ToolchainCoverage coverage={coverage} />
        </div>
      )}
    </>
  );
}

// The second tier's states, in one place so the explorer and the outliers cannot disagree
// about whether the document arrived.
//
// Every one of them is a `<Panel>`, because a band that is waiting, unsupported or broken
// should read as the same card the loaded band does rather than as a sentence adrift on
// the backdrop where a widget was.
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
        <Panel>
          <div className={styles.empty}>
            <Spinner /> Loading the full analysis…
          </div>
        </Panel>
      );
    case "unsupported":
      return (
        <Panel>
          <p className={styles.empty}>
            The per-file detail isn&rsquo;t available here. The figures below
            are the whole of what this run&rsquo;s record carries.
          </p>
        </Panel>
      );
    case "empty":
      return (
        <Panel>
          <p className={styles.empty}>
            This run&rsquo;s full analysis document wasn&rsquo;t stored, so only
            its summary figures are available.
          </p>
        </Panel>
      );
    case "error":
      return (
        <Panel>
          <p className={`${styles.empty} ${styles.error}`}>
            Couldn&rsquo;t load the full analysis: {load.message}
          </p>
        </Panel>
      );
    case "ready":
      return <>{children(load.document)}</>;
  }
}
