//! **The documentation register gate** — the assertion that what an arm's SDK says to a model is
//! written in the register gg chose, and not in whatever register the last person to edit it
//! reached for.
//!
//! # Why this gate exists at all, given how much already checks documentation
//!
//! Every existing check is a check for **presence**. `-Werror=documentation`, `-Xdoclint:all
//! -Werror`, Roslyn's `DocumentationMode.Diagnose`, `-Xexplicit-api=strict`, the reflectors' own
//! refusals to emit a blank, and the [agreement gate](super::agreement)'s blank checks all fail an
//! *absent* description and pass anything else. Not one of them can fail a 1,006-character
//! second-person narrative, a "brief" that is really three paragraphs, or a summary line cut off
//! mid-code-span with an unbalanced backtick — and all three of those are things a model reads
//! today.
//!
//! Nothing else is going to catch them either. The catalogues are reflected out of eleven SDKs by
//! `crates/gg/build.rs` on the build that embeds them and are committed nowhere, so there is no
//! artifact a reviewer eyeballed on the way in and no diff in which a paragraph that grew by 800
//! characters shows up. This gate reads the text a model will actually be handed, minutes after the
//! reflector produced it, which is the only place left that a badly shaped sentence can be stopped.
//!
//! So the register is checked here: **once, in Rust, over the normalized catalogue**, rather than
//! eleven times in eleven reflectors written in eleven languages. That is the entire reason the
//! catalogue is normalized. A policy about *text* can have one implementation, and the twelfth arm
//! inherits it by existing rather than by reimplementing it.
//!
//! # It checks shape, and never length parity across arms
//!
//! Nothing here compares one arm's prose to another's, and nothing may be added that does. A C++
//! brief that has to say something about ownership where Python's does not is a real difference
//! between two languages, not a defect in the longer one, and a rule that pulled them level would be
//! a rule forbidding an arm from being idiomatic — the exact confound the whole reshape exists to
//! remove. What is checked is that a brief is **one line**, that it is **short**, that its code
//! spans **close**, and that it does not read as a fragment torn off a paragraph. Every one of those
//! is answerable by looking at one string.
//!
//! # Why it returns complaints rather than asserting them
//!
//! For the reason the [agreement gate](super::agreement) does: a gate that only panics can be shown
//! to pass and cannot be shown to *catch* anything. Returning the list also means a conversion sweep
//! sees every complaint at once rather than one per run, which is the difference between one pass
//! over an SDK and forty.
//!
//! # The one thing it checks that is not prose
//!
//! An entry whose [operation id](crate::sandbox::operations) resolves to nothing is documentation
//! **no model ever reads**, and that is the most complete failure of register there is: not prose in
//! the wrong voice but prose in no voice, because the entry is dropped before anything renders it.
//! The documentation index skips it, [`bound`](crate::docs::DocsRuntime::bound)
//! refuses it, and the function it documents is absent from search, from every directory and from
//! every documentation view — on a green build, because every one of those paths treats an
//! unresolvable operation as *not offered* rather than as *wrong*, which is the correct thing for a
//! run to do and the wrong thing for nobody to notice.
//!
//! Each arm writes ~47 of these ids by hand, so the failure is a keystroke away, and the
//! symptom — one capability quietly missing from a model's surface — is invisible in a diff and
//! invisible in a run. So it is caught here, beside the other rules about what an arm puts in front
//! of a model, and it names the id it could not resolve.

use std::fmt;

use test_cabinet_core::gg::GgProgramLanguage;

use crate::sandbox::operations::operation_by_id;
use crate::sandbox::signatures::{Parameter, Prose, SignatureCatalogue};

/// The longest a brief may be, in characters.
///
/// A single line should never approach it — the briefs in the fixture run to about fifty — and it is
/// enforced regardless, because the failure it catches is not a long sentence but a **paragraph
/// pasted into the brief field**, which is what happens when the person editing the prose does not
/// know the field is a brief. It is a cap on shape rather than an opinion about how many words a
/// language needs.
const BRIEF_CAP: usize = 120;

/// The longest a detailed description may be, in characters — generous, and a sanity bound rather
/// than a budget: what it catches is a whole document filed as one entry's detail.
const DETAIL_CAP: usize = 2_000;

/// How many consecutive all-capital words make a run **emphasis** rather than **vocabulary**.
///
/// Three, and see [`shouting`] for why two is not available: an SDK documenting wire formats writes
/// `HTTP JSON` and `ASCII TEXT`, and nothing about either string distinguishes it from `NEVER SHOWS`.
const SHOUTED_RUN: usize = 3;

/// The longest a word may be and still read as an **abbreviation** rather than as a word.
///
/// A run made only of these — `SDK API GG` — is a string of abbreviations however long it gets, so a
/// [shouted run](SHOUTED_RUN) needs at least one word longer than this before it is emphasis. It is
/// also why a lone `NOT`, `AND` or `OUT` has never counted.
const ABBREVIATION: usize = 3;

/// The words that make a description address the model in the second person.
///
/// Second person is the register the current prose decayed into — *"This gets bytes for your PROGRAM
/// and puts NOTHING in your context window"* — and it is worth failing rather than merely
/// discouraging, because it is self-propagating: every entry written next to one written that way
/// is written that way.
const SECOND_PERSON: [&str; 3] = ["you", "your", "yours"];

/// The words a brief may not begin with, because a description that opens with one is the **tail of
/// a paragraph** rather than a brief: something was said before it that the model will not be shown.
const CONNECTIVES: [&str; 6] = ["and", "but", "also", "then", "so", "because"];

/// One way a catalogue's prose fails the register, and where.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Complaint {
    /// Whose catalogue it is.
    pub language: GgProgramLanguage,
    /// What the prose belongs to, named the way the arm names it: a fully-qualified name, a module
    /// path, or a member spelled under its type.
    pub subject: String,
    /// What is wrong with it, in a sentence.
    pub detail: String,
}

impl fmt::Display for Complaint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}: {}", self.language, self.subject, self.detail)
    }
}

/// Every way `catalogue`'s documentation departs from the register. Empty is the passing answer.
pub(crate) fn complaints(catalogue: &SignatureCatalogue) -> Vec<Complaint> {
    let mut out = Vec::new();
    let language = catalogue.language;
    // Identity before prose: an entry gg cannot resolve to an operation is an entry no model is
    // shown at all, so it is reported first and in its own words rather than buried under whatever
    // its unreadable brief also does wrong.
    unresolved_operations(catalogue, &mut out);

    let mut check = |subject: String, prose: Prose<'_>, cap: Option<usize>| {
        for detail in faults(prose, cap) {
            out.push(Complaint {
                language,
                subject: subject.clone(),
                detail,
            });
        }
    };

    for module in &catalogue.modules {
        check(
            module.path.clone(),
            Prose::authored(&module.brief, module.detail.as_deref()),
            Some(BRIEF_CAP),
        );
    }

    for function in &catalogue.functions {
        check(
            function.fqn.clone(),
            Prose::authored(&function.brief, function.detail.as_deref()),
            Some(BRIEF_CAP),
        );
        for entry in &function.signatures {
            for parameter in &entry.parameters {
                // A parameter's documentation is a brief and is held to the brief's *shape* — one
                // line, closed code spans, not a torn-off fragment — with no length cap of its own.
                // What a parameter has to say about a path, a selector or a limit is short by
                // nature, and a cap there would be a second opinion about the same thing.
                describe_parameters(
                    &mut check,
                    &format!("{}({})", function.fqn, parameter.name),
                    parameter,
                );
            }
        }
    }

    for declaration in &catalogue.types {
        // The string the declaration is opened by, which is what a complaint has to name if the
        // person reading it is to find the thing.
        let named = declaration.key().to_string();
        check(named.clone(), declaration.prose(), Some(BRIEF_CAP));
        for member in &declaration.members {
            check(
                format!("{named}.{}", member.name),
                member.prose(),
                Some(BRIEF_CAP),
            );
        }
        for member in &declaration.member_functions {
            check(
                member.fqn.clone(),
                Prose::authored(&member.brief, None),
                Some(BRIEF_CAP),
            );
        }
    }

    // One defect, reported once. A language that spells an optional argument as an overload pair
    // documents the same parameter in each shape, so a fault in that one line arrives once per
    // shape — adjacently, since the shapes of one call are walked together. Two identical
    // complaints about one line is noise in a sweep that is meant to be read top to bottom.
    out.dedup();
    out
}

/// Every [operation id](crate::sandbox::operations) `catalogue` names that gg has no row for — on
/// the entries themselves, on their [aliases](crate::sandbox::signatures::FunctionSignature::alias_of),
/// and on the [member functions](crate::sandbox::signatures::MemberFunction) a type lists.
///
/// # Why this is a failure and not a shrug
///
/// Everything downstream reads an unresolvable id as *this agent does not have that operation*,
/// which is the right reading of a real gate and the wrong reading of a typo, and the two are
/// indistinguishable once the entry is gone. The function is then missing from the model's whole
/// surface — no directory lists it, no search returns it, no view opens it — while the SDK still
/// compiles it, still exports it, and still documents it to every human who reads the source. One
/// wrong character costs a whole capability and changes nothing a build or a run can see.
///
/// So the id is checked against the table that defines it, by name, here — where the arm is already
/// being read entry by entry — and the complaint quotes the id it could not resolve, because
/// the whole point is to make a misspelling legible as a misspelling.
///
/// All three sites are checked rather than only the first: an alias and a type's member list are the
/// two places an id is written where **nothing else at all** would notice it, since neither is read
/// by the projection that `every_catalogued_function_has_an_operation` holds every arm to.
fn unresolved_operations(catalogue: &SignatureCatalogue, out: &mut Vec<Complaint>) {
    let language = catalogue.language;
    let mut complain = |subject: &str, detail: String| {
        out.push(Complaint {
            language,
            subject: subject.to_string(),
            detail,
        });
    };

    for function in &catalogue.functions {
        if operation_by_id(&function.operation).is_none() {
            complain(
                &function.fqn,
                format!(
                    "names the operation `{}`, which is not in gg's operations table — an entry gg \
                     cannot resolve is dropped from search, from every directory and from every \
                     documentation view, so this function is absent from the model's surface \
                     entirely",
                    function.operation
                ),
            );
        }
        if let Some(alias) = &function.alias_of
            && operation_by_id(alias).is_none()
        {
            complain(
                &function.fqn,
                format!(
                    "is an alias of the operation `{alias}`, which is not in gg's operations table \
                     — an alias names the operation it is a second way to reach, so one gg does not \
                     have is a claim about a capability nothing offers"
                ),
            );
        }
    }

    for declaration in &catalogue.types {
        for member in &declaration.member_functions {
            if operation_by_id(&member.operation).is_none() {
                complain(
                    &member.fqn,
                    format!(
                        "is listed on `{}` under the operation `{}`, which is not in gg's \
                         operations table",
                        declaration.key(),
                        member.operation
                    ),
                );
            }
        }
    }
}

/// One parameter's documentation, and its structured fields', each held to the brief's shape.
///
/// Recursive because a structured argument's fields are documented in their own right and are read
/// by a model exactly as the argument is — an inline field with a three-paragraph description is the
/// same failure as a function with one, in a place nobody looks.
fn describe_parameters(
    check: &mut impl FnMut(String, Prose<'_>, Option<usize>),
    subject: &str,
    parameter: &Parameter,
) {
    check(
        subject.to_string(),
        Prose::authored(&parameter.doc, None),
        None,
    );
    for field in &parameter.fields {
        describe_parameters(check, &format!("{subject}.{}", field.name), field);
    }
}

/// Every way one piece of [prose](Prose) departs from the register, in the order the rules are
/// stated in the plan. `cap` is the brief's length bound, or `None` where the subject is short by
/// nature and a bound would be a second opinion.
fn faults(prose: Prose<'_>, cap: Option<usize>) -> Vec<String> {
    let mut out = Vec::new();
    let brief = prose.brief;

    if brief.trim().is_empty() {
        out.push("has no brief".to_string());
        // Everything below reads the brief, and reporting five faults about one absent string would
        // bury the one that matters.
        return out;
    }
    if brief.contains('\n') {
        out.push(format!(
            "has a brief of more than one line — the brief is the first line and the rest is the \
             detail: {brief:?}"
        ));
    }
    if let Some(cap) = cap {
        let length = brief.chars().count();
        if length > cap {
            out.push(format!(
                "has a {length}-character brief, and a brief is capped at {cap} — a paragraph in \
                 the brief field is a paragraph the model reads where it expected one line"
            ));
        }
    }
    if !brief.matches('`').count().is_multiple_of(2) {
        out.push(format!("has an unclosed code span in its brief: {brief:?}"));
    }
    if let Some(unclosed) = unclosed_in_a_span(brief) {
        out.push(format!(
            "leaves a `{unclosed}` unclosed inside a code span in its brief, so the thing it names \
             reads as unfinished: {brief:?}"
        ));
    }
    if brief.contains("```") {
        out.push("has a fenced block in its brief, which is a detail's job".to_string());
    }
    if let Some(word) = second_person(brief) {
        out.push(format!(
            "addresses the model as `{word}` in its brief — the register is a description of the \
             call, not an instruction to its caller"
        ));
    }
    if let Some(shouted) = shouting(brief) {
        out.push(format!(
            "shouts `{shouted}` in its brief — emphasis by capitals is the register this gate \
             exists to hold"
        ));
    }
    if let Some(connective) = leading_connective(brief) {
        out.push(format!(
            "opens its brief with `{connective}`, which makes it the tail of a paragraph rather \
             than a brief"
        ));
    }

    let Some(detail) = prose.detail else {
        return out;
    };
    if detail.trim().is_empty() {
        out.push(
            "carries an empty detailed description, which is not the same as none".to_string(),
        );
        return out;
    }
    if detail.lines().next().is_some_and(|first| first == brief) {
        out.push(
            "opens its detailed description with the brief verbatim, so the first thing the model \
             reads twice is the only thing it had already read"
                .to_string(),
        );
    }
    if let Some(word) = second_person(detail) {
        out.push(format!(
            "addresses the model as `{word}` in its detailed description"
        ));
    }
    if let Some(shouted) = shouting(detail) {
        out.push(format!("shouts `{shouted}` in its detailed description"));
    }
    // Fenced examples are *permitted* here, deliberately and exactly once: on five of the six
    // compiled arms the fenced `match`/`switch`/`when`/`std::get_if` block is the only place the
    // closed-union narrowing idiom is taught, and deleting it to satisfy "never narrative" would
    // delete real teaching. Capping it at one keeps the register without taking the teaching.
    let fences = detail.matches("```").count();
    if fences > 2 {
        out.push(format!(
            "carries {} fenced examples in its detailed description, and one is the limit",
            fences / 2
        ));
    }
    if !fences.is_multiple_of(2) {
        out.push("leaves a fenced example unclosed in its detailed description".to_string());
    }
    let length = detail.chars().count();
    if length > DETAIL_CAP {
        out.push(format!(
            "has a {length}-character detailed description, and a detail is capped at {DETAIL_CAP}"
        ));
    }
    out
}

/// The first second-person word `text` uses, or `None`.
///
/// Matched on **whole words**, case-insensitively, so `your` fails while `youth` and `beyond` do not
/// — the check is about who the prose addresses, and a substring match would make it about which
/// letters it contains. An apostrophe separates words rather than joining them, so `you're` is
/// caught: it is the same address wearing a contraction.
fn second_person(text: &str) -> Option<&'static str> {
    text.split(|c: char| !c.is_alphanumeric()).find_map(|word| {
        let lowered = word.to_lowercase();
        SECOND_PERSON
            .into_iter()
            .find(|second| *second == lowered.as_str())
    })
}

/// The first run of shouted words in `text`, or `None`.
///
/// # What tells emphasis apart from vocabulary, and what cannot
///
/// **A shouted word is letters and nothing else.** `UTF-8`, `PREVIEW1`, `NOT_FOUND`, `I/O` and `C++`
/// are a versioned standard, an ABI, an error code, an abbreviation and a language — vocabulary
/// every one of them, and a raised voice none of them. A token carrying a digit, a hyphen, an
/// underscore or a slash is therefore never shouting whatever its case, which is the rule that lets
/// an SDK about wire formats describe its own wire formats.
///
/// **A run has to be [three words](SHOUTED_RUN) long, and one word of it longer than an
/// [abbreviation](ABBREVIATION).** Two was the threshold, and two cannot work: `ASCII TEXT`,
/// `HTTP JSON`, `NEVER SHOWS` and `YOUR FILE` are four pairs of four- and five-letter all-capital
/// words, no property of any string tells the first two from the last two, and the first two are
/// correct English an SDK has to be able to write. A pair of capitalized terms is the ordinary shape
/// of a compound noun; three in a row, unbroken by so much as a comma, is not a shape English
/// terminology takes. `NOT A FAILURE` is shouting and is now caught — it was not before, because
/// `NOT` and `A` are too short to have counted at all.
///
/// **Honest about what that costs:** a genuinely shouted *pair* now passes, and there is no way to
/// have it fail that does not also fail an acronym pair. What survives is the rule against shouted
/// phrases, which is the shape the register decayed into where it decayed.
///
/// # Why punctuation breaks a run
///
/// Because a comma-separated list of terms is vocabulary — *returns HTTP, JSON, ASCII payloads* is
/// three abbreviations and not a raised voice — and so is a term quoted in a code span. Emphasis is
/// a phrase, and a phrase is not punctuated between its own words. So a word carrying leading
/// punctuation starts a fresh run and one carrying trailing punctuation ends the run it is in.
fn shouting(text: &str) -> Option<String> {
    runs(text)
        .into_iter()
        .find(|run| {
            run.len() >= SHOUTED_RUN && run.iter().any(|word| word.chars().count() > ABBREVIATION)
        })
        .map(|run| run.join(" "))
}

/// Every run of consecutive all-capital words in `text`, in order — the unit
/// [shouting](shouting) is judged in.
///
/// A run is broken by any word that is not all capitals, and by punctuation on either side of one
/// that is: see [`shouting`] for why the second of those is a rule about terminology rather than a
/// technicality.
fn runs(text: &str) -> Vec<Vec<&str>> {
    let mut out: Vec<Vec<&str>> = Vec::new();
    let mut run: Vec<&str> = Vec::new();
    for word in text.split_whitespace() {
        let opened = word.trim_start_matches(|c: char| !c.is_alphanumeric());
        let bare = opened.trim_end_matches(|c: char| !c.is_alphanumeric());
        let shouted = capitals(bare);
        // Whatever comes before this word stops here if the word is not all capitals, or if
        // punctuation stands between the two.
        if (!shouted || opened.len() != word.len()) && !run.is_empty() {
            out.push(std::mem::take(&mut run));
        }
        if shouted {
            run.push(bare);
            if bare.len() != opened.len() {
                out.push(std::mem::take(&mut run));
            }
        }
    }
    if !run.is_empty() {
        out.push(run);
    }
    out
}

/// Whether `word` is written entirely in capital letters and in nothing else.
///
/// Letters *and nothing else* is the load-bearing half: it is what keeps `UTF-8`, `PREVIEW1` and
/// `NOT_FOUND` out of a run they have no business being in. See [`shouting`].
fn capitals(word: &str) -> bool {
    !word.is_empty() && word.chars().all(|c| c.is_alphabetic() && c.is_uppercase())
}

/// The connective `text` opens with, or `None`.
fn leading_connective(text: &str) -> Option<&'static str> {
    let first = text
        .split(|c: char| !c.is_alphanumeric())
        .find(|word| !word.is_empty())?
        .to_lowercase();
    CONNECTIVES
        .into_iter()
        .find(|connective| *connective == first.as_str())
}

/// The first bracket left open **inside a code span** of `text`, or `None`.
///
/// # Why only inside a span
///
/// Because prose balances its brackets by different rules than code does, and a check over the whole
/// line would fail correct English. A brief that writes *the half-open range [0, n)* is fine and a
/// bracket counter reading the whole line calls it a mismatch; a brief that writes
/// `` `read_file(path `` has genuinely lost something, and it lost it inside the span. The span is
/// where the fragment shows, so the span is what is counted.
///
/// A span is a stretch between backticks, taken as the odd-numbered pieces of the line split on
/// them — so where the backticks themselves do not balance, the trailing piece is read as an
/// unterminated span and checked too, which is exactly the case where a brief was cut short
/// mid-span.
///
/// # A span that *is* a delimiter
///
/// `` `(` `` is not an unclosed bracket; it is the bracket, quoted, and an SDK about paths,
/// selectors and JSON has to be able to name its own delimiters — *splits the path on `(`*, *the `[`
/// that opens an index*, *writes `}` at the end of the record*. So a span made of nothing **but**
/// delimiter characters is a quotation rather than a fragment and is not balanced against anything.
/// The exemption is safe because it is the presence of something else in the span — an identifier, a
/// literal, a word — that makes a bracket read as opening something, and a span carrying any of
/// those is checked exactly as it was.
fn unclosed_in_a_span(text: &str) -> Option<char> {
    text.split('`')
        .enumerate()
        .filter(|(index, _)| index % 2 == 1)
        .map(|(_, span)| span.trim())
        .filter(|span| !span.chars().all(is_delimiter))
        .find_map(unclosed_bracket)
}

/// Whether `character` is one of the brackets this rule balances.
fn is_delimiter(character: char) -> bool {
    matches!(character, '(' | ')' | '[' | ']' | '{' | '}')
}

/// The first bracket `span` opens and does not close, or `None`.
///
/// It is a **balance** check rather than a nesting one: `read_file(path` has lost something, and
/// `[a](b)` has not. Closing a bracket that was never opened is reported the same way, because it is
/// the same defect seen from the other end — a fragment.
fn unclosed_bracket(text: &str) -> Option<char> {
    let mut open: Vec<char> = Vec::new();
    for character in text.chars() {
        match character {
            '(' | '[' | '{' => open.push(character),
            ')' | ']' | '}' => {
                let expected = match character {
                    ')' => '(',
                    ']' => '[',
                    _ => '{',
                };
                match open.pop() {
                    Some(opened) if opened == expected => {}
                    Some(opened) => return Some(opened),
                    None => return Some(character),
                }
            }
            _ => {}
        }
    }
    open.first().copied()
}

#[cfg(test)]
#[path = "register.test.rs"]
mod tests;
