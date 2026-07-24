//! The `gg-script` lexer: source text → a flat [`Token`] stream the
//! [parser](crate::parser) consumes.
//!
//! The language is deliberately small (see the crate [README](../README.md)), so the
//! lexer is a single left-to-right scan with no lookahead beyond one character. It
//! recognises the literal forms (numbers, double-quoted strings with the usual JSON
//! escapes, and the `true`/`false`/`null` keyword literals), the block/statement
//! punctuation, and the operator set — and it skips whitespace and `//` line
//! comments so a model may annotate its program.
//!
//! Errors are reported as a [`LexError`] carrying the byte offset, never a panic: a
//! malformed program is the model's to fix, and the sandbox surfaces the diagnostic
//! rather than trapping.

use std::fmt;

/// One lexical token, with the source byte offset it started at (for diagnostics).
#[derive(Debug, Clone, PartialEq)]
pub struct Token {
    /// What the token is.
    pub kind: TokenKind,
    /// The byte offset in the source where the token begins.
    pub offset: usize,
}

/// The kinds of token `gg-script` recognises.
#[derive(Debug, Clone, PartialEq)]
pub enum TokenKind {
    /// An identifier or a keyword handled by the parser (`let`, `if`, `while`, …).
    /// Keyword disambiguation is the parser's job; the lexer only classifies the
    /// lexeme as a word.
    Ident(String),
    /// A numeric literal, already parsed to `f64` (all `gg-script` numbers are JSON
    /// numbers).
    Number(f64),
    /// A string literal, with escapes already resolved.
    Str(String),

    // --- one- and two-character punctuation/operators ---
    /// `(`
    LParen,
    /// `)`
    RParen,
    /// `{`
    LBrace,
    /// `}`
    RBrace,
    /// `[`
    LBracket,
    /// `]`
    RBracket,
    /// `,`
    Comma,
    /// `;`
    Semicolon,
    /// `:`
    Colon,
    /// `.`
    Dot,
    /// `+`
    Plus,
    /// `-`
    Minus,
    /// `*`
    Star,
    /// `/`
    Slash,
    /// `%`
    Percent,
    /// `=`
    Assign,
    /// `==`
    Eq,
    /// `!=`
    Ne,
    /// `!`
    Bang,
    /// `<`
    Lt,
    /// `<=`
    Le,
    /// `>`
    Gt,
    /// `>=`
    Ge,
    /// `&&`
    And,
    /// `||`
    Or,
}

/// Why lexing failed — always with the byte offset the fault was found at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LexError {
    /// The byte offset in the source where the fault was found.
    pub offset: usize,
    /// A human-readable explanation.
    pub message: String,
}

impl fmt::Display for LexError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "lex error at byte {}: {}", self.offset, self.message)
    }
}

impl std::error::Error for LexError {}

/// Tokenise `source` into the full [`Token`] stream (no trailing end-of-input token;
/// the parser tracks its own position). A lexical fault stops the scan and returns a
/// [`LexError`].
pub fn lex(source: &str) -> Result<Vec<Token>, LexError> {
    let bytes = source.as_bytes();
    let mut tokens = Vec::new();
    let mut i = 0;

    while i < bytes.len() {
        let c = bytes[i];

        // Whitespace.
        if c.is_ascii_whitespace() {
            i += 1;
            continue;
        }

        // `//` line comment — skip to end of line.
        if c == b'/' && i + 1 < bytes.len() && bytes[i + 1] == b'/' {
            i += 2;
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }

        let start = i;

        // Identifier / keyword: `[A-Za-z_][A-Za-z0-9_]*`.
        if c == b'_' || c.is_ascii_alphabetic() {
            i += 1;
            while i < bytes.len() && (bytes[i] == b'_' || bytes[i].is_ascii_alphanumeric()) {
                i += 1;
            }
            let word = source[start..i].to_string();
            tokens.push(Token {
                kind: TokenKind::Ident(word),
                offset: start,
            });
            continue;
        }

        // Number: a run of digits with an optional single fractional part. A leading
        // `-` is lexed as the `Minus` operator and folded by the parser's unary rule,
        // so the lexer never produces a signed literal (keeping `a-1` unambiguous).
        if c.is_ascii_digit() {
            i += 1;
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
            if i < bytes.len()
                && bytes[i] == b'.'
                && i + 1 < bytes.len()
                && bytes[i + 1].is_ascii_digit()
            {
                i += 1;
                while i < bytes.len() && bytes[i].is_ascii_digit() {
                    i += 1;
                }
            }
            let text = &source[start..i];
            let value = text.parse::<f64>().map_err(|_| LexError {
                offset: start,
                message: format!("invalid number literal `{text}`"),
            })?;
            tokens.push(Token {
                kind: TokenKind::Number(value),
                offset: start,
            });
            continue;
        }

        // String literal.
        if c == b'"' {
            let (value, next) = lex_string(source, i)?;
            tokens.push(Token {
                kind: TokenKind::Str(value),
                offset: start,
            });
            i = next;
            continue;
        }

        // Punctuation and operators. Two-character operators are matched first.
        let two = if i + 1 < bytes.len() {
            Some((c, bytes[i + 1]))
        } else {
            None
        };
        let (kind, width) = match two {
            Some((b'=', b'=')) => (TokenKind::Eq, 2),
            Some((b'!', b'=')) => (TokenKind::Ne, 2),
            Some((b'<', b'=')) => (TokenKind::Le, 2),
            Some((b'>', b'=')) => (TokenKind::Ge, 2),
            Some((b'&', b'&')) => (TokenKind::And, 2),
            Some((b'|', b'|')) => (TokenKind::Or, 2),
            _ => {
                let single = match c {
                    b'(' => TokenKind::LParen,
                    b')' => TokenKind::RParen,
                    b'{' => TokenKind::LBrace,
                    b'}' => TokenKind::RBrace,
                    b'[' => TokenKind::LBracket,
                    b']' => TokenKind::RBracket,
                    b',' => TokenKind::Comma,
                    b';' => TokenKind::Semicolon,
                    b':' => TokenKind::Colon,
                    b'.' => TokenKind::Dot,
                    b'+' => TokenKind::Plus,
                    b'-' => TokenKind::Minus,
                    b'*' => TokenKind::Star,
                    b'/' => TokenKind::Slash,
                    b'%' => TokenKind::Percent,
                    b'=' => TokenKind::Assign,
                    b'!' => TokenKind::Bang,
                    b'<' => TokenKind::Lt,
                    b'>' => TokenKind::Gt,
                    b'&' => {
                        return Err(LexError {
                            offset: start,
                            message: "unexpected `&`; did you mean `&&`?".to_string(),
                        });
                    }
                    b'|' => {
                        return Err(LexError {
                            offset: start,
                            message: "unexpected `|`; did you mean `||`?".to_string(),
                        });
                    }
                    other => {
                        return Err(LexError {
                            offset: start,
                            message: format!("unexpected character `{}`", other as char),
                        });
                    }
                };
                (single, 1)
            }
        };
        tokens.push(Token {
            kind,
            offset: start,
        });
        i += width;
    }

    Ok(tokens)
}

/// Scan a double-quoted string starting at the opening quote at `open`. Returns the
/// unescaped contents and the byte offset just past the closing quote. Supports the
/// JSON escapes `\" \\ \/ \n \t \r \b \f` and `\uXXXX`.
fn lex_string(source: &str, open: usize) -> Result<(String, usize), LexError> {
    let bytes = source.as_bytes();
    let mut i = open + 1;
    let mut out = String::new();

    while i < bytes.len() {
        let c = bytes[i];
        match c {
            b'"' => return Ok((out, i + 1)),
            b'\\' => {
                i += 1;
                if i >= bytes.len() {
                    break;
                }
                match bytes[i] {
                    b'"' => out.push('"'),
                    b'\\' => out.push('\\'),
                    b'/' => out.push('/'),
                    b'n' => out.push('\n'),
                    b't' => out.push('\t'),
                    b'r' => out.push('\r'),
                    b'b' => out.push('\u{0008}'),
                    b'f' => out.push('\u{000C}'),
                    b'u' => {
                        let hex_start = i + 1;
                        if hex_start + 4 > bytes.len() {
                            return Err(LexError {
                                offset: i,
                                message: "truncated `\\u` escape".to_string(),
                            });
                        }
                        let hex = &source[hex_start..hex_start + 4];
                        let code = u32::from_str_radix(hex, 16).map_err(|_| LexError {
                            offset: i,
                            message: format!("invalid `\\u` escape `\\u{hex}`"),
                        })?;
                        let ch = char::from_u32(code).ok_or_else(|| LexError {
                            offset: i,
                            message: format!("`\\u{hex}` is not a valid code point"),
                        })?;
                        out.push(ch);
                        i += 4;
                    }
                    other => {
                        return Err(LexError {
                            offset: i,
                            message: format!("invalid escape `\\{}`", other as char),
                        });
                    }
                }
                i += 1;
            }
            _ => {
                // Copy one UTF-8 scalar. Non-ASCII bytes are part of a multi-byte
                // char; find the char boundary and push the whole char.
                let ch = source[i..].chars().next().ok_or_else(|| LexError {
                    offset: i,
                    message: "invalid UTF-8 in string".to_string(),
                })?;
                out.push(ch);
                i += ch.len_utf8();
            }
        }
    }

    Err(LexError {
        offset: open,
        message: "unterminated string literal".to_string(),
    })
}

#[cfg(test)]
#[path = "lexer.test.rs"]
mod tests;
