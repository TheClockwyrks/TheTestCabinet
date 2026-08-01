// **Syntax classification** for the editor's highlight layer — the token stream a parse
// already produced, labelled by the role each token plays.
//
// It lives here rather than in `query/` on purpose. The parser's `ParseResult` carries
// everything needed (tokens, spans, diagnostics) and is shared with the public site's
// browser evaluator; how those tokens map onto *CSS classes* is a property of this
// console's editor and nothing else, so keeping it beside the editor stops a presentation
// decision from leaking into the mirrored half of the language.
//
// The classification is deliberately token-local rather than tree-driven. Highlighting
// runs on every keystroke over text that is half-typed by definition — `cap.compaction:`
// with no value yet has no parse node to hang a colour off, but it is exactly the moment
// the field must already look like a field.
import type { Diagnostic, Token } from "../query";
import { keywordOf } from "../query";

/** What a run of source text is, for the purpose of colouring it. */
export type HighlightKind =
  /** A grammar keyword: `and`, `or`, `not`, `by`, `as`, `to`, and the stage names. */
  | "keyword"
  /** A dotted field name — the run of word/string tokens that an operator follows. */
  | "field"
  /** An aggregation function name, immediately before its `(`. */
  | "function"
  /** A quoted literal. */
  | "string"
  /** An unquoted literal: a number, a boolean, a date, a glob, a free-text term. */
  | "literal"
  /** An operator or a separator: `:`, `!=`, `|`, `(`, `,`. */
  | "punct"
  /** Whitespace and anything with no role of its own. */
  | "plain";

/** One contiguous run of source text, with its role and whether a diagnostic covers it. */
export interface HighlightSpan {
  text: string;
  kind: HighlightKind;
  /** Set when a diagnostic's span overlaps this run — what the editor underlines. The
   *  message itself is listed below the editor; an underline with no text beside it is
   *  a puzzle rather than a hint. */
  invalid?: boolean;
}

/** The aggregation function names, which are highlighted as calls rather than as the
 *  bare words they lex as. Duplicated from `AGG_FUNCS` as a lookup because this runs per
 *  token per keystroke. */
const FUNCTION_NAMES = new Set([
  "count",
  "distinct",
  "avg",
  "sum",
  "min",
  "max",
  "median",
  "p90",
  "p95",
  "dist",
  // Not an aggregation, but the one other call in the grammar, and it reads as a call.
  "bucket",
]);

/**
 * Classify `text` into contiguous highlight spans covering **every** character.
 *
 * Total coverage is what lets the editor render the highlight layer as the exact visual
 * twin of the textarea above it: the two must lay out identically or the caret drifts
 * away from the glyph it is supposed to sit beside. So whitespace and unclaimed
 * characters come back as `plain` runs rather than being skipped.
 */
export function highlightSpans(
  text: string,
  tokens: readonly Token[],
  diagnostics: readonly Diagnostic[] = [],
): HighlightSpan[] {
  const spans: HighlightSpan[] = [];
  let at = 0;

  const fieldTokens = fieldTokenIndices(tokens);

  tokens.forEach((token, index) => {
    if (token.kind === "eof") return;
    // The gap before this token (whitespace, or a character the lexer skipped).
    if (token.start > at) {
      spans.push({ text: text.slice(at, token.start), kind: "plain" });
    }
    const invalid =
      token.kind === "error" ||
      (token.kind === "string" && token.unterminated === true) ||
      diagnostics.some(
        (diagnostic) =>
          diagnostic.span.start < token.end && diagnostic.span.end > token.start,
      );
    const span: HighlightSpan = {
      text: text.slice(token.start, token.end),
      kind: kindOf(token, index, tokens, fieldTokens),
    };
    if (invalid) span.invalid = true;
    spans.push(span);
    at = token.end;
  });

  if (at < text.length) spans.push({ text: text.slice(at), kind: "plain" });
  return spans;
}

/** The role of one token, given where it sits. */
function kindOf(
  token: Token,
  index: number,
  tokens: readonly Token[],
  fieldTokens: ReadonlySet<number>,
): HighlightKind {
  switch (token.kind) {
    case "colon":
    case "op":
    case "minus":
    case "lparen":
    case "rparen":
    case "lbracket":
    case "rbracket":
    case "comma":
    case "pipe":
      return "punct";
    case "error":
      return "plain";
    case "string":
      return fieldTokens.has(index) ? "field" : "string";
    case "word": {
      if (fieldTokens.has(index)) return "field";
      // A call before a keyword: `bucket` is both, and it reads as the call it is.
      if (
        FUNCTION_NAMES.has(token.text.toLowerCase()) &&
        tokens[index + 1]?.kind === "lparen"
      ) {
        return "function";
      }
      if (keywordOf(token) !== null) return "keyword";
      return "literal";
    }
    default:
      return "plain";
  }
}

/**
 * The indices of every token that is part of a **field name**.
 *
 * A field is a run of *adjacent* word/string tokens followed by an operator, which is how
 * the lexer's own rules leave it: `cap."speculative-execution"` is three tokens with no
 * gaps, and the adjacency is the only thing distinguishing it from `cap. "x"` written
 * with a space. Found by scanning right-to-left from each operator, mirroring what the
 * completer does to answer "whose value am I typing?".
 */
function fieldTokenIndices(tokens: readonly Token[]): Set<number> {
  const found = new Set<number>();
  tokens.forEach((token, index) => {
    if (token.kind !== "colon" && token.kind !== "op") return;
    let i = index - 1;
    let previous: Token | null = null;
    while (i >= 0) {
      const candidate = tokens[i]!;
      if (candidate.kind !== "word" && candidate.kind !== "string") break;
      // A gap means the run stopped: `state completed:` is a free-text term followed by a
      // predicate, not one two-word field.
      if (previous && candidate.end !== previous.start) break;
      found.add(i);
      previous = candidate;
      i -= 1;
    }
  });
  return found;
}
