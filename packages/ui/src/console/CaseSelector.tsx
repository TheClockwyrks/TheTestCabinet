import styles from "./Console.module.scss";
import type { CatalogSelection } from "./useCatalog";

// The cascading test case / version / variant dropdowns, shared by the run and
// specs screens. Driven entirely by a `useCatalog` selection.
export function CaseSelector({ sel }: { sel: CatalogSelection }) {
  const versions = sel.cases.find((c) => c.slug === sel.slug)?.versions ?? [];
  return (
    <div className={styles.fields}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Test case</span>
        <select
          className={styles.select}
          value={sel.slug}
          onChange={(e) => sel.setSlug(e.target.value)}
        >
          {sel.cases.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.slug}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Version</span>
        <select
          className={styles.select}
          value={sel.version}
          onChange={(e) => sel.setVersion(e.target.value)}
        >
          {versions.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Variant</span>
        <select
          className={styles.select}
          value={sel.variant}
          onChange={(e) => sel.setVariant(e.target.value)}
          disabled={!sel.versionInfo}
        >
          {(sel.versionInfo?.variants ?? []).map((v) => (
            <option key={v.slug} value={v.slug}>
              {v.name} ({v.slug})
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
