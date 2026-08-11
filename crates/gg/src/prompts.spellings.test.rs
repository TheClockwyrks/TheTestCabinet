//! **The prompt-resolution gate** — the assertion that no prompt gg renders names a function of the
//! surface it is describing, and that every name it does write under one of gg's modules is a name
//! that module really publishes.
//!
//! # What changed, and why the rule got stronger rather than looser
//!
//! This file used to enforce that a template never *hand-typed* a call: it had to quote one through
//! `{{api.<object>.<key>.call}}`, so the spelling came from the run's own committed catalogue. That
//! was the right rule while the prompt's job was to name calls. It no longer is. The prompt names
//! **no function at all** — a model finds one by searching the documentation and opening a view of
//! it — so a resolved spelling is no longer a safer way to write something the prompt should not be
//! writing. The `{{api.…}}` namespace is gone, and with it the two rules that policed it.
//!
//! What replaces them is stricter in the only direction that matters: a template may not name a
//! catalogued function **however** it came by the name.
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
//! And one reads what is actually **rendered**, for every language including the seam's fixture:
//!
//! * [`every_name_a_rendered_prompt_writes_under_a_module_is_one_it_publishes`].
//!
//! That third one is kept rather than retired with the `{{api.…}}` rules, and it is worth saying
//! why, because the plan this stage implements budgeted for two. It is the only thing that reads a
//! *rendered* prompt, and two live classes of name reach a model only through one:
//!
//! 1. the **ending** calls, which arrive through the context ([`EndingView`](super::EndingView))
//!    rather than through a template. They are the one place a function name still reaches a model
//!    from the prompt, and they are there because an ending is bound to a role rather than to a
//!    capability — so the [discoverability gate](crate::docs) does not cover them, and an agent that
//!    could not find its own ending call would burn its whole budget failing to stop. That exception
//!    is deliberate, and this is what holds it honest: the call named must be one the arm binds;
//! 2. the **type** names a template writes by hand to teach a language's own convention (Rust's
//!    `files::FileRead`, TypeScript's `gg.files.FileRead`). Those are not calls, they are not
//!    discoverable through search, and a template that explains "a type is written under its module"
//!    without an example of one explains nothing.
//!
//! # What a prompt may still name, stated once
//!
//! The line this file draws is not "no identifiers". It is: **a prompt may name only what a model
//! could not find for itself.** That is the module paths (the entry point into search), the failure
//! type and the language-level helpers that no catalogue carries — Rust's failure constructor,
//! PureScript's `Gg.Core.attempt` — and the ending calls above. It may never name a **catalogued**
//! function, because that is precisely the set a search will hand over.

use super::{TEMPLATES, render_code_nothing_shown_for, render_system_for};
use crate::sandbox::{ProgramLanguage, all_languages, catalogue_functions, catalogue_objects};

/// Every template gg renders, as `(name, source)` — the shared ones plus each registered language's
/// pair and the fixture's.
///
/// Read from the same two places [`engine`](super::engine) registers from, so a template added
/// anywhere is covered here without anyone editing a list.
fn every_template() -> Vec<(&'static str, &'static str)> {
    let mut out: Vec<(&'static str, &'static str)> = TEMPLATES.to_vec();
    for language in all_languages().chain(crate::sandbox::fixture_languages()) {
        let dialect = language.prompt();
        out.push((dialect.system_template_name, dialect.system_template));
        out.push((
            dialect.nothing_shown_template_name,
            dialect.nothing_shown_template,
        ));
    }
    out
}

/// The languages a template is judged against: the one whose dialect owns it, or **every** language
/// for a template both execution modes share.
///
/// A per-language template is judged against its own arm alone, and that is the half that matters.
/// A name that is a call in Ruby and ordinary prose in Swift is a defect in exactly one of the two
/// files, and a rule that pooled every arm's spellings would either miss it or refuse a Swift
/// sentence for a Ruby reason.
fn judged_against(template: &str) -> Vec<&'static dyn ProgramLanguage> {
    for language in all_languages().chain(crate::sandbox::fixture_languages()) {
        let dialect = language.prompt();
        if template == dialect.system_template_name
            || template == dialect.nothing_shown_template_name
        {
            return vec![language];
        }
    }
    all_languages()
        .chain(crate::sandbox::fixture_languages())
        .collect()
}

/// Every way `language` writes one of its catalogued functions at a call site: the fully-qualified
/// name its catalogue advertises, and the module-qualified form a program types.
///
/// Both, because they differ on the arms whose FQN carries a receiver or a labelled selector, and a
/// hand-typed spelling would be one or the other.
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
        if let Some(fqn) = function.fqn {
            out.push(fqn.to_string());
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
/// It is one function because the two questions asked over it have one answer with two shapes. A
/// [`V1`](crate::sandbox::SchemaVersion::V1) catalogue's grouping is its API object, a single
/// identifier (`fs`); a converted arm's is its **module path**, which is several (`gg.files`,
/// `GG::Board`, `Gg.Files`). Both are read here, so a rule written over this covers the registered
/// arms and the seam's frozen fixture with one implementation.
fn groupings_of(language: &'static dyn ProgramLanguage) -> Vec<&'static str> {
    let mut out: Vec<&'static str> = catalogue_objects(language)
        .iter()
        .map(|object| object.object.as_str())
        .chain(catalogue_functions(language).into_iter().map(|f| f.object))
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
/// It used to read exactly one leading identifier, which was right while every arm grouped its calls
/// under a single-identifier API object and became **wrong for all eleven** when the last was
/// converted: a rendered `gg.files.readFile` has the head `gg.files`, so reading one identifier
/// yields `gg` and every span in every shipped template fell through the caller's lookup. That was
/// measured rather than reasoned: a hand-typed `` `gg.files.thisCallDoesNotExist(x)` `` planted in a
/// shipped template passed the rendered rule. So the head is matched against the groupings the
/// language really publishes, **longest first**, which is a question with one answer whatever
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
/// context turns on — which is exactly where a spelling survives longest — and it judges each
/// language-specific template against [its own arm](judged_against).
#[test]
fn no_template_names_a_function_of_the_surface_it_describes() {
    let mut offenders = Vec::new();
    for (name, source) in every_template() {
        for language in judged_against(name) {
            let spellings = call_spellings(language);
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
    for (name, source) in every_template() {
        if name == "system-tools" {
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
/// through the *context* rather than through the template. Two of those are live — the
/// [ending](super::EndingView) calls and the hand-typed type names that teach a language's own
/// qualification convention — and the module doc above says why each is allowed to exist at all.
/// What they are not allowed to be is *wrong*.
///
/// Only spans whose head is one of the [groupings](groupings_of) the language publishes are judged.
/// That is deliberate: an example legitimately writes `source.replace(...)`, `console.log()` and
/// `JSON.stringify(...)`, and none of those is gg's surface. A span that *does* begin with one of
/// gg's groupings is a claim about that grouping, and the claim has to be true.
///
/// A **type** the grouping declares satisfies it, because on every arm a module's own types are
/// qualified by the same path its functions are — `gg.files.FileRead` beside `gg.files.readFile` —
/// and a template naming one is quoting a real name rather than inventing a call. So is a **union
/// arm** on a language that qualifies those by the module rather than by the type:
/// `Gg.Delegation.Prompt` is a real, correct, reflected name in PureScript's prompt and is neither a
/// function nor a type. What is refused either way is a name the arm does not carry at all.
#[test]
fn every_name_a_rendered_prompt_writes_under_a_module_is_one_it_publishes() {
    let mut offenders = Vec::new();
    for language in all_languages().chain(crate::sandbox::fixture_languages()) {
        let groupings = groupings_of(language);
        let bound: Vec<(&str, &str)> = catalogue_functions(language)
            .into_iter()
            .map(|function| (function.object, function.name))
            .collect();
        let mut published: Vec<String> = Vec::new();
        for declaration in &language.catalogue().types {
            let Some(fqn) = declaration.fqn.as_deref() else {
                continue;
            };
            published.push(fqn.to_string());
            let Some(prefix) = fqn.strip_suffix(declaration.name.as_str()) else {
                continue;
            };
            for member in &declaration.members {
                if member.kind() == crate::sandbox::MemberKind::Variant {
                    published.push(format!("{prefix}{}", member.name));
                }
            }
        }

        let rendered = format!(
            "{}\n{}",
            render_system_for(language, &super::tests::every_code_section_on_for(language)),
            render_code_nothing_shown_for(language),
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
