//! **Python's [healing dialect](crate::healing::Dialect)** — the lexical half of
//! [response healing](crate::healing), answered in Python's own terms.
//!
//! Every method here answers a question the healing skeleton asks and cannot answer itself, and
//! three of them answer it *differently* from the ECMAScript arm — not as a matter of taste, but
//! because the language underneath is different in ways that change what a deletion is safe to make.
//!
//! # The three answers that are Python's and nobody else's
//!
//! **An import is never deleted.** The ECMAScript guest is baked with no module system at all, so
//! every `import` a program writes there is dead text and dropping it can only help. This guest is a
//! whole CPython with a whole standard library baked into it: `import json` works, `import re` works,
//! and `from gg import ToolError` works, because the SDK is an ordinary package rather than a set of
//! names injected into a scope. There is no lexical shape gg can recognise here that is *certainly*
//! dead, and deleting a working line is the one failure this subsystem is built not to commit. So
//! [`is_import_statement`](Dialect::is_import_statement) answers `false` and
//! [`drop-imports`](crate::healing::HealingStrategy::DropImports) never fires on this arm. The one
//! import that *is* certainly dead — `asyncio`, which this guest is deliberately baked without —
//! is not left behind either: it is part of the concurrency wrapper below, and comes off with it.
//!
//! **Nothing is refused twice.** ECMAScript makes redeclaring a `const` an early error, which is
//! what proves that deleting a repeated tail deletes text that could never have run. Python has no
//! such rule: `def main():` twice is legal and the second wins, and a program pasted twice *runs
//! twice*. So [`declares_a_redeclarable_binding`](Dialect::declares_a_redeclarable_binding) answers
//! `false`, [`drop-duplicate-program`](crate::healing::HealingStrategy::DropDuplicateProgram) gives
//! itself up, and a doubled reply is left to do what the model literally wrote. The coarser
//! [`drop-doubled-response`](crate::healing::HealingStrategy::DropDoubledResponse) — a transport
//! artefact rather than a model's text, and the strategy that asks a dialect nothing — still fires.
//!
//! **The concurrency wrapper has three parts, not two.** ECMAScript's `async` is a keyword and its
//! wrapper is a declaration plus a call. Python's runner is a *module*, so the shape a model writes
//! is `import asyncio`, an `async def`, and `asyncio.run(main())` — and unwrapping the middle while
//! leaving the first would produce a program whose very first line raises `ModuleNotFoundError`.
//! [`unwrap_async`](Dialect::unwrap_async) therefore takes the import with it. That is why this
//! dialect can answer `false` to every import and still deliver the repair the ordering of the
//! pipeline (imports before async) was built to enable.
//!
//! # Two questions whose answers are only *spelled* differently
//!
//! Fence tags and the two line predicates. A line of Python ends with `:` where a line of JavaScript
//! ends with `{`, opens with `def` where the other opens with `function`, and comments with `#`
//! rather than `//` — but the discipline is identical, and it is the asymmetry that matters rather
//! than the clauses. [`looks_like_code`] may cost a fence that could have been unwrapped;
//! [`is_prose_line`] *deletes the model's line*. So every clause of the first is a shape only code
//! has, every clause of the second is a shape only English has, and where neither can tell, both
//! decline.
//!
//! The `#` character is where that asymmetry bites hardest here, and it is worth naming because it
//! is the one thing a reader would otherwise call a bug. `# note` is a Python comment *and* a
//! Markdown heading, and nothing lexical tells them apart. It is therefore listed among the
//! characters no prose line contains — so a `#` line is never deleted as prose, and a model that
//! headed its explanation `## Plan` keeps that heading in its program, where the guest reads it as a
//! comment and it costs nothing.
//!
//! # None of these is a parser
//!
//! Not one predicate here parses, for the reason [TypeScript's dialect](super::typescript::healing)
//! gives: healing runs on text that is not yet known to be a program. Unlike that arm, gg has no
//! Python parser to decline to use — [preparing a Python program](super::python) hands the source
//! across untouched and CPython itself is the first thing to read it — so every answer below is a
//! lexical shape test, and each declines rather than guessing.

use crate::healing::{
    AsyncWrapper, CodeMask, Dialect, Unwrapped, common_prefix, lines_with_offsets,
};

/// Python's dialect. A unit struct: everything it "holds" is the `const` data below.
pub(in crate::sandbox::language) struct PythonDialect;

/// The one instance, held by [`Python`](super::Python) and handed out as `&'static dyn Dialect`.
pub(in crate::sandbox::language) static PYTHON_DIALECT: PythonDialect = PythonDialect;

impl Dialect for PythonDialect {
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

    /// **`false`, always.** See this module's own documentation: this guest carries a real CPython
    /// with a real standard library and a real `gg` package, so an `import` line is as likely to be
    /// load-bearing as it is to be dead, and there is no lexical test that tells the two apart.
    fn is_import_statement(&self, _line: &str) -> bool {
        false
    }

    /// **`false`, always.** Python refuses no declaration twice — `def main():` may be written as
    /// often as a program likes and the last one wins — so there is no proof that a repeated tail
    /// could not have run, and without that proof deleting it would delete work the model asked to
    /// have done twice.
    fn declares_a_redeclarable_binding(&self, _text: &str, _mask: &CodeMask, _base: usize) -> bool {
        false
    }

    /// `async def main(): …` run by `asyncio.run(main())`, with the `import asyncio` that made the
    /// runner reachable — the whole three-part shape, taken off together.
    ///
    /// [`Declared`](AsyncWrapper::Declared) is the only shape reported, because it is the only shape
    /// Python has: there is no asynchronous immediately-invoked expression to be
    /// [`Immediate`](AsyncWrapper::Immediate) about.
    ///
    /// # Why the `await` token takes its whitespace with it
    ///
    /// [TypeScript's arm](super::typescript::healing) deletes the token and leaves the space, which
    /// is what makes its healed output carry the odd double space. Python cannot: a body line
    /// `    await work()` dedents to `await work()`, and deleting the token alone would leave
    /// ` work()` — a line beginning with a space, which is an `IndentationError` rather than a
    /// program. So the whitespace that followed the token goes with it. Deleting more is still
    /// deleting, so the [invariant](crate::healing::Dialect) holds exactly.
    fn unwrap_async(&self, text: &str, mask: &CodeMask) -> Option<Unwrapped> {
        unwrap_async(text, mask)
    }

    #[cfg(test)]
    fn fixtures(&self) -> &'static [&'static str] {
        tests::FIXTURES
    }
}

/// The info-string tags gg reads as "this block is the program", lower-cased.
///
/// A closed, recognised list, on the same terms [TypeScript's](super::typescript::healing) is: a
/// block tagged `json`, `text` or `bash` is context the model showed rather than the program, and
/// tier 3 of the candidacy ladder is what keeps the closed list from being a trap.
///
/// `pycon` and `doctest` are deliberately **absent**. Both name a *transcript* of an interactive
/// session — every line prefixed `>>>`, with the interpreter's answers interleaved — which is not a
/// program and would not run as one.
const PROGRAM_TAGS: &[&str] = &["python", "py", "python3", "py3", "pyw", "ipython"];

/// The statement keywords a line of Python code may open with, matched **case-sensitively** at an
/// identifier boundary.
///
/// Case-sensitivity is what keeps `If you want to…` prose while `if x:` is code, and it is the same
/// distinction a real reply turned on for the other arm. A few are ordinary English words in lower
/// case too (`for`, `with`, `while`), and that is safe in both directions here: a prose line
/// mistaken for code costs a fence that could have been unwrapped, and the same list is what stops
/// [`is_prose_line`] from ever deleting a statement.
///
/// It is the **keywords** and nothing else. `print` is not here even though it opens more lines of a
/// model's Python than any keyword does: it is an ordinary name, `opens_with_call` already reads
/// `print(` as code, and listing it would additionally stop `print the plan first` from ever being
/// deleted as prose. The same reasoning keeps `not`, `and`, `or` and `in` out — all four are
/// operators rather than statement openers, and all four open English clauses.
const STATEMENT_KEYWORDS: [&str; 28] = [
    "def", "class", "return", "yield", "if", "elif", "else", "for", "while", "with", "try",
    "except", "finally", "raise", "assert", "import", "from", "global", "nonlocal", "lambda",
    "pass", "break", "continue", "del", "async", "await", "match", "case",
];

/// The keywords that open a **block**, and so the only lines whose trailing `:` is proof of code.
///
/// A trailing colon on its own is not: `Here is the plan:` is the most ordinary sentence a model
/// writes above its program. Pairing the colon with the keyword that opened the block is what makes
/// the clause a shape only code has.
const BLOCK_KEYWORDS: [&str; 13] = [
    "def", "class", "if", "elif", "else", "for", "while", "with", "try", "except", "finally",
    "match", "case",
];

/// The tokens a line of code may end with — a statement continued, a collection left open, or a
/// block about to be opened.
const CODE_ENDINGS: [&str; 6] = [",", "(", "[", "{", "\\", "="];

/// Characters no line of English prose contains.
///
/// `#` is here and is the one entry worth explaining: it opens a Python comment *and* a Markdown
/// heading, and nothing lexical tells them apart. Listing it means a `#` line is never deleted as
/// prose — so a comment survives, which is what matters, and a heading survives too, which costs a
/// line of comment in the program and nothing else.
const NON_PROSE_CHARS: [char; 16] = [
    '`', '#', ';', '{', '}', '(', ')', '[', ']', '=', '<', '>', '|', '&', '$', '\\',
];

// ---------------------------------------------------------------------------------------------
// The line predicates
// ---------------------------------------------------------------------------------------------

/// Whether `line` is **certainly** a line of Python — this dialect's answer to
/// [`Dialect::looks_like_code`](crate::healing::Dialect::looks_like_code).
///
/// Its errors are asymmetric on purpose: a false positive costs a fence that could have been
/// unwrapped (one turn, one located diagnostic), while a false negative deletes a line of the
/// model's program. So every clause below is a shape that only code has.
fn looks_like_code(line: &str) -> bool {
    let line = line.trim();
    if line.is_empty() {
        return false;
    }
    // 1. It opens a block: a block keyword, and a `:` at the end of the line.
    if line.ends_with(':') && starts_with_any(line, &BLOCK_KEYWORDS) {
        return true;
    }
    // 2. It opens with a statement keyword.
    if starts_with_any(line, &STATEMENT_KEYWORDS) {
        return true;
    }
    // 3. It opens with a closer, a comment or a decorator.
    if line.starts_with([')', ']', '}', '#', '@']) {
        return true;
    }
    // 4. It is left open at the end.
    if CODE_ENDINGS.iter().any(|ending| line.ends_with(ending)) {
        return true;
    }
    // 5. It assigns: a plain or dotted or subscripted target, then a single `=`.
    if is_assignment(line) {
        return true;
    }
    // 6. It opens with a call: an identifier or dotted chain immediately followed by `(`.
    opens_with_call(line)
}

/// Whether `line` opens with one of `keywords` at an identifier boundary.
fn starts_with_any(line: &str, keywords: &[&str]) -> bool {
    keywords.iter().any(|keyword| {
        line.strip_prefix(keyword)
            .is_some_and(|rest| rest.chars().next().is_none_or(|c| !is_ident_char(c)))
    })
}

/// Whether `line` is an assignment whose target is a name — `total = 1`, `self.count += 1`,
/// `rows[0] = x`, `total: int = 1`.
///
/// The target has to be a *name-shaped* thing for the clause to mean anything: `Rewrite = better`
/// would otherwise read two words of English as an assignment. A comparison (`==`, `!=`, `<=`,
/// `>=`) is not an assignment and is excluded, though a line containing one is already kept out of
/// prose by [`NON_PROSE_CHARS`].
fn is_assignment(line: &str) -> bool {
    let Some(at) = find_assignment(line) else {
        return false;
    };
    let target = line[..at].trim_end();
    // An augmented assignment (`+=`, `//=`, `|=`) carries its operator on the target's side.
    let target =
        target.trim_end_matches(['+', '-', '*', '/', '%', '@', '&', '|', '^', '<', '>', '~']);
    // An annotated assignment carries its type there instead: `total: int = 1`.
    let target = target.split(':').next().unwrap_or_default().trim();
    !target.is_empty() && is_name_shaped(target)
}

/// The offset of the `=` that assigns, skipping every `=` that is part of a comparison.
fn find_assignment(line: &str) -> Option<usize> {
    let bytes = line.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'=' {
            index += 1;
            continue;
        }
        if bytes.get(index + 1) == Some(&b'=') {
            index += 2;
            continue;
        }
        if index > 0 && matches!(bytes[index - 1], b'=' | b'!' | b'<' | b'>') {
            index += 1;
            continue;
        }
        return Some(index);
    }
    None
}

/// Whether `text` is a name, a dotted chain of names, or either with a subscript — the shapes an
/// assignment target takes.
fn is_name_shaped(text: &str) -> bool {
    let head = text.split(['[', '(']).next().unwrap_or_default();
    if head.is_empty() || head.trim() != head {
        return false;
    }
    head.split('.').all(|part| {
        !part.is_empty() && part.starts_with(is_ident_start) && part.chars().all(is_ident_char)
    })
}

/// Whether `line` opens with `identifier(`, `a.b(` or `a.b.c(` — `print(`, `view.open_file(`,
/// `entries.append(`.
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
        // ended at the previous character, which is what keeps `Done. Wrote the file.` prose.
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

/// Whether `line` is **certainly** prose rather than Python — this dialect's answer to
/// [`Dialect::is_prose_line`](crate::healing::Dialect::is_prose_line), and the test `strip-prose`
/// uses to *delete* a line.
///
/// The mirror image of [`looks_like_code`], with the asymmetry the other way round: a false positive
/// here deletes the model's code, so every clause is a shape only English has. The two are
/// deliberately not complements and not disjoint, and the pipeline's fixpoint loop resolves the
/// overlap.
fn is_prose_line(line: &str) -> bool {
    let line = line.trim();
    if line.is_empty() {
        return false;
    }
    // 1. No character that only code uses — which here includes `#`, because a Python comment and a
    //    Markdown heading are the same three bytes.
    if line.contains(NON_PROSE_CHARS) {
        return false;
    }
    // 2. Not a statement, and not the head of a block.
    if starts_with_any(line, &STATEMENT_KEYWORDS) {
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

/// Whether `c` may open a Python identifier.
///
/// Python 3 identifiers are Unicode, so this is `is_alphabetic` rather than an ASCII test — a
/// program written by a model prompted in another language is still a program.
fn is_ident_start(c: char) -> bool {
    c.is_alphabetic() || c == '_'
}

/// Whether `c` may continue a Python identifier.
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
    /// Inside a `#` comment, until the next newline.
    Comment,
    /// Inside a string. Carries the quote byte that opened it, and whether it was a triple quote —
    /// which is the whole of the difference between a string a newline ends and one it does not.
    Str { quote: u8, triple: bool },
}

/// Lex `src` into its [code mask](CodeMask) — this dialect's answer to
/// [`Dialect::code_mask`](crate::healing::Dialect::code_mask).
///
/// `None` means the source did not lex cleanly, and every strategy that needs the mask declines on
/// it. Two states end a scan uncleanly: a **triple-quoted** string still open at the end of input,
/// and a **single-quoted** string still open at a newline, which Python forbids exactly as
/// JavaScript does.
///
/// # What it handles, and the two shapes it deliberately does not read
///
/// It handles `'…'`, `"…"`, `'''…'''`, `"""…"""`, `#…\n`, and backslash escapes — including a
/// backslash-newline inside a single-quoted string, which Python accepts as a line continuation and
/// which would otherwise be read as an unterminated string.
///
/// **A string prefix is not read at all.** `r"…"`, `b"…"`, `f"…"` and their combinations are
/// identifier characters followed by a quote, so the scan reaches the quote and does the right
/// thing without knowing which prefix preceded it. That is correct even for a raw string, because
/// Python's raw strings still refuse to end on a backslash-escaped quote — `r"\""` is one string,
/// not two — so treating the backslash as an escape is the accurate reading rather than a
/// convenient one.
///
/// **An f-string's substitutions are string bytes**, not code. Since 3.12 the expression inside
/// `{…}` may re-use the outer quote, so following it as code is a scan that loses its place on
/// exactly the input that is hardest to notice. Reading the whole literal as string text costs
/// nothing any strategy needs — an `import` or an `await` inside an f-string is text a repair must
/// leave alone either way — and it is the reading that cannot desynchronise.
fn code_mask(src: &str) -> Option<CodeMask> {
    let bytes = src.as_bytes();
    let mut code = vec![true; bytes.len()];
    let mut mode = Mode::Code;
    let mut index = 0;

    while index < bytes.len() {
        let byte = bytes[index];
        match mode {
            Mode::Code => match byte {
                b'#' => {
                    code[index] = false;
                    mode = Mode::Comment;
                    index += 1;
                }
                b'\'' | b'"' => {
                    let triple =
                        bytes.get(index + 1) == Some(&byte) && bytes.get(index + 2) == Some(&byte);
                    let width = if triple { 3 } else { 1 };
                    for offset in 0..width {
                        code[index + offset] = false;
                    }
                    mode = Mode::Str {
                        quote: byte,
                        triple,
                    };
                    index += width;
                }
                _ => index += 1,
            },
            Mode::Comment => {
                if byte == b'\n' {
                    mode = Mode::Code;
                } else {
                    code[index] = false;
                }
                index += 1;
            }
            Mode::Str { quote, triple } => {
                code[index] = false;
                match byte {
                    b'\\' => {
                        // A backslash escapes whatever follows it, newline included — which is how
                        // a single-quoted Python string legally spans two lines.
                        if index + 1 >= bytes.len() {
                            return None;
                        }
                        code[index + 1] = false;
                        index += 2;
                    }
                    // A single-quoted string that is still open at a newline is not a string Python
                    // accepts, and is the signature of a scan that has lost its place.
                    b'\n' if !triple => return None,
                    _ if byte == quote => {
                        if triple {
                            if bytes.get(index + 1) == Some(&quote)
                                && bytes.get(index + 2) == Some(&quote)
                            {
                                code[index + 1] = false;
                                code[index + 2] = false;
                                mode = Mode::Code;
                                index += 3;
                            } else {
                                index += 1;
                            }
                        } else {
                            mode = Mode::Code;
                            index += 1;
                        }
                    }
                    _ => index += 1,
                }
            }
        }
    }

    // A comment is closed by end of input; a string is not, and an open one means the scan lost its
    // place.
    matches!(mode, Mode::Code | Mode::Comment).then_some(CodeMask::from_flags(code))
}

// ---------------------------------------------------------------------------------------------
// The concurrency wrapper
// ---------------------------------------------------------------------------------------------

/// The whole three-part `asyncio` wrapper, if `text` is entirely made of one.
///
/// Line-oriented, because Python's block structure is: a body is what is indented under the `async
/// def`, and nothing but a brace count could say so in another language. Each step below declines
/// rather than guessing, and the invocation is **required** for the reason
/// [the skeleton](crate::healing::Dialect::unwrap_async) gives: a wrapper the program never calls
/// ran nothing, so unwrapping it would execute statements the reply never asked to execute.
fn unwrap_async(text: &str, mask: &CodeMask) -> Option<Unwrapped> {
    let lines: Vec<(usize, &str)> = lines_with_offsets(text).collect();
    let mut cursor = 0;

    // Leading blanks, then the optional `import asyncio` that makes the runner reachable.
    cursor = skip_blank(&lines, cursor);
    if lines.get(cursor).is_some_and(|(offset, line)| {
        mask.is_code(*offset) && matches!(line.trim(), "import asyncio")
    }) {
        cursor = skip_blank(&lines, cursor + 1);
    }

    // The declaration, unindented and in code context.
    let (offset, header) = lines.get(cursor).copied()?;
    if !mask.is_code(offset) || header.starts_with([' ', '\t']) {
        return None;
    }
    let name = async_def_name(header)?;
    cursor += 1;

    // The body: every line that is blank, indented, or a continuation inside a string literal.
    let body_start = cursor;
    while let Some((offset, line)) = lines.get(cursor).copied() {
        let continues =
            line.trim().is_empty() || line.starts_with([' ', '\t']) || !mask.is_code(offset);
        if !continues {
            break;
        }
        cursor += 1;
    }
    if cursor == body_start {
        return None;
    }
    let body = lines[body_start].0..lines.get(cursor).map_or(text.len(), |(offset, _)| *offset);

    // The invocation, and nothing after it.
    let cursor = skip_blank(&lines, cursor);
    let (offset, invocation) = lines.get(cursor).copied()?;
    if !mask.is_code(offset) || !is_invocation_of(invocation, &name) {
        return None;
    }
    if skip_blank(&lines, cursor + 1) != lines.len() {
        return None;
    }

    let (text, awaits) = unwrap_body(text, mask, body);
    Some(Unwrapped {
        wrapper: AsyncWrapper::Declared,
        text,
        awaits,
    })
}

/// The index of the next line with something on it, from `from`.
fn skip_blank(lines: &[(usize, &str)], from: usize) -> usize {
    let mut index = from;
    while lines
        .get(index)
        .is_some_and(|(_, line)| line.trim().is_empty())
    {
        index += 1;
    }
    index
}

/// The name `line` declares, when it is `async def NAME(…):` and nothing else.
///
/// The trailing `:` is required and has to end the line, which is what keeps a declaration whose
/// parameters run onto a second line — a shape only a parser could delimit — out of this strategy.
fn async_def_name(line: &str) -> Option<String> {
    let line = line.trim_end();
    let rest = line.strip_prefix("async")?;
    let rest = rest.strip_prefix(char::is_whitespace)?.trim_start();
    let rest = rest.strip_prefix("def")?;
    let rest = rest.strip_prefix(char::is_whitespace)?.trim_start();
    let name: String = rest.chars().take_while(|c| is_ident_char(*c)).collect();
    if name.is_empty() || !name.starts_with(is_ident_start) {
        return None;
    }
    // The parameter list has to open and close on this line, and the line has to end on the colon
    // that opens the block: a declaration continued below is one only a parser could delimit. What
    // lies between the two is an optional return annotation, which is read as text because nothing
    // here needs to understand it.
    let after = rest[name.len()..].trim_start();
    let (_, tail) = after.strip_prefix('(')?.rsplit_once(')')?;
    tail.trim().ends_with(':').then_some(name)
}

/// Whether `line` is exactly one call of `name` — the four ways a model starts an event loop.
///
/// `asyncio.run(main())` is what a model writes today; `main()` is what a model writes when it has
/// forgotten which language's top level it is at; `await main()` is the same mistake spelled the
/// other way; and `asyncio.get_event_loop().run_until_complete(main())` is the pre-3.7 idiom still
/// in a great deal of training data. Anything else — a call whose result the program then uses, a
/// runner given a second task — declines, because deleting it would delete code with it.
fn is_invocation_of(line: &str, name: &str) -> bool {
    let tail = line.trim().trim_end_matches(';').trim_end();
    let call = format!("{name}()");
    tail == call
        || tail == format!("await {call}")
        || tail == format!("asyncio.run({call})")
        || tail == format!("asyncio.get_event_loop().run_until_complete({call})")
}

/// The wrapper's body, dedented and with its `await` tokens removed, and how many went.
///
/// `body` is the byte range of the body inside `text`, so the surviving lines keep their own
/// terminators and a `\r\n` program stays a `\r\n` program.
fn unwrap_body(text: &str, mask: &CodeMask, body: std::ops::Range<usize>) -> (String, usize) {
    let inner = &text[body.clone()];
    let base = body.start;

    // The common indentation, measured only over lines that begin in code context: a line that
    // begins inside a triple-quoted string carries data, not indentation.
    let indent = lines_with_offsets(inner)
        .filter(|(offset, line)| !line.trim().is_empty() && mask.is_code(base + offset))
        .map(|(_, line)| &line[..line.len() - line.trim_start().len()])
        .reduce(common_prefix)
        .unwrap_or_default()
        .to_string();

    let mut out = String::with_capacity(inner.len());
    let mut awaits = 0;
    let mut offset = 0;
    for raw in inner.split_inclusive('\n') {
        let start = offset;
        offset += raw.len();
        let dedented = if mask.is_code(base + start) {
            raw.strip_prefix(indent.as_str()).unwrap_or(raw)
        } else {
            raw
        };
        let shift = base + start + (raw.len() - dedented.len());
        awaits += strip_awaits(dedented, mask, shift, &mut out);
    }
    (out.trim().to_string(), awaits)
}

/// Append `line` to `out` with its code-context `await` tokens **and the whitespace that followed
/// them** removed, returning how many went.
///
/// `base` is the offset of `line`'s first byte within the source the `mask` was built from.
fn strip_awaits(line: &str, mask: &CodeMask, base: usize, out: &mut String) -> usize {
    let mut removed = 0;
    let mut cursor = 0;
    while let Some(found) = line[cursor..].find("await") {
        let at = cursor + found;
        let end = at + "await".len();
        let bounded = line[..at]
            .chars()
            .next_back()
            .is_none_or(|c| !is_ident_char(c))
            && line[end..].chars().next().is_none_or(|c| !is_ident_char(c));
        let in_code = (at..end).all(|index| mask.is_code(base + index));
        if bounded && in_code {
            out.push_str(&line[cursor..at]);
            removed += 1;
            // The whitespace goes too: `    await work()` dedents to `await work()`, and a token
            // deleted on its own would leave a line opening with a space — an `IndentationError`
            // rather than a program. Spaces and tabs only: a newline is what separates two
            // statements, and eating one would join them.
            let rest = &line[end..];
            cursor = end + (rest.len() - rest.trim_start_matches([' ', '\t']).len());
        } else {
            out.push_str(&line[cursor..end]);
            cursor = end;
        }
    }
    out.push_str(&line[cursor..]);
    removed
}

#[cfg(test)]
#[path = "python.healing.test.rs"]
mod tests;
