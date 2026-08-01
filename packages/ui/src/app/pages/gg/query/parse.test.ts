// The parser, the compiler and the formatter — the half of TCQ that exists only in the
// browser.
//
// The cases are organised around the two things that decide whether the language is
// usable: **what a query means** (every grammar production, compiled to the wire form
// the backend actually receives) and **what happens while it is being typed** (the
// parser is error-tolerant on purpose, because live validation and completion run on
// every keystroke).
import { describe, expect, it } from "vitest";
import { compileQuery, literalValue } from "./compile";
import { formatQuery } from "./format";
import { parseQuery } from "./parse";
import { tokenize } from "./lex";

/** 2026-01-01T00:00:00Z — the instant relative dates resolve against here, so `now` is
 *  pinned rather than read off the wall clock. */
const NOW = 1_767_225_600_000;

/** Parse and compile in one step, with `now` fixed. */
function compile(text: string) {
  return compileQuery(parseQuery(text).query, { now: NOW });
}

/** The diagnostics a parse produced, as plain messages. */
function problems(text: string): string[] {
  return parseQuery(text).diagnostics.map((d) => d.message);
}

describe("the lexer", () => {
  it("keeps a dotted field name in one token", () => {
    expect(tokenize("summary.healing.healed").map((t) => t.text)).toEqual([
      "summary.healing.healed",
      "",
    ]);
  });

  it("keeps a slash in a field name, because a model id is part of one", () => {
    // `model.anthropic/claude-a.tokens` is a real field. Splitting on `/` would make the
    // per-model spend namespace unqueryable.
    expect(tokenize("model.anthropic/claude-a.tokens")[0]!.text).toBe(
      "model.anthropic/claude-a.tokens",
    );
  });

  it("reads a leading `-` as negation but a signed number as a number", () => {
    expect(tokenize("-state").map((t) => t.kind)).toEqual(["minus", "word", "eof"]);
    expect(tokenize("-5").map((t) => t.kind)).toEqual(["word", "eof"]);
    expect(tokenize("now-30d").map((t) => t.text)).toEqual(["now-30d", ""]);
  });

  it("never lexes `>=` as `>` then `=`", () => {
    expect(tokenize("a >= 1").map((t) => t.text)).toEqual(["a", ">=", "1", ""]);
  });

  it("keeps an unterminated string usable", () => {
    // The editor is mid-keystroke far more often than it is finished, so an unclosed
    // quote must still produce a token the completer can work from.
    const tokens = tokenize('model:"anthro');
    expect(tokens[0]!.text).toBe("model");
    const string = tokens[2]!;
    expect(string.kind).toBe("string");
    expect(string.value).toBe("anthro");
    expect(string.unterminated).toBe(true);
  });
});

describe("the filter grammar", () => {
  it("compiles juxtaposition as AND", () => {
    expect(compile("state:completed published:true")).toEqual({
      filter: {
        kind: "and",
        clauses: [
          { kind: "compare", field: "state", op: "eq", value: "completed" },
          { kind: "compare", field: "published", op: "eq", value: true },
        ],
      },
    });
  });

  it("gives `or` looser precedence than `and`", () => {
    const compiled = compile("a:1 and b:2 or c:3");
    expect(compiled.filter?.kind).toBe("or");
    expect(compiled).toEqual({
      filter: {
        kind: "or",
        clauses: [
          {
            kind: "and",
            clauses: [
              { kind: "compare", field: "a", op: "eq", value: 1 },
              { kind: "compare", field: "b", op: "eq", value: 2 },
            ],
          },
          { kind: "compare", field: "c", op: "eq", value: 3 },
        ],
      },
    });
  });

  it("expresses the query the all-AND engine could not", () => {
    expect(compile("state:(hung or timed_out)")).toEqual({
      filter: {
        kind: "oneOf",
        field: "state",
        values: ["hung", "timed_out"],
      },
    });
  });

  it("reads `not` and `-` as the same negation", () => {
    expect(compile("not tool.editFile:*")).toEqual(compile("-tool.editFile:*"));
  });

  it("compiles every operator", () => {
    const ops = compile("a:1 b!=2 c>3 d>=4 e<5 f<=6");
    expect(
      (ops.filter as { clauses: { op: string }[] }).clauses.map((c) => c.op),
    ).toEqual(["eq", "ne", "gt", "gte", "lt", "lte"]);
  });

  it("compiles an open range on either side", () => {
    expect(compile("metric.runTimeSeconds:[1800 to *]")).toEqual({
      filter: { kind: "range", field: "metric.runTimeSeconds", from: 1800 },
    });
    expect(compile("metric.runTimeSeconds:[* to 60]")).toEqual({
      filter: { kind: "range", field: "metric.runTimeSeconds", to: 60 },
    });
  });

  it("compiles a bare term to free text, whatever it looks like", () => {
    // The grammar's last predicate arm. A bare word is a *search term* even when it
    // happens to spell a field name — `has.summary` alone is free text, and the
    // boolean marker is asked for as `has.summary:true`. Any other rule would make the
    // meaning of a bare word depend on whether the field catalog had loaded.
    expect(compile("carom")).toEqual({ filter: { kind: "text", text: "carom" } });
    expect(compile("has.summary")).toEqual({
      filter: { kind: "text", text: "has.summary" },
    });
  });

  it("lets a field name carry a quoted segment", () => {
    // `cap."speculative-execution"` is the design's own example, and the quoting has to
    // survive into the resolved dotted name the evaluator looks up.
    expect(compile('cap."speculative-execution":true')).toEqual({
      filter: {
        kind: "compare",
        field: "cap.speculative-execution",
        op: "eq",
        value: true,
      },
    });
  });

  it("keeps `limit` usable as a field even though it is a stage keyword", () => {
    // `limit` names the execution ceiling a run breached. A parser that stopped the
    // juxtaposed chain at every keyword would make the most ordinary ceiling query
    // unparseable.
    expect(compile("state:completed limit:none")).toEqual({
      filter: {
        kind: "and",
        clauses: [
          { kind: "compare", field: "state", op: "eq", value: "completed" },
          { kind: "compare", field: "limit", op: "eq", value: "none" },
        ],
      },
    });
    expect(problems("state:completed limit:none")).toEqual([]);
  });
});

describe("literal typing", () => {
  it("infers booleans and numbers from a bare literal", () => {
    expect(compile("cap.compaction:false").filter).toMatchObject({ value: false });
    expect(compile("cap.compaction.summaryHeadroom>0.5").filter).toMatchObject({
      value: 0.5,
    });
  });

  it("keeps a quoted literal a string, whatever it spells", () => {
    // The only way to ask for the string "true" — and the only way to stop a case slug
    // that looks like a date from becoming a timestamp.
    expect(compile('note:"true"').filter).toMatchObject({ value: "true" });
    expect(compile('case:"2026-01-01"').filter).toMatchObject({ value: "2026-01-01" });
  });

  it("resolves a relative date in the client, so a saved query stays relative", () => {
    expect(compile("started>=now-30d").filter).toMatchObject({
      value: NOW - 30 * 86_400_000,
    });
    expect(compile("started<=now").filter).toMatchObject({ value: NOW });
  });

  it("stretches a bare date to the end of its day as an inclusive upper bound", () => {
    // So that a whole month is a whole month. The lower bound already means the start of
    // its day, and widening that would exclude the day the operator asked for.
    const month = compile("finished:[2026-01-01 to 2026-01-31]");
    expect(month.filter).toMatchObject({
      from: Date.UTC(2026, 0, 1),
      to: Date.UTC(2026, 0, 31) + 86_400_000 - 1,
    });
    expect(compile("finished<=2026-01-31").filter).toMatchObject({
      value: Date.UTC(2026, 0, 31) + 86_400_000 - 1,
    });
    // A strict `<` is not an inclusive bound, so it stays at the start of the day.
    expect(compile("finished<2026-01-31").filter).toMatchObject({
      value: Date.UTC(2026, 0, 31),
    });
  });

  it("does not read a number-shaped string as a number", () => {
    expect(literalValue({ raw: "0x10", quoted: false, span: { start: 0, end: 0 } }, NOW)).toBe(
      "0x10",
    );
  });
});

describe("the stages", () => {
  it("compiles the design doc's worked examples", () => {
    expect(compile("| stats count() by preset")).toEqual({
      stats: {
        aggs: [{ func: "count" }],
        groupBy: [{ kind: "field", field: "preset" }],
      },
    });
    expect(
      compile(
        "cap.compaction:false and has.summary:true | stats avg(summary.ranOutOfContext) as overflow_rate by model",
      ),
    ).toEqual({
      filter: {
        kind: "and",
        clauses: [
          { kind: "compare", field: "cap.compaction", op: "eq", value: false },
          { kind: "compare", field: "has.summary", op: "eq", value: true },
        ],
      },
      stats: {
        aggs: [
          {
            func: "avg",
            field: "summary.ranOutOfContext",
            alias: "overflow_rate",
          },
        ],
        groupBy: [{ kind: "field", field: "model" }],
      },
    });
  });

  it("compiles a date histogram", () => {
    expect(compile("| stats count() by bucket(started, 1d)")).toEqual({
      stats: {
        aggs: [{ func: "count" }],
        groupBy: [
          {
            kind: "bucket",
            field: "started",
            interval: { count: 1, unit: "day" },
          },
        ],
      },
    });
    expect(compile("| stats count() by bucket(started, 15m)").stats?.groupBy).toEqual([
      { kind: "bucket", field: "started", interval: { count: 15, unit: "minute" } },
    ]);
  });

  it("compiles sort and limit", () => {
    expect(compile("| sort score desc, started | limit 20")).toEqual({
      sort: [
        { field: "score", desc: true },
        { field: "started", desc: false },
      ],
      limit: 20,
    });
  });

  it("rejects a fourth group-by key rather than dropping it quietly", () => {
    // Bucket cardinality is the *product* of the keys' cardinalities, and a key that
    // vanished without a word would read as the evaluator losing data.
    const messages = problems("| stats count() by a, b, c, d");
    expect(messages.some((m) => m.includes("At most 3 group-by keys"))).toBe(true);
    expect(compile("| stats count() by a, b, c, d").stats?.groupBy).toHaveLength(3);
  });

  it("rejects an aggregation that needs a field and has none", () => {
    expect(problems("| stats avg()").some((m) => m.includes("needs a field"))).toBe(true);
    // It is dropped from the compiled query rather than sent as a field-less fold.
    expect(compile("| stats avg(), count()").stats?.aggs).toEqual([{ func: "count" }]);
  });

  it("names an unknown aggregation instead of guessing", () => {
    expect(problems("| stats rate(score)")[0]).toContain("Unknown aggregation `rate`");
  });

  it("rejects an interval the grammar does not carry", () => {
    // No `auto`: it has no representation in a compiled query and is unresolvable for a
    // query with no time bound. No months either — a month is not a fixed width, so
    // bucketing by one would need a civil calendar in both implementations.
    expect(problems("| stats count() by bucket(started, auto)")[0]).toContain(
      "is not an interval",
    );
    expect(problems("| stats count() by bucket(started, 1M)")[0]).toContain(
      "is not an interval",
    );
  });
});

describe("error tolerance", () => {
  it("still compiles the clauses that parsed", () => {
    // The property the live editor rests on: a half-typed third clause must not blank
    // the result the operator is watching.
    const compiled = compile("state:completed and model:");
    expect(compiled.filter).toEqual({
      kind: "compare",
      field: "state",
      op: "eq",
      value: "completed",
    });
    expect(problems("state:completed and model:")).toHaveLength(1);
  });

  it("reports an unterminated string once, with its span", () => {
    const { diagnostics } = parseQuery('model:"anthro');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.message).toContain("Unterminated string");
    expect(diagnostics[0]!.span).toEqual({ start: 6, end: 13 });
  });

  it("underlines an unexpected character without reporting it twice", () => {
    const { diagnostics } = parseQuery("state:completed & published:true");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.message).toContain("Unexpected character");
  });

  it("terminates on input that is nothing but punctuation", () => {
    // The AND loop consumes a token on every unreadable clause; without that it spins.
    for (const text of ["))))", "|||", ":::", "( ( (", "| stats"]) {
      expect(() => parseQuery(text)).not.toThrow();
    }
  });

  it("treats an empty query as matching everything", () => {
    expect(compile("")).toEqual({});
    expect(compile("   ")).toEqual({});
  });
});

describe("the formatter", () => {
  it("re-derives parentheses rather than remembering them", () => {
    // Canonical output is what stops a saved query from churning every time it is opened
    // and re-saved.
    expect(formatQuery(parseQuery("((a:1) and (b:2))").query)).toBe("a:1 and b:2");
    expect(formatQuery(parseQuery("a:1 or b:2 and c:3").query)).toBe(
      "a:1 or b:2 and c:3",
    );
    expect(formatQuery(parseQuery("(a:1 or b:2) and c:3").query)).toBe(
      "(a:1 or b:2) and c:3",
    );
  });

  it("writes `:` tight and every other operator spaced", () => {
    expect(formatQuery(parseQuery("state : completed").query)).toBe("state:completed");
    expect(formatQuery(parseQuery("score>=0.5").query)).toBe("score >= 0.5");
  });

  it("round-trips through a re-parse", () => {
    for (const text of [
      "state:completed and model:anthropic/*",
      "not tool.editFile:* or metric.cost:[1 to *]",
      'cap."speculative-execution":true',
      "started >= now-30d | stats count() by bucket(started, 1d)",
      "| stats avg(score) as mean, count() by model, preset | sort mean desc | limit 10",
      "carom",
    ]) {
      const once = formatQuery(parseQuery(text).query);
      expect(formatQuery(parseQuery(once).query), text).toBe(once);
      expect(compile(once), text).toEqual(compile(text));
    }
  });

  it("quotes only what a bare spelling would break", () => {
    expect(formatQuery(parseQuery('note:"a value"').query)).toBe('note:"a value"');
    expect(formatQuery(parseQuery('note:"not"').query)).toBe('note:"not"');
    expect(formatQuery(parseQuery("limit:none").query)).toBe("limit:none");
    // A quoted literal stays quoted: unquoting it would change what it compiles to.
    expect(formatQuery(parseQuery('note:"true"').query)).toBe('note:"true"');
    expect(formatQuery(parseQuery("note:true").query)).toBe("note:true");
  });
});
