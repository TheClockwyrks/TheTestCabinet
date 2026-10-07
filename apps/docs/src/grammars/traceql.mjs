// TraceQL grammar for Expressive Code's Shiki highlighter, which bundles no
// grammar for the language. The observability docs quote the Tempo query the
// console links to, so this covers spansets: intrinsics, scoped attributes,
// durations and the comparison operators between them.
/** @type {import("shiki").LanguageRegistration} */
export const traceql = {
  name: "traceql",
  scopeName: "source.traceql",
  patterns: [
    { match: "//.*$", name: "comment.line.double-slash.traceql" },
    {
      begin: '"',
      end: '"',
      name: "string.quoted.double.traceql",
      patterns: [{ match: "\\\\.", name: "constant.character.escape.traceql" }],
    },
    {
      match: "\\b\\d+(?:\\.\\d+)?(?:ms|s|m|h|d|w|y)\\b",
      name: "constant.numeric.duration.traceql",
    },
    { match: "\\b\\d+(?:\\.\\d+)?\\b", name: "constant.numeric.traceql" },
    {
      match:
        "\\b(?:and|or|not|by|select|with|count|sum|min|max|avg|rate|count_over_time|quantile_over_time|histogram_over_time|compare)\\b",
      name: "keyword.operator.word.traceql",
    },
    {
      match:
        "\\b(?:duration|traceDuration|name|status|statusMessage|kind|childCount|rootName|rootServiceName|nestedSetLeft|nestedSetRight|nestedSetParent|event|link|instrumentation)\\b",
      name: "support.type.intrinsic.traceql",
    },
    {
      match: "\\b(?:ok|error|unset|true|false|nil)\\b",
      name: "constant.language.traceql",
    },
    {
      match:
        "(?:\\b(?:span|resource|event|link|parent)\\b)?\\.[a-zA-Z_][a-zA-Z0-9_.]*",
      name: "variable.other.member.traceql",
    },
    {
      match: "=~|!~|[=!<>]=|&&|\\|\\||[-+*/%<>|&]",
      name: "keyword.operator.traceql",
    },
  ],
};

export default traceql;
