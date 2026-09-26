import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import type { ShowcaseMedia } from "@clockwyrks/run-record";
import type { RunSummary } from "@clockwyrks/run-record/snapshot";
import {
  AestheticBadge,
  ChartWidget,
  GradeBadge,
  MetricTile,
  Panel,
  RatingBadge,
  canonicalModelId,
  categoricalColor,
  timeSeriesChart,
  type StackedSeries,
  type TimeSeriesPoint,
} from "@clockwyrks/ui";
import { CabinetIcon } from "../../components/CabinetIcon";
import { LoadingState } from "../../components/LoadingState";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { UnpublishedTag } from "../../components/UnpublishedTag";
import {
  trimLeadingIdleWeeks,
  type CabinetStats,
} from "../../data/cabinetStats";
import { engineName } from "../../data/engines";
import { useGalleryData, type RunDetail } from "../../data/galleryContext";
import {
  bestAestheticRating,
  bestGrade,
  bestRating,
  foldLeaderboardEntries,
  mean,
  type LeaderboardFoldEntry,
} from "../../data/leaderboardFold";
import { RATINGS, type Rating } from "../../data/ratings";
import type { RunQuery, RunQueryResult } from "../../data/runQuery";
import type { TestCaseGroupSummary } from "../../data/testCases";
import { useFindModel } from "../../data/useModels";
import { useTestCaseGroups } from "../../data/useTestCaseGroups";
import { useTestCaseName } from "../../data/useTestCaseName";
import { useRunsRuntime } from "../../runtime/runsRuntime";
import { routes } from "../../routes";
import {
  formatCompact,
  formatInteger,
  formatTimeAgo,
  formatUsd,
  formatUsdExact,
} from "../../format";
import { ReplayPlayer } from "../runs/replay/ReplayPlayer";
import styles from "./HomePage.module.scss";

// How many legendary runs the showcase stages: the newest as the hero, the rest
// as the thumbnail row beneath it.
const SHOWCASE_LIMIT = 5;

// Home: the cabinet's front door. Top to bottom: the Legendary showcase (the
// newest runs whose looks a reviewer crowned legendary, staged as playing
// media), the whole-corpus totals band, the weekly activity chart, and one
// leaderboard per repo-defined test-case group. The page renders identically
// for every visitor; nothing on it is signed-in-only.
export function HomePage() {
  return (
    <PageLayout>
      <section className={styles.terminal}>
        <PromptHeader
          command="--home"
          blink
          comment={
            <>// insert coin &middot; consume tokens &middot; play the result</>
          }
        />
        <LegendaryShowcase />
        <CabinetPulse />
        <GroupBoards />
      </section>
    </PageLayout>
  );
}

// ---- Legendary showcase ------------------------------------------------------

/** One staged run: its summary card, the carousel entry the stage shows (null
 * when nothing is stageable), and that entry's resolved URL. */
interface ShowcaseEntry {
  run: RunSummary;
  media: ShowcaseMedia | null;
  url: string | null;
}

// The entry a run's stage shows, picked from its showcase carousel: the first
// replay (the game actually moving), else the first video, else the first
// image. Null when the run carries no showcase or none of its media is
// stageable — the stage then holds as the quiet placeholder. `detail?.showcase`
// is read by truthiness: a record from before the field existed omits the key
// entirely.
function pickShowcaseMedia(detail: RunDetail | null): ShowcaseMedia | null {
  const media = detail?.showcase?.media ?? [];
  return (
    media.find((entry) => entry.kind === "replay") ??
    media.find((entry) => entry.kind === "video") ??
    media.find((entry) => entry.kind === "image") ??
    null
  );
}

// The showcase section: the five newest legendary-rated runs, hero first. The
// summary query slices by the lifted aesthetic aggregate; each run's staged
// media lives on its full record (a summary carries no showcase), so the
// details resolve in parallel — a run whose detail fetch fails still shows,
// its stage just holds the placeholder.
//
// Re-queried on the runs runtime's refresh token so a console's freshly
// finished run can take the stage without a reload (the static site's inert
// runtime never bumps it).
function LegendaryShowcase() {
  const { queryRunSummaries, fetchRun, showcaseMediaUrl, localIds } =
    useGalleryData();
  const { refreshToken } = useRunsRuntime();
  const [entries, setEntries] = useState<ShowcaseEntry[] | null>(null);

  useEffect(() => {
    let active = true;
    queryRunSummaries({
      aesthetic: "legendary",
      state: "any",
      sort: "date",
      dir: "desc",
      offset: 0,
      limit: SHOWCASE_LIMIT,
    })
      .then(async ({ summaries }) => {
        const details = await Promise.allSettled(
          summaries.map((run) => fetchRun(run.id)),
        );
        if (!active) return;
        setEntries(
          summaries.map((run, index) => {
            const settled = details[index];
            const media = pickShowcaseMedia(
              settled?.status === "fulfilled" ? settled.value : null,
            );
            return {
              run,
              media,
              // `showcaseMediaUrl` is optional (a host may serve no showcase
              // media at all); an unresolvable file falls back to the
              // placeholder the same way no media does.
              url: media
                ? (showcaseMediaUrl?.(run.id, media.file) ?? null)
                : null,
            };
          }),
        );
      })
      .catch(() => {
        if (active) setEntries([]);
      });
    return () => {
      active = false;
    };
  }, [queryRunSummaries, fetchRun, showcaseMediaUrl, refreshToken]);

  // Unpublished per the console's produced worklist OR per the card itself (a
  // queried run carries no publish timestamp until it is published), mirroring
  // the run log's own tag.
  const isLocal = (run: RunSummary) => localIds.has(run.id) || !run.publishedAt;

  const hero = entries?.[0];
  const thumbs = entries?.slice(1) ?? [];
  return (
    <section className={styles.showcase}>
      <h2 className={styles.sectionTitle}>Legendary Showcase</h2>
      <p className={styles.sectionHint}>
        The newest runs whose looks reviewers rated legendary, playing
        themselves.
      </p>
      {entries === null ? (
        <LoadingState size="section" label="Loading the showcase…" />
      ) : hero === undefined ? (
        // The section stays even with nothing to stage, so the page keeps its
        // shape and the tier's absence is itself visible.
        <p className={styles.empty}>Nothing has been rated legendary yet.</p>
      ) : (
        <>
          <ShowcaseHero entry={hero} local={isLocal(hero.run)} />
          {thumbs.length > 0 && (
            <div className={styles.thumbRow}>
              {thumbs.map((entry) => (
                <ShowcaseThumb
                  key={entry.run.id}
                  entry={entry}
                  local={isLocal(entry.run)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// The fixed-aspect stage a showcase entry plays on. The replay player is
// intrinsically aspect-driven (it sizes to its recording), so the stage clamps
// every media kind into one 16:9 box — overflow hidden, centered — and the
// card row holds its geometry whatever each run produced.
function ShowcaseStage({ entry }: { entry: ShowcaseEntry }) {
  const { media, url } = entry;
  if (media === null || url === null) {
    // A quiet placeholder — panel surface plus the cabinet mark — so a run
    // without stageable media (or a host that cannot serve it) still holds its
    // place in the layout.
    return (
      <div className={`${styles.stage} ${styles.stagePlaceholder}`}>
        <CabinetIcon className={styles.stageMark} />
      </div>
    );
  }
  if (media.kind === "replay") {
    return (
      <div className={styles.stage}>
        <ReplayPlayer url={url} label={media.name} presentation="showcase" />
      </div>
    );
  }
  if (media.kind === "video") {
    // A bare autoplaying, muted loop rather than `MediaView`, whose controls
    // are unconditional — a stage that plays itself wants none.
    return (
      <div className={styles.stage}>
        <video
          className={styles.stageMedia}
          src={url}
          muted
          autoPlay
          loop
          playsInline
          aria-label={media.name}
        />
      </div>
    );
  }
  return (
    <div className={styles.stage}>
      <img className={styles.stageMedia} src={url} alt={media.name} />
    </div>
  );
}

// The hero card: the newest legendary run at full width, its stage over a
// caption line of the run's identity. A replay stage keeps its own hover
// scrubber, so only the inert media kinds get the whole-stage link into the
// run; the replay's run stays one click away on "open run".
function ShowcaseHero({
  entry,
  local,
}: {
  entry: ShowcaseEntry;
  local: boolean;
}) {
  const { run } = entry;
  const { subject } = run;
  const model = useFindModel()(subject.modelId, subject.harnessSlug);
  const testCaseName = useTestCaseName();
  const caseName = testCaseName(subject.testCaseSlug);
  const stage = <ShowcaseStage entry={entry} />;
  return (
    <article className={styles.hero}>
      {entry.media?.kind === "replay" ? (
        stage
      ) : (
        <Link
          to={routes.runDetail(run.id)}
          className={styles.stageLink}
          aria-label={`Open run: ${caseName}`}
        >
          {stage}
        </Link>
      )}
      <div className={styles.heroCaption}>
        <div className={styles.heroTitleRow}>
          <h3 className={styles.heroCase}>
            <Link to={routes.testCaseDetail(subject.testCaseSlug)}>
              {caseName}
            </Link>
            {local && <UnpublishedTag className={styles.tag} />}
          </h3>
          <AestheticBadge rating="legendary" />
        </div>
        <p className={styles.heroSubject}>
          {model ? (
            <Link
              to={routes.modelDetail(model.slug)}
              className={styles.heroModel}
            >
              {model.name}
            </Link>
          ) : (
            <span className={styles.heroModel}>
              {canonicalModelId(subject.modelId, subject.harnessSlug)}
            </span>
          )}
          <span className={styles.sep}>&middot;</span>
          <span className={styles.heroHarness}>{subject.harnessSlug}</span>
          <span className={styles.sep}>&middot;</span>
          <span className={styles.heroTime}>
            {formatTimeAgo(run.startedAt)}
          </span>
        </p>
        <Link to={routes.runDetail(run.id)} className={styles.openRun}>
          open run &rsaquo;
        </Link>
      </div>
    </article>
  );
}

// A thumbnail card: the same stage chain at a quarter of the row, its badges
// overlaid on the media per the mock, and one overlay link covering the whole
// card. A thumbnail's replay is a moving picture to click through, not a
// player to operate, so the link sitting over its scrubber costs nothing.
function ShowcaseThumb({
  entry,
  local,
}: {
  entry: ShowcaseEntry;
  local: boolean;
}) {
  const { run } = entry;
  const { subject } = run;
  const model = useFindModel()(subject.modelId, subject.harnessSlug);
  const testCaseName = useTestCaseName();
  const caseName = testCaseName(subject.testCaseSlug);
  const modelName =
    model?.name ?? canonicalModelId(subject.modelId, subject.harnessSlug);
  return (
    <article className={styles.thumb}>
      <ShowcaseStage entry={entry} />
      <span className={styles.thumbBadges}>
        <AestheticBadge rating="legendary" />
        {local && <UnpublishedTag />}
      </span>
      <Link
        to={routes.runDetail(run.id)}
        className={styles.thumbLink}
        aria-label={`Open run: ${caseName} — ${modelName}`}
      >
        <span className={styles.thumbCaption}>
          {caseName}{" "}
          <span className={styles.thumbModel}>&middot; {modelName}</span>
        </span>
      </Link>
    </article>
  );
}

// ---- Totals band + activity chart --------------------------------------------

// The activity chart's one-line roster, module-level so its identity is stable
// across renders. The single series is unnamed: the widget's title already
// names it, and `timeSeriesChart` draws no legend for one series.
const ACTIVITY_SERIES: StackedSeries[] = [
  { name: "", color: categoricalColor(0) },
];

// The activity tooltip's week label ("Week of Aug 24, 2026"). UTC, because the
// bucket keys are UTC Mondays and a local-zone render would shift some of them
// onto a Sunday.
const ACTIVITY_WEEK_LABEL = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

// The activity chart counts whole runs, so fractional gridline ticks (which
// Plot generates freely when the peak week is small) label nothing real —
// only the integer ticks get a label.
function activityTick(value: number): string {
  return Number.isInteger(value) ? formatInteger(value) : "";
}

// The honesty note for a total some runs could not contribute to.
function unreportedNote(count: number, what: string): string {
  return `${formatInteger(count)} ${count === 1 ? "run" : "runs"} reported ${what}, contributing nothing to this total.`;
}

// The cabinet's pulse: the five-tile totals band and the weekly activity chart,
// both fed by the host's one `getCabinetStats` figure. A host without the
// capability — or whose fetch failed or resolved null — renders neither:
// the page quietly holds the sections back rather than showing zeros.
function CabinetPulse() {
  const { getCabinetStats } = useGalleryData();
  const { refreshToken } = useRunsRuntime();
  // undefined while resolving, null when the figures cannot be produced.
  const [stats, setStats] = useState<CabinetStats | null | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!getCabinetStats) {
      setStats(null);
      return;
    }
    let active = true;
    getCabinetStats()
      .then((value) => {
        if (active) setStats(value);
      })
      .catch(() => {
        if (active) setStats(null);
      });
    return () => {
      active = false;
    };
  }, [getCabinetStats, refreshToken]);

  const points = useMemo<TimeSeriesPoint[]>(
    () =>
      // The wire covers the last year; the axis opens at the first week that
      // actually saw a run rather than padding a younger corpus with leading
      // zeros (see trimLeadingIdleWeeks).
      trimLeadingIdleWeeks(stats?.weekly ?? []).map((week) => {
        // `weekStart` is the wire's `YYYY-MM-DD` (a UTC Monday); a bare date
        // string parses as UTC midnight — the bucket's floored start, which is
        // what a `TimeSeriesPoint.time` must be.
        const time = new Date(week.weekStart);
        return {
          time,
          series: "",
          // The wire's explicit zero entries chart as zeros deliberately,
          // departing from the omit-empty-buckets convention elsewhere: a week
          // the cabinet sat idle is signal, so the line must dip to the axis
          // rather than skip the bucket.
          value: week.runs,
          title: `Week of ${ACTIVITY_WEEK_LABEL.format(time)}\n${formatInteger(
            week.runs,
          )} ${week.runs === 1 ? "run" : "runs"} started`,
        };
      }),
    [stats],
  );

  if (!stats) return null;

  const { tokens, cost } = stats;
  return (
    <>
      <div className={styles.totals}>
        <MetricTile label="Runs" value={formatInteger(stats.runs)} />
        <MetricTile
          label="Tokens"
          value={formatCompact(tokens.total)}
          title={
            tokens.unreportedRuns > 0
              ? unreportedNote(tokens.unreportedRuns, "no tokens")
              : undefined
          }
        />
        <MetricTile
          label="Spend"
          value={formatUsdExact(cost.total)}
          title={
            cost.unreportedRuns > 0
              ? unreportedNote(cost.unreportedRuns, "no comparable cost")
              : undefined
          }
        />
        <MetricTile label="Test cases" value={formatInteger(stats.testCases)} />
        <MetricTile label="Models" value={formatInteger(stats.models)} />
      </div>
      <div className={styles.activity}>
        <ChartWidget
          title="Activity"
          hint="Runs started per week, from the first recorded week within the last year."
          spec={(palette) =>
            timeSeriesChart(points, palette, ACTIVITY_SERIES, {
              y: "runs",
              yTickFormat: activityTick,
            })
          }
        />
      </div>
    </>
  );
}

// ---- Group leaderboards ------------------------------------------------------

// The page stride of a group's drain; a host may clamp it (see the advance-by-
// what-arrived note below).
const GROUP_PAGE_LIMIT = 200;
// How many ranked rows a group's panel shows.
const GROUP_BOARD_ROWS = 5;

// Every run of a group's member cases, drained page by page following the
// `drainCaseSummaries` pattern. One query covers all members via the
// `testCases` list filter; `state: "any"` draws the consoles' union slice (the
// fold drops non-completed runs itself), and `latestVersions` keeps each case
// to the spec currently in play — an older minor is a different spec whose runs
// are not comparable.
async function drainGroupSummaries(
  query: (q: RunQuery) => Promise<RunQueryResult>,
  cases: readonly string[],
): Promise<RunSummary[]> {
  const acc: RunSummary[] = [];
  let offset = 0;
  for (;;) {
    const { summaries, total } = await query({
      testCases: [...cases],
      latestVersions: true,
      state: "any",
      offset,
      limit: GROUP_PAGE_LIMIT,
    });
    acc.push(...summaries);
    // Advance by what ARRIVED, never by what was asked for: a host free to
    // return fewer rows than requested (the backend clamps the limit) would
    // otherwise leave a silently dropped hole in the board's corpus.
    offset += summaries.length;
    if (summaries.length === 0 || acc.length >= total) break;
  }
  return acc;
}

/** One ranked board row: the fold entry plus the figures the ranking orders on,
 * computed once rather than inside the comparator. */
interface GroupRow {
  entry: LeaderboardFoldEntry;
  /** The mean score fraction across the row's runs — the ranking figure.
   * Cross-case point totals differ, so raw points are not comparable here. */
  meanFraction: number;
  best: Rating | null;
}

// Rank by mean score fraction, then best functional rating, then recency — the
// case board's tie-break order transposed onto the cross-case fraction.
function byFractionThenRatingThenRecency(a: GroupRow, b: GroupRow): number {
  if (a.meanFraction !== b.meanFraction) return b.meanFraction - a.meanFraction;
  const ra = a.best ? RATINGS.indexOf(a.best) : RATINGS.length;
  const rb = b.best ? RATINGS.indexOf(b.best) : RATINGS.length;
  if (ra !== rb) return ra - rb;
  return b.entry.latestStartedAt.localeCompare(a.entry.latestStartedAt);
}

// One leaderboard per repo-defined test-case group, two across. A host that
// supplies no groups (the set is optional gallery data) renders no section at
// all — there is nothing to head it with.
function GroupBoards() {
  const groups = useTestCaseGroups();
  if (groups.length === 0) return null;
  return (
    <section className={styles.boards}>
      {groups.map((group) => (
        <GroupBoard key={group.slug} group={group} />
      ))}
    </section>
  );
}

// A group's panel: its member cases' runs drained in one filtered query, folded
// into `(harness, model, engine)` rows, and ranked by mean score fraction.
function GroupBoard({ group }: { group: TestCaseGroupSummary }) {
  const { queryRunSummaries } = useGalleryData();
  const { refreshToken } = useRunsRuntime();
  const findModel = useFindModel();
  const [summaries, setSummaries] = useState<RunSummary[] | null>(null);

  useEffect(() => {
    let active = true;
    drainGroupSummaries(queryRunSummaries, group.cases)
      .then((rows) => {
        if (active) setSummaries(rows);
      })
      .catch(() => {
        if (active) setSummaries([]);
      });
    return () => {
      active = false;
    };
  }, [queryRunSummaries, group, refreshToken]);

  const { top, multiEngine } = useMemo(() => {
    if (summaries === null) {
      return { top: [] as GroupRow[], multiEngine: false };
    }
    // Keyed by engine always: a cross-case fold can meet runs under different
    // engines, which measure different work and must never share a row.
    const folded = foldLeaderboardEntries(summaries, {
      keyEngine: true,
      resolveModelName: (modelId, harnessSlug) =>
        findModel(modelId, harnessSlug)?.name ?? null,
    });
    // The engine marker shows only when the group's rows actually span more
    // than one engine — measured over every folded row, not just the shown
    // top, so the shown rows never read as same-engine when they are not.
    const engines = new Set(folded.map((entry) => entry.engineSlug));
    const ranked = folded.map(
      (entry): GroupRow => ({
        entry,
        meanFraction: mean(entry.fractions) ?? 0,
        best: bestRating(entry.ratings),
      }),
    );
    ranked.sort(byFractionThenRatingThenRecency);
    return {
      top: ranked.slice(0, GROUP_BOARD_ROWS),
      multiEngine: engines.size > 1,
    };
  }, [summaries, findModel]);

  return (
    <Panel className={styles.board}>
      <header className={styles.boardHead}>
        <h3 className={styles.boardName}>{group.name}</h3>
        <p className={styles.boardCases}>
          {group.cases.map((slug, index) => (
            <Fragment key={slug}>
              {index > 0 && <span className={styles.sep}>&middot;</span>}
              <Link to={routes.testCaseDetail(slug)}>{slug}</Link>
            </Fragment>
          ))}
        </p>
      </header>
      {summaries === null ? (
        <LoadingState size="section" label="Loading leaderboard…" />
      ) : top.length === 0 ? (
        <p className={styles.boardEmpty}>No scored runs in this group yet.</p>
      ) : (
        <div
          className={styles.boardRows}
          role="table"
          aria-label={`${group.name} leaderboard`}
        >
          {top.map((row, index) => (
            <GroupBoardRow
              key={row.entry.rowKey}
              row={row}
              rank={index + 1}
              multiEngine={multiEngine}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

function GroupBoardRow({
  row,
  rank,
  multiEngine,
}: {
  row: GroupRow;
  rank: number;
  multiEngine: boolean;
}) {
  const { entry } = row;
  // A jam's runs carry a whole-game grade in place of a domain rating; a row
  // never carries both, so the badge adapts exactly as the case board's does.
  const grade = bestGrade(entry.grades);
  const aesthetic = bestAestheticRating(entry.aesthetics);
  return (
    <div className={styles.boardRow} role="row">
      <span className={styles.rank}>{rank}</span>
      <span className={styles.model}>
        {entry.modelName}{" "}
        <span className={styles.harness}>
          &middot; {entry.harnessSlug}
          {multiEngine && entry.engineSlug !== null
            ? ` · ${engineName(entry.engineSlug)}`
            : ""}
        </span>
      </span>
      <span className={styles.score}>
        {Math.round(row.meanFraction * 100)}%
      </span>
      {/* formatUsd already renders an em dash for a pair no run of which
          reported a comparable cost (an empty list means a null mean). */}
      <span className={styles.cost}>{formatUsd(mean(entry.costs))}</span>
      <span className={styles.badges}>
        {grade ? (
          <GradeBadge status={grade} />
        ) : row.best ? (
          <RatingBadge rating={row.best} />
        ) : (
          <span className={styles.noRating}>—</span>
        )}
        {aesthetic && <AestheticBadge rating={aesthetic} />}
      </span>
    </div>
  );
}
