import type { RunRecord, RunShowcase } from "@clockwyrks/run-record";
import { Markdown, Panel } from "@clockwyrks/ui";
import { ShowcaseCarousel } from "../../../components/showcase-carousel";
import { useGalleryData } from "../../../data/galleryContext";
import { PlayableSection } from "../PlayableSection";
import styles from "./ShowcaseSection.module.scss";

// The Play tab's showcase presentation: the model's own store-page pitch for the
// game it built, rendered around the playable build. Top to bottom: the media
// carousel (the record's ordered entries — carousel order is presentation
// order), the same gated launch panel the plain Play tab shows (the build stays
// one obvious click away), and the markdown description with its bare relative
// image references (`![Title](title.png)`) resolved to the run's served
// showcase files.
//
// The carousel itself is the shared {@link ShowcaseCarousel}, which a suite's
// landing page stages too, so every showcase there is reads identically.
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

  return (
    <div className={styles.showcase}>
      <ShowcaseCarousel media={showcase.media} resolve={resolve} />
      <PlayableSection run={run} />
      <Panel>
        <Markdown className={styles.description} resolveImageUrl={resolve}>
          {showcase.description}
        </Markdown>
      </Panel>
    </div>
  );
}
