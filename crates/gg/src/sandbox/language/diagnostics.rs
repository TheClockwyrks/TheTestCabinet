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
//! **Whether the library set is cut.** It is not — see [`library_set`], which is the one thing this
//! module renders rather than bounds, and the paragraph there is the argument.
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
/// * a count of what the **caller** dropped, which is not the same number in both shapes and is
///   worth saying rather than glossing: [`capped`] counts survivors of its de-duplication, so a
///   repetition it folded is not counted twice; [`capped_lines`] does not de-duplicate at all and
///   counts groups as the compiler wrote them. Both are honest about their own input, and neither
///   claims to be the other;
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

/// **The library set a compile failure is answered with** — every group the arm's catalogue
/// declares, rendered as the lines a model reads under the `Compiler error` heading.
///
/// `None` for an arm whose catalogue declares no set, which is the arm whose programs get their
/// runtime's own standard library and nothing else: there is no set to quote, and a heading over an
/// empty list would be a sentence about nothing.
///
/// # Why it rides a compile failure rather than the prompt
///
/// It used to be a section of every arm's system prompt, read on every turn of every run whether or
/// not the model ever reached for a library. What it prevents is one mistake — a program written
/// against a package this arm does not carry — and that mistake is **detected**, by the compiler,
/// on the turn that made it. So it is delivered there: a model that never writes an import never
/// reads it, and the one that did reads it beside the diagnostic that made it relevant.
///
/// It is quoted from [`libraries`](super::super::signatures::SignatureCatalogue::libraries) rather
/// than authored, for the reason every model-facing word about an arm's surface is: a second copy
/// of the set, written in prose, drifts from the artifact that decides it with nothing to catch it.
///
/// # Why this one is not bounded
///
/// Everything else this module touches is a **list of mistakes**, which grows with the program: one
/// misremembered name at fifty call sites is fifty diagnostics, and the [bound](self) is what stops
/// a model paying for all fifty. A library set does not grow with the program. It is a fixed fact
/// about the arm — the largest today is PureScript's, at a little under 5 KB — and it is the same
/// size on a program with one mistake and on a program with a hundred.
///
/// Cutting it would also be the one cut here that **lies**. A dropped diagnostic is a diagnostic the
/// model is told the count of and can ask for again by fixing what it was shown; a dropped library
/// name reads as a library the arm does not have, which is exactly the false negative this set is
/// carried to prevent.
pub fn library_set(catalogue: &super::super::signatures::SignatureCatalogue) -> Option<String> {
    if catalogue.libraries.is_empty() {
        return None;
    }
    let groups: Vec<String> = catalogue
        .libraries
        .iter()
        .map(|group| format!("- {}: {}", group.group, group.modules.join(", ")))
        .collect();
    Some(format!(
        "Libraries available to your program:\n\n{}",
        groups.join("\n")
    ))
}

#[cfg(test)]
#[path = "diagnostics.test.rs"]
mod tests;
