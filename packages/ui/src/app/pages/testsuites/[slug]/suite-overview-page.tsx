import styles from "./suite-detail-pages.module.scss";
import { ShowcaseCarousel } from "../../../components/showcase-carousel";
import type { ShowcaseCarouselEntry } from "../../../components/showcase-carousel";
import { useGalleryData } from "../../../data/galleryContext";
import { showcaseMediaKind } from "../../../data/showcase-media-kind";
import { SuiteDetailLayout } from "../../../layouts/testsuites/suite-detail-layout";
import type { SuiteTabContext } from "../../../layouts/testsuites/suite-detail-layout";
import { Markdown, Panel } from "@clockwyrks/ui";

// The suite's landing tab (`/test-cases/suites/:suiteSlug`): the showcase, which
// is how a reader is told what the project IS before being told what it declares.
//
// Top to bottom: the showcase description (`showcase/showcase.md`, the
// player-facing store-page prose) with its bare relative image references
// resolved to the suite's served showcase files, the carousel in the order
// `showcase.toml` declares, and the manifest's own `description.md` below them —
// so the suite's player-facing and descriptive prose are both reachable from the
// landing tab.
//
// The carousel is the shared `ShowcaseCarousel`, the same one a run's showcase is
// staged through, so a suite's showcase and a run's read identically. Media bytes
// never ride the record: every file resolves through the gallery's
// `suiteShowcaseMediaUrl`, which points at the backend route that reads the
// stored suite version.
export function SuiteOverviewPage() {
  return (
    <SuiteDetailLayout tab="overview">
      {(ctx) => <SuiteOverview {...ctx} />}
    </SuiteDetailLayout>
  );
}

function SuiteOverview({ slug, version, suite }: SuiteTabContext) {
  const { suiteShowcaseMediaUrl } = useGalleryData();
  const resolve = (file: string): string | null =>
    suiteShowcaseMediaUrl?.(slug, version, file) ?? null;

  const showcase = suite.showcase;
  const declared = showcase?.manifest.media ?? [];
  // The suite showcase is served as the authored `showcase.toml`, which carries a
  // file and a caption and no kind, so each entry's kind is inferred from its
  // name by the contract's own mapping. A name that is no media kind this build
  // knows is named below the carousel rather than staged as a broken viewer.
  const media: ShowcaseCarouselEntry[] = [];
  const unknown: string[] = [];
  for (const entry of declared) {
    const kind = showcaseMediaKind(entry.file);
    if (kind === null) {
      unknown.push(entry.file);
      continue;
    }
    media.push({ file: entry.file, name: entry.name, kind });
  }

  return (
    <div className={styles.stack}>
      {showcase && (
        <Panel>
          <Markdown className={styles.prose} resolveImageUrl={resolve}>
            {showcase.description}
          </Markdown>
        </Panel>
      )}
      <ShowcaseCarousel media={media} resolve={resolve} />
      {unknown.length > 0 && (
        <p className={styles.note}>
          This console cannot show {unknown.join(", ")}.
        </p>
      )}
      <Panel>
        <Markdown className={styles.prose}>{suite.description}</Markdown>
      </Panel>
    </div>
  );
}
