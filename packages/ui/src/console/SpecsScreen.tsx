import { useEffect, useState } from "react";
import { Markdown } from "../primitives/Markdown";
import { SpecAccordion, type AccordionEntry } from "../primitives/SpecAccordion";
import { useBackend } from "../client/context";
import type { Specification } from "../client/types";
import { CaseSelector } from "./CaseSelector";
import { useCatalog } from "./useCatalog";
import styles from "./Console.module.scss";

// Read the specification a run is built from: the case description plus every
// seeded spec for the chosen variant. This is what a reviewer judges a produced
// implementation against. Resolved from the active backend.
export function SpecsScreen() {
  const { client } = useBackend();
  const sel = useCatalog();
  const [spec, setSpec] = useState<Specification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!client || !sel.slug || !sel.version || !sel.variant) {
      setSpec(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    client
      .readSpecs(sel.slug, sel.version, sel.variant)
      .then((s) => active && setSpec(s))
      .catch((e) => active && setError(String(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [client, sel.slug, sel.version, sel.variant]);

  const entries: AccordionEntry[] = spec
    ? [
        ...(spec.description
          ? [
              {
                path: "Description",
                kind: "text",
                body: <Markdown>{spec.description}</Markdown>,
              },
            ]
          : []),
        ...spec.specs.map((doc) => ({
          path: doc.dest,
          kind: "text",
          body: <Markdown>{doc.body}</Markdown>,
        })),
      ]
    : [];

  return (
    <div className={styles.view}>
      <h2 className={styles.viewTitle}>Read the specs</h2>
      <CaseSelector sel={sel} />

      {sel.noBackend && (
        <p className={`${styles.notice} ${styles.warn}`}>
          No backend configured — open the Connections tab to point the console at
          a backend instance to resolve test cases.
        </p>
      )}
      {loading && <p className={styles.muted}>Loading specification…</p>}
      {(error || sel.error) && (
        <p className={`${styles.notice} ${styles.error}`}>{error ?? sel.error}</p>
      )}

      {spec && (
        <div className={styles.specs}>
          <SpecAccordion
            entries={entries}
            emptyLabel="This variant seeds no spec files."
          />
        </div>
      )}
    </div>
  );
}
