//! **The bound on what a compiler is allowed to say to a model** — the shared capping an arm's
//! verdict puts its diagnostics through on the way to becoming context.
//!
//! Nothing downstream of an arm shortens anything. [`PrepareError::Compile`](super::PrepareError)
//! carries the arm's string, its `Display` is that string and nothing else, `CodeFeedback::compiler`
//! is built straight from it, and the next request to the model carries it verbatim. So the size of
//! a compiler's opinion is decided in exactly one place — the arm that renders it — and this module
//! is what the arms decide it with.
//!
//! # Why there is a bound at all
//!
//! A model reads its compiler errors out of its own context window, and it pays for every byte of
//! them twice: once in the request that carries them and again in every request after, because the
//! turn stays in the transcript. A rejected program has already cost a turn. What this module is
//! about is how much of the **next** turn it also costs.
//!
//! One ordinary mistake — a misremembered SDK name, called at fifty call sites — measured on this
//! machine, against these arms' real toolchains, on this checkout:
//!
//! | arm | bytes | lines | |
//! | --- | --- | --- | --- |
//! | [Swift](super::swift) | 11614 | 395 | uncapped |
//! | [Rust](super::rust) | 5982 | 201 | uncapped |
//! | [Java](super::java) | 5139 | 199 | uncapped |
//! | [C#](super::csharp) | 4840 | 50 | uncapped |
//! | [TypeScript](super::typescript) | 3390 | 50 | uncapped |
//! | [PureScript](super::purescript) | 3139 | 149 | uncapped |
//! | [C++](super::cpp) | 2789 | 59 | **capped** |
//! | [Kotlin](super::kotlin) | 475 | 17 | **capped** |
//!
//! Eleven kilobytes is roughly three thousand tokens spent on fifty copies of one sentence, and the
//! sentence is the same one at every call site. It is not that the model is told too much; it is
//! that it is told one thing fifty times and has to read all fifty to find out that is what
//! happened. The two capped rows are the same measurement taken through a cap, and they are the
//! argument: Kotlin's arm reports the identical mistake in 475 bytes and the model can act on all
//! of it.
//!
//! # Why two functions and not one
//!
//! Because the arms hold their diagnostics in two shapes, and neither can be converted to the other
//! without inventing structure or throwing it away.
//!
//! * An arm whose compiler reports **machine-readable** diagnostics — `rustc`'s JSON, javac's and
//!   `csc`'s and `purs`'s structured output — already has a `Vec` of separately
//!   rendered strings, and knows where one ends. That is [`capped`].
//! * An arm whose compiler reports **text** — `swiftc`, `tsc`'s pretty output — has one string in
//!   which a diagnostic is a header line followed by a source excerpt, a caret, and sometimes notes.
//!   Splitting that into items would mean re-deriving the grouping the compiler already expressed by
//!   indentation, and joining it back afterwards would mean guessing at the separator. That is
//!   [`capped_lines`], which caps the groups in place and never touches the text.
//!
//! # Why the C++ arm does not use either
//!
//! [`cpp::capped`](super::cpp) is group-shaped and stays its own, because it does two things this
//! module deliberately does not. It **sub-caps the notes under one error**, since a `note:` on that
//! arm is not context but frequently *the* diagnostic — a template error is reported inside libc++
//! and the model's own line arrives as `note: in instantiation of … requested here`. And it
//! **exempts any diagnostic naming a file somebody authored, at any depth**, for the same reason:
//! the one line the model can act on can sit thirty notes into a backtrace. That is not a general
//! shape, it is what C++'s instantiation backtraces are, and it is already correct and already
//! tested. Its own measurement is the case for keeping it: `std::format("exit {}", v)` with `v` a
//! `std::optional<int>` is 18 KB across 8 errors and 34 notes uncapped, and 5807 bytes across 65
//! lines through that arm's cap — a bound this module's [`capped_lines`] could not have reached
//! without keeping the wrong sixty-five lines.
//!
//! # What is not decided here
//!
//! **How many.** `shown` is an argument rather than a constant, because what a diagnostic costs is
//! the arm's fact and not this module's: a Kotlin diagnostic is one line, so eight of them is
//! seventeen lines; a Swift diagnostic drags an excerpt and a caret behind it, so eight of those is
//! a screen. Each arm names its own constant and says why, next to the compiler it measured.
//!
//! **What an arm's diagnostic says.** The [supporting material](supporting) a failure carries is
//! drawn from the arm's library set by matching the imports the diagnostic could not resolve, and
//! which words those are is the arm's fact: each reads them out of its own compiler's wording
//! through [`unresolved_imports`](super::ProgramLanguage::unresolved_imports). What this module
//! owns is the matching, the rendering and the one bound both go through.
//!
//! **Whether an arm needs a bound at all.** Three registered arms are absent from the table above
//! and none of them is an oversight. [Ruby](super::ruby)'s Opal driver catches a single thrown
//! `SyntaxError` and reports it, so a rejection is structurally one diagnostic and there is no list
//! to cap. [Python](super::python) runs no checker on the prepare path, so it raises no compile
//! band at all — a syntax error arrives at run time as a located program error from the guest.
//! [JavaScript](super::javascript) prepares nothing at all, so it raises no compile band either —
//! everything a program on it gets wrong arrives from the guest.

/// The line a model is shown in place of what it was not shown.
///
/// One wording for both shapes, and it is [Kotlin's](super::kotlin) unchanged, because that arm has
/// been printing it since before there was a second arm to share it with and its tests assert the
/// text. Three things it is careful to be:
///
/// * a **count**, not an ellipsis — a model that needs the rest can tell there is a rest, and how
///   much of one, which is the difference between a bound and a truncation;
/// * a count of what the **caller** dropped, which is not the same number in each shape and is
///   worth saying rather than glossing: [`capped`] counts survivors of its de-duplication, so a
///   repetition it folded is not counted twice; [`capped_lines`] does not de-duplicate at all and
///   counts groups as the compiler wrote them; [`supporting`] counts library names. Each is honest
///   about its own input, and none claims to be another;
/// * "like these" rather than "more errors", because on the shapes that reach here the dropped
///   items are *usually* the tail of a list the kept ones open — the [measurement](self) is of one
///   mistake repeated — and because saying "errors" would be wrong on the arms whose lists are of
///   notes or of warnings promoted to errors. Where it overclaims is a program with more than
///   `shown` **genuinely distinct** mistakes: those dropped items are not like these, and the model
///   is told a count instead of a diagnostic. That is a real cost and it is the one this bound
///   trades for, on the same terms [C++](super::cpp) and [Kotlin](super::kotlin) already traded it.
fn more(dropped: usize) -> String {
    format!("… and {dropped} more like these.")
}

/// **Bound a list of separately rendered diagnostics** — the shape an arm has when its compiler
/// reports structure rather than text.
///
/// De-duplicates first, keeps the first `shown` survivors, joins them with `separator`, and — if
/// anything was dropped — closes with [one more line](more) counting it.
///
/// The de-duplication is not tidiness and it is not free of judgement: it folds **byte-identical**
/// renderings only. That is exactly the case the [measurement above](self) is of — TeaVM reports one
/// problem per call site, so a single unsupported call arrives forty-five times with the same
/// message at different lines inside the standard library — and it is deliberately not extended to
/// "the same message at different locations", because on every other arm those locations are the
/// list of places the model has to go and fix. An arm that wants locations folded should render them
/// folded and hand the folded list here.
///
/// Two properties a caller must know:
///
/// * it **does not trim**, at either end or between entries. What an arm renders is what the model
///   reads, whitespace included, because an excerpt and a caret only line up if nothing touched
///   them;
/// * order is **first-seen**, never sorted. A compiler reports in the order it found things, which
///   is the order a model reads the file in.
///
/// `shown == 0` is a legal request for "tell it only the count", and produces the count line alone
/// with no leading separator. An empty list produces an empty string — an arm that has no
/// diagnostics has nothing to say, and this is not the place that decides whether that was a
/// toolchain failure.
pub(super) fn capped(rendered: Vec<String>, shown: usize, separator: &str) -> String {
    // Linear scan rather than a hash set: this is quadratic in the number of DISTINCT renderings,
    // which is the number the whole module exists to observe is small, and a set would have to own
    // or clone every string to save comparisons that cost nothing at this size.
    let mut seen: Vec<String> = Vec::with_capacity(rendered.len());
    for entry in rendered {
        if !seen.contains(&entry) {
            seen.push(entry);
        }
    }
    let dropped = seen.len().saturating_sub(shown);
    seen.truncate(shown);
    if dropped > 0 {
        seen.push(more(dropped));
    }
    seen.join(separator)
}

/// **Bound a compiler's own text, in place** — the shape an arm has when a diagnostic is several
/// lines and the compiler expressed the grouping by writing them together.
///
/// `opens` decides where a diagnostic begins: a line it answers `true` for starts a new group, and
/// every other line belongs to the group above it. The first `shown` groups are kept whole and the
/// rest are replaced by [one line](more) counting them.
///
/// Three things it is careful about:
///
/// * whatever precedes the **first** opening line is a preamble and is always kept. On the text
///   arms that is where a driver's own failure lands — a note about a tool it could not find,
///   printed before it had a diagnostic to attach it to — and dropping it would leave a model
///   reading about its program when the sentence was about the machine;
/// * the text is **never re-wrapped, re-indented or trimmed**. A group is exactly the lines the
///   compiler wrote, in order, including the blank ones: an excerpt and a caret are a picture, and a
///   picture survives being cut but not being reflowed;
/// * the count line goes on a line of its own, and does not add a blank one — if the kept text
///   already ends at a line boundary, that boundary is the one it starts after.
///
/// Text with **no** opening line at all is returned unchanged, whatever `shown` is. That is not an
/// edge case to be tolerated but the correct answer: a compiler that said something this arm's
/// `opens` does not recognise has said one thing, and cutting a thing there is no evidence is a
/// group of would be gg discarding a diagnostic it did not understand.
///
/// `shown == 0` keeps the preamble and counts every group, which is the same "tell it only the
/// count" [`capped`] offers.
///
/// Splitting is on `\n` rather than through `str::lines`, because this function's whole promise is
/// that what it did not drop it did not touch: `lines` eats a trailing newline and a `\r` before
/// each one, so a round trip through it would edit text on the way past.
pub(super) fn capped_lines(rendered: &str, opens: impl Fn(&str) -> bool, shown: usize) -> String {
    let mut kept: Vec<&str> = Vec::new();
    let mut groups = 0usize;
    let mut dropped = 0usize;
    // True until proven otherwise, which is what makes the preamble kept: it belongs to no group, so
    // no group's fate applies to it.
    let mut showing = true;

    for line in rendered.split('\n') {
        if opens(line) {
            groups += 1;
            showing = groups <= shown;
            if !showing {
                dropped += 1;
            }
        }
        if showing {
            kept.push(line);
        }
    }

    let mut text = kept.join("\n");
    if dropped > 0 {
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(&more(dropped));
    }
    text
}

/// **The bound every arm holds its supporting material to**, in bytes of UTF-8.
///
/// One constant rather than an argument, which is the whole difference between this and `shown`: a
/// diagnostic's cost is the arm's own fact, and what a rejection may spend on material *about* the
/// arm is not. A cross-language study compares what a compile failure cost the next turn, so the
/// number an arm may spend on it is the one number in this module an arm may not restate.
///
/// Bytes rather than entries, because the arms' entries differ by an order of magnitude —
/// `<vector>` against `Control.Comonad.Cofree.Class` — so a count of entries bounds nothing
/// comparable. 1024 is roughly 256 tokens, and it is above every arm's whole declared set but
/// [PureScript's](super::purescript), which is 4893 bytes of module names on every rejection and is
/// the measurement this bound exists for.
pub const SUPPORTING: usize = 1024;

/// **Every value a line writes between `opens` and the next `closes`**, in the order they appear.
///
/// The one piece of parsing this module offers the arms. Each names an unresolved import in a
/// wording of its own — ``unresolved import `serd` ``, `package java.utl does not exist`,
/// `no such module 'Algorithm'` — and each of those is one value between two delimiters. Which
/// sentence and which delimiters is the arm's fact; scanning for them is not, and seven copies of
/// this loop would be seven places for an off-by-one.
///
/// An empty value is skipped, so a pair of adjacent delimiters names nothing. An `opens` with no
/// `closes` after it ends the scan, because a delimiter a line never closed is a sentence this arm
/// did not recognise rather than a name running to the end of it.
pub(super) fn named(line: &str, opens: &str, closes: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut rest = line;
    while let Some(at) = rest.find(opens) {
        let after = &rest[at + opens.len()..];
        let Some(end) = after.find(closes) else {
            break;
        };
        if end > 0 {
            found.push(after[..end].to_string());
        }
        rest = &after[end + closes.len()..];
    }
    found
}

/// The heading over the whole set.
const WHOLE: &str = "Libraries available to your program:";

/// The heading over the modules that match what a program could not import.
const MATCHED: &str = "Libraries available to your program that match what it imported:";

/// **The supporting material a compile failure carries** — the modules of this arm's library set
/// that answer the diagnostic, rendered as the lines a model reads under the `Compiler error`
/// heading and [bounded](SUPPORTING).
///
/// `unresolved` is what the arm read out of its own diagnostic
/// ([`unresolved_imports`](super::ProgramLanguage::unresolved_imports)). Where any of those names
/// [matches](matched) a module the catalogue declares, the material is those modules. Where the
/// diagnostic named none, or none of them matched, it is the whole set: a program that named
/// nothing recognisable is the one with most to learn from the inventory.
///
/// `None` for an arm whose catalogue declares no set, which is the arm whose programs get their
/// runtime's own standard library and nothing else: there is no set to quote, and a heading over an
/// empty list would be a sentence about nothing.
///
/// # Why it rides a compile failure rather than the prompt
///
/// It used to be a section of every arm's system prompt, read on every turn of every run whether or
/// not the model ever reached for a library. What it prevents is one mistake — a program written
/// against a package this arm does not carry — and that mistake is **detected**, by the compiler, on
/// the turn that made it. So it is delivered there: a model that never writes an import never reads
/// it, and the one that did reads it beside the diagnostic that made it relevant.
///
/// It is quoted from [`libraries`](super::super::signatures::SignatureCatalogue::libraries) rather
/// than authored, for the reason every model-facing word about an arm's surface is: a second copy of
/// the set, written in prose, drifts from the artifact that decides it with nothing to catch it.
///
/// # Why cutting it is honest here
///
/// A dropped library name would read as a library the arm does not have, which is exactly the false
/// negative the set is carried to prevent — so nothing is dropped silently. Whole names are dropped
/// off the end and the block closes with [the count](more), and the names most likely to be dropped
/// are the ones the diagnostic did not ask about.
pub fn supporting(
    catalogue: &super::super::signatures::SignatureCatalogue,
    unresolved: &[String],
) -> Option<String> {
    if catalogue.libraries.is_empty() {
        return None;
    }
    let whole: Vec<(&str, Vec<&str>)> = catalogue
        .libraries
        .iter()
        .map(|group| {
            (
                group.group.as_str(),
                group.modules.iter().map(String::as_str).collect(),
            )
        })
        .collect();
    match candidates(&whole, unresolved) {
        Some(matched) => Some(block(MATCHED, &matched)),
        None => Some(block(WHOLE, &whole)),
    }
}

/// The groups of `whole` reduced to the modules `unresolved` [matches](matched), with the empty
/// groups dropped — or `None` when nothing matched, which is what asks for the whole set.
///
/// Catalogue order is kept, both between groups and inside them, so a model reads the candidates in
/// the shape the set itself has.
fn candidates<'a>(
    whole: &[(&'a str, Vec<&'a str>)],
    unresolved: &[String],
) -> Option<Vec<(&'a str, Vec<&'a str>)>> {
    if unresolved.is_empty() {
        return None;
    }
    let picked: Vec<(&str, Vec<&str>)> = whole
        .iter()
        .filter_map(|(group, modules)| {
            let kept: Vec<&str> = modules
                .iter()
                .copied()
                .filter(|module| unresolved.iter().any(|name| matched(module, name)))
                .collect();
            (!kept.is_empty()).then_some((*group, kept))
        })
        .collect();
    (!picked.is_empty()).then_some(picked)
}

/// **Whether a catalogue module answers a name a program could not import.**
///
/// One rule for every arm, because a similarity rule per arm is eleven different standards for the
/// same question. Three ways to match, and each answers a different mistake:
///
/// * the module **is** the name, so the arm carries it and the diagnostic is about something else,
///   which is the most informative of the three;
/// * one **extends** the other at a path separator — the module the name reached into
///   (`java.util` for `java.util.List`), or the modules under a namespace the program named
///   (`kotlin.math` for `kotlin`);
/// * their **last segments** are within two edits, which is the misspelling this whole path exists
///   for. Segments shorter than three characters are held to equality instead, since two edits over
///   three letters is not a resemblance.
///
/// Both sides are normalised first: a compiler quotes a name (`'Algorithm'`), a C++ catalogue spells
/// a module with its brackets (`<vector>`), and neither punctuation is part of the name. Comparison
/// is case-insensitive throughout, because a misremembered name is as often miscased as misspelt.
fn matched(module: &str, name: &str) -> bool {
    let module = segments(module);
    let name = segments(name);
    if module.is_empty() || name.is_empty() {
        return false;
    }
    if module == name {
        return true;
    }
    if module.len() < name.len() && name.starts_with(&module[..]) {
        return true;
    }
    if name.len() < module.len() && module.starts_with(&name[..]) {
        return true;
    }
    let (last, other) = (
        module.last().expect("checked non-empty"),
        name.last().expect("checked non-empty"),
    );
    let short = last.chars().count().min(other.chars().count());
    short >= 3 && edits(last, other) <= 2
}

/// A module path or an imported name as its comparable segments: lower-cased, with the punctuation a
/// compiler or a catalogue wraps around a name removed, split on every separator the arms spell a
/// path with.
fn segments(path: &str) -> Vec<String> {
    path.trim()
        .trim_matches(['<', '>', '\'', '"', '`', ';', ',', '.'])
        .split(['.', '/'])
        .flat_map(|part| part.split("::"))
        .filter(|part| !part.is_empty())
        .map(str::to_lowercase)
        .collect()
}

/// The Levenshtein distance between two segments, counted in characters.
///
/// One row of the matrix at a time: the inputs are one path segment each, so the cost is a handful
/// of comparisons and the allocation is what would dominate a cleverer version.
fn edits(left: &str, right: &str) -> usize {
    let right: Vec<char> = right.chars().collect();
    let mut previous: Vec<usize> = (0..=right.len()).collect();
    let mut current = vec![0usize; right.len() + 1];
    for (row, from) in left.chars().enumerate() {
        current[0] = row + 1;
        for (column, to) in right.iter().enumerate() {
            let substitution = previous[column] + usize::from(from != *to);
            current[column + 1] = substitution
                .min(previous[column + 1] + 1)
                .min(current[column] + 1);
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[right.len()]
}

/// Render `groups` under `heading`, dropping whole module names off the end until the block fits
/// [`SUPPORTING`] and closing with [the count](more) of what went.
///
/// Whole names, never a prefix of one: a truncated module name is a library nobody has, and the
/// count is what keeps a cut set from reading as the arm's whole inventory.
fn block(heading: &str, groups: &[(&str, Vec<&str>)]) -> String {
    let total: usize = groups.iter().map(|(_, modules)| modules.len()).sum();
    let mut kept = total;
    loop {
        let rendered = render(heading, groups, kept, total - kept);
        if kept == 0 || rendered.len() <= SUPPORTING {
            return rendered;
        }
        kept -= 1;
    }
}

/// The block as a model reads it: the heading, a blank line, one line per group that kept anything,
/// and the count line when `dropped` is not zero.
fn render(heading: &str, groups: &[(&str, Vec<&str>)], kept: usize, dropped: usize) -> String {
    let mut budget = kept;
    let mut lines: Vec<String> = Vec::new();
    for (group, modules) in groups {
        if budget == 0 {
            break;
        }
        let take = budget.min(modules.len());
        lines.push(format!("- {group}: {}", modules[..take].join(", ")));
        budget -= take;
    }
    let mut text = format!("{heading}\n\n{}", lines.join("\n"));
    if dropped > 0 {
        if !lines.is_empty() {
            text.push('\n');
        }
        text.push_str(&more(dropped));
    }
    text
}

#[cfg(test)]
#[path = "diagnostics.test.rs"]
mod tests;
