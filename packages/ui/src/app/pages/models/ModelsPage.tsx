import { Link } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import type { ModelSummary } from "../../data/models";
import { useModels } from "../../data/useModels";
import { providerLogo } from "../../data/providerLogo";
import { formatCompact, formatUsd } from "../../format";
import { routes } from "../../routes";
import styles from "./ModelsPage.module.scss";

// Models: the curated catalog as a dense, column-aligned table — one row per
// model showing its provider, name, comparable per-token input/output prices,
// and context window, each row linking to the model's detail page. Like the home
// gallery's run log this is a browse view, not a leaderboard: rows appear in
// catalog order with no ranking or score.
export function ModelsPage() {
  const { models } = useModels();

  return (
    <PageLayout>
      <section className={styles.section}>
        <PromptHeader
          command="--models"
          blink
          comment={<>// the models we put through the cabinet</>}
        />

        {models.length === 0 ? (
          <p className={styles.empty}>No models are in the catalog yet.</p>
        ) : (
          <div className={styles.table}>
            <div className={`${styles.row} ${styles.head}`} aria-hidden="true">
              <span />
              <span>MODEL</span>
              <span>PROVIDER</span>
              <span className={styles.num}>INPUT / MTOK</span>
              <span className={styles.num}>OUTPUT / MTOK</span>
              <span className={styles.num}>CONTEXT</span>
            </div>
            {models.map((model) => (
              <ModelRow key={model.slug} model={model} />
            ))}
          </div>
        )}
      </section>
    </PageLayout>
  );
}

function ModelRow({ model }: { model: ModelSummary }) {
  const logo = providerLogo(model.provider);
  return (
    <Link to={routes.modelDetail(model.slug)} className={styles.row}>
      <span className={styles.rowCaret}>&rsaquo;</span>
      <span className={styles.identity}>
        {logo && (
          <span
            className={styles.logo}
            style={{
              maskImage: `url(${logo})`,
              WebkitMaskImage: `url(${logo})`,
            }}
            aria-hidden="true"
          />
        )}
        <span className={styles.name}>{model.name}</span>
      </span>
      <span className={styles.provider} data-label="Provider">
        {model.provider}
      </span>
      <Price
        value={model.prices ? model.prices.uncachedInput * 1e6 : null}
        label="Input / Mtok"
      />
      <Price
        value={model.prices ? model.prices.output * 1e6 : null}
        label="Output / Mtok"
      />
      <span
        className={`${styles.num}${model.contextLength == null ? ` ${styles.muted}` : ""}`}
        data-label="Context"
      >
        {model.contextLength != null ? formatCompact(model.contextLength) : "—"}
      </span>
    </Link>
  );
}

// A per-token price cell, right-aligned to align like printed figures, or a muted
// dash when the catalog has no resolved price for this model.
function Price({ value, label }: { value: number | null; label: string }) {
  return (
    <span
      className={`${styles.num}${value == null ? ` ${styles.muted}` : ""}`}
      data-label={label}
    >
      {value != null ? formatUsd(value) : "—"}
    </span>
  );
}
