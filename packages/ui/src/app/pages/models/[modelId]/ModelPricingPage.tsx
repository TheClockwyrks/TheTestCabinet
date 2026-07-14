import { useMemo } from "react";
import {
  Chart,
  Panel,
  priceHistoryChart,
  type ChartPalette,
  type PricePoint,
} from "@test-cabinet/ui";
import type { ModelSummary } from "../../../data/models";
import {
  formatReleaseDate,
  formatUsd,
  perMillion,
} from "../../../format";
import { ModelDetailLayout } from "../../../layouts/models/ModelDetailLayout";
import styles from "./ModelPricingPage.module.scss";

// The two comparable series charted over time. Cached input is shown in the table
// but not the graph (the input/output pair is the comparison that matters).
const INPUT_SERIES = "Input";
const OUTPUT_SERIES = "Output";

// The Pricing tab (`/models/:modelId/pricing`): the model's comparable per-Mtok
// prices over time — a chart of the input and output series against a UTC time
// axis, plus a table of every recorded observation newest first. A series with no
// recorded value is dropped from the chart and its legend; an empty history hides
// the chart entirely and falls back to the model's current catalog prices.
export function ModelPricingPage() {
  return (
    <ModelDetailLayout tab="pricing">
      {({ model }) => <PricingContent model={model} />}
    </ModelDetailLayout>
  );
}

function PricingContent({ model }: { model: ModelSummary }) {
  const history = model.priceHistory;

  // Split the history into the two charted series, dropping observations where a
  // series has no price (so a partial history plots only its known points) and a
  // series that is null throughout (it never enters the chart or the legend).
  const { points, seriesOrder } = useMemo(() => {
    const inputPoints: PricePoint[] = [];
    const outputPoints: PricePoint[] = [];
    for (const observation of history) {
      const date = new Date(observation.observedAt);
      const input = perMillion(observation.prices.uncachedInput);
      const output = perMillion(observation.prices.output);
      if (input !== null) {
        inputPoints.push({ date, value: input, series: INPUT_SERIES });
      }
      if (output !== null) {
        outputPoints.push({ date, value: output, series: OUTPUT_SERIES });
      }
    }
    const order: string[] = [];
    if (inputPoints.length > 0) order.push(INPUT_SERIES);
    if (outputPoints.length > 0) order.push(OUTPUT_SERIES);
    return { points: [...inputPoints, ...outputPoints], seriesOrder: order };
  }, [history]);

  // Memoized so <Chart> only re-plots when the data changes, not on every render.
  const spec = useMemo(
    () => (palette: ChartPalette) => priceHistoryChart(points, palette, seriesOrder),
    [points, seriesOrder],
  );

  // The table lists every observation newest first (the history arrives ascending).
  const rows = useMemo(() => [...history].reverse(), [history]);

  const hasChart = seriesOrder.length > 0;

  return (
    <section className={styles.section}>
      {hasChart ? (
        <Panel className={styles.chartPanel}>
          <h2 className={styles.sectionTitle}>Price / Mtok over time</h2>
          <Chart
            title="Input and output price per million tokens over time"
            spec={spec}
            className={styles.chart}
          />
        </Panel>
      ) : (
        <Panel>
          <p className={styles.empty}>No price history recorded yet.</p>
          {model.prices && (
            <div className={styles.currentGrid}>
              <Current
                label="Uncached input / Mtok"
                value={perMillion(model.prices.uncachedInput)}
              />
              <Current
                label="Cached input / Mtok"
                value={perMillion(model.prices.cachedInput)}
              />
              <Current
                label="Output / Mtok"
                value={perMillion(model.prices.output)}
              />
            </div>
          )}
        </Panel>
      )}

      {rows.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Observed</th>
                <th scope="col" className={styles.num}>
                  Uncached input
                </th>
                <th scope="col" className={styles.num}>
                  Cached input
                </th>
                <th scope="col" className={styles.num}>
                  Output
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((observation) => (
                <tr key={observation.observedAt}>
                  <td className={styles.observed}>
                    {formatReleaseDate(observation.observedAt)}
                  </td>
                  <Money
                    label="Uncached input"
                    value={perMillion(observation.prices.uncachedInput)}
                  />
                  <Money
                    label="Cached input"
                    value={perMillion(observation.prices.cachedInput)}
                  />
                  <Money
                    label="Output"
                    value={perMillion(observation.prices.output)}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// A per-Mtok figure cell, right-aligned like printed figures, muted-dash when the
// price was not recorded for this observation. `label` names the column so the
// cell can render it inline when the table reflows into cards on a phone.
function Money({ value, label }: { value: number | null; label: string }) {
  return (
    <td
      className={`${styles.num}${value == null ? ` ${styles.muted}` : ""}`}
      data-label={label}
    >
      {value != null ? formatUsd(value) : "—"}
    </td>
  );
}

// A current-price tile, shown as the fallback when there is no history to chart.
function Current({ label, value }: { label: string; value: number | null }) {
  return (
    <div className={styles.current}>
      <span className={styles.currentLabel}>{label}</span>
      <span
        className={`${styles.currentValue}${value == null ? ` ${styles.muted}` : ""}`}
      >
        {value != null ? formatUsd(value) : "—"}
      </span>
    </div>
  );
}
