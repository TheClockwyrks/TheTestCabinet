import type { ReactElement } from "react";
import type { RunRecord } from "@test-cabinet/run-record";
import { PageLayout } from "../../components/PageLayout";
import { useDesignVariant } from "../../design/useDesignVariant";
import type { DesignVariantId } from "../../design/variants";
import { useRuns } from "../../data/useRuns";
import { CabinetGallery } from "./variants/CabinetGallery";
import { TerminalGallery } from "./variants/TerminalGallery";
import { NeonGridGallery } from "./variants/NeonGridGallery";
import { MinimalGallery } from "./variants/MinimalGallery";
import { NeonLogGallery } from "./variants/NeonLogGallery";
import styles from "./GalleryPage.module.scss";

export interface GalleryProps {
  runs: RunRecord[];
  /** Ids of runs that are local/unpublished, for badging. */
  localIds: ReadonlySet<string>;
}

// Each design variant renders the gallery its own way; they all consume the same
// run list. The switcher decides which one is shown.
const GALLERIES: Record<DesignVariantId, (props: GalleryProps) => ReactElement> = {
  cabinet: CabinetGallery,
  crt: TerminalGallery,
  neon: NeonGridGallery,
  minimal: MinimalGallery,
  neonlog: NeonLogGallery,
};

export function GalleryPage() {
  const { variant } = useDesignVariant();
  const { runs, localIds } = useRuns();
  const Gallery = GALLERIES[variant];

  return (
    <PageLayout>
      {runs.length === 0 ? (
        <p className={styles.empty}>No runs have been published yet.</p>
      ) : (
        <Gallery runs={runs} localIds={localIds} />
      )}
    </PageLayout>
  );
}
