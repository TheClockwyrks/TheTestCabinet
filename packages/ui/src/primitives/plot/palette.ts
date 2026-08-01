// The one categorical series palette, shared by every chart in the library that
// has to keep *entities* apart by color: an arm's identity in a comparison's
// distribution charts, a tool name in the tool-call breakdown, and a series in gg
// Discover's visualizations.
//
// It lives here rather than beside any one surface because the alternative is two
// palettes that drift, and a hue that means "arm 2" on one page and "series 3" on
// another is exactly the confusion a fixed order exists to prevent. New surfaces
// mint no new colors — they take these, in this order.
//
// **Validated, not eyeballed** (the dataviz skill's `validate_palette.js`):
//
// - `--mode dark --surface #120a1c`: chroma floor PASS, CVD adjacent-pair
//   separation PASS (worst `#a78bfa`↔`#22d3ee`, ΔE 11.4 deutan / 17.0 tritan),
//   normal-vision floor PASS (ΔE 21.2), contrast vs surface PASS (all ≥ 3:1).
// - `--mode light --surface #ffffff`: the same separation results, and contrast
//   drops to a **WARN** — which the validator says is dischargeable by "visible
//   labels or a table view", and both are structural here rather than optional. A
//   bar chart carries identity on its axis, a multi-series chart always draws a
//   legend, and Discover's table view is always reachable beside the chart because
//   the numbers behind a visualization are the record. That is the relief the WARN
//   asks for; it is not being waved away.
// - The **lightness band** check FAILs in both modes, and deliberately: every
//   accent and rating token in `styles/tokens.css` sits in the same high-lightness
//   range, so these are the app's established neon register rather than a defect
//   introduced by a chart. Snapping them into the generic mid band would make the
//   charts the only part of the product not wearing the product's palette.
//
// Charts read their *surface*, *text*, *border* and *accent* from the live
// `--tcab-*` custom properties (see `theme.ts`), so those follow whatever theme an
// embedding app supplies. These six are literal because a series' identity must not
// change with the theme — a legend swatch and a line have to be the same color in a
// screenshot pasted into either.
export const CATEGORICAL_COLORS: readonly string[] = [
  "#ff9d2f", // orange
  "#22d3ee", // cyan
  "#a78bfa", // violet
  "#4ade80", // green
  "#f472b6", // pink
  "#fde047", // yellow
];

/** The categorical color for the entity at `index` in a fixed-order list (an arm's
 * position among the comparison's arms, a tool name's rank by total calls, a
 * series' rank within one chart). Assigned in this fixed order and **never
 * cycled**, per the dataviz non-negotiable: a roster longer than the palette
 * repeats the last color rather than inventing an unvalidated hue, and a caller
 * that cares (gg's visualizations do) caps its roster at
 * {@link CATEGORICAL_COLORS}`.length` and says how many entities it left out. */
export function categoricalColor(index: number): string {
  return (
    CATEGORICAL_COLORS[index] ?? CATEGORICAL_COLORS[CATEGORICAL_COLORS.length - 1]!
  );
}
