//! **PureScript's [healing dialect](crate::healing::Dialect)** — the lexical half of
//! [response healing](crate::healing), answered in PureScript's own terms.
//!
//! Three of the methods here answer questions the healing skeleton asks and cannot answer itself —
//! the fence tags and the two line predicates — and two of those answers are this arm's alone, each
//! a fact about the language rather than a preference. The fourth, the
//! [mask](Dialect::code_mask), answers a lexical question of the same kind that healing never asks;
//! it sits on the trait beside the others and is read by
//! [this arm's module analysis](super::modules).
//!
//! # A `#` line is prose here, and that is the opposite of what the other arms say
//!
//! [Python](super::super::python::healing) and [Ruby](super::super::ruby::healing) both refuse to delete a `#`
//! line, because `# Plan` is a Markdown heading *and* a comment in those languages and nothing
//! lexical tells them apart — so the heading survives into the program, where the interpreter reads
//! it as a comment and it costs nothing.
//!
//! PureScript comments with `--` and `{- … -}`, and `#` is an ordinary **operator**
//! (`Data.Function.(#)`). A `## Plan` line left in a program is therefore a parse error rather than a
//! comment, so this dialect deletes it: `#` is *not* among [`NON_PROSE_CHARS`], and a `--` line is
//! never prose. That is the same rule as the other two arms — never delete a comment, never keep a
//! heading — reaching the opposite conclusion because the language underneath is different.
//!
//! The same fact cuts the other way once, and [`continues_a_pipeline`] is the carve-out: `# map trim`
//! is a **pipeline continuation**, which is what an operator that is not a comment is *for*. An
//! indented single `#` applied to a lower-case name and an argument is code and is kept; everything
//! else with a leading `#` is a heading and goes.
//!
//! # A call written without brackets is not two words of English
//!
//! PureScript applies a function by juxtaposition, so `log "done"` is a statement and
//! `throwError message` is a statement, and neither carries a bracket, an operator, a keyword or a
//! dot for a lexical test to find. Every other arm gets this for free from its own syntax — Python
//! and TypeScript need the call parentheses, Ruby's own dialect has them in the overwhelming case.
//! Here it takes two clauses of its own: `"` joins [`NON_PROSE_CHARS`], and
//! [`applies_a_named_function`] reads the shape English is written in — a sentence opens with a
//! capital or closes with terminal punctuation — rather than the tokens, which are identical.
//!
//! # None of this is a parser
//!
//! `purs` is a process and [the compile](super::compile) already spends one. Nothing here may spend a
//! second, so every answer below is a lexical shape test over text that is not yet known to be a
//! program, and each declines rather than guessing.

use crate::healing::{CodeMask, Dialect};

/// PureScript's dialect. A unit struct: everything it "holds" is the `const` data below.
pub(in crate::sandbox::language) struct PureScriptDialect;

/// The one instance, held by [`PureScript`](super::PureScript) and handed out as
/// `&'static dyn Dialect`.
pub(in crate::sandbox::language) static PURESCRIPT_DIALECT: PureScriptDialect = PureScriptDialect;

impl Dialect for PureScriptDialect {
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
/// A closed, recognised list, on the same terms every other arm's is. `haskell` is on it and is the
/// one entry worth explaining: PureScript's syntax is Haskell's to a highlighter's eye, most tools a
/// model has seen carry a `haskell` grammar and no `purescript` one, and a model tagging its program
/// that way is naming a *language*, not showing a Haskell snippet beside its program. The cost of
/// being wrong about that is bounded by the ladder: two blocks both carrying a recognised tag make
/// [`strip-fences`](crate::healing::HealingStrategy::StripFences) decline outright rather than choose.
const PROGRAM_TAGS: &[&str] = &["purescript", "purs", "haskell"];

/// The keywords a **declaration** opens with, matched case-sensitively at an identifier boundary.
///
/// Case-sensitivity is what keeps `Data models are the point` prose while `data Colour = Red` is
/// code, and it is the same distinction every other arm's dialect turns on.
const DECLARATION_KEYWORDS: [&str; 12] = [
    "module", "import", "data", "newtype", "type", "class", "instance", "derive", "foreign",
    "infixl", "infixr", "infix",
];

/// The keywords an **expression** line opens with inside a `do` block or a `where` clause.
///
/// Every one of them is also an ordinary English word in lower case, and that is safe in exactly one
/// direction: a prose line mistaken for code costs a fence that could have been unwrapped, and this
/// same list is what stops [`is_prose_line`] from ever deleting a `case … of` or a `let`.
const EXPRESSION_KEYWORDS: [&str; 10] = [
    "do", "ado", "let", "in", "case", "if", "then", "else", "where", "pure",
];

/// The tokens a line of code may end with — a declaration about to open a block, a binding about to
/// be given a body, or an expression continued on the line below.
///
/// Every one of them is a shape English lines do not end in, which is why this clause is safe in the
/// deleting direction as well as the keeping one.
const CODE_ENDINGS: [&str; 15] = [
    "=", "->", "<-", "=>", "$", "do", "where", "of", "then", "else", ",", "(", "[", "{", "::",
];

/// The operator sequences that only code contains — an ML type ascription, an arrow, a bind, an
/// application operator, a semigroup append.
const CODE_OPERATORS: [&str; 9] = ["::", "->", "<-", "=>", "<>", ">>=", "<$>", "<*>", "$ "];

/// Characters no line of English prose contains.
///
/// `#` is deliberately **absent**, which is where this arm parts company with
/// [Python's](super::super::python::healing) and [Ruby's](super::super::ruby::healing). Those two list it because a
/// `#` line is a comment in their languages and deleting it would delete the model's own words.
/// PureScript comments with `--`; `#` is an operator, and `## Plan` left in a program is a parse
/// error. So a Markdown heading is prose here, and is deleted — with the one exception
/// [`continues_a_pipeline`] carves out, which is the *other* thing a leading `#` can be.
///
/// `"` **is** present, and is this arm's own addition to the list every other dialect carries. A
/// PureScript string literal is written with it and nothing else is, so a line carrying one carries
/// code — while a quotation mark in a model's prose costs only a fence that could have been
/// unwrapped. English does contain quotation marks, which is exactly why this entry is justified by
/// the asymmetry rather than by the claim in this doc comment's first line: without it,
/// `log "done"` is two words to a word counter and gets deleted.
///
/// `:` is absent, for the reason it is absent from every arm's list: `Here is the plan:` is the
/// most ordinary sentence a model writes above its program. The `::` that matters is caught by
/// [`CODE_OPERATORS`] instead, which is the shape rather than the byte.
const NON_PROSE_CHARS: [char; 18] = [
    '`', ';', '{', '}', '(', ')', '[', ']', '=', '<', '>', '|', '&', '$', '\\', '~', '^', '"',
];

// ---------------------------------------------------------------------------------------------
// The line predicates
// ---------------------------------------------------------------------------------------------

/// Whether `line` is **certainly** a line of PureScript — this dialect's answer to
/// [`Dialect::looks_like_code`].
///
/// Its errors are asymmetric on purpose: a false positive costs a fence that could have been
/// unwrapped (one turn, one located diagnostic), while a false negative deletes a line of the model's
/// program. So every clause below is a shape that only code has.
fn looks_like_code(raw: &str) -> bool {
    let line = raw.trim();
    if line.is_empty() {
        return false;
    }
    // 1. A comment, a block comment, or a closer continuing the line above.
    if line.starts_with("--") || line.starts_with("{-") || line.starts_with([')', ']', '}', ',']) {
        return true;
    }
    // 1b. A `#` continuing a pipeline on the line above — the other thing a leading `#` can be.
    if continues_a_pipeline(raw) {
        return true;
    }
    // 2. A declaration, or an expression keyword.
    if starts_with_any(line, &DECLARATION_KEYWORDS) || starts_with_any(line, &EXPRESSION_KEYWORDS) {
        return true;
    }
    // 3. An operator only code writes.
    if CODE_OPERATORS
        .iter()
        .any(|operator| line.contains(operator))
    {
        return true;
    }
    // 4. It is left open at the end.
    if CODE_ENDINGS
        .iter()
        .any(|ending| ends_with_token(line, ending))
    {
        return true;
    }
    // 5. It binds a name — `total = 1`, `f (Just x) = x`.
    if is_binding(line) {
        return true;
    }
    // 6. It opens with a qualified name: `Console.log "x"`, `Map.insert k v`.
    opens_with_qualified(line)
}

/// Whether `line` is **certainly** prose rather than PureScript — this dialect's answer to
/// [`Dialect::is_prose_line`], and the test `strip-prose` uses to *delete* a line.
///
/// The mirror image of [`looks_like_code`], with the asymmetry the other way round: a false positive
/// here deletes the model's code, so every clause is a shape only English has. The two are
/// deliberately not complements and not disjoint, and the pipeline's fixpoint loop resolves the
/// overlap.
fn is_prose_line(raw: &str) -> bool {
    let line = raw.trim();
    if line.is_empty() {
        return false;
    }
    // 1. No character, and no operator, that only code uses.
    if line.contains(NON_PROSE_CHARS) {
        return false;
    }
    if CODE_OPERATORS
        .iter()
        .any(|operator| line.contains(operator))
    {
        return false;
    }
    // 2. Not a comment — deleting one would delete the model's own words, which is the deletion this
    //    subsystem exists not to make.
    if line.starts_with("--") {
        return false;
    }
    // 3. Not a declaration, not an expression keyword, and not a line left open at the end.
    if starts_with_any(line, &DECLARATION_KEYWORDS) || starts_with_any(line, &EXPRESSION_KEYWORDS) {
        return false;
    }
    if CODE_ENDINGS
        .iter()
        .any(|ending| ends_with_token(line, ending))
    {
        return false;
    }
    // 4. Not a call on a qualified name — the mirror of [`looks_like_code`]'s last clause, and the
    //    one this predicate cannot do without: `view.openText label summary` carries no bracket, no
    //    operator and no keyword, and reads to a word counter as three words of English. It is
    //    clause 5's case with a dot in the head, which is why that clause does not subsume it.
    if opens_with_qualified(line) {
        return false;
    }
    // 5. Not a function applied to something, which is the *unqualified* half of the clause above
    //    and the one this arm cannot do without. PureScript applies a function by juxtaposition, so
    //    `log "done"`, `log summary` and `throwError message` carry no bracket, no operator, no
    //    keyword and no dot — three of the commonest lines a `do` block contains, and three lines a
    //    word counter reads as two words of English apiece.
    if applies_a_named_function(line) {
        return false;
    }
    // 6. Not a `#` continuing a pipeline. [`NON_PROSE_CHARS`] deliberately omits `#` so that a
    //    Markdown heading is deleted, and this is the other thing a leading `#` can be.
    if continues_a_pipeline(raw) {
        return false;
    }
    // 7. A sentence, or a single terminated word.
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

/// Whether `line` opens with one of `keywords` at an identifier boundary.
fn starts_with_any(line: &str, keywords: &[&str]) -> bool {
    keywords.iter().any(|keyword| {
        line.strip_prefix(keyword)
            .is_some_and(|rest| rest.chars().next().is_none_or(|c| !is_ident_char(c)))
    })
}

/// Whether `line` ends with `ending` — at an identifier boundary when the ending is a word, so
/// `nothing to do` ends with `do` and `the video` does not.
fn ends_with_token(line: &str, ending: &str) -> bool {
    let Some(head) = line.strip_suffix(ending) else {
        return false;
    };
    if !ending.starts_with(|c: char| c.is_alphabetic()) {
        return true;
    }
    head.chars().next_back().is_none_or(|c| !is_ident_char(c))
}

/// Whether `line` binds a name — an identifier, optional argument patterns, then a top-level `=`
/// that is not part of `==`, `=>`, `<=`, `>=` or `/=`.
fn is_binding(line: &str) -> bool {
    super::modules::declared_value(line).is_some()
}

/// Whether `line` opens with a dotted chain of names followed by an argument — `Console.log "x"`,
/// `Map.insert key value`, `view.openText label body`.
fn opens_with_qualified(line: &str) -> bool {
    let mut parts = 0;
    let mut cursor = 0;
    loop {
        let rest = &line[cursor..];
        let name: String = rest
            .chars()
            .take_while(|c| is_ident_char(*c) || (*c == '\'' && cursor > 0))
            .collect();
        if name.is_empty() || !name.starts_with(is_ident_start) {
            return false;
        }
        cursor += name.len();
        parts += 1;
        let Some(after) = line[cursor..].strip_prefix('.') else {
            break;
        };
        if !after.starts_with(is_ident_start) {
            return false;
        }
        cursor += 1;
    }
    // Two names at least, and something applied to them: a lone `Data.Map` is as likely to be prose
    // about a module as it is to be a line of code.
    parts >= 2 && line[cursor..].starts_with(' ') && !line[cursor..].trim().is_empty()
}

/// Whether `line` applies a function to something, in the shape juxtaposition gives it: a lower-case
/// name, at least one more token after it, and no sentence punctuation at the end.
///
/// The clause exists because PureScript writes a call with no brackets at all. `log "done"` and
/// `throwError message` are ordinary lines of a `do` block and they are lexically indistinguishable
/// from two words of English — so what separates them here is not the tokens but the *shape English
/// is written in*: a sentence opens with a capital or closes with terminal punctuation, and an
/// application does neither.
///
/// The residue is a lower-case, unpunctuated line of prose — `the remaining work` — which this
/// reads as code and therefore keeps. That is the direction this predicate is allowed to be wrong
/// in: a kept line of prose is a parse error the model is shown at its own coordinates, and a
/// deleted line of code is a statement the model never learns went missing.
fn applies_a_named_function(line: &str) -> bool {
    let mut tokens = line.split_whitespace();
    let (Some(head), Some(_)) = (tokens.next(), tokens.next()) else {
        return false;
    };
    head.starts_with(char::is_lowercase)
        && head.chars().all(|c| is_ident_char(c) || c == '\'')
        && !line.ends_with(['.', '!', '?', ':', ',', ';'])
}

/// Whether `raw` — **untrimmed** — continues a pipeline with `#`, PureScript's
/// `Data.Function.applyFlipped`, which `Prelude` exports and which idiomatic code uses to read an
/// expression left to right.
///
/// The one shape that has to be told from a Markdown heading, because [`NON_PROSE_CHARS`]
/// deliberately does not carry `#` and the sentence clause would otherwise delete it. Three facts
/// separate the two, and all three are required:
///
/// * **One** `#`, followed by a space. `## Plan` is a heading and nothing else; `#>` is an operator
///   a program defined, which the clauses above already keep.
/// * The name after it is **lower-case**, or is qualified and ends in a lower-case name —
///   `# map trim`, `# Array.filter isEmpty`. A function is what `#` applies, and PureScript
///   functions are lower-case.
/// * The line is **indented**. `#` continues an expression, and the declaration it continues began
///   at column zero; Markdown puts a heading at the margin for its own reasons, since indenting one
///   four spaces makes it a code block rather than a heading.
///
/// A heading whose title happens to begin with a lower-case word — `# the remaining work`, indented
/// — is read as code by this, and is kept. Same asymmetry as everywhere else in this module.
fn continues_a_pipeline(raw: &str) -> bool {
    let line = raw.trim_start();
    if line.len() == raw.len() {
        return false;
    }
    let Some(rest) = line.strip_prefix("# ") else {
        return false;
    };
    let mut tokens = rest.split_whitespace();
    let (Some(head), Some(_)) = (tokens.next(), tokens.next()) else {
        return false;
    };
    let Some(last) = head.split('.').next_back() else {
        return false;
    };
    head.split('.').all(|segment| {
        !segment.is_empty() && segment.chars().all(|c| is_ident_char(c) || c == '\'')
    }) && last.starts_with(char::is_lowercase)
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

/// Whether `c` may open a PureScript identifier.
fn is_ident_start(c: char) -> bool {
    c.is_alphabetic() || c == '_'
}

/// Whether `c` may continue one.
fn is_ident_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

// ---------------------------------------------------------------------------------------------
// The lexical mask
// ---------------------------------------------------------------------------------------------

/// Where the scan currently is.
enum Mode {
    /// Ordinary code.
    Code,
    /// Inside a `--` comment, until the next newline.
    Line,
    /// Inside a `{- … -}` comment, which **nests** — so the depth is carried.
    Block { depth: usize },
    /// Inside a `"…"` string, which a newline ends uncleanly.
    Str,
    /// Inside a `"""…"""` string, which is raw and which a newline does not end.
    Raw,
}

/// Lex `src` into its [code mask](CodeMask) — this dialect's answer to [`Dialect::code_mask`].
///
/// `None` means the source did not lex cleanly, and every caller that needs the mask goes without
/// it — [the module scan](super::modules) reads such a source as though it were all code. Three
/// states end a scan uncleanly: an ordinary string still open at a newline, a triple-quoted string
/// still open at the end of input, and a block comment still open at the end of input.
///
/// # The four shapes it reads, and the two subtleties in them
///
/// `"…"` with backslash escapes, `"""…"""` raw strings, `-- …` to the newline, and `{- … -}`
/// nested block comments.
///
/// **A `--` is not always a comment.** PureScript operators are built out of symbol characters, so
/// `-->` and `<--` are names a program may define and use, and only a run of dashes followed by
/// something that is *not* a symbol character opens a comment. Reading `x --> y` as a comment would
/// mask the rest of the line, and everything declared on it would go unread.
///
/// **A `'` is usually a prime.** `total'` is an ordinary identifier and `'a'` is a character literal,
/// and the two are told apart the only way they can be: a quote that follows an identifier character
/// continues a name, and one that does not opens a literal *only if* the literal closes within the
/// handful of bytes a character literal can be. Anything else is left as code, because a mis-read
/// quote would open a string that never closes and cost the whole source its mask.
fn code_mask(src: &str) -> Option<CodeMask> {
    let bytes = src.as_bytes();
    let mut code = vec![true; bytes.len()];
    let mut mode = Mode::Code;
    let mut index = 0;

    while index < bytes.len() {
        let byte = bytes[index];
        match mode {
            Mode::Code => match byte {
                b'-' if opens_line_comment(bytes, index) => {
                    code[index] = false;
                    mode = Mode::Line;
                    index += 1;
                }
                b'{' if bytes.get(index + 1) == Some(&b'-') => {
                    code[index] = false;
                    code[index + 1] = false;
                    mode = Mode::Block { depth: 1 };
                    index += 2;
                }
                b'"' => {
                    let triple =
                        bytes.get(index + 1) == Some(&b'"') && bytes.get(index + 2) == Some(&b'"');
                    let width = if triple { 3 } else { 1 };
                    for offset in 0..width {
                        code[index + offset] = false;
                    }
                    mode = if triple { Mode::Raw } else { Mode::Str };
                    index += width;
                }
                b'\'' => match character_literal(bytes, index) {
                    Some(end) => {
                        for slot in code.iter_mut().take(end).skip(index) {
                            *slot = false;
                        }
                        index = end;
                    }
                    // A prime on an identifier, or a quote this scan cannot account for. Either way
                    // it is code, and reading it as a literal would lose the rest of the source.
                    None => index += 1,
                },
                _ => index += 1,
            },
            Mode::Line => {
                if byte == b'\n' {
                    mode = Mode::Code;
                } else {
                    code[index] = false;
                }
                index += 1;
            }
            Mode::Block { depth } => {
                code[index] = false;
                if src[index..].starts_with("{-") {
                    code[index + 1] = false;
                    mode = Mode::Block { depth: depth + 1 };
                    index += 2;
                } else if src[index..].starts_with("-}") {
                    code[index + 1] = false;
                    mode = match depth {
                        0 | 1 => Mode::Code,
                        _ => Mode::Block { depth: depth - 1 },
                    };
                    index += 2;
                } else {
                    index += 1;
                }
            }
            Mode::Str => {
                code[index] = false;
                match byte {
                    // A backslash escapes whatever follows it, a newline included — which is how a
                    // PureScript string gap legally spans two lines.
                    b'\\' => {
                        if index + 1 >= bytes.len() {
                            return None;
                        }
                        code[index + 1] = false;
                        index += 2;
                    }
                    b'\n' => return None,
                    b'"' => {
                        mode = Mode::Code;
                        index += 1;
                    }
                    _ => index += 1,
                }
            }
            Mode::Raw => {
                code[index] = false;
                if byte == b'"'
                    && bytes.get(index + 1) == Some(&b'"')
                    && bytes.get(index + 2) == Some(&b'"')
                {
                    code[index + 1] = false;
                    code[index + 2] = false;
                    mode = Mode::Code;
                    index += 3;
                } else {
                    index += 1;
                }
            }
        }
    }

    // A line comment is closed by end of input; the other three are not, and an open one means the
    // scan lost its place.
    matches!(mode, Mode::Code | Mode::Line).then_some(CodeMask::from_flags(code))
}

/// The symbol characters a PureScript operator is built out of.
const SYMBOL_BYTES: &[u8] = br":!#$%&*+./<=>?@\^|";

/// Whether the run of dashes at `index` opens a line comment.
///
/// Two or more dashes, followed by something that is not a symbol character — which is exactly
/// Haskell's rule, and is what keeps `-->` an operator. The character *before* matters too: `<--` is
/// one operator, not a `<` and a comment.
fn opens_line_comment(bytes: &[u8], index: usize) -> bool {
    if bytes.get(index + 1) != Some(&b'-') {
        return false;
    }
    if index > 0 && (SYMBOL_BYTES.contains(&bytes[index - 1]) || bytes[index - 1] == b'-') {
        return false;
    }
    let mut end = index;
    while bytes.get(end) == Some(&b'-') {
        end += 1;
    }
    bytes
        .get(end)
        .is_none_or(|byte| !SYMBOL_BYTES.contains(byte))
}

/// The end offset of the character literal opening at `index`, or `None` when this quote is a prime
/// on an identifier or a shape this scan will not guess at.
///
/// A character literal is `'x'`, `'\n'`, or one of the escapes that run to a handful of bytes
/// (`'\x2764'`), so the search is bounded rather than open-ended: an unbounded one is how a prime
/// swallows the rest of a program.
fn character_literal(bytes: &[u8], index: usize) -> Option<usize> {
    // A quote directly after an identifier character is a prime — `total'`, `x''`.
    if index > 0 && (bytes[index - 1].is_ascii_alphanumeric() || bytes[index - 1] == b'_') {
        return None;
    }
    let escaped = bytes.get(index + 1) == Some(&b'\\');
    let limit = if escaped { 8 } else { 2 };
    let mut at = index + 1 + usize::from(escaped);
    let end = (index + 1 + limit).min(bytes.len());
    while at < end {
        if bytes[at] == b'\'' {
            return Some(at + 1);
        }
        if bytes[at] == b'\n' {
            return None;
        }
        at += 1;
    }
    None
}

#[cfg(test)]
#[path = "purescript.healing.test.rs"]
mod tests;
