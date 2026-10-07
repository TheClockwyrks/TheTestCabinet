import type { ArmMetric, PresentedRatio } from "./comparisonMath";
import styles from "./Comparisons.module.scss";

interface MedianRatioTileProps {
  /** What the tile compares, such as "Median cost". */
  title: string;
  /** The two arms and the ratio of their medians, the higher arm first. */
  ratio: PresentedRatio;
  /** The metric the ratio was taken over, which is where each median is read. */
  metric: ArmMetric;
  /** Writes a median as the reader sees it. */
  format: (value: number) => string;
  /** Each arm's identity color, by arm id. */
  colorForArm: ReadonlyMap<string, string>;
}

/**
 * A two-arm comparison's ratio for one metric (docs/comparisons/statistics.md,
 * "Comparing two arms"): the ratio as the tile's figure, and under it each arm's
 * median beside a bar scaled to the higher one, so the size of the gap reads
 * before any number does. The ratio is a presented number rather than a verdict,
 * so the only colors here are the arms' own.
 */
export function MedianRatioTile({
  title,
  ratio,
  metric,
  format,
  colorForArm,
}: MedianRatioTileProps) {
  // A ratio exists only when both arms have a distribution for the metric.
  const higherMedian = ratio.higher[metric]!.median;
  const rows = [ratio.higher, ratio.lower].map((result) => {
    const median = result[metric]!.median;
    return {
      id: result.arm.id,
      label: result.arm.label,
      median,
      // The higher median is above zero whenever a ratio is presented.
      share: Math.min(1, Math.max(0, median / higherMedian)),
      color: colorForArm.get(result.arm.id),
    };
  });

  return (
    <section className={styles.ratioTile} aria-label={title}>
      <h2 className={styles.ratioTileTitle}>{title}</h2>
      <p className={styles.ratioTileFigure}>
        ~{ratio.ratio.toFixed(1)}×
        <span className={styles.ratioTileCaption}>
          higher median over lower
        </span>
      </p>
      <dl className={styles.ratioTileRows}>
        {rows.map((row) => (
          <div key={row.id} className={styles.ratioTileRow}>
            <dt className={styles.ratioTileArm}>
              <span
                className={styles.armSwatch}
                style={{ background: row.color }}
                aria-hidden
              />
              <span className={styles.ratioTileArmLabel}>{row.label}</span>
            </dt>
            <dd className={styles.ratioTileValue}>{format(row.median)}</dd>
            <dd className={styles.ratioTileTrack} aria-hidden>
              <span
                className={styles.ratioTileBar}
                data-testid="median-bar"
                style={{
                  width: `${(row.share * 100).toFixed(1)}%`,
                  background: row.color,
                }}
              />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
