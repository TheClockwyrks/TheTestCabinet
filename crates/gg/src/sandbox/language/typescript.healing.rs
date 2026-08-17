//! **TypeScript's [healing dialect](crate::healing::Dialect)** — the lexical half of
//! [response healing](crate::healing).
//!
//! It serves gg's [JavaScript](super::super::javascript) arm too, and that is not a shortcut: the two arms
//! are one syntax, differing only in whether the program is type-checked before it runs. Every
//! question below — which fence tags a model uses, which lines are code and which are prose, which
//! bytes are string or comment text — has the same answer on both, and a second copy giving a
//! *different* one would be a difference in surface in the middle of the one study this pair exists
//! to run.
//!
//! Three of those four are what the healing skeleton asks and cannot answer itself: the fence tags
//! and the two line predicates. The last of them — which bytes of a source are code rather than
//! string or comment text — is a lexical question of the same kind that **no strategy consults**.
//! It lives on the [dialect](Dialect) beside the other three so that a reader who finds it here does
//! not go looking for the call; [`code_mask`] says what it serves instead.
//!
//! # Why it lives here and not in `healing.rs`
//!
//! Because it is TypeScript's, and the module it serves is deliberately not any language's. The
//! skeleton owns the contract — the three strategies, their order, their declines, the honesty
//! disclosure and the delete-only invariant — and this file owns the reading of the text. Splitting
//! them this way is what lets a second language reuse every repair without inheriting a single one
//! of the assumptions below, and what lets the skeleton be tested against a dialect that answers
//! nothing.
//!
//! # None of these is a parser
//!
//! Not one predicate here parses. `tsc` is sitting right next door in
//! [`compile`](super::compile) and is deliberately not used: healing runs on text that is **not yet
//! known to be a program** — it may be Markdown or English as easily as source — so a parser would
//! fail on precisely the inputs healing exists to repair. Every predicate is therefore a lexical
//! shape test with its errors pointed in the safe direction, and every one of them **declines**
//! rather than guesses when it cannot tell.

use crate::healing::{CodeMask, Dialect};

/// TypeScript's dialect. A unit struct: everything it "holds" is the `const` data below.
pub(in crate::sandbox::language) struct TypeScriptDialect;

/// The one instance, held by [`TypeScript`](super::TypeScript) — and by
/// [`JavaScript`](super::super::javascript::JavaScript), which reads its replies with the same
/// dialect because it is written in the same syntax — and handed out as `&'static dyn Dialect`.
pub(in crate::sandbox::language) static TYPESCRIPT_DIALECT: TypeScriptDialect = TypeScriptDialect;

impl Dialect for TypeScriptDialect {
    fn program_fence_tags(&self) -> &'static [&'static str] {
        PROGRAM_TAGS
    }

    fn looks_like_code(&self, line: &str) -> bool {
        looks_like_code(line)
    }

    fn is_prose_line(&self, line: &str) -> bool {
        is_prose_line(line)
    }

    fn code_mask(&self, src: &str) -> Option<CodeMask> {
        code_mask(src)
    }

    #[cfg(test)]
    fn fixtures(&self) -> &'static [&'static str] {
        tests::FIXTURES
    }
}

/// The info-string tags gg reads as "this block is the program", lower-cased.
///
/// A closed, recognised list rather than a deny list: a block tagged `json`, `text`, `bash` or `md`
/// is context the model showed, not the program, and round 1 measured models emitting exactly those
/// alongside a `ts` block. Tier 3 of the candidacy ladder is what stops the closed list from being a
/// trap — a reply that is one block tagged something gg has never heard of, whose body is plainly
/// code, is still run.
///
/// The JavaScript spellings are here beside the TypeScript ones deliberately: a model asked for
/// TypeScript routinely tags its block `js`, and the type-strip accepts either.
const PROGRAM_TAGS: &[&str] = &[
    "ts",
    "typescript",
    "tsx",
    "mts",
    "cts",
    "typescriptreact",
    "js",
    "javascript",
    "jsx",
    "mjs",
    "cjs",
    "javascriptreact",
    "node",
    "es",
    "es6",
];

// ---------------------------------------------------------------------------------------------
// The predicates and the lexical mask
// ---------------------------------------------------------------------------------------------

/// The JavaScript statement keywords a line of code may open with.
///
/// Matched **case-sensitively** at an identifier boundary, which is the difference between the `let`
/// that opens a declaration and the `Let's` that opens a sentence — a distinction a real reply
/// turned on.
const STATEMENT_KEYWORDS: [&str; 26] = [
    "const", "let", "var", "function", "return", "if", "for", "while", "switch", "case", "try",
    "catch", "finally", "throw", "class", "new", "do", "else", "import", "export", "async",
    "await", "yield", "delete", "typeof", "void",
];

/// The tokens a line of code may end with.
const CODE_ENDINGS: [&str; 11] = [";", "{", "}", ",", "(", "[", "=>", "&&", "||", "+", "="];

/// Characters no line of English prose contains.
const NON_PROSE_CHARS: [char; 15] = [
    '`', ';', '{', '}', '(', ')', '[', ']', '=', '<', '>', '|', '&', '$', '\\',
];

/// Whether `line` is **certainly** a line of code — TypeScript's answer to
/// [`Dialect::looks_like_code`].
///
/// It is what `strip-fences` uses to refuse to unwrap a fence that is inside a program rather than
/// around one, and what the loop uses to tell a reply that failed to compile from a reply that was
/// never a program.
///
/// Its errors are asymmetric on purpose. A false positive costs a fence that could have been
/// unwrapped (one turn, one located diagnostic); a false negative deletes a line of the model's
/// program. So every clause below is a shape that only code has.
///
/// # Three shapes deliberately absent, each because a real reply contains it
///
/// * **ending with `)` or `]`** — a real trailing-prose line is `- a.ts (6 lines)`, and treating a
///   trailing paren as code would make the single most common real shape (prose, one fenced program,
///   prose) decline;
/// * **starting with a backtick** — models write prose lines that open with an inline code span
///   (`` `index.ts`: ``), and a template-literal continuation line that genuinely is code is already
///   caught by clause 1;
/// * **containing `;` anywhere** — English uses semicolons (`Here is the plan; I will list the
///   files.`), while clause 5 keeps every code shape that needs one (`x.y = 1; // note`). Without
///   that narrowing, one semicolon in a model's lead-in sentence disables fence stripping for the
///   whole reply.
fn looks_like_code(line: &str) -> bool {
    let line = line.trim();
    if line.is_empty() {
        return false;
    }
    // 1. It ends the way a statement or an open block ends.
    if CODE_ENDINGS.iter().any(|ending| line.ends_with(ending)) {
        return true;
    }
    // 2. It opens with a statement keyword.
    if starts_with_keyword(line) {
        return true;
    }
    // 3. It opens with a closer or a comment.
    if ["}", ")", "]", "//", "/*"]
        .iter()
        .any(|prefix| line.starts_with(prefix))
    {
        return true;
    }
    // 4. It contains a fat arrow anywhere.
    if line.contains("=>") {
        return true;
    }
    // 5. It contains a `;` that terminates a statement — nothing after it but a comment.
    if line.match_indices(';').any(|(at, _)| {
        let rest = line[at + 1..].trim_start();
        rest.is_empty() || rest.starts_with("//") || rest.starts_with("/*")
    }) {
        return true;
    }
    // 6. It opens with a call: an identifier or dotted chain immediately followed by `(`.
    opens_with_call(line)
}

/// Whether `line` opens with a JavaScript statement keyword at an identifier boundary.
fn starts_with_keyword(line: &str) -> bool {
    STATEMENT_KEYWORDS.iter().any(|keyword| {
        line.strip_prefix(keyword)
            .is_some_and(|rest| rest.chars().next().is_none_or(|c| !is_ident_char(c)))
    })
}

/// Whether `line` opens with `identifier(`, `a.b(` or `a.b.c(` — `writeFile(`, `console.log(`,
/// `entries.filter(`.
fn opens_with_call(line: &str) -> bool {
    let mut chars = line.char_indices().peekable();
    let Some((_, first)) = chars.peek().copied() else {
        return false;
    };
    if !is_ident_start(first) {
        return false;
    }
    let mut end = 0;
    while let Some((index, c)) = chars.peek().copied() {
        if is_ident_char(c) {
            end = index + c.len_utf8();
            chars.next();
            continue;
        }
        // A dot continues the chain only when a further identifier follows it; otherwise the chain
        // ended at the previous character, which is what keeps `Done. Created …` prose.
        if c == '.' {
            let mut lookahead = chars.clone();
            lookahead.next();
            if lookahead
                .peek()
                .is_some_and(|(_, next)| is_ident_start(*next))
            {
                chars.next();
                continue;
            }
        }
        break;
    }
    line[end..].starts_with('(')
}

/// Whether `line` is **certainly** prose — TypeScript's answer to [`Dialect::is_prose_line`], and
/// the test `strip-prose` uses to delete a line.
///
/// The mirror image of [`looks_like_code`]: here a false positive deletes the model's code, so every
/// clause is a shape that only English has. The two predicates are **not** complements and are not
/// disjoint — a line may satisfy both, or neither — and the pipeline's fixpoint loop is what
/// resolves the overlap.
fn is_prose_line(line: &str) -> bool {
    let line = line.trim();
    if line.is_empty() {
        return false;
    }
    // 1. No punctuation that only code uses, and no comment opener.
    if line.contains(NON_PROSE_CHARS) || line.contains("//") || line.contains("/*") {
        return false;
    }
    // 2. Not a statement.
    if starts_with_keyword(line) {
        return false;
    }
    // 3. A sentence, or a single terminated word.
    let mut tokens = line.split_whitespace();
    let (Some(first), second) = (tokens.next(), tokens.next()) else {
        return false;
    };
    if second.is_some() {
        return [first]
            .into_iter()
            .chain(second)
            .chain(tokens)
            .any(has_letter_run);
    }
    first
        .strip_suffix(['.', '!', '?'])
        .is_some_and(|word| word.chars().count() >= 2 && word.chars().all(char::is_alphabetic))
}

/// Whether `token` contains a run of three or more letters — what tells a word of English from a
/// path, a number or an identifier fragment.
fn has_letter_run(token: &str) -> bool {
    let mut run = 0;
    for c in token.chars() {
        run = if c.is_alphabetic() { run + 1 } else { 0 };
        if run >= 3 {
            return true;
        }
    }
    false
}

/// Whether `c` may open a JavaScript identifier.
fn is_ident_start(c: char) -> bool {
    c.is_alphabetic() || c == '_' || c == '$'
}

/// Whether `c` may continue a JavaScript identifier.
fn is_ident_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '$'
}

/// Lex `src` into its [code mask](CodeMask) — TypeScript's answer to [`Dialect::code_mask`].
///
/// `None` means the source did not lex cleanly, and every caller declines on it. Three states end a
/// scan uncleanly: an unterminated block comment, an unterminated template literal, and —
/// decisively — a single- or double-quoted string still open at a newline, which JavaScript forbids.
///
/// Handles `'…'`, `"…"`, `` `…` `` with `${ … }` substitutions re-entering code (nesting tracked),
/// `//…\n`, `/*…*/`, and backslash escapes. Neither `strip-fences` nor `strip-prose` asks for it —
/// their input is not JavaScript yet — so what it serves is a reader that already has a program in
/// hand and has to tell the program's own bytes from the text it merely quotes.
///
/// # The one thing it does not lex
///
/// Regular-expression literals. Telling `/` as division from `/` as the start of a regex needs
/// parser context, which is the very thing this function exists to avoid. A regex containing a quote
/// (`str.replace(/don't/g, "")`) therefore desynchronises the scan — and because that leaves a
/// quoted string open at the next newline, the scan returns `None` and the caller declines. The
/// failure mode of the one shape it cannot lex is *no answer at all*, which is the correct one.
fn code_mask(src: &str) -> Option<CodeMask> {
    /// Where the scan currently is.
    enum Mode {
        Code,
        Single,
        Double,
        Template,
        LineComment,
        BlockComment,
    }

    let bytes = src.as_bytes();
    let mut code = vec![true; bytes.len()];
    let mut mode = Mode::Code;
    // The brace depth each open `${ … }` substitution returns to Template at. Its length is how
    // many template literals the scan is currently inside.
    let mut substitutions: Vec<usize> = Vec::new();
    let mut depth = 0usize;
    let mut index = 0;

    while index < bytes.len() {
        let byte = bytes[index];
        let next = bytes.get(index + 1).copied();
        match mode {
            Mode::Code => match byte {
                b'/' if next == Some(b'/') => {
                    mark_comment(&mut code, index);
                    mark_comment(&mut code, index + 1);
                    mode = Mode::LineComment;
                    index += 2;
                }
                b'/' if next == Some(b'*') => {
                    mark_comment(&mut code, index);
                    mark_comment(&mut code, index + 1);
                    mode = Mode::BlockComment;
                    index += 2;
                }
                b'\'' | b'"' | b'`' => {
                    code[index] = false;
                    mode = match byte {
                        b'\'' => Mode::Single,
                        b'"' => Mode::Double,
                        _ => Mode::Template,
                    };
                    index += 1;
                }
                b'{' => {
                    depth += 1;
                    index += 1;
                }
                b'}' => {
                    if substitutions.last() == Some(&depth) {
                        substitutions.pop();
                        mode = Mode::Template;
                    } else {
                        depth = depth.saturating_sub(1);
                    }
                    index += 1;
                }
                _ => index += 1,
            },
            Mode::Single | Mode::Double => {
                let quote = if matches!(mode, Mode::Single) {
                    b'\''
                } else {
                    b'"'
                };
                code[index] = false;
                match byte {
                    // A string that is still open at a newline is not a string JavaScript accepts,
                    // and is the signature of a scan that has lost its place.
                    b'\n' => return None,
                    b'\\' => {
                        if index + 1 >= bytes.len() {
                            return None;
                        }
                        code[index + 1] = false;
                        index += 2;
                    }
                    _ if byte == quote => {
                        mode = Mode::Code;
                        index += 1;
                    }
                    _ => index += 1,
                }
            }
            Mode::Template => {
                code[index] = false;
                match byte {
                    b'\\' => {
                        if index + 1 >= bytes.len() {
                            return None;
                        }
                        code[index + 1] = false;
                        index += 2;
                    }
                    b'`' => {
                        mode = Mode::Code;
                        index += 1;
                    }
                    b'$' if next == Some(b'{') => {
                        // The substitution's own delimiters are code: they are what a brace count
                        // has to see in order to come back out again.
                        code[index] = true;
                        code[index + 1] = true;
                        substitutions.push(depth);
                        mode = Mode::Code;
                        index += 2;
                    }
                    _ => index += 1,
                }
            }
            Mode::LineComment => {
                if byte == b'\n' {
                    mode = Mode::Code;
                } else {
                    mark_comment(&mut code, index);
                }
                index += 1;
            }
            Mode::BlockComment => {
                mark_comment(&mut code, index);
                if byte == b'*' && next == Some(b'/') {
                    mark_comment(&mut code, index + 1);
                    mode = Mode::Code;
                    index += 2;
                } else {
                    index += 1;
                }
            }
        }
    }

    // A line comment is closed by end of input; a string, a template literal, a block comment and an
    // open `${` substitution are not, and each one means the scan lost its place.
    (matches!(mode, Mode::Code | Mode::LineComment) && substitutions.is_empty())
        .then_some(CodeMask::from_flags(code))
}

/// Mark one byte as comment text, which is not code.
fn mark_comment(code: &mut [bool], index: usize) {
    code[index] = false;
}

#[cfg(test)]
#[path = "typescript.healing.test.rs"]
mod tests;
