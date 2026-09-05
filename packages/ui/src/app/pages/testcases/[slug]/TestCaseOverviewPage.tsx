import { useState } from "react";
import { Markdown, Panel } from "@clockwyrks/ui";
import { MediaView } from "../../../components/MediaView";
import { ReferencePlayable } from "../../../components/PlayableEmbed";
import { engineName } from "../../../data/engines";
import { useGalleryData } from "../../../data/galleryContext";
import type { ShowcaseMediaRef, TestCaseDetail } from "../../../data/testCases";
import {
  TestCaseDetailLayout,
  type DetailTabContext,
} from "../../../layouts/testcases/TestCaseDetailLayout";
import { FullscreenViewport } from "../../runs/[runId]/FullscreenViewport";
import { ReplayPlayer } from "../../runs/replay/ReplayPlayer";
import shared from "./TestCaseDetailPages.module.scss";
import styles from "./TestCaseOverviewPage.module.scss";

// The detail landing tab (`/test-cases/:slug`, tab id "overview"): the case's
// Play surface. Top to bottom, each part appearing only when the anchored
// coordinate carries it:
//
//   • The variant's authored showcase carousel — media captured from the
//     reference implementation, committed with the version. Mirrors the run
//     Play tab's ShowcaseSection: a stage with a thumbnail strip and prev/next
//     steppers, resolving every file through the gallery's case-scoped
//     `caseShowcaseMediaUrl` (a host without the resolver notes the file as
//     unavailable rather than mounting a broken viewer).
//   • The reference-implementation launch panel — the deployed build for the
//     anchored engine, embedded inline (this is where the old Reference tab's
//     build embed folded to; the tab remains only for asset cases' frames).
//   • The description panel — always. The case's site-facing description plus,
//     when the variant declares a showcase, its authored `showcase.md`.
//
// A coordinate with neither showcase nor builds renders the description alone,
// which is exactly the page's old Overview shape (and the layout labels the tab
// "Overview" again in that case).
export function TestCaseOverviewPage() {
  return (
    <TestCaseDetailLayout
      tab="overview"
      // The description reads nothing off the resolved coordinate, so it doubles
      // as the layout's fallback: it stays readable even on a host that cannot
      // resolve the selected rendering.
      fallback={({ testCase, version, isLatest }) => (
        <DescriptionPanel
          testCase={testCase}
          version={version}
          isLatest={isLatest}
        />
      )}
    >
      {(ctx) => <PlayBody ctx={ctx} />}
    </TestCaseDetailLayout>
  );
}

// The tab body for a resolved coordinate. A component (not inlined in the render
// prop) because it reads the gallery's media resolver with a hook.
function PlayBody({ ctx }: { ctx: DetailTabContext }) {
  const { testCase, version, isLatest, engine, variant } = ctx;
  const { caseShowcaseMediaUrl } = useGalleryData();
  // The case-side counterpart of the run showcase's run-scoped resolver: the
  // showcase is authored material of the anchored (version, variant), so the
  // whole coordinate keys the lookup.
  const resolve = (file: string): string | null =>
    caseShowcaseMediaUrl?.(testCase.slug, version, variant.slug, file) ?? null;

  const showcase =
    variant.showcase && variant.showcase.media.length > 0
      ? variant.showcase
      : null;

  return (
    <div className={styles.play}>
      {showcase && (
        <ShowcaseCarousel media={showcase.media} resolve={resolve} />
      )}
      {Object.keys(variant.referenceBuilds).length > 0 && (
        <Panel>
          <h2 className={styles.launchHeading}>
            Play the reference implementation
          </h2>
          <p className={styles.launchNote}>
            The reference build for {variant.name} · {engineName(engine)}.
          </p>
          <ReferencePlayable
            referenceBuilds={variant.referenceBuilds}
            variantName={variant.name}
            engine={engine}
            version={version}
          />
        </Panel>
      )}
      <DescriptionPanel
        testCase={testCase}
        version={version}
        isLatest={isLatest}
        showcaseDescription={variant.showcase?.description || null}
        resolve={resolve}
      />
    </div>
  );
}

// The case's site-facing description, written for readers browsing the gallery
// rather than seeded into a run.
//
// The description is a property of the CASE, not of a version — there is one
// `description.md`, kept current with the latest version — so anchoring the page
// to an older version does not swap it out. Instead the panel says plainly which
// version the prose accompanies, so a reader looking at a superseded deliverable
// is never left assuming the description describes it.
//
// When the anchored variant declares a showcase, its authored `showcase.md`
// renders below the case description, with its bare relative image references
// (`![Title](title.png)`) resolved to the served showcase files — the same rule
// the run showcase's description follows.
function DescriptionPanel({
  testCase,
  version,
  isLatest,
  showcaseDescription = null,
  resolve,
}: {
  testCase: TestCaseDetail;
  version: string;
  isLatest: boolean;
  showcaseDescription?: string | null;
  resolve?: (file: string) => string | null;
}) {
  return (
    <Panel>
      {!isLatest && (
        <p className={shared.anchorNote}>
          This description accompanies the latest version (
          {testCase.latestVersion}); you are viewing {version}.
        </p>
      )}
      {testCase.description ? (
        <Markdown>{testCase.description}</Markdown>
      ) : (
        <p className={shared.empty}>
          No description has been written for {testCase.name} yet.
        </p>
      )}
      {showcaseDescription && (
        <Markdown
          className={styles.showcaseDescription}
          resolveImageUrl={resolve}
        >
          {showcaseDescription}
        </Markdown>
      )}
    </Panel>
  );
}

// One carousel entry on the stage: the media itself under its caption. An image
// gets the shared fullscreen expand; a video carries its native fullscreen and a
// replay plays itself (the player's `showcase` presentation loops and keeps its
// scrubber off the layout, which is what lets the stage hold one height as the
// carousel steps). A file the host cannot serve (no resolver, or nothing behind
// the name) reads as a note rather than a broken viewer.
function ShowcaseStage({
  entry,
  url,
}: {
  entry: ShowcaseMediaRef;
  url: string | null;
}) {
  return (
    <figure className={styles.stageFigure}>
      {url === null ? (
        <p className={styles.unavailable}>
          {entry.name} ({entry.file}) is not available here.
        </p>
      ) : entry.kind === "replay" ? (
        <ReplayPlayer url={url} label={entry.name} presentation="showcase" />
      ) : entry.kind === "image" ? (
        <FullscreenViewport
          label={entry.name}
          hint="Esc to close"
          renderExpanded={(height) => (
            <img
              className={styles.expandedImage}
              style={{ maxHeight: height }}
              src={url}
              alt={entry.name}
            />
          )}
        >
          <MediaView kind={entry.kind} url={url} alt={entry.name} />
        </FullscreenViewport>
      ) : (
        <MediaView kind={entry.kind} url={url} alt={entry.name} />
      )}
      <figcaption className={styles.caption}>{entry.name}</figcaption>
    </figure>
  );
}

// The thumbnail strip under the stage: one button per carousel entry, in the
// carousel's order. An image entry shows the image itself; a replay or video —
// which has no cheap still — shows a play glyph.
function ShowcaseStrip({
  media,
  index,
  onSelect,
  resolve,
}: {
  media: ShowcaseMediaRef[];
  index: number;
  onSelect: (index: number) => void;
  resolve: (file: string) => string | null;
}) {
  return (
    <div className={styles.strip} role="tablist" aria-label="Showcase media">
      {media.map((entry, i) => {
        const url = entry.kind === "image" ? resolve(entry.file) : null;
        return (
          <button
            key={`${i}-${entry.file}`}
            type="button"
            role="tab"
            aria-selected={i === index}
            className={
              i === index
                ? `${styles.thumb} ${styles.thumbActive}`
                : styles.thumb
            }
            title={entry.name}
            aria-label={`Show ${entry.name}`}
            onClick={() => onSelect(i)}
          >
            {url !== null ? (
              <img className={styles.thumbImage} src={url} alt="" />
            ) : (
              <span className={styles.thumbGlyph} aria-hidden="true">
                ▶
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// The case-side showcase carousel: the variant's ordered media entries (carousel
// order is presentation order, exactly as authored) staged one at a time over a
// thumbnail strip with prev/next steppers. Modeled directly on the run Play
// tab's ShowcaseSection so the two surfaces read and behave as one.
function ShowcaseCarousel({
  media,
  resolve,
}: {
  media: ShowcaseMediaRef[];
  resolve: (file: string) => string | null;
}) {
  const [index, setIndex] = useState(0);
  // Clamp rather than trust: the manifest caps the carousel, but the index is
  // local state and the variant can change under a coordinate switch.
  const shown = Math.max(0, Math.min(index, media.length - 1));
  const current = media[shown];
  if (current === undefined) {
    return null;
  }

  return (
    <section className={styles.carousel} aria-label="Showcase">
      <ShowcaseStage entry={current} url={resolve(current.file)} />
      {media.length > 1 && (
        <div className={styles.stripRow}>
          <button
            type="button"
            className={styles.step}
            aria-label="Previous media"
            disabled={shown === 0}
            onClick={() => setIndex(shown - 1)}
          >
            ‹
          </button>
          <ShowcaseStrip
            media={media}
            index={shown}
            onSelect={setIndex}
            resolve={resolve}
          />
          <button
            type="button"
            className={styles.step}
            aria-label="Next media"
            disabled={shown === media.length - 1}
            onClick={() => setIndex(shown + 1)}
          >
            ›
          </button>
        </div>
      )}
    </section>
  );
}
