// PromQL grammar for Expressive Code's Shiki highlighter, which bundles no
// grammar for the language. The observability docs quote Prometheus queries, so
// this covers the constructs those queries use: comments, label matchers,
// durations, aggregation keywords and function calls.
/** @type {import("shiki").LanguageRegistration} */
export const promql = {
  name: "promql",
  scopeName: "source.promql",
  patterns: [
    { match: "#.*$", name: "comment.line.number-sign.promql" },
    {
      begin: '"',
      end: '"',
      name: "string.quoted.double.promql",
      patterns: [{ match: "\\\\.", name: "constant.character.escape.promql" }],
    },
    {
      begin: "'",
      end: "'",
      name: "string.quoted.single.promql",
      patterns: [{ match: "\\\\.", name: "constant.character.escape.promql" }],
    },
    {
      match: "\\b\\d+(?:\\.\\d+)?(?:ms|s|m|h|d|w|y)\\b",
      name: "constant.numeric.duration.promql",
    },
    { match: "\\b\\d+(?:\\.\\d+)?\\b", name: "constant.numeric.promql" },
    {
      match:
        "\\b(?:by|without|on|ignoring|group_left|group_right|offset|bool|and|or|unless)\\b",
      name: "keyword.operator.word.promql",
    },
    {
      match: "\\b[a-zA-Z_][a-zA-Z0-9_]*(?=\\s*(?:=~|!~|=|!=))",
      name: "entity.other.attribute-name.promql",
    },
    {
      match: "\\b([a-z_][a-zA-Z0-9_]*)(?=\\s*\\()",
      name: "entity.name.function.promql",
    },
    {
      match: "\\b[a-zA-Z_:][a-zA-Z0-9_:]*\\b",
      name: "variable.other.metric.promql",
    },
    { match: "=~|!~|[=!<>]=|[-+*/%^<>]", name: "keyword.operator.promql" },
  ],
};

export default promql;
