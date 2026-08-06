//! **Ruby's [healing dialect](crate::healing::Dialect)** — the lexical half of
//! [response healing](crate::healing), answered in Ruby's own terms.
//!
//! Every method here answers a question the healing skeleton asks and cannot answer itself. Three of
//! the answers are the same *decisions* [Python's arm](super::super::python::healing) made, for the
//! same reasons restated in Ruby; two are Ruby's alone and exist nowhere else in the registry.
//!
//! # The two answers that are Ruby's and nobody else's
//!
//! **The concurrency wrapper is a `Thread`, not a coroutine.** Ruby has no `async` keyword and no
//! suspension token — every method call in the language already blocks — so the shape a model wraps
//! a whole program in, when it wraps one at all, is `Thread.new do … end.join`. That wrapper is not
//! merely redundant here: this guest is Opal, which has no `Thread` at all, so a program wearing one
//! raises `NameError: uninitialized constant Thread` before a single line of the model's own work
//! runs. [`unwrap_async`](Dialect::unwrap_async) therefore recognises both the immediate shape and
//! the two-statement declared shape (`t = Thread.new do … end` … `t.join`), takes the
//! `require "thread"` above it if there is one, and reports **zero** tokens removed — because there
//! is no `await` in this language to remove and reporting one would be a count of something that
//! never existed.
//!
//! **The lexer has five string shapes and a heredoc.** `'…'`, `"…"` with `#{…}` interpolation,
//! `` `…` ``, the `%w[…]`/`%q(…)` family, `<<~EOS` heredocs, and `=begin`/`=end` block comments are
//! all ordinary Ruby that a model writes without thinking about it, and a mask that lost its place
//! on any of them would be a mask that reported string bytes as code. See [`code_mask`] for what is
//! read, and for the one shape that is deliberately not.
//!
//! # The three answers that agree with Python's, and why
//!
//! **An import is never deleted.** The ECMAScript guest is baked with no module system at all, so
//! every `import` a program writes there is dead text and dropping it can only help. This guest
//! carries [a declared library set](super) baked out of the pinned Opal's own sources, so
//! `require "json"` works, `require "set"` works, and the line is load-bearing. There is no lexical
//! shape gg can recognise here that is *certainly* dead — and a `require` of something that is
//! **not** baked is no better a candidate, because a program is entitled to rescue the `LoadError`
//! it raises. So [`is_import_statement`](Dialect::is_import_statement) answers `false` and
//! [`drop-imports`](crate::healing::HealingStrategy::DropImports) never fires on this arm.
//!
//! **Nothing is refused twice.** ECMAScript makes redeclaring a `const` an early error, which is
//! what proves that deleting a repeated tail deletes text that could never have run. Ruby refuses
//! nothing: `def main` twice is legal and the second wins, re-assigning a constant is a *warning*
//! rather than an error, and a program pasted twice **runs twice**. So
//! [`declares_a_redeclarable_binding`](Dialect::declares_a_redeclarable_binding) answers `false`,
//! [`drop-duplicate-program`](crate::healing::HealingStrategy::DropDuplicateProgram) gives itself up,
//! and a doubled reply is left to do what the model literally wrote. The coarser
//! [`drop-doubled-response`](crate::healing::HealingStrategy::DropDoubledResponse) — a transport
//! artefact rather than a model's text, and the strategy that asks a dialect nothing — still fires.
//!
//! **A `#` line is never prose.** `# note` is a Ruby comment *and* a Markdown heading, and nothing
//! lexical tells them apart. So `#` is listed among the characters no prose line contains: a comment
//! survives, which is what matters, and a stray heading survives too, which costs a line of comment
//! in the program and nothing else.
//!
//! # None of these is a parser
//!
//! Not one predicate here parses, for the reason every other dialect gives: healing runs on text
//! that is not yet known to be a program. Unlike [TypeScript](super::super::typescript::healing),
//! which has `oxc` next door and declines to use it, gg has no Ruby parser on the host at all — the
//! [compile step](super::compile) spawns Opal in another process, which is a great deal more than a
//! predicate may cost. So every answer below is a lexical shape test, and each declines rather than
//! guessing.

use crate::healing::{
    AsyncWrapper, CodeMask, Dialect, Unwrapped, common_prefix, lines_with_offsets,
};

/// Ruby's dialect. A unit struct: everything it "holds" is the `const` data below.
pub(in crate::sandbox::language) struct RubyDialect;

/// The one instance, held by [`Ruby`](super::Ruby) and handed out as `&'static dyn Dialect`.
pub(in crate::sandbox::language) static RUBY_DIALECT: RubyDialect = RubyDialect;

impl Dialect for RubyDialect {
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

    /// **`false`, always.** See this module's own documentation: this guest bakes a declared library
    /// set, so `require "json"` is a working line, and a `require` of something it does not carry is
    /// a `LoadError` the program is entitled to rescue. Neither is certainly dead, and there is no
    /// lexical test that tells a working one from a doomed one.
    fn is_import_statement(&self, _line: &str) -> bool {
        false
    }

    /// **`false`, always.** Ruby refuses no declaration twice — `def main` may be written as often
    /// as a program likes and the last one wins, and re-assigning a constant is a warning rather
    /// than an error — so there is no proof that a repeated tail could not have run, and without
    /// that proof deleting it would delete work the model asked to have done twice.
    fn declares_a_redeclarable_binding(&self, _text: &str, _mask: &CodeMask, _base: usize) -> bool {
        false
    }

    /// `Thread.new do … end.join`, and the two-statement `t = Thread.new do … end` … `t.join` —
    /// with the `require "thread"` that would have made either reachable, taken off together.
    ///
    /// Both shapes are reported, and this is the one dialect where the
    /// [`Immediate`](AsyncWrapper::Immediate) label describes something that is not a lambda: a
    /// thread created and joined where it is written is one expression with no name, which is
    /// exactly what that variant is for.
    ///
    /// `awaits` is always **zero**. Ruby has no suspension token — every call in the language
    /// already blocks — so there is nothing of that kind to delete, and reporting a count would put
    /// a number in front of the model for a repair that never happened.
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
/// A closed, recognised list, on the same terms every other dialect's is: a block tagged `json`,
/// `text` or `bash` is context the model showed rather than the program, and tier 3 of the candidacy
/// ladder is what keeps the closed list from being a trap.
///
/// `irb` and `pry` are deliberately **absent**. Both name a *transcript* of an interactive session —
/// every line prefixed with a prompt, with the interpreter's answers interleaved — which is not a
/// program and would not run as one. It is the same exclusion Python's dialect makes for `pycon`.
const PROGRAM_TAGS: &[&str] = &["ruby", "rb"];

/// The statement keywords a line of Ruby code may open with, matched **case-sensitively** at an
/// identifier boundary.
///
/// Case-sensitivity is what keeps `If you want to…` prose while `if x` is code. Several are ordinary
/// English words in lower case (`for`, `while`, `in`, `when`, `end`, `next`, `break`), and listing
/// them is safe in both directions: a prose line mistaken for code costs a fence that could have
/// been unwrapped, and the same list is what stops [`is_prose_line`] from ever deleting a statement.
/// `in` and `when` are the two that had to be here whatever they cost — `in Integer => n` and
/// `when TextFile` are pattern-matching lines a model really writes, and both would otherwise read
/// as two words of English and be deleted.
///
/// It is the **keywords and the declaration macros**, and nothing else. `puts` is not here even
/// though it opens more lines of a model's Ruby than any keyword does: it is an ordinary method,
/// `opens_with_call` already reads `puts(` as code, and listing it would additionally stop
/// `puts the plan first` from ever being deleted as prose. The same reasoning keeps `p`, `pp`,
/// `print`, `loop`, `and`, `or`, `not`, `then` and `do` out — every one of them opens an English
/// clause at least as often as it opens a statement, and each is already reached by another clause
/// (`loop do` and `items.each do |x|` end with `do` or `|`).
const STATEMENT_KEYWORDS: [&str; 30] = [
    "def",
    "class",
    "module",
    "end",
    "if",
    "elsif",
    "else",
    "unless",
    "while",
    "until",
    "for",
    "case",
    "when",
    "in",
    "begin",
    "rescue",
    "ensure",
    "retry",
    "redo",
    "next",
    "break",
    "return",
    "yield",
    "raise",
    "require",
    "require_relative",
    "alias",
    "undef",
    "attr_reader",
    "attr_accessor",
];

/// The tokens a line of code may end with — a statement continued, a collection left open, or a
/// block about to be opened.
///
/// `|` is Ruby's: `items.each do |entry|` and `rows.map { |row|` both end on one, and no English
/// sentence does.
const CODE_ENDINGS: [&str; 7] = [",", "(", "[", "{", "\\", "=", "|"];

/// Characters no line of English prose contains.
///
/// `#` is here for the reason this module's documentation gives — a Ruby comment and a Markdown
/// heading are the same byte. `@` and `$` are Ruby's instance- and global-variable sigils; listing
/// them means a line carrying one is never deleted as prose, which is the safe direction and costs
/// nothing but the occasional `@mention` surviving into a program as a comment-free line the
/// compiler will refuse.
const NON_PROSE_CHARS: [char; 17] = [
    '`', '#', ';', '{', '}', '(', ')', '[', ']', '=', '<', '>', '|', '&', '$', '\\', '@',
];

// ---------------------------------------------------------------------------------------------
// The line predicates
// ---------------------------------------------------------------------------------------------

/// Whether `line` is **certainly** a line of Ruby — this dialect's answer to
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
    // 1. It opens a block: a trailing `do`, with or without its block parameters.
    if ends_with_keyword(line, "do") {
        return true;
    }
    // 2. It opens with a statement keyword or a declaration macro.
    if starts_with_any(line, &STATEMENT_KEYWORDS) {
        return true;
    }
    // 3. It opens with a closer, a comment, or one of Ruby's sigils.
    if line.starts_with([')', ']', '}', '#', '@', '$', '|']) {
        return true;
    }
    // 4. It is left open at the end.
    if CODE_ENDINGS.iter().any(|ending| line.ends_with(ending)) {
        return true;
    }
    // 5. It assigns: a plain, dotted, subscripted or sigilled target, then a single `=`.
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

/// Whether `line` **ends** with `keyword` at an identifier boundary — how a Ruby block opener is
/// recognised, since `do` closes the line that opens the block rather than opening it.
fn ends_with_keyword(line: &str, keyword: &str) -> bool {
    line.strip_suffix(keyword)
        .is_some_and(|rest| rest.chars().next_back().is_none_or(|c| !is_ident_char(c)))
}

/// Whether `line` is an assignment whose target is a name — `total = 1`, `@count += 1`,
/// `rows[0] = x`, `Config::LIMIT = 3`.
///
/// The target has to be a *name-shaped* thing for the clause to mean anything: `Rewrite = better`
/// would otherwise read two words of English as an assignment. A comparison (`==`, `!=`, `<=`, `>=`)
/// is not an assignment and is excluded, though a line containing one is already kept out of prose
/// by [`NON_PROSE_CHARS`].
fn is_assignment(line: &str) -> bool {
    let Some(at) = find_assignment(line) else {
        return false;
    };
    let target = line[..at].trim_end();
    // An augmented assignment (`+=`, `||=`, `<<=`) carries its operator on the target's side.
    let target =
        target.trim_end_matches(['+', '-', '*', '/', '%', '&', '|', '^', '<', '>', '~', '!']);
    let target = target.trim();
    !target.is_empty() && is_name_shaped(target)
}

/// The offset of the `=` that assigns, skipping every `=` that is part of a comparison, a rocket, or
/// a safe-navigation-ish operator.
fn find_assignment(line: &str) -> Option<usize> {
    let bytes = line.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'=' {
            index += 1;
            continue;
        }
        // `==`, `===`, and `=>` (a rescue binding or a hash rocket) all bind nothing.
        if matches!(
            bytes.get(index + 1),
            Some(&b'=') | Some(&b'>') | Some(&b'~')
        ) {
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

/// Whether `text` is a name, a dotted or `::`-qualified chain of names, or either with a subscript —
/// the shapes an assignment target takes. A leading `@`, `@@` or `$` is Ruby's variable sigil and is
/// part of the name.
fn is_name_shaped(text: &str) -> bool {
    let head = text.split(['[', '(']).next().unwrap_or_default();
    if head.is_empty() || head.trim() != head {
        return false;
    }
    head.replace("::", ".").split('.').all(|part| {
        let part = part.trim_start_matches(['@', '$']);
        !part.is_empty() && part.starts_with(is_ident_start) && part.chars().all(is_ident_char)
    })
}

/// Whether `line` opens with `identifier(`, `a.b(` or `a::B.c(` — `puts(`, `view.open_file(`,
/// `entries.push(`.
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
        // A dot (or a `::`) continues the chain only when a further identifier follows it;
        // otherwise the chain ended at the previous character, which is what keeps
        // `Done. Wrote the file.` prose.
        if c == '.' || c == ':' {
            let mut lookahead = chars.clone();
            lookahead.next();
            if c == ':' {
                match lookahead.peek().copied() {
                    Some((_, ':')) => {
                        lookahead.next();
                    }
                    _ => break,
                }
            }
            if lookahead
                .peek()
                .is_some_and(|(_, next)| is_ident_start(*next))
            {
                chars = lookahead;
                continue;
            }
        }
        break;
    }
    line[end..].starts_with('(')
}

/// Whether `line` is **certainly** prose rather than Ruby — this dialect's answer to
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
    // 1. No character that only code uses — which here includes `#`, because a Ruby comment and a
    //    Markdown heading are the same byte.
    if line.contains(NON_PROSE_CHARS) {
        return false;
    }
    // 2. Not a statement, and not the line that opens a block.
    if starts_with_any(line, &STATEMENT_KEYWORDS) || ends_with_keyword(line, "do") {
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

/// Whether `c` may open a Ruby identifier.
///
/// `is_alphabetic` rather than an ASCII test: Ruby identifiers may be Unicode, and a program written
/// by a model prompted in another language is still a program.
fn is_ident_start(c: char) -> bool {
    c.is_alphabetic() || c == '_'
}

/// Whether `c` may continue a Ruby identifier. `?` and `!` are Ruby's method suffixes — `empty?`,
/// `save!` — and belong to the name they end.
fn is_ident_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '?' || c == '!'
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
    /// Inside an `=begin` block comment, until an `=end` at the start of a line.
    BlockComment,
    /// Inside a quoted string. Carries the byte that closes it and whether `#{…}` is honoured —
    /// which is the whole of the difference between `'…'` and `"…"`.
    Quoted {
        /// The delimiter that ends it: `'`, `"` or a backtick.
        close: u8,
        /// Whether `#{…}` inside it is part of the literal rather than two ordinary bytes.
        interpolates: bool,
    },
    /// Inside a `%w[…]`-family literal.
    Percent {
        /// The opener that nests it, for the four paired delimiters; `None` for the rest.
        open: Option<u8>,
        /// The delimiter that ends it.
        close: u8,
        /// How many nested openers are still to be closed.
        depth: usize,
    },
    /// Inside a heredoc body, until a line whose trimmed content is [`terminator`](Scan::terminator).
    Heredoc,
}

/// The scan's state that outlives one byte: the heredocs this line opened and the one being read.
///
/// A struct rather than three locals because a heredoc is the one shape here whose opener and body
/// are on different lines, so what a line *promised* has to survive until the newline delivers it.
#[derive(Default)]
struct Scan {
    /// The terminators of the heredocs opened on the current line, in the order they must be read.
    pending: Vec<String>,
    /// The terminator of the heredoc being read.
    terminator: String,
}

/// Lex `src` into its [code mask](CodeMask) — this dialect's answer to
/// [`Dialect::code_mask`](crate::healing::Dialect::code_mask).
///
/// `None` means the source did not lex cleanly, and every strategy that needs the mask declines on
/// it. Three states end a scan uncleanly: a quoted string still open at the end of input, a
/// `%`-literal still open there, and a heredoc whose terminator never arrived.
///
/// # What it reads
///
/// * `'…'` and `"…"`, with a backslash escaping whatever follows it. Ruby's single-quoted strings
///   only escape `\` and `'`, but treating the backslash as a universal escape reaches the same
///   answer — both bytes are string text either way — and it is what makes `'a\\'` one string rather
///   than two.
/// * `#{…}` **inside** a double-quoted string, read as string bytes and delimited by *brace
///   counting* rather than by looking for the closing quote. That is what lets
///   `"total: #{rows["n"]}"` — an interpolation containing the outer quote, which Ruby allows — stay
///   one string. Reading the interpolation's contents as code was the alternative and is the scan
///   that loses its place on exactly the input hardest to notice; nothing any strategy needs lives
///   inside one.
/// * `` `…` `` — a command literal in Ruby, and inline JavaScript in this guest's Opal. Either way
///   its bytes are not Ruby code.
/// * The `%w[…]` family (`%w %W %i %I %q %Q %r %s`, and a bare `%(…)`), with nesting for the four
///   paired delimiters, recognised only where a literal may begin so that `total % width` stays
///   arithmetic.
/// * `<<~EOS` / `<<-EOS` / `<<EOS` / `<<'EOS'` heredocs, whose body runs from the next newline to
///   the line that is the terminator. A bare `<<` is only read as a heredoc when what follows it is
///   `~`, `-`, a quote, or an ALL-CAPS identifier — the four shapes that cannot also be the
///   left-shift operator a program writes as `list << item`.
/// * `#` line comments, and `=begin`/`=end` block comments at column zero, which is the only place
///   Ruby accepts them.
///
/// # The one shape it deliberately does not read
///
/// **A regular-expression literal.** `/…/` cannot be told from division without knowing whether the
/// previous token was a value, which is a parse. So a `/` is scanned as an ordinary code byte, and a
/// regex carrying a quote — `/it's/` — opens a string that never closes and the scan **declines**.
/// That is the right failure: declining costs a repair, and the alternative reading costs a
/// deletion.
fn code_mask(src: &str) -> Option<CodeMask> {
    let bytes = src.as_bytes();
    let mut code = vec![true; bytes.len()];
    let mut mode = Mode::Code;
    let mut scan = Scan::default();
    let mut index = 0;

    while index < bytes.len() {
        let byte = bytes[index];
        match mode {
            Mode::Code => {
                if at_line_start(bytes, index) && src[index..].starts_with("=begin") {
                    mode = Mode::BlockComment;
                    continue;
                }
                match byte {
                    b'\n' => {
                        index += 1;
                        mode = open_heredoc(&mut scan);
                    }
                    b'#' => {
                        code[index] = false;
                        mode = Mode::Comment;
                        index += 1;
                    }
                    b'\'' | b'"' | b'`' => {
                        code[index] = false;
                        mode = Mode::Quoted {
                            close: byte,
                            interpolates: byte != b'\'',
                        };
                        index += 1;
                    }
                    b'%' => match percent_literal(bytes, index) {
                        Some((width, open, close)) => {
                            blank(&mut code, index, index + width);
                            mode = Mode::Percent {
                                open,
                                close,
                                depth: 0,
                            };
                            index += width;
                        }
                        None => index += 1,
                    },
                    b'<' => match heredoc_terminator(bytes, index) {
                        Some((width, name)) => {
                            scan.pending.push(name);
                            index += width;
                        }
                        None => index += 1,
                    },
                    _ => index += 1,
                }
            }
            Mode::Comment => {
                if byte == b'\n' {
                    index += 1;
                    mode = open_heredoc(&mut scan);
                } else {
                    code[index] = false;
                    index += 1;
                }
            }
            Mode::BlockComment => {
                if at_line_start(bytes, index) && src[index..].starts_with("=end") {
                    let end = index + "=end".len();
                    blank(&mut code, index, end);
                    mode = Mode::Code;
                    index = end;
                    continue;
                }
                code[index] = false;
                index += 1;
            }
            Mode::Quoted {
                close,
                interpolates,
            } => {
                code[index] = false;
                match byte {
                    b'\\' => {
                        if index + 1 >= bytes.len() {
                            return None;
                        }
                        code[index + 1] = false;
                        index += 2;
                    }
                    b'#' if interpolates && bytes.get(index + 1) == Some(&b'{') => {
                        let end = interpolation_end(bytes, index + 1)?;
                        blank(&mut code, index, end);
                        index = end;
                    }
                    _ if byte == close => {
                        mode = Mode::Code;
                        index += 1;
                    }
                    _ => index += 1,
                }
            }
            Mode::Percent { open, close, depth } => {
                code[index] = false;
                match byte {
                    b'\\' => {
                        if index + 1 >= bytes.len() {
                            return None;
                        }
                        code[index + 1] = false;
                        index += 2;
                    }
                    _ if Some(byte) == open => {
                        mode = Mode::Percent {
                            open,
                            close,
                            depth: depth + 1,
                        };
                        index += 1;
                    }
                    _ if byte == close => {
                        mode = match depth {
                            0 => Mode::Code,
                            _ => Mode::Percent {
                                open,
                                close,
                                depth: depth - 1,
                            },
                        };
                        index += 1;
                    }
                    _ => index += 1,
                }
            }
            Mode::Heredoc => {
                // The terminator is recognised at the start of a line, which is also how an empty
                // heredoc — one whose very first body line is the terminator — is read as empty
                // rather than as a body that never ends.
                if at_line_start(bytes, index) {
                    let line = src[index..].split('\n').next().unwrap_or_default();
                    if line.trim() == scan.terminator {
                        let end = index + line.len();
                        blank(&mut code, index, end);
                        index = end;
                        mode = match scan.pending.is_empty() {
                            true => Mode::Code,
                            false => open_heredoc(&mut scan),
                        };
                        continue;
                    }
                }
                code[index] = false;
                index += 1;
            }
        }
    }

    // A comment is closed by end of input; a string, a `%`-literal and a heredoc are not, and an
    // open one means the scan lost its place. A `=begin` that never met its `=end` is read as a
    // comment running to the end, which is what it is.
    matches!(mode, Mode::Code | Mode::Comment | Mode::BlockComment)
        .then(|| CodeMask::from_flags(code))
}

/// Whether the byte at `index` begins a line.
fn at_line_start(bytes: &[u8], index: usize) -> bool {
    index == 0 || bytes[index - 1] == b'\n'
}

/// Mark `[from, to)` as not code.
fn blank(code: &mut [bool], from: usize, to: usize) {
    for slot in code.iter_mut().take(to).skip(from) {
        *slot = false;
    }
}

/// Begin reading the next heredoc this line promised, or go back to code.
fn open_heredoc(scan: &mut Scan) -> Mode {
    match scan.pending.is_empty() {
        true => Mode::Code,
        false => {
            scan.terminator = scan.pending.remove(0);
            Mode::Heredoc
        }
    }
}

/// The offset one past the `}` that closes the `#{` opening at `open`, counting nested braces.
fn interpolation_end(bytes: &[u8], open: usize) -> Option<usize> {
    let mut depth = 0usize;
    let mut index = open;
    while index < bytes.len() {
        match bytes[index] {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(index + 1);
                }
            }
            _ => {}
        }
        index += 1;
    }
    None
}

/// The `%`-literal opening at `index`, as `(how many bytes it opens with, the nesting opener, the
/// closing delimiter)`.
///
/// Recognised only where a literal may begin — at the start of the source, or after whitespace or an
/// operator — so that `total % width` stays arithmetic. The type letter is optional (`%(…)` is a
/// string), and the delimiter is whatever punctuation follows it. `=` is excluded as a delimiter
/// because `count %= 2` is the modulo-assignment operator, which is exactly what would otherwise be
/// read as a literal running to the next `=` in the file.
fn percent_literal(bytes: &[u8], index: usize) -> Option<(usize, Option<u8>, u8)> {
    const AFTER: &[u8] = b"([{,~!|&<>+-*/%?:;\n\t ";
    if index > 0 && !AFTER.contains(&bytes[index - 1]) {
        return None;
    }
    let mut width = 1;
    if matches!(
        bytes.get(index + width),
        Some(b'w' | b'W' | b'i' | b'I' | b'q' | b'Q' | b'r' | b's')
    ) {
        width += 1;
    }
    let delimiter = *bytes.get(index + width)?;
    if delimiter.is_ascii_alphanumeric() || delimiter.is_ascii_whitespace() || delimiter == b'=' {
        return None;
    }
    let (open, close) = match delimiter {
        b'(' => (Some(b'('), b')'),
        b'[' => (Some(b'['), b']'),
        b'{' => (Some(b'{'), b'}'),
        b'<' => (Some(b'<'), b'>'),
        other => (None, other),
    };
    Some((width + 1, open, close))
}

/// The heredoc opening at `index`, as `(how many bytes it opens with, the terminator)`.
///
/// A bare `<<` is the left-shift operator far more often than it is a heredoc, so only the four
/// shapes that cannot be one are read: `<<~`, `<<-`, `<<` with a quoted terminator, and `<<` with an
/// ALL-CAPS identifier — which is the convention every heredoc in the wild follows and which
/// `list << item` (a space) and `count << shift` (a lower-case name) do not.
fn heredoc_terminator(bytes: &[u8], index: usize) -> Option<(usize, String)> {
    if bytes.get(index + 1) != Some(&b'<') {
        return None;
    }
    let mut cursor = index + 2;
    let squiggly = matches!(bytes.get(cursor), Some(b'~' | b'-'));
    if squiggly {
        cursor += 1;
    }
    let quote = match bytes.get(cursor) {
        Some(&byte @ (b'\'' | b'"')) => {
            cursor += 1;
            Some(byte)
        }
        _ => None,
    };
    let start = cursor;
    while cursor < bytes.len() && (bytes[cursor].is_ascii_alphanumeric() || bytes[cursor] == b'_') {
        cursor += 1;
    }
    if cursor == start {
        return None;
    }
    let name = std::str::from_utf8(&bytes[start..cursor]).ok()?.to_string();
    match quote {
        Some(byte) => {
            if bytes.get(cursor) != Some(&byte) {
                return None;
            }
            cursor += 1;
        }
        // An unadorned `<<NAME` is only a heredoc when the name is the ALL-CAPS one every heredoc
        // uses; anything else is the shift operator.
        None if !squiggly
            && !name
                .chars()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_') =>
        {
            return None;
        }
        None => {}
    }
    Some((cursor - index, name))
}

// ---------------------------------------------------------------------------------------------
// The concurrency wrapper
// ---------------------------------------------------------------------------------------------

/// The whole `Thread` wrapper, if `text` is entirely made of one.
///
/// Line-oriented, because Ruby's block structure is: the body is what lies between the line that
/// opens the block and the `end` that closes it, and nothing but a keyword count could say so in
/// another language. Each step declines rather than guessing, and the join is **required** for the
/// reason [the skeleton](crate::healing::Dialect::unwrap_async) gives: a thread the program never
/// joins is a wrapper whose body may not have finished, so unwrapping it would change what the reply
/// asked for.
fn unwrap_async(text: &str, mask: &CodeMask) -> Option<Unwrapped> {
    let lines: Vec<(usize, &str)> = lines_with_offsets(text).collect();
    let mut cursor = 0;

    // Leading blanks, then the optional `require "thread"` that would have made the runner
    // reachable — dead in this guest either way, and taken with the wrapper rather than left behind
    // as the one line of a repaired program that still names a constant nothing defines.
    cursor = skip_blank(&lines, cursor);
    if lines
        .get(cursor)
        .is_some_and(|(offset, line)| mask.is_code(*offset) && is_thread_require(line))
    {
        cursor = skip_blank(&lines, cursor + 1);
    }

    // The line that opens the thread, unindented and in code context.
    let (offset, header) = lines.get(cursor).copied()?;
    if !mask.is_code(offset) || header.starts_with([' ', '\t']) {
        return None;
    }
    let opened = thread_header(header)?;
    cursor += 1;

    // The body: every line up to the unindented `end` that closes the block.
    let body_start = cursor;
    let closing = loop {
        let (offset, line) = lines.get(cursor).copied()?;
        // Only an **unindented** `end` closes the wrapper: an indented one closes a block inside the
        // body, which is where every nested `do` in a real program ends.
        if mask.is_code(offset)
            && !line.starts_with([' ', '\t'])
            && let Some(closing) = closes_thread(line)
        {
            break closing;
        }
        cursor += 1;
    };
    if cursor == body_start {
        return None;
    }
    let body = lines[body_start].0..lines[cursor].0;

    // How the thread is waited on: on the closing line for the immediate shape, on a line of its own
    // for the declared one — and in both cases with nothing after it.
    let (wrapper, tail) = match (&opened, closing) {
        (Opened::Immediate, Closing::Joined) => (AsyncWrapper::Immediate, cursor + 1),
        (Opened::Named(name), Closing::Bare) => {
            let waited = skip_blank(&lines, cursor + 1);
            let (offset, line) = lines.get(waited).copied()?;
            if !mask.is_code(offset) || !is_join_of(line, name) {
                return None;
            }
            (AsyncWrapper::Declared, waited + 1)
        }
        _ => return None,
    };
    if skip_blank(&lines, tail) != lines.len() {
        return None;
    }

    Some(Unwrapped {
        wrapper,
        text: dedent(text, mask, body),
        // Ruby has no suspension token, so nothing of that kind was deleted and nothing is reported.
        awaits: 0,
    })
}

/// What the line that opens the thread said.
enum Opened {
    /// `Thread.new do` — created and waited on where it is written, so it has no name.
    Immediate,
    /// `worker = Thread.new do` — bound to a name the join below has to match.
    Named(String),
}

/// How the block's `end` line ended: waiting on the thread, or merely closing it.
#[derive(Clone, Copy)]
enum Closing {
    /// `end.join` — the immediate shape's wait.
    Joined,
    /// `end` — the declared shape's close, whose wait is on the next line.
    Bare,
}

/// Whether `line` is the `require` that would have made `Thread` reachable.
fn is_thread_require(line: &str) -> bool {
    matches!(
        line.trim(),
        "require \"thread\"" | "require 'thread'" | "require \"thread\";" | "require 'thread';"
    )
}

/// What `line` opens, when it is `Thread.new do` or `name = Thread.new do` and nothing else.
///
/// The trailing `do` is required and has to end the line: a block whose parameters run on — or which
/// is written with braces spanning lines — is a shape only a parser could delimit.
fn thread_header(line: &str) -> Option<Opened> {
    let line = line.trim();
    let (name, rest) = match find_assignment(line) {
        Some(at) => {
            let target = line[..at].trim_end();
            if !is_name_shaped(target) || target.contains(['.', '[', ':']) {
                return None;
            }
            (Some(target.to_string()), line[at + 1..].trim_start())
        }
        None => (None, line),
    };
    let rest = rest.strip_prefix("Thread.new")?.trim_start();
    // `Thread.new()` and `Thread.new` are both written; anything else is a call this cannot delimit.
    let rest = rest.strip_prefix("()").unwrap_or(rest);
    // The line has to end on the bare `do` that opens the block. A block that names its parameters
    // (`do |name|`) is one whose body only a parser could delimit, and a brace block spanning lines
    // is one expression rather than a statement — both decline here rather than being guessed at.
    if rest.trim() != "do" {
        return None;
    }
    Some(match name {
        Some(name) => Opened::Named(name),
        None => Opened::Immediate,
    })
}

/// How `line` closes the thread's block, when it closes it at all.
fn closes_thread(line: &str) -> Option<Closing> {
    match line.trim().trim_end_matches(';').trim_end() {
        "end" => Some(Closing::Bare),
        "end.join" | "end.join()" | "end.value" => Some(Closing::Joined),
        _ => None,
    }
}

/// Whether `line` is exactly the wait on the thread `name` holds.
fn is_join_of(line: &str, name: &str) -> bool {
    let tail = line.trim().trim_end_matches(';').trim_end();
    tail == format!("{name}.join")
        || tail == format!("{name}.join()")
        || tail == format!("{name}.value")
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

/// The wrapper's body, dedented by the common indentation of the lines that begin in code context.
///
/// `body` is the byte range of the body inside `text`, so the surviving lines keep their own
/// terminators and a `\r\n` program stays a `\r\n` program. A line that begins inside a heredoc or a
/// `%`-literal carries data rather than indentation and is neither measured nor stripped, which is
/// what keeps a repaired program's embedded text byte-identical.
fn dedent(text: &str, mask: &CodeMask, body: std::ops::Range<usize>) -> String {
    let inner = &text[body.clone()];
    let base = body.start;

    let indent = lines_with_offsets(inner)
        .filter(|(offset, line)| !line.trim().is_empty() && mask.is_code(base + offset))
        .map(|(_, line)| &line[..line.len() - line.trim_start().len()])
        .reduce(common_prefix)
        .unwrap_or_default()
        .to_string();

    let mut out = String::with_capacity(inner.len());
    let mut offset = 0;
    for raw in inner.split_inclusive('\n') {
        let start = offset;
        offset += raw.len();
        let dedented = match mask.is_code(base + start) {
            true => raw.strip_prefix(indent.as_str()).unwrap_or(raw),
            false => raw,
        };
        out.push_str(dedented);
    }
    out.trim().to_string()
}

#[cfg(test)]
#[path = "ruby.healing.test.rs"]
mod tests;
