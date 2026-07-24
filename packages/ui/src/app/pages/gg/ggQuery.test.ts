import { describe, expect, it } from "vitest";
import {
  buildQuery,
  decodeDraft,
  defaultDraft,
  encodeDraft,
  readChartMetric,
  type AggregateDraft,
} from "./ggQuery";

// A query exercising every clause kind, so the round trip covers each encoded
// shape: a case narrowing, two group-by facets (one with a param target), two
// metrics, and both filter kinds.
const DRAFT: AggregateDraft = {
  testCase: "carom",
  facetFilters: [
    {
      facet: {
        kind: "capabilityEnabled",
        capability: "compaction",
        param: "",
        slot: "primary",
        tool: "Bash",
      },
      op: "eq",
      value: "true",
    },
    {
      facet: {
        kind: "preset",
        capability: "compaction",
        param: "",
        slot: "primary",
        tool: "Bash",
      },
      op: "ne",
      value: "minimal",
    },
  ],
  metricFilters: [
    {
      metric: { kind: "totalTokens", field: "agents_spawned" },
      op: "gte",
      value: "1000",
    },
  ],
  groupBy: [
    {
      kind: "capabilityParam",
      capability: "subagents",
      param: "maxDepth",
      slot: "primary",
      tool: "Bash",
    },
    {
      kind: "slotModel",
      capability: "compaction",
      param: "",
      slot: "reviewer",
      tool: "Bash",
    },
  ],
  metrics: [
    { metric: { kind: "score", field: "agents_spawned" }, agg: "avg" },
    {
      metric: { kind: "summary", field: "issues_reopened" },
      agg: "sum",
    },
  ],
  chartMetric: 1,
};

describe("encodeDraft / decodeDraft", () => {
  it("round-trips every clause of a query through the URL", () => {
    const decoded = decodeDraft(encodeDraft(DRAFT));
    // The blank-clause fields a kind doesn't use (a facet's unused slot/tool) are
    // not carried, so compare the queries the drafts stand for rather than the
    // drafts themselves.
    expect(buildQuery(decoded)).toEqual(buildQuery(DRAFT));
    expect(decoded.chartMetric).toBe(DRAFT.chartMetric);
  });

  it("falls back to the default query when the URL carries none", () => {
    expect(decodeDraft(new URLSearchParams("page=2"))).toEqual(defaultDraft());
  });

  it("degrades a malformed or stale link to a runnable query", () => {
    const decoded = decodeDraft(
      new URLSearchParams(
        "group=notAFacet&metric=nonsense|alsoNonsense&ff=preset|weird|x",
      ),
    );
    // Unknown tokens become blank clauses rather than erroring…
    expect(decoded.groupBy).toHaveLength(1);
    expect(decoded.metrics[0]!.agg).toBe("avg");
    expect(decoded.facetFilters[0]!.op).toBe("eq");
    // …and the query it stands for is still a valid one.
    expect(() => buildQuery(decoded)).not.toThrow();
  });

  it("clamps a charted-metric index that points past the query's metrics", () => {
    // A stale link charting metric 3 of a query that now requests one metric falls
    // back to the run count, which every bucket always carries.
    expect(readChartMetric("3", 1)).toBe(-1);
    expect(readChartMetric("0", 1)).toBe(0);
    expect(readChartMetric(null, 1)).toBe(-1);
  });
});
