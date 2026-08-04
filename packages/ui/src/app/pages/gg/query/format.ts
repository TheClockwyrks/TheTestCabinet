// The **formatter** — the syntax tree back to canonical source text.
//
// Two callers, one of which is not obvious. The editor's "tidy" action is the obvious
// one. The other is **insertion**: the field sidebar and the completer both build a
// clause and paste it into the query, and a clause a human then edits has to be spelled
// the same way the formatter would have spelled it, or the query text churns every time
// it is touched.
//
// Canonical means: no redundant parentheses, `:` tight against its value and every other
// operator spaced, keywords lowercase, and a literal quoted only when leaving it bare
// would change what it means.
import type { FieldRef, FilterNode, LiteralNode, QueryNode, StageNode } from "./ast";
import { KEYWORDS } from "./lex";

/** Render a whole query. */
export function formatQuery(query: QueryNode): string {
  const parts: string[] = [];
  if (query.filter) parts.push(formatFilter(query.filter, 0));
  for (const stage of query.stages) parts.push(`| ${formatStage(stage)}`);
  return parts.join(" ").trim();
}

/**
 * Binding strength, so parentheses are re-derived rather than remembered: `or` binds
 * loosest, then `and`, then everything that cannot need them.
 *
 * Re-deriving is what makes the output canonical — a tree that came from
 * `((a) and (b))` and one that came from `a b` format identically, which is the property
 * that stops a saved query from drifting every time somebody opens and re-saves it.
 */
const PRECEDENCE = { or: 0, and: 1, atom: 2 } as const;

function formatFilter(node: FilterNode, minPrecedence: number): string {
  switch (node.kind) {
    case "or": {
      const body = node.clauses
        .map((clause) => formatFilter(clause, PRECEDENCE.or + 1))
        .join(" or ");
      return minPrecedence > PRECEDENCE.or ? `(${body})` : body;
    }
    case "and": {
      const body = node.clauses
        .map((clause) => formatFilter(clause, PRECEDENCE.and + 1))
        .join(" and ");
      return minPrecedence > PRECEDENCE.and ? `(${body})` : body;
    }
    case "not":
      return `not ${formatFilter(node.clause, PRECEDENCE.atom)}`;
    case "exists":
      return `${formatField(node.field)}:*`;
    case "compare": {
      const value = node.value ? formatLiteral(node.value) : "";
      // `:` reads as part of the field/value pair and is written tight; a relational
      // operator reads as a comparison and is written spaced.
      return node.opText === ":"
        ? `${formatField(node.field)}:${value}`
        : `${formatField(node.field)} ${node.opText} ${value}`;
    }
    case "oneOf":
      return `${formatField(node.field)}:(${node.values.map(formatLiteral).join(" or ")})`;
    case "range": {
      const from = node.from ? formatLiteral(node.from) : "*";
      const to = node.to ? formatLiteral(node.to) : "*";
      return `${formatField(node.field)}:[${from} to ${to}]`;
    }
    case "text":
      return formatLiteral(node.value);
    case "error":
      return "";
  }
}

function formatStage(stage: StageNode): string {
  switch (stage.kind) {
    case "stats": {
      const aggs = stage.aggs
        .map((agg) => {
          const call = `${agg.func ?? agg.funcText}(${agg.field ? formatField(agg.field) : ""})`;
          return agg.alias ? `${call} as ${formatIdentifier(agg.alias)}` : call;
        })
        .join(", ");
      if (stage.groupBy.length === 0) return `stats ${aggs}`;
      const groups = stage.groupBy
        .map((group) =>
          group.kind === "field"
            ? formatField(group.field)
            : `bucket(${formatField(group.field)}, ${group.interval?.raw ?? ""})`,
        )
        .join(", ");
      return `stats ${aggs} by ${groups}`;
    }
    case "sort":
      return `sort ${stage.keys
        .map((key) => `${formatField(key.field)}${key.desc ? " desc" : ""}`)
        .join(", ")}`;
    case "limit":
      return `limit ${stage.value ?? ""}`;
    case "error":
      return "";
  }
}

/** The characters a bare word may carry, and what it may start with — the formatter's
 *  half of the lexer's rule, restated here because getting them out of step would
 *  produce text that does not re-parse to the tree it came from. */
const WORD_BODY = /^[\p{L}\p{N}_./*+-]+$/u;
const WORD_START = /^[\p{L}\p{N}_./*]/u;

/**
 * Whether `text` would lex back as exactly one bare word.
 *
 * The leading-sign case is the subtle one: the lexer only admits `-`/`+` at the start of
 * a word when a digit follows (so `-5` is a negative number while `-state` is a
 * negation), and the formatter has to respect the same cut or `-foo` would come back as
 * two tokens.
 */
function lexesAsWord(text: string): boolean {
  if (text.length === 0) return false;
  if (!WORD_START.test(text) && !/^[+-]\d/.test(text)) return false;
  return WORD_BODY.test(text);
}

/** Render a field name, quoting only the segments that need it. Splitting on `.` first
 *  is what keeps `cap."agent-persistence"` readable instead of quoting the whole
 *  dotted path. */
export function formatField(field: FieldRef): string {
  return field.name.split(".").map(formatIdentifier).join(".");
}

/**
 * Quote an identifier if a bare spelling would not survive a round trip.
 *
 * A keyword is **not** quoted here. A field position is unambiguous once the text is
 * canonical — the parser reads a keyword as a field whenever an operator follows it —
 * and `limit` is a real document field, so quoting it would make the most ordinary
 * query about execution ceilings read like an escape hatch.
 */
export function formatIdentifier(name: string): string {
  if (lexesAsWord(name) && !name.includes(".")) return name;
  return quote(name);
}

/**
 * Render a literal.
 *
 * A literal that *parsed* quoted stays quoted, because unquoting it would change what it
 * compiles to — `"true"` is the string, `true` is the boolean, and `"2026-01-01"` is the
 * string where the bare spelling is a timestamp. An unquoted one is re-quoted only when
 * its characters demand it, or when it collides with a keyword: a bare `not` in
 * free-text position would come back as a negation, and quoting is free here because a
 * quoted keyword still compares equal to the stored string.
 */
export function formatLiteral(literal: LiteralNode): string {
  if (!literal.quoted && lexesAsWord(literal.raw) && !isKeywordName(literal.raw)) {
    return literal.raw;
  }
  return quote(literal.raw);
}

function isKeywordName(name: string): boolean {
  return (KEYWORDS as readonly string[]).includes(name.toLowerCase());
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
