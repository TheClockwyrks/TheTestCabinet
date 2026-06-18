import { useEffect, useState } from "react";
import styles from "../App.module.scss";
import { isTauri, readSpecs, type Specification } from "../api";
import { useCatalog } from "../useCatalog";
import { CaseSelector } from "./CaseSelector";

// Read the specification a run is built from: the case description plus every
// seeded spec for the chosen variant. This is what a reviewer judges a produced
// implementation against.
export function SpecsView() {
  const sel = useCatalog();
  const [spec, setSpec] = useState<Specification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isTauri() || !sel.slug || !sel.version || !sel.variant) {
      setSpec(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    readSpecs(sel.slug, sel.version, sel.variant)
      .then((s) => {
        if (active) setSpec(s);
      })
      .catch((e) => {
        if (active) setError(String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [sel.slug, sel.version, sel.variant]);

  return (
    <div className={styles.view}>
      <h2 className={styles.viewTitle}>Read the specs</h2>
      <CaseSelector sel={sel} />

      {loading && <p className={styles.muted}>Loading specification…</p>}
      {(error || sel.error) && (
        <p className={`${styles.notice} ${styles.error}`}>{error ?? sel.error}</p>
      )}

      {spec && (
        <div className={styles.specs}>
          {spec.description && (
            <details className={styles.spec} open>
              <summary className={styles.specSummary}>Description</summary>
              <pre className={styles.specBody}>{spec.description}</pre>
            </details>
          )}
          {spec.specs.length === 0 && !spec.description && (
            <p className={styles.muted}>This variant seeds no spec files.</p>
          )}
          {spec.specs.map((doc) => (
            <details key={doc.dest} className={styles.spec} open>
              <summary className={styles.specSummary}>{doc.dest}</summary>
              <pre className={styles.specBody}>{doc.body}</pre>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
