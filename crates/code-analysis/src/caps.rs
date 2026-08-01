//! The bounds the analysis runs under, and the guarded thread every parse happens on.
//!
//! Two unrelated problems are solved here, and they are in one module because they are
//! solved by the same numbers.
//!
//! # 1. A parser stack overflow would abort the process
//!
//! Both front ends are **unguarded recursive descent over untrusted input**. `oxc`'s
//! parser takes one stack frame per level of grammatical nesting with no depth check;
//! `syn` does the same over a token stream. The source they are pointed at was written by
//! a model, and a model that repeats a bracket in a generation loop produces exactly the
//! degenerate shape that overflows.
//!
//! A stack overflow is **not a catchable panic**. It is `fatal runtime error: stack
//! overflow` and `SIGABRT` — it takes the whole process down, and the analysis now runs
//! *before* validation inside the driver, so the blast radius is a pod, not a file. No
//! `catch_unwind` and no `Result` can help after the fact, so every mitigation here is a
//! bound applied **before** the parser is ever entered:
//!
//! 1. [`MAX_PARSED_FILE_BYTES`] bounds how many levels the source can ask for at all —
//!    recursive descent takes at most one level per token and a token is at least one
//!    byte. A file over the cap is counted for **size** rather than dropped: a 300 KB
//!    god-file is precisely the interesting case, and dropping it would bias every size
//!    metric against the worst outcomes.
//! 2. [`bracket_nesting_depth`] prescans for the bracket shapes, which are both the ones a
//!    runaway generation actually produces and the most expensive per level. Over
//!    [`MAX_BRACKET_NESTING`] the file is size-only.
//! 3. [`parse_stack_bytes`] **derives** the stack from the file rather than fixing it, so
//!    a small file costs a small reservation and a 256 KiB file gets what 256 KiB can ask
//!    for.
//! 4. [`parse_guarded`] runs the parse on that stack inside `catch_unwind`, and treats a
//!    thread that cannot be *started* as a size-only file rather than as a panic.
//!
//! # 2. Deterministic means deterministic
//!
//! The analysis is a pure function of the tree's bytes, and one tempting feature had to be
//! removed to keep it: **there is no wall-clock budget in the record-producing path.** A
//! time cutoff would make the output a function of machine speed and load — the same tree
//! analysed in a loaded pod and re-analysed later on a quiet host would yield two
//! different figure sets, both stamped with the same analyzer version, which is precisely
//! the corruption the version field exists to make visible. An "analyse it twice, assert
//! equal" test would pass and prove nothing.
//!
//! So every bound is **content-derived**: [`MAX_FILES`], [`MAX_TOTAL_PARSE_BYTES`],
//! [`MAX_PARSED_FILE_BYTES`], [`MAX_SYMBOLS`]. Files are visited in sorted order, so
//! *which* files a cap drops is deterministic too, and hitting one marks the result
//! truncated.
//!
//! # Where the stack numbers come from
//!
//! [`STACK_BYTES_PER_SOURCE_BYTE`] is measured, not chosen — see its own documentation.
//! The relationship between it and [`MAX_PARSED_FILE_BYTES`] is load-bearing in both
//! directions: **raising the byte cap without raising the stack breaks the derivation**,
//! and 256 KiB is the largest file for which the derived stack still fits under
//! [`MAX_PARSE_STACK_BYTES`].

use std::panic::AssertUnwindSafe;

/// The most files the walk will analyse.
///
/// Twenty thousand is an order of magnitude more than any produced tree has held, and the
/// cap exists to bound the analysis of a tree that is pathological rather than large — a
/// model that generates a file per entity in a loop. Files are visited in sorted order, so
/// the set a cap drops is a function of the tree, not of when the analysis ran.
pub const MAX_FILES: usize = 20_000;

/// The most bytes of a **single** file either front end will parse.
///
/// Over this the file is counted for size and contributes no functions, imports or type
/// figures. That reversal is deliberate: the interesting failure is a model that wrote one
/// enormous file, and excluding it entirely would make the size metrics *flatter* exactly
/// where the model did worst.
///
/// The number is not free-standing. [`parse_stack_bytes`] derives a stack of
/// `bytes × STACK_BYTES_PER_SOURCE_BYTE × STACK_SAFETY_FACTOR`, and at 256 KiB that is
/// ~946 MiB — just under [`MAX_PARSE_STACK_BYTES`]. **A larger byte cap would silently
/// clamp, and the derivation would stop covering the worst shape the cap admits.** Raise
/// them together or not at all, and bump the analyzer version when you do, because a cap
/// change is a definition change.
pub const MAX_PARSED_FILE_BYTES: usize = 256 * 1024;

/// The most bytes handed to a parser across the whole tree.
///
/// Reached by summing the parsed files in sorted order, so a tree that exceeds it is
/// analysed as its alphabetically-first 64 MiB of source and marked truncated — the same
/// 64 MiB every time.
pub const MAX_TOTAL_PARSE_BYTES: u64 = 64 * 1024 * 1024;

/// The most functions the analysis will score.
///
/// A per-symbol budget rather than a per-file one, because the document carries a row per
/// function and it is the *document* this protects.
pub const MAX_SYMBOLS: usize = 200_000;

/// The deepest `(`, `[` or `{` nesting either front end will parse.
///
/// Real code nests fewer than ten levels. Two hundred is twenty times that, and still well
/// under the shallowest depth at which `oxc` was measured to overflow a 2 MiB stack (985
/// levels of `{a:`). Bracket shapes are both the cheapest for a model to emit by accident
/// and the most expensive per level, which is why they get a bound of their own instead of
/// being left to the stack.
pub const MAX_BRACKET_NESTING: u32 = 200;

/// Bytes of stack per byte of source, measured against `oxc` 0.141 in the **dev** profile.
///
/// The figure comes from `crates/gg/src/sandbox/transpile.rs`, which measured the appetite
/// of every bracket-free recursion the nesting prescan cannot see — chains of postfix `!`,
/// prefix `!`, `.b`, `?:`, unary `-`, `as any`, `new`. The hungriest was a chain of
/// postfix non-null assertions at **1,261 bytes of stack per byte of source**.
///
/// It is the dev-profile figure deliberately: an unoptimised frame is up to ~16× fatter
/// than an optimised one (the same chain costs ~80 bytes per source byte in `release`),
/// the test suite runs unoptimised, and the margin has to hold for the build a developer
/// runs as well as the one a run container gets.
pub const STACK_BYTES_PER_SOURCE_BYTE: usize = 1_261;

/// The multiplier applied on top of [`STACK_BYTES_PER_SOURCE_BYTE`].
///
/// **This is not slack; it is the bracket allowance.** The measured per-byte figure covers
/// the bracket-*free* shapes. Bracket shapes cost more per level — up to ~3.4 KiB for each
/// `{a:` — and the nesting prescan is a naive byte scan that a closer inside a string
/// literal can fool, so a crafted file can reach the parser with real nesting the prescan
/// under-counted. At `1_261 × 3 = 3_783` bytes per source byte the derived stack covers
/// even a file that is *entirely* the most expensive bracket shape, because a bracket
/// still costs at least one byte of source. The two guards therefore overlap by design
/// rather than depending on each other.
pub const STACK_SAFETY_FACTOR: usize = 3;

/// The floor on a derived parse stack.
///
/// Below about 17 KiB of source the derivation asks for less than this, and there is no
/// reason to reserve less: the reservation is virtual, untouched pages never fault in, and
/// a thread costs the same tens of microseconds to spawn whatever its stack size.
pub const MIN_PARSE_STACK_BYTES: usize = 64 * 1024 * 1024;

/// The ceiling on a derived parse stack.
///
/// [`MAX_PARSED_FILE_BYTES`] is chosen so the derivation never actually reaches this — it
/// tops out at ~946 MiB — so the clamp is a backstop against a future cap change made
/// without reading [`MAX_PARSED_FILE_BYTES`]'s documentation, not a live bound.
pub const MAX_PARSE_STACK_BYTES: usize = 1024 * 1024 * 1024;

/// The stack a file of `source_bytes` is parsed on, **before** clamping.
///
/// Exposed separately from [`parse_stack_bytes`] so the per-front-end calibration tests
/// can exercise the derivation itself rather than the [`MIN_PARSE_STACK_BYTES`] floor,
/// which would otherwise dominate at every size small enough to test quickly.
pub fn derived_stack_bytes(source_bytes: usize) -> usize {
    source_bytes
        .saturating_mul(STACK_BYTES_PER_SOURCE_BYTE)
        .saturating_mul(STACK_SAFETY_FACTOR)
}

/// The stack a file of `source_bytes` is actually parsed on.
pub fn parse_stack_bytes(source_bytes: usize) -> usize {
    derived_stack_bytes(source_bytes).clamp(MIN_PARSE_STACK_BYTES, MAX_PARSE_STACK_BYTES)
}

/// The deepest `(`, `[` or `{` nesting in `source`, by a single byte scan.
///
/// Deliberately naive — it does not skip string literals or comments — for two reasons.
/// Over-counting is safe: it only refuses a file that would have parsed, and that file is
/// still counted for size. Under-counting is *possible* (a closer inside a string literal
/// cancels a real opener) but is covered by [`STACK_SAFETY_FACTOR`], which sizes the stack
/// for a file that is entirely brackets. A lexer here would buy accuracy the safety
/// argument does not need, and would itself have to be correct for two languages.
pub fn bracket_nesting_depth(source: &str) -> u32 {
    let mut depth: u32 = 0;
    let mut deepest: u32 = 0;
    for byte in source.bytes() {
        match byte {
            b'(' | b'[' | b'{' => {
                depth = depth.saturating_add(1);
                deepest = deepest.max(depth);
            }
            b')' | b']' | b'}' => depth = depth.saturating_sub(1),
            _ => {}
        }
    }
    deepest
}

/// Why a file that a front end could otherwise have handled was counted for size only.
///
/// Every variant is a *refusal*, never an error: the file still contributes its bytes and
/// lines, and the reason is recorded on its document entry so a reader can see that the
/// analysis chose not to parse it rather than failing to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseRefusal {
    /// Larger than [`MAX_PARSED_FILE_BYTES`].
    OverByteCap,
    /// Nested deeper than [`MAX_BRACKET_NESTING`].
    OverNestingCap,
    /// The parse thread could not be started — the machine is out of threads or address
    /// space. Treated as a size-only file rather than as a panic, because the analysis is
    /// a diagnostic read of a run that has already finished and must never be the thing
    /// that destroys it.
    ThreadUnavailable,
    /// The parse panicked and the panic was contained on the parse thread. A defect in a
    /// front end, or a shape it rejects with an assertion; either way the run is
    /// unaffected.
    Panicked,
}

impl ParseRefusal {
    /// The stable token recorded on a file's document entry.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::OverByteCap => "over-parse-cap",
            Self::OverNestingCap => "over-nesting-cap",
            Self::ThreadUnavailable => "thread-unavailable",
            Self::Panicked => "parse-failed",
        }
    }
}

/// Run `parse` over `source` under every mitigation this module exists for.
///
/// The whole pipeline the caller wants — parse *and* the tree walk that follows it — must
/// happen inside `parse`, because the walk recurses to the same depth the parse did. A
/// caller that parses here and walks outside has moved the overflow, not removed it.
pub fn parse_guarded<T: Send>(
    source: &str,
    parse: impl FnOnce(&str) -> T + Send,
) -> Result<T, ParseRefusal> {
    if source.len() > MAX_PARSED_FILE_BYTES {
        return Err(ParseRefusal::OverByteCap);
    }
    if bracket_nesting_depth(source) > MAX_BRACKET_NESTING {
        return Err(ParseRefusal::OverNestingCap);
    }
    on_stack(parse_stack_bytes(source.len()), || parse(source))
}

/// Run `work` on a fresh thread with `stack_bytes` of stack, containing anything it
/// panics with.
///
/// Separate from [`parse_guarded`] so the calibration tests can pick the stack themselves
/// — the whole point of those tests is to exercise a stack the production formula derives
/// rather than the one it clamps to.
pub fn on_stack<T: Send>(
    stack_bytes: usize,
    work: impl FnOnce() -> T + Send,
) -> Result<T, ParseRefusal> {
    std::thread::scope(|scope| {
        let spawned = std::thread::Builder::new()
            .stack_size(stack_bytes)
            .spawn_scoped(scope, move || {
                std::panic::catch_unwind(AssertUnwindSafe(work))
            });
        // `Builder::spawn_scoped` returns `Err` where `thread::spawn` would panic. That
        // difference is the reason it is used: a machine out of threads must degrade this
        // file to size-only, not take out an analysis that is already past the run it
        // describes.
        let Ok(handle) = spawned else {
            return Err(ParseRefusal::ThreadUnavailable);
        };
        match handle.join() {
            Ok(Ok(value)) => Ok(value),
            // The panic was caught on the parse thread; the payload is deliberately
            // dropped rather than re-raised, unlike gg's transpiler, because there the
            // caller is one model turn and here it is one file out of thousands.
            Ok(Err(_)) | Err(_) => Err(ParseRefusal::Panicked),
        }
    })
}

#[cfg(test)]
#[path = "caps.test.rs"]
mod tests;
