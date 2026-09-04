/**
 * The unit a [`CodeMetricDef`] is measured in, so an axis can be labelled and two
 * metrics can be told apart at a glance.
 */
export type CodeMetricUnit = "count" | "lines" | "bytes" | "ratio" | "perKiloLine" | "score" | "boolean";
/**
 * Display metadata for one leaf of [`CodeAnalysisSummary`].
 *
 * This is **not** a query vocabulary — the query language derives its field catalog from
 * observed documents, so a new metric needs no entry here to be queryable. It is what the
 * Code tab and the field sidebar read to label a figure, choose its formatting, and — the
 * reason it exists at all — say whether the figure is approximate.
 */
export type CodeMetricDef = {
    /**
     * The dotted path of the leaf inside [`CodeAnalysisSummary`]'s JSON, without the
     * `code.` namespace prefix the query document adds. `catalog_paths_resolve` asserts
     * every one of these resolves against a serialized summary, so a renamed field fails
     * the suite rather than silently unlabelling a chart.
     */
    path: string;
    /**
     * The short human label for an axis, a table header or a sidebar row.
     */
    label: string;
    /**
     * What the number is measured in.
     */
    unit: CodeMetricUnit;
    /**
     * The family the metric belongs to, matching the top-level block of the summary, so
     * the sidebar can group without re-deriving it from the path.
     */
    family: string;
    /**
     * Which direction is "better", used **only** to orient a sort and pick an arrow's
     * direction. `None` means the metric is descriptive and has no good direction — most
     * counts are like this. No figure here influences a run's score or verdict.
     */
    higherIsBetter: boolean | null;
    /**
     * Whether the figure rests on approximation rather than resolution.
     *
     * This is the honesty requirement expressed as **data**: the field sidebar, the chart
     * axis, the symbol-table header and the docs page all read this one flag, so they
     * cannot drift apart. Set on everything downstream of cross-file reference counting,
     * which is approximate in both languages.
     */
    approximate: boolean;
};
/**
 * Display metadata for every leaf of the code-analysis summary, in the order a
 * reader wants the figures: by family, and within a family by how much the figure
 * says.
 *
 * This is **not** a query vocabulary — the query language derives its field catalog
 * from the documents it has indexed, so a metric is queryable with or without an
 * entry here. What an entry buys is what a number cannot carry on its own: a label,
 * a unit, a polarity, and the {@link CodeMetricDef.approximate} flag that the Code
 * tab's headers, the field sidebar and the docs page all read, so the four cannot
 * drift apart.
 */
export declare const CODE_METRICS: readonly CodeMetricDef[];
//# sourceMappingURL=code-metrics.d.ts.map