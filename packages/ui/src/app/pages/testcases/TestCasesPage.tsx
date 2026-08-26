import { useMemo, useState } from "react";
import { Link, NavLink } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { LoadingState } from "../../components/LoadingState";
import { PromptHeader } from "../../components/PromptHeader";
import { CabinetIcon } from "../../components/CabinetIcon";
import { useRecordSectionIndex } from "../../components/backReturn";
import { useTestCases } from "../../data/useTestCases";
import { useGalleryData } from "../../data/galleryContext";
import type { ShowcaseMediaRef, TestCaseSummary } from "../../data/testCases";
import { CATALOG_TABS, inTab } from "../../data/testCaseTabs";
import { ReplayPlayer } from "../runs/replay/ReplayPlayer";
import { routes } from "../../routes";
import type { CatalogTab } from "../../routes";
import styles from "./TestCasesPage.module.scss";

// The catalog's type tabs are defined in `../../data/testCaseTabs` (shared with
// the coverage plan editor). On a console (canExecute) they are all shown
// regardless of which types the catalog currently holds, so the bar's shape is
// stable even for a type that has cases but no runs yet. On the static gallery
// site the catalog holds only cases with a published run, so a tab with no case
// under it is hidden (see `visibleTabs`) — mirroring, for the tab bar, the way
// the grid already lists only published cases. The catalog shows exactly one tab
// at a time.

interface TestCasesPageProps {
  /** Which type tab this route renders. Carried in the URL (one route per tab)
   * so the selection survives a reload and is linkable. */
  tab: CatalogTab;
}

/** Whether a case carries a stageable catalog showcase — the marker's and the
 * preview stage's shared condition. Read by truthiness: a host that predates
 * the field omits the key entirely. */
function hasShowcase(testCase: TestCaseSummary): boolean {
  return (testCase.showcase?.media.length ?? 0) > 0;
}

// The test-case catalog, laid out "index + stage": below the type tab bar and
// search, a master-detail split. The left index lists every case in the tab as
// a selectable row (name, latest version, a replay marker when the case has a
// showcase, difficulty badge); the right pane is a sticky preview of the
// selected case — its showcase media on a stage (or a quiet cabinet placeholder
// when it has none), a filmstrip of the rest of the carousel, its summary and
// tags, and the link into the detail page. The tab is the URL (one route per
// tab), so a reload keeps it, and a client-side search narrows within it.
// Rows are listed alphabetically — never ranked.
export function TestCasesPage({ tab }: TestCasesPageProps) {
  const { testCases, status } = useTestCases();
  const { canExecute } = useGalleryData();
  const [query, setQuery] = useState("");
  // The index's selection: which case the preview pane stages. Held as the slug
  // rather than an object so the fallback below can resolve it against whatever
  // the current filters leave shown.
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  // Remember the viewed tab so a case's detail back-control returns here, not to
  // the catalog default tab.
  useRecordSectionIndex("testCases");

  // On the static site (no execution) drop tabs the catalog has no case for, so
  // the bar advertises only types with a published run; the consoles keep the
  // full, stable bar.
  const visibleTabs = useMemo(
    () =>
      canExecute
        ? CATALOG_TABS
        : CATALOG_TABS.filter((entry) =>
            testCases.some((testCase) => inTab(testCase, entry.tab)),
          ),
    [canExecute, testCases],
  );

  const shown = useMemo(
    () =>
      testCases
        .filter((testCase) => matches(testCase, query, tab))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [testCases, query, tab],
  );

  // Resolve the selection against the filtered list rather than track it with
  // an effect: the preview follows the clicked row while it is shown, and falls
  // back to the first shown case when the search or the tab filters the clicked
  // one out (or nothing was clicked yet).
  const selected =
    shown.find((testCase) => testCase.slug === selectedSlug) ?? shown[0];

  return (
    <PageLayout>
      <PromptHeader
        command="--test-cases"
        blink
        comment={<>// the specs harnesses build against</>}
      />

      {status === "loading" && <LoadingState label="Loading catalog…" />}

      {status === "error" && (
        <p className={styles.error}>
          Couldn&apos;t reach the backend, so the test-case catalog is
          unavailable.
        </p>
      )}

      {status === "ready" && (
        <>
          <div className={styles.controls}>
            <nav className={styles.tabs} aria-label="Test type">
              {visibleTabs.map((entry) => (
                <NavLink
                  key={entry.tab}
                  to={routes.testCasesCatalog(entry.tab)}
                  className={
                    entry.tab === tab
                      ? `${styles.tab} ${styles.tabActive}`
                      : styles.tab
                  }
                >
                  {entry.label}
                </NavLink>
              ))}
            </nav>
            <input
              className={styles.search}
              type="search"
              placeholder="Search by title, tag, or difficulty…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search test cases"
            />
          </div>

          {selected === undefined ? (
            <p className={styles.empty}>No test cases match.</p>
          ) : (
            <div className={styles.split}>
              <div
                className={styles.index}
                role="listbox"
                aria-label="Test cases"
              >
                {shown.map((testCase) => (
                  <button
                    key={testCase.slug}
                    type="button"
                    role="option"
                    aria-selected={testCase.slug === selected.slug}
                    className={styles.row}
                    onClick={() => setSelectedSlug(testCase.slug)}
                  >
                    <span className={styles.rowHeading}>
                      <h2 className={styles.rowTitle}>{testCase.name}</h2>
                      <span className={styles.version}>
                        {testCase.latestVersion}
                      </span>
                      {hasShowcase(testCase) && (
                        <span
                          className={styles.marker}
                          role="img"
                          aria-label="Has a showcase"
                        >
                          ▶
                        </span>
                      )}
                    </span>
                    <span
                      className={styles.difficulty}
                      data-level={testCase.difficulty}
                    >
                      {testCase.difficulty}
                    </span>
                  </button>
                ))}
              </div>
              <PreviewPane testCase={selected} />
            </div>
          )}
        </>
      )}
    </PageLayout>
  );
}

// ---- Preview pane ------------------------------------------------------------

// The sticky preview of the selected case: the stage (its showcase's first
// media, looping), the filmstrip over the rest of the carousel, then the case's
// identity line, summary, tags, and the link into the detail page.
function PreviewPane({ testCase }: { testCase: TestCaseSummary }) {
  const { caseShowcaseMediaUrl } = useGalleryData();
  const showcase = testCase.showcase ?? null;
  const media = showcase?.media ?? [];
  // `caseShowcaseMediaUrl` is optional (a host may serve no case showcase media
  // at all); an unresolvable file falls back to the placeholder stage the same
  // way no media does.
  const resolve = (file: string): string | null =>
    showcase
      ? (caseShowcaseMediaUrl?.(
          testCase.slug,
          showcase.version,
          showcase.variant,
          file,
        ) ?? null)
      : null;

  return (
    <section className={styles.preview} aria-label="Case preview">
      <PreviewStage
        entry={media[0]}
        url={media[0] ? resolve(media[0].file) : null}
      />
      {media.length > 1 && <Filmstrip media={media} resolve={resolve} />}
      <div className={styles.previewHeader}>
        <div className={styles.previewHeading}>
          <h3 className={styles.previewTitle}>{testCase.name}</h3>
          <span className={styles.version}>{testCase.latestVersion}</span>
        </div>
        <span className={styles.difficulty} data-level={testCase.difficulty}>
          {testCase.difficulty}
        </span>
      </div>
      {testCase.summary && <p className={styles.summary}>{testCase.summary}</p>}
      {testCase.tags.length > 0 && (
        <ul className={styles.tags}>
          {testCase.tags.map((value) => (
            <li key={value} className={styles.tag}>
              {value}
            </li>
          ))}
        </ul>
      )}
      <Link
        to={routes.testCaseDetail(testCase.slug)}
        className={styles.openCase}
      >
        open case &rsaquo;
      </Link>
    </section>
  );
}

// The fixed-aspect stage the preview leads with. A replay plays itself in the
// player's `showcase` presentation (a picture of the game moving, no scrubber
// in the layout), a video loops muted, an image just shows. A case without a
// stageable entry — no showcase, or a host that cannot serve the file — holds
// the quiet placeholder (panel surface plus the cabinet mark) so the pane keeps
// its geometry, mirroring the home page's showcase stage.
function PreviewStage({
  entry,
  url,
}: {
  entry: ShowcaseMediaRef | undefined;
  url: string | null;
}) {
  if (entry === undefined || url === null) {
    return (
      <div className={`${styles.stage} ${styles.stagePlaceholder}`}>
        <CabinetIcon className={styles.stageMark} />
      </div>
    );
  }
  if (entry.kind === "replay") {
    return (
      <div className={styles.stage}>
        <ReplayPlayer url={url} label={entry.name} presentation="showcase" />
      </div>
    );
  }
  if (entry.kind === "video") {
    // A bare autoplaying, muted loop rather than a controlled player: the stage
    // plays itself.
    return (
      <div className={styles.stage}>
        <video
          className={styles.stageMedia}
          src={url}
          muted
          autoPlay
          loop
          playsInline
          aria-label={entry.name}
        />
      </div>
    );
  }
  return (
    <div className={styles.stage}>
      <img className={styles.stageMedia} src={url} alt={entry.name} />
    </div>
  );
}

// The strip under the stage: a glance at the rest of the carousel — the stage
// already plays the first entry, so the strip starts at the second — capped at
// three thumbs with a "+n more" tail; the full carousel lives on the case's
// detail page, so the strip advertises rather than operates. An image entry
// shows the image itself; a replay or video — which has no cheap still — shows
// a play glyph over its kind.
function Filmstrip({
  media,
  resolve,
}: {
  media: ShowcaseMediaRef[];
  resolve: (file: string) => string | null;
}) {
  const thumbs = media.slice(1, 4);
  const more = media.length - 1 - thumbs.length;
  return (
    <div className={styles.filmstrip} aria-label="Showcase media">
      {thumbs.map((entry, index) => {
        const url = entry.kind === "image" ? resolve(entry.file) : null;
        return (
          <span
            key={`${index}-${entry.file}`}
            className={styles.filmThumb}
            role="img"
            aria-label={entry.name}
            title={entry.name}
          >
            {url !== null ? (
              <img className={styles.filmImage} src={url} alt="" />
            ) : (
              <span className={styles.filmGlyph} aria-hidden="true">
                ▶ {entry.kind}
              </span>
            )}
          </span>
        );
      })}
      {more > 0 && <span className={styles.filmMore}>+{more} more</span>}
    </div>
  );
}

// Scope to the selected tab, then a case-insensitive search over the title,
// tags, and difficulty — so tags and difficulty are usable as filters even
// though the tab bar is the only faceted control.
function matches(
  testCase: TestCaseSummary,
  query: string,
  tab: CatalogTab,
): boolean {
  if (!inTab(testCase, tab)) return false;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [testCase.name, testCase.difficulty, ...testCase.tags]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}
