// The **lexer** — TCQ source text to a flat token stream.
//
// Hand-written, with no parser library anywhere in the workspace: the CSP-strict public
// site and the bundle budget both argue against one, and the grammar is small enough
// that a generator would be more machinery than language. The consequence is that the
// grammar is **frozen for v1** — every "just add a function" is a lex rule, a parse
// path, a completion rule, a formatter arm and new conformance cases.
//
// The lexer never fails. An unterminated string or a stray character becomes a token
// carrying its own span, because the editor highlights and completes on **every**
// keystroke, and half-typed text is the normal case rather than the error case.

/** What a token is, before the parser gives it a role. */
export type TokenKind =
  /** A bare run of word characters: a field, a keyword, an unquoted literal, a glob. */
  | "word"
  /** A double-quoted literal. {@link Token.value} carries it unescaped. */
  | "string"
  /** `:` — the equality operator, and the head of `:*`, `:(…)` and `:[…]`. */
  | "colon"
  /** `!=`, `>=`, `<=`, `>`, `<`. */
  | "op"
  /** `-` in prefix position: the terse spelling of `not`. */
  | "minus"
  | "lparen"
  | "rparen"
  | "lbracket"
  | "rbracket"
  | "comma"
  /** `|` — the stage separator. */
  | "pipe"
  /** A character the grammar has no rule for. Kept as a token so the editor can
   *  underline exactly it rather than the rest of the line. */
  | "error"
  /** The zero-width token at the end of the input, so every parse position is a real
   *  token and the completer can ask "what follows the caret" at the very end. */
  | "eof";

/** A half-open `[start, end)` range of the source text, in UTF-16 offsets — what the
 *  editor underlines and what a diagnostic points at. */
export interface Span {
  start: number;
  end: number;
}

/** One lexed token. */
export interface Token {
  kind: TokenKind;
  /** The source text the token spans, verbatim (quotes and all, for a string). */
  text: string;
  /** A string token's contents with escapes resolved; the raw text otherwise. */
  value: string;
  start: number;
  end: number;
  /** Set on a `string` token whose closing quote is missing — still a usable token, so
   *  a query being typed keeps completing. */
  unterminated?: boolean;
}

/** The operator spellings, longest first so `>=` is never lexed as `>` then `=`. */
const OPERATORS = ["!=", ">=", "<="] as const;

/**
 * Whether `ch` may appear **inside** a bare word.
 *
 * Deliberately wide. Field names carry every one of these in practice:
 * `cap.agent-persistence` (dots and hyphens), `tool.edit_file` (underscores) and
 * `model.anthropic/claude-a.tokens` (a slash, because a model id is part of the field
 * name). `*` is included so `model:anthropic/*` lexes as one literal rather than a word
 * followed by a bare star, and `+`/`-` so a relative date (`now-30d`) and a signed
 * number (`-5`) survive.
 *
 * Note what is **not** here: `:`, which is the equality operator. A full ISO timestamp
 * (`2026-01-01T00:00:00Z`) therefore has to be quoted; a bare `2026-01-01` does not.
 */
function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}_./*+\-]/u.test(ch);
}

/**
 * Whether `ch` may **start** a bare word.
 *
 * `-` and `+` are excluded so `-state:completed` reads as a negation rather than as a
 * field literally called `-state`; {@link tokenize} re-admits them when a digit follows,
 * which is how `-5` stays a negative number.
 */
function isWordStart(ch: string): boolean {
  return isWordChar(ch) && ch !== "-" && ch !== "+";
}

/**
 * Lex `text` into tokens, always ending with an `eof` token.
 *
 * Whitespace is skipped rather than emitted: nothing in the grammar is
 * whitespace-sensitive (juxtaposition means AND, but so does the `and` keyword), and
 * the formatter re-derives spacing from the tree.
 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  const push = (
    kind: TokenKind,
    start: number,
    end: number,
    value?: string,
  ) => {
    tokens.push({
      kind,
      text: text.slice(start, end),
      value: value ?? text.slice(start, end),
      start,
      end,
    });
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (/\s/u.test(ch)) {
      i += 1;
      continue;
    }

    if (ch === '"') {
      const start = i;
      i += 1;
      let value = "";
      let closed = false;
      while (i < text.length) {
        const c = text[i]!;
        if (c === "\\" && i + 1 < text.length) {
          const next = text[i + 1]!;
          value += next === "n" ? "\n" : next === "t" ? "\t" : next;
          i += 2;
          continue;
        }
        if (c === '"') {
          i += 1;
          closed = true;
          break;
        }
        value += c;
        i += 1;
      }
      const token: Token = {
        kind: "string",
        text: text.slice(start, i),
        value,
        start,
        end: i,
      };
      if (!closed) token.unterminated = true;
      tokens.push(token);
      continue;
    }

    const twoChar = text.slice(i, i + 2);
    if ((OPERATORS as readonly string[]).includes(twoChar)) {
      push("op", i, i + 2);
      i += 2;
      continue;
    }

    if (ch === ">" || ch === "<") {
      push("op", i, i + 1);
      i += 1;
      continue;
    }

    const punctuation: Record<string, TokenKind> = {
      ":": "colon",
      "(": "lparen",
      ")": "rparen",
      "[": "lbracket",
      "]": "rbracket",
      ",": "comma",
      "|": "pipe",
    };
    const kind = punctuation[ch];
    if (kind) {
      push(kind, i, i + 1);
      i += 1;
      continue;
    }

    // A sign directly in front of a digit belongs to the number; anywhere else a
    // leading `-` is the terse `not`.
    const signedNumber =
      (ch === "-" || ch === "+") &&
      i + 1 < text.length &&
      /\d/u.test(text[i + 1]!);
    if (isWordStart(ch) || signedNumber) {
      const start = i;
      i += 1;
      while (i < text.length && isWordChar(text[i]!)) i += 1;
      push("word", start, i);
      continue;
    }

    if (ch === "-") {
      push("minus", i, i + 1);
      i += 1;
      continue;
    }

    push("error", i, i + 1);
    i += 1;
  }

  tokens.push({
    kind: "eof",
    text: "",
    value: "",
    start: text.length,
    end: text.length,
  });
  return tokens;
}

/** The keywords the parser recognises, matched case-insensitively so `NOT`/`not` and
 *  `BY`/`by` both read. The formatter emits them lowercase. */
export const KEYWORDS = [
  "and",
  "or",
  "not",
  "to",
  "stats",
  "by",
  "sort",
  "limit",
  "as",
  "bucket",
  "asc",
  "desc",
] as const;

export type Keyword = (typeof KEYWORDS)[number];

/** Whether `token` is the given keyword — a `word` token whose text matches, ignoring
 *  case. Keywords are contextual: nothing stops a field being called `by`, it simply
 *  has to be quoted where the parser would otherwise read the keyword. */
export function isKeyword(token: Token, keyword: Keyword): boolean {
  return token.kind === "word" && token.text.toLowerCase() === keyword;
}

/** Whether `token` is any keyword at all — used by the parser to stop a juxtaposed AND
 *  chain from swallowing `by`, and by the completer to decide what may follow. */
export function keywordOf(token: Token): Keyword | null {
  if (token.kind !== "word") return null;
  const lowered = token.text.toLowerCase() as Keyword;
  return (KEYWORDS as readonly string[]).includes(lowered) ? lowered : null;
}
