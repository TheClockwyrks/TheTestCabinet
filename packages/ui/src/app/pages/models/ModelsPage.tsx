import { Fragment, useMemo, useRef, type ReactNode } from "react";
import { Link } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { LoadingState } from "../../components/LoadingState";
import { PromptHeader } from "../../components/PromptHeader";
import { ColumnMenu, type ColumnMenuHandle } from "../../components/ColumnMenu";
import { SortableHeaderCell } from "../../components/SortableHeaderCell";
import { useColumnVisibility } from "../../components/useColumnVisibility";
import { useResizableColumns } from "../../components/useResizableColumns";
import { sortRows, useTableSort } from "../../components/useTableSort";
import type { ModelSummary } from "../../data/models";
import { useModels } from "../../data/useModels";
import { useModelConfig } from "../../data/useModelConfig";
import { ModelProviderMark } from "../../components/ModelProviderMark";
import { formatCompact, formatUsd, perMillion } from "../../format";
import { routes } from "../../routes";
import styles from "./ModelsPage.module.scss";

// One column of the model catalog: its header and grid track, how it renders a
// row, and — when sortable — the key it orders by. Every data column is optional
// (hideable via the picker) and starts visible; only the caret gutter is fixed.
interface ModelColumn {
  id: string;
  label: string;
  default: string;
  min: number;
  resizable?: boolean;
  numeric?: boolean;
  optional?: boolean;
  sortKey?: (model: ModelSummary) => string | number | null;
  render: (model: ModelSummary) => ReactNode;
}

const MODEL_COLUMNS: readonly ModelColumn[] = [
  {
    id: "caret",
    label: "",
    default: "1.2rem",
    min: 20,
    resizable: false,
    render: () => <span className={styles.rowCaret}>&rsaquo;</span>,
  },
  {
    id: "name",
    label: "MODEL",
    default: "1.6fr",
    min: 96,
    optional: true,
    sortKey: (model) => model.name.toLowerCase(),
    render: (model) => (
      <span className={styles.identity}>
        <ModelProviderMark
          logoSvg={model.logoSvg}
          provider={model.provider}
          className={styles.logo}
        />
        <span className={styles.name}>{model.name}</span>
      </span>
    ),
  },
  {
    id: "provider",
    label: "PROVIDER",
    default: "8rem",
    min: 72,
    optional: true,
    sortKey: (model) => model.provider.toLowerCase(),
    render: (model) => (
      <span className={styles.provider} data-label="Provider">
        {model.provider}
      </span>
    ),
  },
  {
    id: "input",
    label: "INPUT",
    default: "7rem",
    min: 64,
    numeric: true,
    optional: true,
    sortKey: (model) => perMillion(model.prices?.uncachedInput ?? null),
    render: (model) => (
      <Price
        value={perMillion(model.prices?.uncachedInput ?? null)}
        label="Input"
      />
    ),
  },
  {
    id: "output",
    label: "OUTPUT",
    default: "7rem",
    min: 64,
    numeric: true,
    optional: true,
    sortKey: (model) => perMillion(model.prices?.output ?? null),
    render: (model) => (
      <Price value={perMillion(model.prices?.output ?? null)} label="Output" />
    ),
  },
  {
    id: "context",
    label: "CONTEXT",
    default: "6rem",
    min: 56,
    numeric: true,
    optional: true,
    sortKey: (model) => model.contextLength ?? null,
    render: (model) => (
      <span
        className={`${styles.num}${model.contextLength == null ? ` ${styles.muted}` : ""}`}
        data-label="Context"
      >
        {model.contextLength != null ? formatCompact(model.contextLength) : "—"}
      </span>
    ),
  },
];

const MODEL_COLUMN_BY_ID = new Map(
  MODEL_COLUMNS.map((column) => [column.id, column]),
);

// Models: the curated catalog as a dense, column-aligned table — one row per
// model showing its provider, name, comparable per-token input/output prices,
// and context window, each row linking to the model's detail page. Rows default
// to catalog order; the headers can be clicked to sort by any column, columns are
// user-resizable, and the optional columns can be shown/hidden via the picker.
export function ModelsPage() {
  const { models, status } = useModels();
  // The add affordance shows only where curating a model is possible (a signed-in
  // console with a config-capable backend); it is null (hidden) otherwise.
  const config = useModelConfig();
  const { sort, cycle } = useTableSort("ttc:sort:models");
  const { isVisible, toggle } = useColumnVisibility(
    "ttc:visible:models",
    MODEL_COLUMNS,
  );
  const menuRef = useRef<ColumnMenuHandle>(null);

  const sorted = useMemo(
    () => sortRows(models, sort, (id) => MODEL_COLUMN_BY_ID.get(id)?.sortKey),
    [models, sort],
  );
  const visible = useMemo(
    () => MODEL_COLUMNS.filter((column) => isVisible(column.id)),
    [isVisible],
  );
  const table = useResizableColumns({
    storageKey: "ttc:cols:models",
    columns: visible,
  });

  return (
    <PageLayout>
      <section className={styles.section}>
        <div className={styles.header}>
          <PromptHeader
            command="--models"
            blink
            comment={<>// the models we put through the cabinet</>}
          />
          {config && (
            <Link className={styles.addButton} to={routes.modelNew()}>
              + Add model
            </Link>
          )}
        </div>

        {/* The three states are distinct and must read that way: a fetch in
            flight is a wait, an unreachable backend is a fault, and only a
            resolved-but-empty catalog is genuinely "no models yet". Reporting
            the first two as the third told a visitor the cabinet was empty
            while it was still being read. */}
        {status === "loading" ? (
          <LoadingState label="Loading models…" />
        ) : status === "error" ? (
          <p className={styles.empty}>
            Couldn&apos;t reach the backend — the model catalog is unavailable.
          </p>
        ) : models.length === 0 ? (
          <p className={styles.empty}>No models are in the catalog yet.</p>
        ) : (
          <div className={styles.wrap}>
            <div className={styles.menuAnchor}>
              <ColumnMenu
                ref={menuRef}
                columns={MODEL_COLUMNS}
                isVisible={isVisible}
                onToggle={toggle}
              />
            </div>
            <div className={styles.table} ref={table.containerRef}>
              <div
                className={`${styles.row} ${styles.head}`}
                data-ttc-head
                onContextMenu={(event) => {
                  event.preventDefault();
                  menuRef.current?.openAt(event.clientX, event.clientY);
                }}
              >
                {visible.map((column, index) => (
                  <SortableHeaderCell
                    key={column.id}
                    columnId={column.id}
                    label={column.label}
                    numeric={column.numeric}
                    sortable={typeof column.sortKey === "function"}
                    sort={sort}
                    onSort={cycle}
                    handle={table.handle(index)}
                  />
                ))}
              </div>
              {sorted.map((model) => (
                <Link
                  key={model.slug}
                  to={routes.modelDetail(model.slug)}
                  className={styles.row}
                >
                  {visible.map((column) => (
                    <Fragment key={column.id}>{column.render(model)}</Fragment>
                  ))}
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>
    </PageLayout>
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
