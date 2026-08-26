import { useState } from "react";
import type {
  RunRecord,
  RunShowcase,
  ShowcaseMedia,
} from "@test-cabinet/run-record";
import { Markdown, Panel } from "@test-cabinet/ui";
import { MediaView } from "../../../components/MediaView";
import { useGalleryData } from "../../../data/galleryContext";
import { PlayableSection } from "../PlayableSection";
import { FullscreenViewport } from "./FullscreenViewport";
import styles from "./ShowcaseSection.module.scss";

// One carousel entry on the stage: the media itself (dispatched by kind — an
// image, a video with native controls, or a replay in the scrubbing player) under
// its caption. An image gets the shared fullscreen expand; a replay carries its
// own transport and a video its native fullscreen, so neither needs one. A file
// the host cannot serve (no resolver, or nothing behind the name) reads as a
// note rather than a broken viewer.
function ShowcaseStage({
  entry,
  url,
}: {
  entry: ShowcaseMedia;
  url: string | null;
}) {
  return (
    <figure className={styles.stageFigure}>
      {url === null ? (
        <p className={styles.unavailable}>
          {entry.name} ({entry.file}) is not available here.
        </p>
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
// which has no cheap still — shows a play glyph over its kind.
function ShowcaseStrip({
  media,
  index,
  onSelect,
  resolve,
}: {
  media: ShowcaseMedia[];
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
                ▶ {entry.kind}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// The Play tab's showcase presentation: the model's own store-page pitch for the
// game it built, rendered around the playable build. Top to bottom: the media
// carousel (the record's ordered entries — carousel order is presentation
// order), the same gated launch panel the plain Play tab shows (the build stays
// one obvious click away), and the markdown description with its bare relative
// image references (`![Title](title.png)`) resolved to the run's served
// showcase files.
//
// Media bytes never ride the record — every file resolves through the gallery's
// run-scoped `showcaseMediaUrl`, which the consoles point at the backend/worker
// showcase endpoint and the static site at the snapshot's published assets. A
// run without a showcase never reaches this component: the Play tab renders the
// plain {@link PlayableSection} alone, exactly as it did before showcases
// existed.
export function ShowcaseSection({
  run,
  showcase,
}: {
  run: RunRecord;
  showcase: RunShowcase;
}) {
  const { showcaseMediaUrl } = useGalleryData();
  const resolve = (file: string): string | null =>
    showcaseMediaUrl?.(run.id, file) ?? null;

  const media = showcase.media;
  const [index, setIndex] = useState(0);
  // Clamp rather than trust: the record caps the carousel, but the index is
  // local state and the record could in principle change under a refetch.
  const shown = Math.max(0, Math.min(index, media.length - 1));
  const current = media[shown];

  return (
    <div className={styles.showcase}>
      {current !== undefined && (
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
      )}
      <PlayableSection run={run} />
      <Panel>
        <Markdown className={styles.description} resolveImageUrl={resolve}>
          {showcase.description}
        </Markdown>
      </Panel>
    </div>
  );
}
