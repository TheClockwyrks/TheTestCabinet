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
//! 2. [`bracket_nesting_depth`] prescans for the bracket shapes — round, square, curly
//!    **and angle** — which are both the ones a runaway generation actually produces and
//!    by far the most expensive per level. Over [`MAX_BRACKET_NESTING`] the file is
//!    size-only.
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
//! and 128 KiB is the largest file for which the derived stack still fits under
//! [`MAX_PARSE_STACK_BYTES`].
//!
//! The measurement has to be made against the shape that costs the **fewest source bytes
//! per recursion level**, because the derivation is per *byte* and the parser recurses per
//! *level*. A shape that spends two bytes per level halves the demand the measurement sees,
//! so calibrating against one certifies a constant roughly twice as small as the caps
//! actually admit — which is how an earlier derivation, calibrated against a spaced `- `
//! chain, shipped a figure that a plain `*` deref chain in an ordinary 17 KB file walked
//! straight through. Every figure below is now measured against a one- or two-byte-per-level
//! shape, and the tests that assert them use those shapes too.

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
/// `bytes × STACK_BYTES_PER_SOURCE_BYTE × STACK_SAFETY_FACTOR`, and at 128 KiB that is
/// ~2.1 GiB — just under [`MAX_PARSE_STACK_BYTES`]. **A larger byte cap would silently
/// clamp, and the derivation would stop covering the worst shape the cap admits.** Raise
/// them together or not at all, and bump the analyzer version when you do, because a cap
/// change is a definition change.
///
/// It was 256 KiB in the first generation, against a per-byte figure measured on a shape
/// that cost two source bytes per recursion level. `syn` is several times hungrier than
/// that figure admitted, so the cap came down with the constant going up rather than the
/// stack ceiling going up alone: a file this large that is *entirely* degenerate already
/// asks for gigabytes of real, touched stack, and the point of a cap is to refuse that
/// file, not to reserve more address space for it.
pub const MAX_PARSED_FILE_BYTES: usize = 128 * 1024;

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

/// The deepest `(`, `[`, `{`, `<` or closure-`|` nesting either front end will parse.
///
/// Real code nests fewer than ten levels. Two hundred is twenty times that, and still well
/// under the shallowest depth at which `oxc` was measured to overflow a 2 MiB stack (985
/// levels of `{a:`). Bracket shapes are both the cheapest for a model to emit by accident
/// and the most expensive per level, which is why they get a bound of their own instead of
/// being left to the stack.
///
/// **Angle brackets are in the count**, and they are the reason the bound is load-bearing
/// rather than belt-and-braces: a nest of one-character generics (`A<A<A<…i32…>>>`) costs
/// `syn` ~51 KiB of stack per level in the dev profile for three source bytes, which is
/// three times what the byte derivation provides and the hungriest shape either front end
/// was measured at. Refusing it here is what lets [`STACK_BYTES_PER_SOURCE_BYTE`] be sized
/// for the *unbracketed* shapes alone. The cost of counting `<` is over-counting a
/// comparison-heavy file, and over-counting only refuses a file that would have parsed —
/// scanning this repository's 7,305 TypeScript and Rust files put the deepest naive angle
/// nesting at **25**, an eighth of the bound.
pub const MAX_BRACKET_NESTING: u32 = 200;

/// Bytes of stack per byte of source, measured against the **hungrier of the two front
/// ends** in the **dev** profile.
///
/// One constant covers both front ends deliberately. `syn` is several times hungrier per
/// level than `oxc`, and a per-front-end pair would buy nothing: the reservation is virtual,
/// untouched pages never fault in, and a TypeScript file being handed a stack sized for a
/// Rust one costs exactly nothing at run time. So the figure is the maximum, and the
/// TypeScript calibration test asserts `oxc` still fits inside it.
///
/// Every candidate was measured by bisecting the file size at which `tcab analyze` aborts,
/// with the stack the production derivation gives that size. Per **source byte**, worst
/// first, for the shapes the nesting prescan does *not* refuse:
///
/// | Shape | Front end | Bytes/level | Stack/level | **Stack/source byte** |
/// | --- | --- | --- | --- | --- |
/// | `\|\|\|\|…1` (closure chain) | `syn` | 2 | ~17.2 KiB | **8,595** |
/// | `***…x` (deref chain) | `syn` | 1 | ~4.4 KiB | 4,388 |
/// | `!!!…x` (prefix not) | `syn` | 1 | ~4.4 KiB | 4,388 |
/// | `(((…` hidden behind `//` | `syn` | 2 | ~14.2 KiB | 4,705 |
/// | `a!!!…` (postfix non-null) | `oxc` | 1 | ~1.3 KiB | 1,261 |
///
/// The shapes that outrun this — a `syn` generic nest at ~51 KiB per level for three source
/// bytes — are refused by [`MAX_BRACKET_NESTING`] before the parser is entered, which is why
/// that prescan now counts angle brackets. The closure chain is refused there too, but it
/// stays at the head of this table because the prescan counts a *run* of `|` and a comment
/// between two of them breaks the run: a file that reaches the parser having fooled the
/// prescan is the case this figure carries on its own.
///
/// **A second hazard, found measuring the first, and the reason the prescan counts `|`.**
/// The closure chain does not *overflow* on this stack — it takes time quadratic in its
/// depth. The Rust front end asks `syn` for a closure's span, and computing a compound
/// node's span re-serializes its whole subtree, so `n` nested closures re-walk `O(n²)`
/// tokens: sixteen thousand levels take about a minute in the dev profile, and a file at
/// the byte cap would not finish. There is no wall-clock budget in this path *by design*
/// (see the module docs on determinism), so a slow parse is not something a timeout can
/// rescue and the shape has to be refused before it starts. [`MAX_BRACKET_NESTING`] does
/// that now. The underlying quadratic is a defect in the front end's line accounting — the
/// fix is to take a node's start and end from its own cheap delimiter tokens rather than
/// from `Spanned` — and every *other* deep nest already carries a brace, so the prescan
/// bounds those at two hundred levels regardless.
///
/// It is the dev-profile figure deliberately: an unoptimised frame is several times fatter
/// than an optimised one (`syn`'s generic nest measured under a quarter of the dev cost in
/// `release`), the test suite runs unoptimised, and the margin has to hold for the build a
/// developer runs — `tcab analyze` is a shipped command — as well as for the one a run
/// container gets.
pub const STACK_BYTES_PER_SOURCE_BYTE: usize = 8_600;

/// The multiplier applied on top of [`STACK_BYTES_PER_SOURCE_BYTE`].
///
/// **This is not slack; it is the allowance for the shapes nobody enumerated.** The
/// per-byte figure is a maximum over the degenerate shapes that were actually measured, and
/// neither grammar is small enough for that list to be a proof. Doubling it means a shape
/// twice as hungry as the worst one found still parses, and it is what covers the two known
/// ways the nesting prescan can be *under*-counted — a closer hidden inside a comment or a
/// string literal — at the ~4,705 bytes per source byte such a file was measured to demand.
///
/// The factor is deliberately a separate constant from the measurement so that re-measuring
/// one does not quietly re-decide the other.
pub const STACK_SAFETY_FACTOR: usize = 2;

/// The floor on a derived parse stack.
///
/// Below about 4 KiB of source the derivation asks for less than this, and there is no
/// reason to reserve less: the reservation is virtual, untouched pages never fault in, and
/// a thread costs the same tens of microseconds to spawn whatever its stack size.
pub const MIN_PARSE_STACK_BYTES: usize = 64 * 1024 * 1024;

/// The ceiling on a derived parse stack.
///
/// [`MAX_PARSED_FILE_BYTES`] is chosen so the derivation never actually reaches this — it
/// tops out at ~2.1 GiB — so the clamp is a backstop against a future cap change made
/// without reading [`MAX_PARSED_FILE_BYTES`]'s documentation, not a live bound.
///
/// Four gibibytes of *reservation* is not four gibibytes of memory: the mapping is
/// anonymous and lazily faulted, so a thread that recurses ten levels touches two pages of
/// it. A parse that genuinely walked the whole reservation would be a file the caps should
/// have refused, and a host that cannot reserve it at all reports
/// [`ThreadUnavailable`](ParseRefusal::ThreadUnavailable) and degrades that one file to
/// size-only.
pub const MAX_PARSE_STACK_BYTES: usize = 4 * 1024 * 1024 * 1024;

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

/// The deepest `(`, `[`, `{` or `<` nesting in `source`, by a single byte scan.
///
/// Deliberately naive — it does not skip string literals or comments — for two reasons.
/// Over-counting is safe: it only refuses a file that would have parsed, and that file is
/// still counted for size. Under-counting is *possible* (a closer inside a string literal
/// cancels a real opener) but is covered by [`STACK_SAFETY_FACTOR`], which is sized against
/// the measured cost of exactly that file. A lexer here would buy accuracy the safety
/// argument does not need, and would itself have to be correct for two languages.
///
/// Angle brackets are counted on a **separate** running depth that is summed with the
/// round/square/curly one, rather than sharing a counter with it. Sharing would let `a > b`
/// pop a real `{`, which under-counts in the one direction that matters; summing two
/// independent counters can only over-count, and a file where both nests are genuinely deep
/// does demand both. `->`, `=>` and every comparison decrement the angle counter, which is
/// why ordinary source stays two orders of magnitude clear of
/// [`MAX_BRACKET_NESTING`] — the deepest naive angle nesting in this repository is 25.
///
/// A **run of `|`** counts too, because a Rust closure chain (`||||||…1`) is a nest whose
/// levels have no closer to balance them: `n` closures nest `n` deep and the counting
/// scheme above would see zero. It is measured as a run rather than a depth for the same
/// reason. Whitespace does not break the run — `|| || ||` is the same nest spelled wider —
/// and anything else resets it, so `a || b || c` never exceeds two, the longest run in all
/// 7,305 source files in this repository. The run is counted per `|` rather than per pair,
/// so a chain of `n` closures scores `2n`: an over-count, which is the safe direction, and
/// one that bounds closure nesting at a hundred rather than two hundred levels.
pub fn bracket_nesting_depth(source: &str) -> u32 {
    let mut brackets: u32 = 0;
    let mut angles: u32 = 0;
    let mut closures: u32 = 0;
    let mut deepest: u32 = 0;
    for byte in source.bytes() {
        match byte {
            b'(' | b'[' | b'{' => brackets = brackets.saturating_add(1),
            b')' | b']' | b'}' => {
                brackets = brackets.saturating_sub(1);
                closures = 0;
                continue;
            }
            b'<' => angles = angles.saturating_add(1),
            b'>' => {
                angles = angles.saturating_sub(1);
                closures = 0;
                continue;
            }
            b'|' => closures = closures.saturating_add(1),
            b' ' | b'\t' | b'\r' | b'\n' => continue,
            _ => {
                closures = 0;
                continue;
            }
        }
        if byte != b'|' {
            closures = 0;
        }
        deepest = deepest.max(brackets.saturating_add(angles).saturating_add(closures));
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

    /// Whether `token` names a file the **guard** turned away before a front end could
    /// judge it, as opposed to one a front end saw and could not read.
    ///
    /// The distinction is the whole point of the
    /// [`filesRefused`](test_cabinet_core::CodeAnalysisNotes::files_refused) note. "Could
    /// not parse" is a fact about the model's output; "was not offered to the parser" is a
    /// fact about *this analysis*, and a reader has to be able to tell how much of the tree
    /// the parsed-only metrics were computed over. Written as a match over the variants
    /// rather than a token list so a new refusal cannot be added without classifying it.
    pub fn is_guard_refusal(token: &str) -> bool {
        [
            Self::OverByteCap,
            Self::OverNestingCap,
            Self::ThreadUnavailable,
            Self::Panicked,
        ]
        .into_iter()
        .find(|refusal| refusal.as_str() == token)
        .is_some_and(|refusal| match refusal {
            Self::OverByteCap | Self::OverNestingCap | Self::ThreadUnavailable => true,
            // The parser was entered. Counted under `filesUnparsable` instead.
            Self::Panicked => false,
        })
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
