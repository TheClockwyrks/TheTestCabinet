//! **Ruby's code mask** — the byte-level lexer behind [this arm's module
//! analysis](super::modules), which must not take a `def` written inside a heredoc or a string for
//! one the module declares. See [`CodeMask`] for the shape of the
//! answer.

use super::super::mask::CodeMask;

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

/// Lex `src` into its [code mask](CodeMask).
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
pub(super) fn code_mask(src: &str) -> Option<CodeMask> {
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
