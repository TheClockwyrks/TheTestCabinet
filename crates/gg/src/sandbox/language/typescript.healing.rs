//! **TypeScript's [healing dialect](crate::healing::Dialect)** — the lexical half of
//! [response healing](crate::healing), for the one language gg registers today.
//!
//! Everything here answers a question the healing skeleton asks and cannot answer itself: which
//! Markdown info-strings mean "this block is the program", what a line of TypeScript looks like
//! against what a line of English looks like, which bytes of a source are code rather than string or
//! comment text, what a complete single-line `import` is, which declarations ECMAScript refuses to
//! see twice, and how an `async` wrapper comes off a program that cannot await anything.
//!
//! # Why it lives here and not in `healing.rs`
//!
//! Because it is TypeScript's, and the module it serves is deliberately not any language's. The
//! skeleton owns the contract — the six strategies, their order, their declines, the honesty
//! disclosure and the delete-only invariant — and this file owns the reading of the text. Splitting
//! them this way is what lets a second language reuse every repair without inheriting a single one
//! of the assumptions below, and what lets the skeleton be tested against a dialect that answers
//! nothing.
//!
//! # None of these is a parser
//!
//! Not one predicate here parses. `oxc` is sitting right next door in
//! [`prepare`](super::prepare) and is deliberately not used: healing runs on text that is **not yet
//! known to be a program** — it may be Markdown, prose, or two programs pasted together — so a
//! parser would fail on precisely the inputs healing exists to repair. Every predicate is therefore
//! a lexical shape test with its errors pointed in the safe direction, and every one of them
//! **declines** rather than guesses when it cannot tell.

use crate::healing::{AsyncWrapper, CodeMask, Dialect, Unwrapped, lines_with_offsets};

/// TypeScript's dialect. A unit struct: everything it "holds" is the `const` data below.
pub(super) struct TypeScriptDialect;

/// The one instance, held by [`TypeScript`](super::TypeScript) and handed out as
/// `&'static dyn Dialect`.
pub(super) static TYPESCRIPT_DIALECT: TypeScriptDialect = TypeScriptDialect;

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

    fn is_import_statement(&self, line: &str) -> bool {
        is_import_statement(line)
    }

    /// Whether the repeated tail declares a `const`, `let` or `class` at its top level — the proof
    /// that the reply as sent was an early error and therefore ran nothing.
    fn declares_a_redeclarable_binding(&self, text: &str, mask: &CodeMask, base: usize) -> bool {
        declares_lexically(text, mask, base).next().is_some()
    }

    /// The two shapes are `async function main() { … }` followed by a call to it
    /// ([`Declared`](AsyncWrapper::Declared)), and `(async () => { … })();` or
    /// `(async function () { … })();` ([`Immediate`](AsyncWrapper::Immediate)). Both are unwrapped
    /// to their body, dedented by the common indentation of their code-context lines.
    ///
    /// # Why removing `await` is a deletion and not a rewrite
    ///
    /// Every function on the model-facing surface is synchronous and returns its value directly, so
    /// `await` on one is a no-op — the operand is already the value. [`strip_awaits`] therefore
    /// deletes the `await` **token** in code context, replaced by nothing, with the surrounding
    /// whitespace untouched: `const x = await foo();` becomes `const x =  foo();`, which is the same
    /// program and is where the odd double space in healed output comes from. Leaving the whitespace
    /// alone is also what keeps the [delete-only
    /// invariant](crate::healing::Dialect) exact — the healed program is a
    /// literal subsequence of the reply, not merely an equivalent one.
    fn unwrap_async(&self, text: &str, mask: &CodeMask) -> Option<Unwrapped> {
        let (wrapper, body) = match_async_wrapper(text, mask)?;
        let (text, awaits) = unwrap_body(text, mask, body);
        Some(Unwrapped {
            wrapper,
            text,
            awaits,
        })
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

/// The lexical declarations a program cannot make twice at its top level.
///
/// `const`, `let` and `class` bindings are the ones ECMAScript makes an **early error** to
/// redeclare, so a reply containing two of the same is refused at construction before a statement of
/// it runs. `var` and `function` are deliberately absent: both may legally be redeclared in the
/// sloppy function body a program is evaluated as, so a repetition of either says nothing about
/// whether the reply is one program or two.
const LEXICAL_KEYWORDS: [&str; 3] = ["const", "let", "class"];

// ---------------------------------------------------------------------------------------------
// Module imports
// ---------------------------------------------------------------------------------------------

/// Whether the trimmed `line` is a complete single-line module import.
///
/// Every arm insists the statement *finishes* on this line — an `import` that closes its module
/// specifier, a `require(…)` call that closes its parentheses — because a statement whose end is
/// somewhere below is one only a parser can delete correctly, and this is not a parser.
fn is_import_statement(line: &str) -> bool {
    let line = line.trim();
    if let Some(rest) = line.strip_prefix("import") {
        let introduced = rest.starts_with(|c: char| c.is_whitespace())
            || rest.starts_with(['{', '*', '"', '\'']);
        return introduced && closes_a_string(rest);
    }
    if !line.ends_with(')') && !line.ends_with(';') {
        return false;
    }
    // `const fs = require("fs");` and its `let`/`var` spellings. The call has to be the **whole**
    // right-hand side: `const x = wrap(require("y"));` is a program doing something with a module
    // system it brought itself, and deleting that line would delete a binding the rest of the
    // program uses.
    for keyword in ["const", "let", "var"] {
        if let Some(rest) = line.strip_prefix(keyword)
            && rest.starts_with(|c: char| c.is_whitespace())
            && let Some((_, value)) = rest.split_once('=')
            && opens_with_require(value.trim_start())
        {
            return closes_a_string(value);
        }
    }
    // A bare `require("./setup");` statement, whose value nothing binds.
    opens_with_require(line) && closes_a_string(line)
}

/// Whether `text` **opens** with a `require(…)` call.
///
/// The identifier boundary falls out of the prefix test: `requireHelper(` leaves `Helper(`, which
/// does not open with the parenthesis.
fn opens_with_require(text: &str) -> bool {
    text.strip_prefix("require")
        .is_some_and(|rest| rest.trim_start().starts_with('('))
}

/// Whether `text` opens **and closes** a quoted string, honouring backslash escapes — the test for
/// "the module specifier ends on this line".
fn closes_a_string(text: &str) -> bool {
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c != '\'' && c != '"' {
            continue;
        }
        let mut escaped = false;
        for inner in chars.by_ref() {
            if escaped {
                escaped = false;
            } else if inner == '\\' {
                escaped = true;
            } else if inner == c {
                return true;
            }
        }
        return false;
    }
    false
}

// ---------------------------------------------------------------------------------------------
// Redeclaration
// ---------------------------------------------------------------------------------------------

/// Every name `text` binds with a [lexical keyword](LEXICAL_KEYWORDS) at its **top level**, in
/// source order.
///
/// "Top level" is read as *unindented*, which is what a top-level statement is in every program a
/// model writes and what keeps this from mistaking a `const` inside a function body — legal, and
/// legal twice — for a redeclaration. `base` is where `text` starts inside the source `mask` was
/// built over, so a caller may ask about a slice of it.
///
/// Only plain identifiers are collected: `const { a, b } = …` binds two names, and reconstructing
/// which would be a parse. A destructuring declaration repeated verbatim is caught by the repeated
/// tail's own guard finding the other, plainer declarations beside it — and where there are none,
/// declining is the correct outcome for a strategy that may only delete what it is certain of.
fn declares_lexically<'a>(
    text: &'a str,
    mask: &'a CodeMask,
    base: usize,
) -> impl Iterator<Item = &'a str> {
    lines_with_offsets(text).filter_map(move |(offset, line)| {
        if !mask.is_code(base + offset) || line.starts_with([' ', '\t']) {
            return None;
        }
        let rest = LEXICAL_KEYWORDS
            .iter()
            .find_map(|keyword| line.strip_prefix(keyword))?;
        let rest = rest.strip_prefix(' ')?.trim_start();
        let name = rest
            .split(|c: char| !(c.is_alphanumeric() || c == '_' || c == '$'))
            .next()
            .filter(|name| !name.is_empty())?;
        name.starts_with(|c: char| c.is_alphabetic() || c == '_' || c == '$')
            .then_some(name)
    })
}

// ---------------------------------------------------------------------------------------------
// The async wrapper
// ---------------------------------------------------------------------------------------------

/// The wrapper `text` is entirely made of, and the byte range of its body between the braces.
fn match_async_wrapper(
    text: &str,
    mask: &CodeMask,
) -> Option<(AsyncWrapper, std::ops::Range<usize>)> {
    if let Some(matched) = match_async_function(text, mask) {
        return Some(matched);
    }
    match_async_iife(text, mask)
}

/// `async function main() { … }` followed by exactly one call to it.
///
/// The call is **required**. A wrapper that is only declared runs perfectly well in this sandbox —
/// as a program that does nothing — so unwrapping it would not repair a broken program, it would
/// execute statements the response never asked to execute. That is the one rewrite the
/// [caveat](crate::healing::Dialect::unwrap_async) cannot cover, and its absence is what keeps this
/// strategy consistent with the synchronous wrapper it deliberately declines.
fn match_async_function(
    text: &str,
    mask: &CodeMask,
) -> Option<(AsyncWrapper, std::ops::Range<usize>)> {
    let after_async = keyword(text, 0, "async")?;
    let after_function = keyword(text, after_async, "function")?;
    let (name, after_name) = identifier(text, after_function)?;
    let open = body_brace(text, mask, after_name)?;
    let close = matching_brace(text, mask, open)?;

    let tail = text[close + 1..].trim();
    if !is_invocation_of(tail, &name) {
        return None;
    }
    Some((AsyncWrapper::Declared, open + 1..close))
}

/// `(async () => { … })();` or `(async function (…) { … })();` as the whole program.
fn match_async_iife(text: &str, mask: &CodeMask) -> Option<(AsyncWrapper, std::ops::Range<usize>)> {
    // The leading whitespace of the first line is the model's indentation, kept by `trim_reply` so
    // the fence scanner can read it — so the match skips it here rather than assuming a `(` at zero.
    let rest = text.trim_start().strip_prefix('(')?;
    let start = text.len() - rest.len();
    let after_async = keyword(text, start, "async")?;

    let open = match keyword(text, after_async, "function") {
        // `(async function () { … })();` — an optionally named function expression.
        Some(after_function) => {
            let after_name = identifier(text, after_function)
                .map_or(after_function, |(_, after_name)| after_name);
            body_brace(text, mask, after_name)?
        }
        // `(async () => { … })();` — parameters, the fat arrow, then the body directly. An arrow
        // function has no name and no return-type position to skip, so it does not go through
        // `body_brace`.
        None => {
            let after_params = parameter_list(text, mask, after_async)?;
            let arrow = text.get(after_params..)?.trim_start();
            let arrow_at = text.len() - arrow.len();
            arrow.strip_prefix("=>")?;
            let body = text.get(arrow_at + 2..)?.trim_start();
            let open = text.len() - body.len();
            body.starts_with('{').then_some(open)?
        }
    };
    let close = matching_brace(text, mask, open)?;
    let tail = text[close + 1..].trim();
    // The wrapper's own closing paren, then the call that runs it, and nothing else.
    let tail = tail.strip_prefix(')')?.trim_start();
    let tail = tail.strip_prefix('(')?.trim_start();
    let tail = tail.strip_prefix(')')?.trim_start();
    let tail = tail.strip_prefix(';').unwrap_or(tail);
    tail.trim()
        .is_empty()
        .then_some((AsyncWrapper::Immediate, open + 1..close))
}

/// The offset just past `word` when it appears at `from` (skipping leading whitespace) at an
/// identifier boundary, or `None`.
fn keyword(text: &str, from: usize, word: &str) -> Option<usize> {
    let rest = text.get(from..)?;
    let trimmed = rest.trim_start();
    let at = text.len() - trimmed.len();
    let after = trimmed.strip_prefix(word)?;
    after
        .chars()
        .next()
        .is_none_or(|c| !is_ident_char(c))
        .then_some(at + word.len())
}

/// The identifier at `from` (skipping leading whitespace) and the offset just past it.
fn identifier(text: &str, from: usize) -> Option<(String, usize)> {
    let rest = text.get(from..)?;
    let trimmed = rest.trim_start();
    let at = text.len() - trimmed.len();
    let mut end = 0;
    for (index, c) in trimmed.char_indices() {
        let acceptable = if index == 0 {
            is_ident_start(c)
        } else {
            is_ident_char(c)
        };
        if !acceptable {
            break;
        }
        end = index + c.len_utf8();
    }
    (end > 0).then(|| (trimmed[..end].to_string(), at + end))
}

/// The offset just past a balanced `( … )` parameter list starting at `from`.
fn parameter_list(text: &str, mask: &CodeMask, from: usize) -> Option<usize> {
    let rest = text.get(from..)?;
    let trimmed = rest.trim_start();
    let open = text.len() - trimmed.len();
    if !trimmed.starts_with('(') {
        return None;
    }
    let mut depth = 0usize;
    for (index, byte) in text.bytes().enumerate().skip(open) {
        if !mask.is_code(index) {
            continue;
        }
        match byte {
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(index + 1);
                }
            }
            _ => {}
        }
    }
    None
}

/// The offset of the wrapper's body `{`, given the offset just past its name.
///
/// Between the two lie the parameter list and — for a model that writes TypeScript, which is what
/// this run asks of it — an optional return-type annotation. The annotation is accepted only when
/// its angle brackets balance, which is what stops `: Promise<{ ok: boolean }>` from being mistaken
/// for the body and unwrapping half a type as if it were code.
fn body_brace(text: &str, mask: &CodeMask, after_name: usize) -> Option<usize> {
    let after_params = parameter_list(text, mask, after_name)?;
    let open = (after_params..text.len())
        .find(|index| text.as_bytes()[*index] == b'{' && mask.is_code(*index))?;
    let annotation = text[after_params..open].trim();
    let balanced = annotation.matches('<').count() == annotation.matches('>').count();
    (annotation.is_empty() || (annotation.starts_with(':') && balanced)).then_some(open)
}

/// The offset of the `}` that closes the `{` at `open`, counting braces in code context only.
fn matching_brace(text: &str, mask: &CodeMask, open: usize) -> Option<usize> {
    let mut depth = 0usize;
    for (index, byte) in text.bytes().enumerate().skip(open) {
        if !mask.is_code(index) {
            continue;
        }
        match byte {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(index);
                }
            }
            _ => {}
        }
    }
    None
}

/// Whether `tail` is exactly one call of `name` — `main();`, `await main();` or `void main();`.
///
/// A `main().then(…)` tail fails here, which is the point: dropping that call would delete the
/// callback's code with it.
fn is_invocation_of(tail: &str, name: &str) -> bool {
    let tail = tail
        .strip_prefix("await")
        .or_else(|| tail.strip_prefix("void"))
        .filter(|rest| rest.starts_with(|c: char| c.is_whitespace()))
        .unwrap_or(tail)
        .trim_start();
    let Some(rest) = tail.strip_prefix(name) else {
        return false;
    };
    let rest = rest.trim_start();
    let Some(rest) = rest.strip_prefix('(') else {
        return false;
    };
    let rest = rest.trim_start();
    let Some(rest) = rest.strip_prefix(')') else {
        return false;
    };
    rest.trim_start().trim_start_matches(';').trim().is_empty()
}

/// The wrapper's body, dedented and with its `await` tokens removed, and how many went.
fn unwrap_body(text: &str, mask: &CodeMask, body: std::ops::Range<usize>) -> (String, usize) {
    let inner = &text[body.clone()];
    let base = body.start;

    // The common indentation, measured only over lines that begin in code context: a line that
    // begins inside a template literal carries data, not indentation.
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

/// Append `line` to `out` with its code-context `await` tokens removed, returning how many went.
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
        } else {
            out.push_str(&line[cursor..end]);
        }
        cursor = end;
    }
    out.push_str(&line[cursor..]);
    removed
}

/// The longer common prefix of two strings, in whole characters.
fn common_prefix<'a>(left: &'a str, right: &'a str) -> &'a str {
    let end = left
        .char_indices()
        .zip(right.char_indices())
        .take_while(|((_, a), (_, b))| a == b)
        .map(|((index, c), _)| index + c.len_utf8())
        .last()
        .unwrap_or(0);
    &left[..end]
}

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
/// [`Dialect::looks_like_code`](crate::healing::Dialect::looks_like_code).
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

/// Whether `line` is **certainly** prose — TypeScript's answer to
/// [`Dialect::is_prose_line`](crate::healing::Dialect::is_prose_line), and the test `strip-prose`
/// uses to delete a line.
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

/// Lex `src` into its [code mask](CodeMask) — TypeScript's answer to
/// [`Dialect::code_mask`](crate::healing::Dialect::code_mask).
///
/// `None` means the source did not lex cleanly, and every strategy that needs the mask declines on
/// it. Three states end a scan uncleanly: an unterminated block comment, an unterminated template
/// literal, and — decisively — a single- or double-quoted string still open at a newline, which
/// JavaScript forbids.
///
/// Handles `'…'`, `"…"`, `` `…` `` with `${ … }` substitutions re-entering code (nesting tracked),
/// `//…\n`, `/*…*/`, and backslash escapes. Asked for by the three strategies that only ever edit
/// code — `drop-imports`, `unwrap-async` and `drop-duplicate-program` — and deliberately never by
/// `strip-fences` or `strip-prose`, whose input is not JavaScript yet.
///
/// # The one thing it does not lex
///
/// Regular-expression literals. Telling `/` as division from `/` as the start of a regex needs
/// parser context, which is the very thing this function exists to avoid. A regex containing a quote
/// (`str.replace(/don't/g, "")`) therefore desynchronises the scan — and because that leaves a
/// quoted string open at the next newline, the scan returns `None` and every strategy declines. The
/// failure mode of the one shape it cannot lex is *no healing*, which is the correct one.
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
