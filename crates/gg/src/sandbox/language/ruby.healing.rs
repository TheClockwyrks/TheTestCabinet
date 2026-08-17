//! **Ruby's [healing dialect](crate::healing::Dialect)** — the lexical half of
//! [response healing](crate::healing), answered in Ruby's own terms.
//!
//! The healing skeleton asks three questions here and cannot answer any of them itself: the fence
//! tags and the two line predicates. One of those answers is the same *decision*
//! [Python's arm](super::super::python::healing) made, for the same reason restated in Ruby. The
//! trait's fourth question — the [mask](Dialect::code_mask), which healing never asks and
//! [this arm's module analysis](super::modules) does — is where Ruby reads shapes that exist
//! nowhere else in the registry.
//!
//! # The answer that is Ruby's and nobody else's
//!
//! **The lexer reads five string shapes, one of them a heredoc.** `'…'`, `"…"` with `#{…}`
//! interpolation, `` `…` ``, the `%w[…]`/`%q(…)` family and `<<~EOS` heredocs — beside `#` line
//! comments and `=begin`/`=end` block comments — are all ordinary Ruby that a model writes without
//! thinking about it, and a mask that lost its place on any of them would be a mask that reported
//! string bytes as code. See [`code_mask`] for what is read, and for the one shape that is
//! deliberately not.
//!
//! # The answer that agrees with Python's, and why
//!
//! **A `#` line is never prose.** `# note` is a Ruby comment *and* a Markdown heading, and nothing
//! lexical tells them apart. So `#` is listed among the characters no prose line contains: a comment
//! survives, which is what matters, and a stray heading survives too, which costs a line of comment
//! in the program and nothing else.
//!
//! # None of these is a parser
//!
//! Not one predicate here parses, for the reason every other dialect gives: healing runs on text
//! that is not yet known to be a program. gg has no Ruby parser on the host at all — the
//! [compile step](super::compile) spawns Opal in another process, which is a great deal more than a
//! predicate may cost. So every answer below is a lexical shape test, and each declines rather than
//! guessing.

use crate::healing::{CodeMask, Dialect};

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
/// [`Dialect::looks_like_code`].
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
/// [`Dialect::is_prose_line`], and the test `strip-prose` uses to *delete* a line.
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

/// Lex `src` into its [code mask](CodeMask) — this dialect's answer to [`Dialect::code_mask`].
///
/// `None` means the source did not lex cleanly, and every caller that needs the mask declines on
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
///   that loses its place on exactly the input hardest to notice; nothing any caller needs lives
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
/// That is the right failure: a mask that declines is one nobody acts on, and the alternative
/// reading is one that reports string bytes as code.
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

#[cfg(test)]
#[path = "ruby.healing.test.rs"]
mod tests;
