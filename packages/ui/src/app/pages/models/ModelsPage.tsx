import { Link } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import {
  useResizableColumns,
  type ResizableColumn,
} from "../../components/useResizableColumns";
import type { ModelSummary } from "../../data/models";
import { useModels } from "../../data/useModels";
import { providerLogo } from "../../data/providerLogo";
import { formatCompact, formatUsd, perMillion } from "../../format";
import { routes } from "../../routes";
import styles from "./ModelsPage.module.scss";

// The column tracks, matching the header/row grid in ModelsPage.module.scss:
// caret · model · provider · input · output · context. The caret gutter isn't
// user-resizable; every other column can be dragged down to its minimum.
const MODELS_COLUMNS: ResizableColumn[] = [
  { default: "1.2rem", min: 20, resizable: false },
  { default: "1.6fr", min: 96 },
  { default: "8rem", min: 72 },
  { default: "7rem", min: 64 },
  { default: "7rem", min: 64 },
  { default: "6rem", min: 56 },
];

// Models: the curated catalog as a dense, column-aligned table — one row per
// model showing its provider, name, comparable per-token input/output prices,
// and context window, each row linking to the model's detail page. Like the home
// gallery's run log this is a browse view, not a leaderboard: rows appear in
// catalog order with no ranking or score. Columns are user-resizable by dragging
// the boundaries in the header (widths persist locally).
export function ModelsPage() {
  const { models } = useModels();
  const table = useResizableColumns({
    storageKey: "ttc:cols:models",
    columns: MODELS_COLUMNS,
  });

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
          <div className={styles.table} ref={table.containerRef}>
            <div
              className={`${styles.row} ${styles.head}`}
              data-ttc-head
              aria-hidden="true"
            >
              <span>{table.handle(0)}</span>
              <span>MODEL{table.handle(1)}</span>
              <span>PROVIDER{table.handle(2)}</span>
              <span className={styles.num}>INPUT{table.handle(3)}</span>
              <span className={styles.num}>OUTPUT{table.handle(4)}</span>
              <span className={styles.num}>CONTEXT{table.handle(5)}</span>
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
        value={perMillion(model.prices?.uncachedInput ?? null)}
        label="Input"
      />
      <Price
        value={perMillion(model.prices?.output ?? null)}
        label="Output"
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
