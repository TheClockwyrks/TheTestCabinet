import { PageLayout } from "../../components/PageLayout";
import { RunCard } from "../../components/RunCard";
import { runs } from "../../data/runs";
import styles from "./GalleryPage.module.scss";

export function GalleryPage() {
  return (
    <PageLayout>
      {runs.length === 0 ? (
        <p className={styles.empty}>No runs have been published yet.</p>
      ) : (
        <div className={styles.grid}>
          {runs.map((run) => (
            <RunCard key={run.id} run={run} />
          ))}
        </div>
      )}
    </PageLayout>
  );
}
