// The legacy-URL transcoder.
//
// The property under test is not "the strings match" — it is that **a link somebody
// pasted into an issue in April still answers the question they asked**. So each case
// names the question the old URL was asking and asserts the TCQ text asks the same one.
import { describe, expect, it } from "vitest";
import { parseQuery } from "../query";
import {
  LEGACY_DEFAULT_QUERY,
  isLegacyAggregateQuery,
  legacyQueryText,
} from "./legacyQuery";

/** Transcode a query string, the way the redirect route does. */
function transcode(search: string): string {
  return legacyQueryText(new URLSearchParams(search));
}

describe("recognising a legacy link", () => {
  it("knows its own parameters", () => {
    expect(isLegacyAggregateQuery(new URLSearchParams("group=preset"))).toBe(true);
    expect(isLegacyAggregateQuery(new URLSearchParams("chart=-1"))).toBe(true);
    expect(isLegacyAggregateQuery(new URLSearchParams("q=state:hung"))).toBe(false);
  });

  it("falls back to the query the builder itself opened on", () => {
    // A bare `/gg/aggregate` showed the default draft — group by whether compaction was
    // enabled, average the score — so a link to it has to land on exactly that, not on an
    // empty editor.
    expect(transcode("")).toBe(LEGACY_DEFAULT_QUERY);
    expect(transcode("")).toBe("| stats avg(score) by cap.compaction");
  });
});

describe("transcoding an aggregate query", () => {
  it("turns the canonical ablation link into its TCQ equivalent", () => {
    expect(transcode("group=capabilityEnabled:compaction&metric=avg|score&chart=0")).toBe(
      "| stats avg(score) by cap.compaction",
    );
  });

  it("maps every facet kind onto its document field", () => {
    expect(transcode("group=preset")).toBe("| stats count() by preset");
    // The two that are *not* the same word: the old terminal-status facet read the run's
    // lifecycle state, and `limitHit` — which ceiling stopped it — is now `limit`.
    expect(transcode("group=terminalStatus")).toBe("| stats count() by state");
    expect(transcode("group=limitHit")).toBe("| stats count() by limit");
    expect(transcode("group=testCase")).toBe("| stats count() by case");
    expect(transcode("group=capabilityImplementation:memories")).toBe(
      "| stats count() by cap.memories.impl",
    );
    expect(transcode("group=capabilityParam:compaction:summaryHeadroom")).toBe(
      "| stats count() by cap.compaction.summaryHeadroom",
    );
    expect(transcode("group=slotModel:primary")).toBe(
      "| stats count() by agent.primary.model",
    );
    expect(transcode("group=toolOffered:editFile")).toBe(
      "| stats count() by tool.editFile",
    );
  });

  it("keeps a grouping that lost its figures asking how many", () => {
    // Every old bucket carried `n` whether or not a metric was requested, so a grouping
    // with no surviving aggregation is still a count — not an empty stats stage.
    expect(transcode("group=preset")).toContain("count()");
  });

  it("carries several group keys and several figures in request order", () => {
    expect(
      transcode(
        "group=preset&group=testCase&metric=avg|score&metric=max|runTimeSeconds",
      ),
    ).toBe(
      "| stats avg(score), max(metric.runTimeSeconds) by preset, case",
    );
  });

  it("camel-cases a summary field, and unfolds the healing prefix", () => {
    // The document carries the whole session summary verbatim and it serializes
    // camelCase, while the old enum's wire tokens were snake_case.
    expect(transcode("metric=avg|summary:ran_out_of_context&group=preset")).toBe(
      "| stats avg(summary.ranOutOfContext) by preset",
    );
    expect(transcode("metric=sum|summary:context_overflow_count&group=preset")).toBe(
      "| stats sum(summary.contextOverflowCount) by preset",
    );
    // The healing counters lived on a nested struct with the prefix folded into the enum
    // name, so they are the ones a mechanical camel-casing would get wrong.
    expect(transcode("metric=sum|summary:healing_strip_fences&group=preset")).toBe(
      "| stats sum(summary.healing.stripFences) by preset",
    );
    expect(
      transcode("metric=sum|summary:healing_drop_duplicate_program&group=preset"),
    ).toBe("| stats sum(summary.healing.dropDuplicateProgram) by preset");
  });

  it("drops the one metric the document model cannot express", () => {
    // `healing_rate` was a per-run ratio the aggregator computed. TCQ deliberately has no
    // `rate()`, and rewriting it to its numerator would answer a different question under
    // the original's label — so the column is dropped and the grouping keeps its count.
    expect(transcode("metric=avg|summary:healing_rate&group=preset")).toBe(
      "| stats count() by preset",
    );
  });
});

describe("transcoding filters", () => {
  it("turns a case narrowing and a facet filter into a filter tree", () => {
    expect(transcode("case=carom&ff=capabilityEnabled:compaction|eq|false")).toBe(
      "case:carom and cap.compaction:false",
    );
  });

  it("spells exists and absent as the predicate and its negation", () => {
    expect(transcode("ff=toolOffered:editFile|exists")).toBe("tool.editFile:*");
    expect(transcode("ff=toolOffered:editFile|absent")).toBe("not tool.editFile:*");
  });

  it("keeps a metric filter numeric", () => {
    // The value has to stay unquoted or it compares as the string that spells it, and the
    // run-time field is now `metric.*` — where it is **absent rather than zero** on a run
    // that produced nothing, which is what finally makes this filter honest.
    expect(transcode("mf=runTimeSeconds|gte|1800")).toBe("metric.runTimeSeconds >= 1800");
    expect(transcode("mf=cost|lt|0.5")).toBe("metric.cost < 0.5");
    expect(transcode("mf=totalTokens|gt|100000")).toBe("metric.totalTokens > 100000");
  });

  it("joins several clauses with and, which is what the old engine could only do", () => {
    expect(
      transcode("ff=preset|eq|planning-A&ff=terminalStatus|ne|completed&mf=score|gte|0.5"),
    ).toBe("preset:planning-A and state != completed and score >= 0.5");
  });

  it("produces the document view when the link asked for no aggregation", () => {
    // A filter with no group-by and no metric is not an aggregate query at all — it is
    // exactly what TCQ expresses by omitting the stage.
    expect(transcode("ff=terminalStatus|eq|hung")).toBe("state:hung");
  });

  it("skips a clause it cannot read rather than throwing", () => {
    // A hand-edited or stale link was always possible, and the alternative to a slightly
    // narrower query is a broken link.
    expect(transcode("ff=notAFacet:x|eq|1&ff=preset|eq|a&group=preset")).toBe(
      "preset:a | stats count() by preset",
    );
    expect(transcode("metric=avg|notAMetric&group=preset")).toBe(
      "| stats count() by preset",
    );
  });

  it("quotes a value that would not lex as one bare word", () => {
    expect(transcode("ff=preset|eq|two words")).toBe('preset:"two words"');
  });
});

describe("everything it emits", () => {
  // The transcoder's output is fed straight into the editor, so text that does not parse
  // is worse than a 404: it looks like the operator broke it.
  it.each([
    "",
    "group=capabilityEnabled:compaction&metric=avg|score",
    "case=carom&ff=toolOffered:editFile|absent&mf=runTimeSeconds|gte|1800&group=model",
    "ff=preset|eq|two words&group=preset&metric=max|summary:healing_strip_fences",
    "group=capabilityParam:compaction:summaryHeadroom&metric=avg|cost",
  ])("parses cleanly: %s", (search) => {
    const parsed = parseQuery(transcode(search));
    expect(parsed.diagnostics).toEqual([]);
  });
});
