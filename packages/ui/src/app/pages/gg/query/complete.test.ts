// The completer.
//
// These are user-experience assertions, not incidental ones. A text language is strictly
// harder to start with than the widget builder it replaces, so without genuinely
// context-sensitive completion — and without the **document counts** that make a sparse
// field visible before it returns nothing — the redesign is a downgrade for the first
// five minutes of use.
import { describe, expect, it } from "vitest";
import type { GgFieldCatalog } from "@clockwyrks/run-record/gg-query";
import { completeQuery } from "./complete";

/** A small corpus catalog: two capabilities (total, so both values appear with non-zero
 *  counts), one deliberately sparse tool field, and a string field. */
const CATALOG: GgFieldCatalog = {
  documents: 100,
  fields: [
    {
      name: "cap.compaction",
      kind: "boolean",
      documents: 100,
      topValues: [
        { value: true, count: 60 },
        { value: false, count: 40 },
      ],
    },
    {
      name: "cap.subagents",
      kind: "boolean",
      documents: 100,
      topValues: [
        { value: false, count: 90 },
        { value: true, count: 10 },
      ],
    },
    {
      name: "model",
      kind: "string",
      documents: 100,
      topValues: [
        { value: "anthropic/claude-a", count: 70 },
        { value: "openai/gpt-x", count: 30 },
      ],
    },
    { name: "started", kind: "date", documents: 100 },
    {
      name: "tool.editFile",
      kind: "boolean",
      documents: 12,
      topValues: [{ value: true, count: 12 }],
    },
  ],
};

/** Complete at the end of `text`. */
function at(text: string) {
  return completeQuery(text, text.length, CATALOG);
}

const labels = (text: string) => at(text).map((c) => c.label);

describe("field completion", () => {
  it("offers the fields matching the prefix, most-populated first", () => {
    // Count-descending is the ranking that matters: an operator typing `cap.` wants the
    // capabilities runs actually configured, not the alphabetically first one.
    expect(labels("cap.")).toEqual(["cap.compaction", "cap.subagents"]);
  });

  it("replaces the partial word rather than appending to it", () => {
    const first = at("cap.comp")[0]!;
    expect(first.replace).toEqual({ start: 0, end: 8 });
    expect(first.insert).toBe("cap.compaction");
  });

  it("carries the document count, so a sparse field is visible before it is queried", () => {
    // The whole reason `tool.*` is allowed to be sparse: "never offered this tool" is a
    // negation, and without this number an operator would have to *infer* the sparseness
    // from an empty result.
    const tool = at("tool").find((c) => c.label === "tool.editFile");
    expect(tool?.documents).toBe(12);
    expect(tool?.detail).toBe("boolean");
  });

  it("offers `not` in the filter, and nothing else that is not a field", () => {
    expect(labels("")).toContain("not");
    expect(labels("")).toContain("model");
    expect(labels("")).not.toContain("stats");
  });
});

describe("value completion", () => {
  it("offers a field's observed values with their counts after a colon", () => {
    const values = at("model:");
    expect(values.map((c) => c.label)).toEqual([
      "anthropic/claude-a",
      "openai/gpt-x",
    ]);
    expect(values[0]!.documents).toBe(70);
  });

  it("offers both `true` and `false` for a total capability field", () => {
    // The `cap.*` namespace is total, so a capability that a run never mentioned still
    // stores `false`. A completer that only offered observed-as-true values would hide
    // exactly the half a query comparing two configurations is looking for.
    expect(labels("cap.compaction:")).toEqual(["true", "false"]);
    expect(at("cap.compaction:").map((c) => c.documents)).toEqual([60, 40]);
  });

  it("answers values after a relational operator too", () => {
    expect(labels("model !=")).toEqual(["anthropic/claude-a", "openai/gpt-x"]);
  });

  it("still answers about the field inside a one-of list", () => {
    expect(labels("model:(")).toContain("anthropic/claude-a");
    expect(labels("model:(anthropic/claude-a or ")).toContain("openai/gpt-x");
  });

  it("quotes a value that would not lex as one bare word", () => {
    const suggestion = at("model:")[0]!;
    // `anthropic/claude-a` lexes bare; a value with a space would not.
    expect(suggestion.insert).toBe("anthropic/claude-a");
    const spaced = completeQuery("x:", 2, {
      documents: 1,
      fields: [
        {
          name: "x",
          kind: "string",
          documents: 1,
          topValues: [{ value: "two words", count: 1 }],
        },
      ],
    });
    expect(spaced[0]!.insert).toBe('"two words"');
  });
});

describe("stage completion", () => {
  it("offers only stages after a pipe", () => {
    expect(labels("state:completed | ")).toEqual(["stats", "sort", "limit"]);
  });

  it("offers the aggregation functions after `stats`", () => {
    expect(labels("| stats ")).toEqual([
      "count()",
      "distinct()",
      "avg()",
      "sum()",
      "min()",
      "max()",
      "median()",
      "p90()",
      "p95()",
      "dist()",
    ]);
    expect(labels("| stats avg(score), ")).toContain("median()");
  });

  it("offers fields inside an aggregation call", () => {
    expect(labels("| stats avg(")).toContain("cap.compaction");
    expect(labels("| stats avg(cap.")).toEqual([
      "cap.compaction",
      "cap.subagents",
    ]);
  });

  it("offers fields and `bucket(` after `by`", () => {
    const suggestions = labels("| stats count() by ");
    expect(suggestions[0]).toBe("bucket(");
    expect(suggestions).toContain("model");
  });

  it("offers intervals inside a bucket call", () => {
    expect(labels("| stats count() by bucket(started, ")).toEqual([
      "15m",
      "1h",
      "6h",
      "1d",
      "1w",
    ]);
  });

  it("offers fields to sort by, and nothing after `limit`", () => {
    expect(labels("| sort ")).toContain("model");
    // A row count has no suggestions worth offering; an empty list closes the popup
    // rather than showing an irrelevant one.
    expect(labels("| limit ")).toEqual([]);
  });
});
