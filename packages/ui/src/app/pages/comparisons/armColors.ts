// Categorical colors for the entities a comparison keeps visually distinct: an
// arm's identity in the distribution charts (ComparisonDetailPage), and a tool
// name's identity in the tool-call breakdown (comparisonMath's
// `toolCallChartData`). Six colors, validated (dataviz skill's
// `validate_palette.js`, mode dark, surface `#120a1c`) for CVD adjacent-pair
// separation and contrast; the OKLCH lightness sits above the generic
// mid-lightness band the validator otherwise recommends — an established,
// deliberate trait of this app's whole neon palette (every existing
// accent/rating token in `styles/tokens.css` sits in the same high range), not a
// defect introduced here. Assigned in this fixed order — never cycled, per the
// dataviz non-negotiable — by an entity's position in its own list; a roster
// longer than six degrades to repeating the last color rather than inventing an
// unvalidated one.
export const CATEGORICAL_COLORS: readonly string[] = [
  "#ff9d2f", // orange
  "#22d3ee", // cyan
  "#a78bfa", // violet
  "#4ade80", // green
  "#f472b6", // pink
  "#fde047", // yellow
];

/** The categorical color for the entity at `index` in a fixed-order list (an
 * arm's position among the comparison's arms, or a tool name's rank by total
 * calls). Never re-cycles past the end — a longer roster repeats the last
 * color rather than picking an unvalidated one. */
export function categoricalColor(index: number): string {
  return (
    CATEGORICAL_COLORS[index] ??
    CATEGORICAL_COLORS[CATEGORICAL_COLORS.length - 1]!
  );
}
