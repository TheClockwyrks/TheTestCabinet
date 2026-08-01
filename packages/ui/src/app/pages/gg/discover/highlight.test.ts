// The editor's syntax classification.
//
// Two properties matter, and only one of them is about colour. The visible one is that a
// field looks like a field the moment it is followed by an operator — including in the
// half-typed state (`cap.compaction:` with no value yet) that live highlighting spends
// most of its time in. The invisible one is **total coverage**: the painted layer and the
// textarea above it must lay out identically, so every character of the source has to end
// up in exactly one span or the caret drifts away from the glyph it is editing.
import { describe, expect, it } from "vitest";
import { parseQuery } from "../query";
import { type HighlightKind, highlightSpans } from "./highlight";

/** Classify a whole query the way the editor does. */
function spans(text: string) {
  const parse = parseQuery(text);
  return highlightSpans(parse.text, parse.tokens, parse.diagnostics);
}

/** The kind assigned to the first span whose text matches. */
function kindOf(text: string, needle: string): HighlightKind | undefined {
  return spans(text).find((span) => span.text === needle)?.kind;
}

describe("coverage", () => {
  it.each([
    "",
    "state:completed",
    'model:"anthropic/*" and metric.runTimeSeconds >= 1800',
    "not state:completed | stats count() by preset",
    '| stats dist(score) by cap."speculative-execution"',
    "| stats count() by bucket(started, 1d)",
    "started:[2026-01-01 to 2026-01-31]  ",
    "state:(hung or timed_out)",
    "@@ broken ((",
  ])("reproduces the source exactly: %s", (text) => {
    // If this ever fails the caret is in the wrong place, which is the classic failure of
    // a textarea-over-a-painted-layer editor.
    expect(spans(text).map((span) => span.text).join("")).toBe(text);
  });
});

describe("classification", () => {
  it("marks the field before an operator, however it is spelled", () => {
    expect(kindOf("state:completed", "state")).toBe("field");
    expect(kindOf("metric.runTimeSeconds >= 1800", "metric.runTimeSeconds")).toBe("field");
    // A quoted segment is part of the same dotted name, and adjacency is what says so.
    expect(kindOf('cap."speculative-execution":true', "cap.")).toBe("field");
    expect(kindOf('cap."speculative-execution":true', '"speculative-execution"')).toBe(
      "field",
    );
  });

  it("marks a field the moment its operator is typed, before any value exists", () => {
    // The state live highlighting spends most of its time in.
    expect(kindOf("cap.compaction:", "cap.compaction")).toBe("field");
  });

  it("does not mistake a free-text term for a field", () => {
    expect(kindOf("carom", "carom")).toBe("literal");
    // A gap breaks the run: this is a free-text term followed by a predicate, not one
    // two-word field name.
    expect(kindOf("carom state:hung", "carom")).toBe("literal");
    expect(kindOf("carom state:hung", "state")).toBe("field");
  });

  it("marks keywords, calls and punctuation apart", () => {
    expect(kindOf("a:1 and b:2", "and")).toBe("keyword");
    expect(kindOf("not state:completed", "not")).toBe("keyword");
    expect(kindOf("| stats avg(score) by preset", "avg")).toBe("function");
    expect(kindOf("| stats avg(score) by preset", "stats")).toBe("keyword");
    expect(kindOf("| stats count() by bucket(started, 1d)", "bucket")).toBe("function");
    expect(kindOf("| stats count() by bucket(started, 1d)", "by")).toBe("keyword");
    expect(kindOf("state:completed", ":")).toBe("punct");
    expect(kindOf("state:completed | limit 10", "|")).toBe("punct");
  });

  it("marks a quoted literal apart from a bare one", () => {
    expect(kindOf('model:"anthropic/*"', '"anthropic/*"')).toBe("string");
    expect(kindOf("model:anthropic", "anthropic")).toBe("literal");
  });

  it("still classifies a field named after a keyword", () => {
    // `limit` is a real document field — which ceiling stopped the run — as well as a
    // stage keyword. In a field position it has to look like the field it is.
    expect(kindOf("limit:cost", "limit")).toBe("field");
    expect(kindOf("| limit 10", "limit")).toBe("keyword");
  });
});

describe("error marking", () => {
  it("underlines the span a diagnostic points at, and nothing else", () => {
    const marked = spans('model:"unterminated').filter((span) => span.invalid);
    expect(marked.map((span) => span.text)).toEqual(['"unterminated']);
  });

  it("underlines a stray character without swallowing the rest of the query", () => {
    const all = spans("state:completed @ preset:a");
    expect(all.filter((span) => span.invalid).map((span) => span.text)).toEqual(["@"]);
    // The clauses either side stay clean, which is what an error-tolerant parser buys.
    expect(kindOf("state:completed @ preset:a", "state")).toBe("field");
    expect(kindOf("state:completed @ preset:a", "preset")).toBe("field");
  });

  it("leaves a well-formed query entirely unmarked", () => {
    expect(
      spans("not state:completed | stats count() by preset").some((s) => s.invalid),
    ).toBe(false);
  });
});
