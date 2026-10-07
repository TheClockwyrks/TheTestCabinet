//! **The prompt-resolution gate** — the assertion that no prompt gg renders names a function of the
//! surface it is describing, and that every name it does write under one of gg's modules is a name
//! that module really publishes.
//!
//! # What changed, and why the rule got stronger rather than looser
//!
//! A template quoting a call through `{{api.<object>.<key>.call}}` would take its spelling from the
//! run's own catalogue, which would be the right rule if the prompt's job were to name calls. It is
//! not. The prompt names
//! **no function at all** — a model finds one by searching the documentation and opening a view of
//! it — so a resolved spelling is no longer a safer way to write something the prompt should not be
//! writing. The `{{api.…}}` namespace is gone, and with it the two rules that policed it.
//!
//! What replaces them is stricter in the only direction that matters: a template may not name a
//! catalogued function **however** it came by the name.
//!
//! It got stricter again when the eleven code templates became one. A per-language template was
//! judged against its own arm's spellings, on the reasoning that a name that is a call in Ruby and
//! ordinary prose in Swift is a defect in exactly one of two files. There is one file now, and a
//! sentence written under Ruby's gate sits three lines from Swift's, so **every arm's spellings are
//! pooled against every template** — a language segment may not name a catalogued call of any arm,
//! including one that is not its own.
//!
//! # The three rules, and what each of them can see
//!
//! Two read the template **sources**, so they cover every branch — including the sections a test's
//! context does not turn on, which is exactly where a stale spelling survives longest:
//!
//! * [`no_template_names_a_function_of_the_surface_it_describes`] — the rule the design rests on.
//! * [`no_code_reachable_template_names_a_bare_gg_tool`] — a gg tool name is the right identity in
//!   the tool-calling prompt and nowhere else, because a program calls a function in a module.
//!
//! And one reads what is actually **rendered**, for every registered language:
//!
//! * [`every_name_a_rendered_prompt_writes_under_a_module_is_one_it_publishes`].
//!
//! That third one is kept rather than retired with the `{{api.…}}` rules, and it is worth saying
//! why, because the plan this stage implements budgeted for two. It is the only thing that reads a
//! *rendered* prompt, and one live class of name reaches a model only through one: the **ending**
//! calls, which arrive through the context ([`EndingView`](super::EndingView)) rather than through a
//! template. They are the one place a function name still reaches a model from the prompt, and they
//! are there because an ending is bound to a role rather than to a capability — so the
//! [discoverability gate](crate::docs) does not cover them, and an agent that could not find its own
//! ending call would burn its whole budget failing to stop. That exception is deliberate, and this
//! is what holds it honest: the call named must be one the arm binds.
//!
//! It used to hold a second class honest — the **type** names templates wrote by hand to teach a
//! language's own qualification convention (`gg.files.FileRead` beside `gg.files.readFile`). No
//! template writes one now: a documentation view of a function opens the error types its comment
//! declares beside it, so a type name in the prompt is a second copy of something the model reads
//! where it is declared. This rule still *admits* a published type, because a name written under a
//! module is judged by whether that module carries it rather than by what kind of thing it is, and
//! [`prompts::tests::a_rendered_prompt_names_no_type_the_documentation_would_open`](super::tests)
//! is what refuses one outright.
//!
//! # What a prompt may still name, stated once
//!
//! The line this file draws is not "no identifiers". It is: **a prompt may name only what a model
//! could not find for itself.** That is the module paths (the entry point into search), the
//! language-level helpers and types that no catalogue carries — Rust's `Failure` and the
//! constructor that builds one live in the SDK's prelude rather than in a published module, so no
//! search reaches them — and the ending calls above. It may never name a **catalogued** function or
//! a **catalogued** type, because those are precisely the sets a search will hand over.

use super::{TEMPLATES, render_code_nothing_shown, render_system};
use crate::sandbox::{ProgramLanguage, all_languages, catalogue_functions};
use test_cabinet_core::gg::GgProgramLanguage;

/// Every language a template is judged against: **all of them**, plus the seam's fixture.
///
/// There is one system prompt and one "nothing shown" notice for every arm, so there is no longer a
/// template whose spellings belong to one language. Pooling is the correct reading of a shared
/// document and it is strictly stricter than what it replaces: a language segment may not name a
/// catalogued call of **any** arm, not merely of its own — which is the right rule for a file where a
/// sentence written under one arm's gate sits three lines from another's.
fn judged_against() -> Vec<&'static dyn ProgramLanguage> {
    all_languages()
        .chain(crate::sandbox::fixture_languages())
        .collect()
}

/// Every way `language` writes one of its catalogued functions at a call site: the fully-qualified
/// name its catalogue advertises, the module-qualified form a program types, and — where the arm
/// states one — the call-site spelling its catalogue records as differing from both.
///
/// All three, because they differ on the arms whose FQN carries a receiver or a labelled selector,
/// and on the two whose modules are reached by a named import, so that what gg prints is one
/// segment longer than what a program writes. A hand-typed spelling would be one of the three.
///
/// **Bare names are deliberately not here.** Every arm's surface is module-qualified — that is the
/// condition the whole static-SDK decision was accepted on — so a bare `close` in a template is not
/// a call a model could copy, while `print`, `run` and `get` are words a prompt legitimately writes.
/// Banning them would refuse prose in order to catch nothing.
fn call_spellings(language: &'static dyn ProgramLanguage) -> Vec<String> {
    let separator = language.member_separator();
    let mut out: Vec<String> = Vec::new();
    for function in catalogue_functions(language) {
        out.push(format!("{}{separator}{}", function.object, function.name));
        out.push(function.fqn.to_string());
    }
    // The third form is on the raw catalogue rather than on the projection, which carries the two
    // above and not this one.
    for function in &language.catalogue().functions {
        if let Some(call) = &function.call {
            out.push(call.clone());
        }
    }
    out.sort();
    out.dedup();
    out
}

/// The text inside each pair of backticks in `text`, in order.
///
/// Backticks are how every gg prompt marks a call, a name or an identifier, so they are the whole
/// of the syntax these rules read. Anything outside them is prose and is deliberately not the
/// subject: a paragraph that mentions views in words is a paragraph, and a paragraph is meant to be
/// edited.
fn backticked(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(open) = rest.find('`') {
        let after = &rest[open + 1..];
        let Some(close) = after.find('`') else {
            break;
        };
        out.push(&after[..close]);
        rest = &after[close + 1..];
    }
    out
}

/// Every **grouping** `language` presents its surface under — the string that stands before the
/// member separator in a name gg writes.
///
/// The grouping is the arm's **module path**, which is several identifiers (`gg.files`, `GG::Board`,
/// `Gg.Files`) rather than one, and is read off the calls themselves so that what a rule matches is
/// exactly what some catalogued function is listed under.
fn groupings_of(language: &'static dyn ProgramLanguage) -> Vec<&'static str> {
    let mut out: Vec<&'static str> = catalogue_functions(language)
        .into_iter()
        .map(|function| function.object)
        .collect();
    out.sort_unstable();
    out.dedup();
    out
}

/// The **first** `grouping.name` a backticked span writes, with whatever follows it:
/// `fs.readFile(path)` → `("fs", "readFile", "(path)")`, and `try gg.files.readFile(path)` →
/// `("gg.files", "readFile", "(path)")`.
///
/// # Why the grouping is matched rather than parsed
///
/// Reading exactly one leading identifier would be wrong on every arm: a rendered `gg.files.readFile`
/// has the head `gg.files`, so one identifier yields `gg` and every span in every shipped template
/// falls through the caller's lookup — a hand-typed
/// `` `gg.files.thisCallDoesNotExist(x)` `` would pass. So the head is matched against the groupings
/// the language really publishes, **longest first**, which is a question with one answer whatever
/// punctuation an arm's module path is written with.
///
/// # Why it scans rather than anchoring at the start
///
/// Because a call is not always the first thing in the span it is written in: Swift's every fallible
/// call is quoted `` `try gg.views.openFile(path)` ``, and several of that template's spans are
/// shaped that way. Anchoring would leave every one of them unjudged on the arm whose idiom it is.
/// The scan takes the **first** grouping written at a token boundary, so a nested call in an
/// argument list is not mistaken for the call being quoted, and a grouping that is merely the tail
/// of a longer qualified name is not matched at all.
fn call_head<'a>(
    span: &'a str,
    separator: &str,
    groupings: &[&'static str],
) -> Option<(&'static str, &'a str, &'a str)> {
    let identifier =
        |character: char| character.is_ascii_alphanumeric() || character == '_' || character == '$';
    for start in 0..span.len() {
        if !span.is_char_boundary(start) {
            continue;
        }
        let before = &span[..start];
        // A grouping written as the tail of something longer — the `gg.files` inside
        // `mygg.files`, or the `files` inside `gg.files` — is not this span's head.
        if before.ends_with(identifier) || before.ends_with(separator) {
            continue;
        }
        let rest = &span[start..];
        // Longest first, so a module path that is a prefix of another — `gg` beside `gg.files`, were
        // an arm ever to publish both — is answered with the one the span really writes.
        let mut candidates: Vec<&'static str> = groupings
            .iter()
            .copied()
            .filter(|grouping| {
                rest.starts_with(grouping) && rest[grouping.len()..].starts_with(separator)
            })
            .collect();
        candidates.sort_unstable_by_key(|grouping| std::cmp::Reverse(grouping.len()));
        let Some(object) = candidates.first().copied() else {
            continue;
        };
        let after = &rest[object.len() + separator.len()..];
        let name_len = after
            .find(|character| !identifier(character))
            .unwrap_or(after.len());
        if name_len == 0 {
            continue;
        }
        return Some((object, &after[..name_len], &after[name_len..]));
    }
    None
}

/// **No template names a function of the surface it describes.**
///
/// The rule the whole design rests on, and it is unconditional: not "not by hand", not "resolve it
/// from the catalogue instead" — a template may not put a call in front of a model at all. The
/// prompt says what a capability *is* and which module it lives in; the model searches for the
/// function and reads it where it is declared.
///
/// Two failures it exists to prevent, and they are different. A **stale** spelling — the SDK renames
/// a call and the prompt keeps the old name — is the one the old resolution rule already answered.
/// The other is the reason this replaced it: a prompt that names four calls and leaves forty to be
/// discovered has quietly made those four cheaper to reach than the rest, which is a thumb on the
/// scale of a study whose whole subject is how a model finds its surface.
///
/// It reads the template *sources* rather than a rendering, so it covers a `{{#if}}` section no test
/// context turns on — which is exactly where a spelling survives longest — and it judges every
/// template against [every arm's spellings pooled](judged_against).
#[test]
fn no_template_names_a_function_of_the_surface_it_describes() {
    let mut offenders = Vec::new();
    for language in judged_against() {
        let spellings = call_spellings(language);
        for (name, source) in TEMPLATES {
            for span in backticked(source) {
                for spelling in &spellings {
                    if span.starts_with(spelling.as_str()) {
                        offenders.push(format!("{name}: `{span}`"));
                        break;
                    }
                }
            }
        }
    }
    assert!(
        offenders.is_empty(),
        "a prompt template names a function of gg's own surface. Do not resolve it from the \
         catalogue either — say what the capability is and which module it lives in, and let the \
         model search for the call:\n{}",
        offenders.join("\n"),
    );
}

/// **A gg tool name is identity in the tool-calling prompt and a wrong answer everywhere else.**
///
/// `evict_file_view` is what a tool-calling model requests and what a run's enabled set is expressed
/// in — so `system-tools.hbs` naming it is correct, and is the one exception here. Every other
/// template is shared by both execution modes or belongs to a code arm, and a code agent that reads
/// `evict_file_view` reaches for a name its scope does not bind: it calls a function in a module.
///
/// This is not hypothetical. The context-pressure block — the one message whose whole purpose is to
/// tell an agent how to reclaim its window — named two gg tools at every code agent gg has ever run.
#[test]
fn no_code_reachable_template_names_a_bare_gg_tool() {
    let mut offenders = Vec::new();
    for (name, source) in TEMPLATES {
        if *name == "system-tools" {
            continue;
        }
        for span in backticked(source) {
            if crate::tools::ALL_TOOL_NAMES.contains(&span) {
                offenders.push(format!("{name}: `{span}`"));
            }
        }
    }
    assert!(
        offenders.is_empty(),
        "a template a code agent reads names a bare gg tool. Describe the capability instead — a \
         code agent reaches it as a function in a module, and finds that function by searching \
         for it:\n{}",
        offenders.join("\n"),
    );
}

/// **Every name a rendered prompt writes under one of gg's modules is one that module publishes.**
///
/// The rendered half, and the one that covers what the source rule cannot: a name that arrived
/// through the *context* rather than through the template. One of those is live — the
/// [ending](super::EndingView) calls — and the module doc above says why it is allowed to exist at
/// all. What it is not allowed to be is *wrong*.
///
/// Only spans whose head is one of the [groupings](groupings_of) the language publishes are judged.
/// That is deliberate: an example legitimately writes `source.replace(...)`, `console.log()` and
/// `JSON.stringify(...)`, and none of those is gg's surface. A span that *does* begin with one of
/// gg's groupings is a claim about that grouping, and the claim has to be true.
///
/// A **type** the grouping declares satisfies it, and a **union arm** on a language that qualifies
/// those by the module rather than by the type does too, because on every arm a module's own types
/// are qualified by the same path its functions are — `gg.files.FileRead` beside `gg.files.readFile`.
/// Neither is written by any prompt today, and that is a stronger rule
/// ([`prompts::tests::a_rendered_prompt_names_no_type_the_documentation_would_open`](super::tests))
/// rather than this one's business: what is asked here is whether a name written under a module is
/// one that module carries, and a name the arm does not carry at all is refused whatever it claims
/// to be.
///
/// The **registered** arms, and not the seam's fixture: a document is rendered for the language its
/// context names, a language segment is gated on a wire id, and the fixture deliberately has none.
/// It is still judged by the two rules above, which read sources rather than renderings.
#[test]
fn every_name_a_rendered_prompt_writes_under_a_module_is_one_it_publishes() {
    let mut offenders = Vec::new();
    for &id in GgProgramLanguage::ALL {
        let language = crate::sandbox::language(id);
        let groupings = groupings_of(language);
        let bound: Vec<(&str, &str)> = catalogue_functions(language)
            .into_iter()
            .map(|function| (function.object, function.name))
            .collect();
        let mut published: Vec<String> = Vec::new();
        for declaration in &language.catalogue().types {
            let fqn = declaration.fqn.as_str();
            published.push(fqn.to_string());
            let Some(prefix) = fqn.strip_suffix(declaration.name.as_str()) else {
                continue;
            };
            for member in &declaration.members {
                if member.kind == crate::sandbox::MemberKind::Variant {
                    published.push(format!("{prefix}{}", member.name));
                }
            }
        }

        let rendered = format!(
            "{}\n{}",
            render_system(&super::tests::every_code_section_on(id), None)
                .expect("every arm's system prompt renders"),
            render_code_nothing_shown(id),
        );
        for span in backticked(&rendered) {
            let Some((object, name, _)) = call_head(span, language.member_separator(), &groupings)
            else {
                continue;
            };
            let qualified = format!("{object}{}{name}", language.member_separator());
            if !bound.contains(&(object, name)) && !published.contains(&qualified) {
                offenders.push(format!(
                    "{}: `{span}` — `{object}` publishes no `{name}`",
                    language.display_name()
                ));
            }
        }
    }
    assert!(
        offenders.is_empty(),
        "a rendered prompt writes a name under one of gg's modules that the module does not \
         publish:\n{}",
        offenders.join("\n"),
    );
}
