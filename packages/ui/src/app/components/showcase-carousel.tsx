import { useState } from "react";

import { MediaView } from "./MediaView";
import styles from "./showcase-carousel.module.scss";
import type { MediaKind } from "../../client/types";
import { FullscreenViewport } from "../pages/runs/[runId]/FullscreenViewport";
import { ReplayPlayer } from "../pages/runs/replay/ReplayPlayer";

/** One entry of a showcase carousel: the media file, its caption, and the kind
 * the file's extension names. The run, case and suite showcases are one format,
 * so one entry shape serves all three. */
export interface ShowcaseCarouselEntry {
  /** The media file's plain name inside the showcase directory — what the
   * caller's resolver turns into a loadable URL. */
  file: string;
  /** The short caption displayed with the entry. */
  name: string;
  kind: MediaKind;
}

// One carousel entry on the stage: the media itself under its caption. An image
// gets the shared fullscreen expand; a video carries its native fullscreen and a
// replay plays itself. A file the host cannot serve (no resolver, or nothing
// behind the name) reads as a note rather than a broken viewer.
//
// A replay is staged in the player's `showcase` presentation rather than through
// {@link MediaView}: it belongs beside the screenshots as another picture of the
// game running, so it plays on a loop and keeps its scrubber off the layout,
// which is what lets the stage hold one height as the carousel steps.
function ShowcaseStage({
  entry,
  url,
}: {
  entry: ShowcaseCarouselEntry;
  url: string | null;
}) {
  return (
    <figure className={styles.stageFigure}>
      <StageMedia entry={entry} url={url} />
      <figcaption className={styles.caption}>{entry.name}</figcaption>
    </figure>
  );
}

// What the stage shows for one entry: the replay player, the image with its
// fullscreen view, or the plain media view, and a note when the host cannot
// resolve the file.
function StageMedia({
  entry,
  url,
}: {
  entry: ShowcaseCarouselEntry;
  url: string | null;
}) {
  if (url === null) {
    return (
      <p className={styles.unavailable}>
        {entry.name} ({entry.file}) is not available here.
      </p>
    );
  }
  switch (entry.kind) {
    case "replay": {
      return (
        <ReplayPlayer url={url} label={entry.name} presentation="showcase" />
      );
    }
    case "image": {
      return (
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
      );
    }
    default: {
      return <MediaView kind={entry.kind} url={url} alt={entry.name} />;
    }
  }
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
  media: readonly ShowcaseCarouselEntry[];
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
            key={`${String(i)}-${entry.file}`}
            type="button"
            role="tab"
            aria-selected={i === index}
            className={
              i === index
                ? [styles.thumb, styles.thumbActive].filter(Boolean).join(" ")
                : styles.thumb
            }
            title={entry.name}
            aria-label={`Show ${entry.name}`}
            onClick={() => {
              onSelect(i);
            }}
          >
            {url === null ? (
              <span className={styles.thumbGlyph} aria-hidden="true">
                ▶
              </span>
            ) : (
              <img className={styles.thumbImage} src={url} alt="" />
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A showcase's media carousel: the staged entry with its caption, and the
 * thumbnail strip that steps through the rest, in the order the showcase
 * declares.
 *
 * Shared by every showcase there is — a run's model-written one and a suite's
 * authored one — so the same presentation serves all of them rather than each
 * surface growing its own. Media bytes never ride a record: every file resolves
 * through the caller's `resolve`, which each host points at whatever serves that
 * showcase's files (the backend's run or suite route, or the static site's
 * published objects). A resolver that answers null for a file renders the note in
 * place of the viewer.
 *
 * Renders nothing when the carousel is empty, so a caller may hand it whatever
 * the showcase carries.
 */
export function ShowcaseCarousel({
  media,
  resolve,
}: {
  media: readonly ShowcaseCarouselEntry[];
  resolve: (file: string) => string | null;
}) {
  const [index, setIndex] = useState(0);
  // Clamp rather than trust: the record caps the carousel, but the index is
  // local state and the media could in principle change under a refetch.
  const shown = Math.max(0, Math.min(index, media.length - 1));
  const current = media[shown];
  return current === undefined ? null : (
    <section className={styles.carousel} aria-label="Showcase">
      <ShowcaseStage entry={current} url={resolve(current.file)} />
      {media.length > 1 && (
        <div className={styles.stripRow}>
          <button
            type="button"
            className={styles.step}
            aria-label="Previous media"
            disabled={shown === 0}
            onClick={() => {
              setIndex(shown - 1);
            }}
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
            onClick={() => {
              setIndex(shown + 1);
            }}
          >
            ›
          </button>
        </div>
      )}
    </section>
  );
}
