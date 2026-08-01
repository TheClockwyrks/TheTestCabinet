// **TCQ in the browser** — the lexer, parser, compiler, formatter and completer, plus
// the mirrored evaluator and field catalog.
//
// The split is the design's, not an accident of layout:
//
// - **Parsing is TypeScript only.** It runs on every keystroke to highlight tokens,
//   underline an error span and answer "what can follow the caret", which a round trip
//   to a compiled artifact cannot serve — and `test-cabinet-core` does not compile to the
//   browser anyway. The backend never sees query *text*: the client sends the compiled
//   `GgQuery`, which is the single wire form, while the URL and the saved object carry
//   the source.
// - **Evaluation is mirrored.** `evaluate` and `fieldCatalog` exist twice — authoritative
//   in `crates/core/src/gg_query.eval.rs`, twinned here — because they must run on the
//   backend for the console *and* in the browser for the public static site, which has no
//   backend at all. The shared `gg_query.conformance.json` fixture is executed by both
//   suites (`conformance.test.ts` here) and is the only thing standing between two
//   independent evaluators and two different published numbers.
export type {
  AggNode,
  Diagnostic,
  FieldRef,
  FilterNode,
  GroupNode,
  IntervalNode,
  LiteralNode,
  QueryNode,
  SortKeyNode,
  StageNode,
} from "./ast";
export { AGG_FUNCS, STAGE_KEYWORDS } from "./ast";
export type { Completion, CompletionKind } from "./complete";
export { completeQuery } from "./complete";
export type { CompileOptions } from "./compile";
export { compileQuery, literalValue } from "./compile";
export { evaluate, fieldCatalog, globMatches, matches } from "./evaluate";
export { formatField, formatIdentifier, formatLiteral, formatQuery } from "./format";
export type { Keyword, Span, Token, TokenKind } from "./lex";
export { KEYWORDS, isKeyword, keywordOf, tokenize } from "./lex";
export type { ParseResult } from "./parse";
export { parseQuery } from "./parse";
export {
  GG_DATE_FIELDS,
  GG_FIELD_TOP_VALUES,
  GG_MAX_GROUP_KEYS,
  WEEK_ORIGIN_MS,
  aggName,
  asDisplay,
  asNumber,
  compareCodePoints,
  compareNumbers,
  formatNumber,
  intervalFloor,
  intervalMillis,
  quantile,
  totalCompare,
  valueKey,
} from "./values";
