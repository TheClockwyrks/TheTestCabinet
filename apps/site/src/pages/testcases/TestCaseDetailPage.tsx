import { useMemo } from "react";
import { Link, useParams } from "react-router";
import type { RunRecord } from "@test-cabinet/run-record";
import { PageLayout } from "../../components/PageLayout";
import { Markdown } from "../../components/Markdown";
import { Chart } from "../../components/Chart";
import { barChart, boxAndWhisker } from "../../components/plot/charts";
import type { BarPoint, BoxPoint } from "../../components/plot/charts";
import { useTestCases } from "../../data/useTestCases";
import type { SeededInput, TestCaseSummary } from "../../data/testCases";
import { useRuns } from "../../data/useRuns";
import {
  formatCompact,
  formatRunTime,
  formatUsd,
  totalTokens,
} from "../../format";
import { routes } from "../../routes";
import styles from "./TestCaseDetailPage.module.scss";

// How many recent runs of a case to surface inline before the charts.
const RECENT_RUNS = 8;

// A test case in full: its description, the exact inputs a run is seeded with
// (text inlined, reference screenshots rendered), the most recent runs of the
// case, and distribution charts of token usage and cost. The charts show
// spread, never a ranking (docs/site.md).
export function TestCaseDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { testCases } = useTestCases();
  const { runs } = useRuns();
  const testCase = testCases.find((entry) => entry.slug === slug);

  // Runs of this case, newest first. Memoized so the chart specs are stable.
  const caseRuns = useMemo(
    () =>
      testCase
        ? runs
            .filter((run) => run.subject.testCaseSlug === testCase.slug)
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        : [],
    [runs, testCase],
  );

  if (!testCase) {
    return (
      <PageLayout>
        <p className={styles.notFound}>No test case found for &ldquo;{slug}&rdquo;.</p>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <header className={styles.header}>
        <h1 className={styles.title}>{testCase.name}</h1>
        <div className={styles.meta}>
          <span className={styles.difficulty} data-level={testCase.difficulty}>
            {testCase.difficulty}
          </span>
          <span className={styles.version}>{testCase.latestVersion}</span>
          {testCase.tags.map((tag) => (
            <span key={tag} className={styles.tag}>
              {tag}
            </span>
          ))}
        </div>
      </header>

      {testCase.description && (
        <section className={styles.section}>
          <Markdown>{testCase.description}</Markdown>
        </section>
      )}

      <FileBrowser testCase={testCase} />

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Recent runs</h2>
        {caseRuns.length === 0 ? (
          <p className={styles.secondary}>No runs of this case yet.</p>
        ) : (
          <ul className={styles.runs}>
            {caseRuns.slice(0, RECENT_RUNS).map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </ul>
        )}
      </section>

      <CaseCharts runs={caseRuns} />
    </PageLayout>
  );
}

// The seeded inputs viewer: a flat list of the files a run receives, with text
// files inlined and reference screenshots rendered from their /catalog URL.
// This is exactly what harnesses and models are handed — no more, no less.
function FileBrowser({ testCase }: { testCase: TestCaseSummary }) {
  const { seededInputs, referenceScreenshots } = testCase;
  if (seededInputs.length === 0 && referenceScreenshots.length === 0) {
    return null;
  }
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Seeded inputs</h2>
      <p className={styles.secondary}>
        Every run of {testCase.name} starts from a fresh repository containing
        exactly these files.
      </p>
      <ul className={styles.files}>
        {seededInputs.map((input) => (
          <SeededFile key={input.path} input={input} />
        ))}
        {referenceScreenshots.map((shot) => (
          <li key={`ref-${shot.view}`} className={styles.file}>
            <div className={styles.fileHead}>
              <span className={styles.filePath}>reference/{shot.view}</span>
              <span className={styles.fileKind}>image</span>
            </div>
            <img className={styles.image} src={shot.url} alt={`Reference for ${shot.view}`} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SeededFile({ input }: { input: SeededInput }) {
  return (
    <li className={styles.file}>
      <div className={styles.fileHead}>
        <span className={styles.filePath}>{input.path}</span>
        <span className={styles.fileKind}>{input.kind}</span>
      </div>
      {input.kind === "text" && input.text !== undefined ? (
        <Markdown className={styles.fileBody}>
          {fence(input.path, input.text)}
        </Markdown>
      ) : input.url ? (
        <img className={styles.image} src={input.url} alt={input.path} />
      ) : null}
    </li>
  );
}

// Markdown source files render as prose; everything else renders as a fenced
// code block so the file is shown verbatim.
function fence(path: string, text: string): string {
  if (path.endsWith(".md") || path.endsWith(".markdown")) {
    return text;
  }
  const lang = path.split(".").pop() ?? "";
  return `\`\`\`${lang}\n${text}\n\`\`\``;
}

function RunRow({ run }: { run: RunRecord }) {
  const { subject, metrics, validation } = run;
  return (
    <li>
      <Link to={routes.runDetail(run.id)} className={styles.runRow}>
        <span className={styles.runHarness}>{subject.harnessSlug}</span>
        <span className={styles.runModel}>{subject.modelId}</span>
        <span className={styles.runNum}>{formatCompact(totalTokens(metrics))}</span>
        <span className={styles.runNum}>{formatUsd(metrics.cost.comparable)}</span>
        <span className={styles.runNum}>{formatRunTime(metrics.runTimeSeconds)}</span>
        <span
          className={`${styles.runNum} ${validation.loaded ? styles.ok : styles.bad}`}
        >
          {validation.loaded ? "[Y]" : "[N]"}
        </span>
      </Link>
    </li>
  );
}

// Distribution charts for the case: token usage and cost grouped by harness so
// the spread across runs is visible without implying a winner.
function CaseCharts({ runs }: { runs: RunRecord[] }) {
  const tokenPoints = useMemo<BoxPoint[]>(
    () =>
      runs.map((run) => ({
        group: run.subject.harnessSlug,
        value: totalTokens(run.metrics),
      })),
    [runs],
  );
  const costPoints = useMemo<BoxPoint[]>(
    () =>
      runs.map((run) => ({
        group: run.subject.harnessSlug,
        value: run.metrics.cost.comparable,
      })),
    [runs],
  );
  // Per-run magnitudes for the bar charts, keyed by harness (and model when a
  // harness appears more than once) so each bar maps back to one run.
  const tokenBars = useMemo<BarPoint[]>(() => runBars(runs, totalTokensValue), [runs]);
  const costBars = useMemo<BarPoint[]>(() => runBars(runs, costValue), [runs]);

  // A box plot needs a spread to be meaningful; below that we say so.
  if (runs.length < 2) {
    return null;
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Distributions</h2>
      <div className={styles.charts}>
        <Chart
          title="Total tokens by harness"
          spec={(palette) => boxAndWhisker(tokenPoints, palette, { y: "tokens" })}
        />
        <Chart
          title="Comparable cost by harness"
          spec={(palette) => boxAndWhisker(costPoints, palette, { y: "USD" })}
        />
        <Chart
          title="Total tokens per run"
          spec={(palette) => barChart(tokenBars, palette, { y: "tokens" })}
        />
        <Chart
          title="Comparable cost per run"
          spec={(palette) => barChart(costBars, palette, { y: "USD" })}
        />
      </div>
    </section>
  );
}

function totalTokensValue(run: RunRecord): number {
  return totalTokens(run.metrics);
}

function costValue(run: RunRecord): number {
  return run.metrics.cost.comparable;
}

// Builds one labeled bar per run. Labels prefer the harness slug, disambiguating
// with the model id when the same harness ran the case more than once.
function runBars(runs: RunRecord[], value: (run: RunRecord) => number): BarPoint[] {
  const counts = new Map<string, number>();
  for (const run of runs) {
    counts.set(run.subject.harnessSlug, (counts.get(run.subject.harnessSlug) ?? 0) + 1);
  }
  return runs.map((run) => ({
    label:
      (counts.get(run.subject.harnessSlug) ?? 0) > 1
        ? `${run.subject.harnessSlug} · ${run.subject.modelId}`
        : run.subject.harnessSlug,
    value: value(run),
  }));
}
