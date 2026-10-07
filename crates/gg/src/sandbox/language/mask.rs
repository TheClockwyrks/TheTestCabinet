//! The **code mask** — which bytes of a source are code, as opposed to string, interpolation or
//! comment text — and the line-walking helper the per-language lexers behind it share.
//!
//! The question every caller asks of a mask is the same one: *is this byte code?* — so that an
//! import inside a string, a keyword inside a comment, or a declaration inside a template literal
//! is read as the text it is rather than as the statement it spells. The callers are the
//! per-language module analyses — `python.modules.rs`, `purescript.modules.rs` and
//! `ruby.modules.rs`, which read a module's exports and must not mistake one written into a string
//! for one the module declares — and Swift's source scan (`swift.source.rs`), which reads a
//! code module's declarations by the same discipline.
//!
//! The type lives here with a per-language *filler* (each arm's own `mask` module), because the
//! shape of the answer is the same in every language — one flag per byte, out of range is not code
//! — and only the lexer that produces it differs. That is what lets a caller index a mask without
//! knowing whose it is.

/// Which bytes of a source are **code** — as opposed to string, interpolation or comment text.
pub(super) struct CodeMask {
    /// Per byte: not string, interpolation, or comment text. An interpolation's own delimiters are
    /// code, because they are what a brace count has to see in order to come back out again.
    code: Vec<bool>,
}

impl CodeMask {
    /// A mask from one flag per byte of the source it was lexed from — the constructor a
    /// language's own lexer returns through.
    ///
    /// The flags are taken by value rather than the field being public, so a mask is immutable once
    /// built: every caller that reads one is deciding what a stretch of a program means, and a mask
    /// that could be edited afterwards is a decision that could be revised behind the decider's
    /// back.
    pub(super) fn from_flags(code: Vec<bool>) -> Self {
        Self { code }
    }

    /// Whether the byte at `index` is code. Out-of-range indices are not, so a caller that has
    /// already rewritten its text cannot silently read past the end of the mask.
    pub(super) fn is_code(&self, index: usize) -> bool {
        self.code.get(index) == Some(&true)
    }
}

/// Each line of `src` with the byte offset it starts at, without its line ending.
///
/// Offsets rather than an iterator of `&str` because the callers pair what a line says with where
/// it stands in the source — the mask is indexed by byte, and two spellings of "where does line
/// *n* begin" is exactly the drift one shared helper removes.
pub(super) fn lines_with_offsets(src: &str) -> impl Iterator<Item = (usize, &str)> {
    let mut offset = 0;
    src.split_inclusive('\n').map(move |raw| {
        let start = offset;
        offset += raw.len();
        let line = raw.strip_suffix('\n').unwrap_or(raw);
        (start, line.strip_suffix('\r').unwrap_or(line))
    })
}
