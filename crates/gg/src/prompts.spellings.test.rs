//! **The prompt-resolution gate** — the assertion that no prompt gg renders spells an SDK call by
//! hand, and that every spelling it does quote resolves against the run's own catalogue.
//!
//! # Why this is a gate rather than a review note
//!
//! Everything a model reads about gg's SDK is reflected out of the declaration that implements it,
//! carried in that language's committed catalogue, and resolved at render time. A template that
//! types `view.openText(slug: str, contents: str)` instead reads perfectly and is wrong in three
//! ways at once — two parameter names that were never those, and a type name from a language this
//! SDK is not written in — and every one of those defects survived review for months, because a
//! hand-written signature looks exactly like a reflected one.
//!
//! It is also the defect that a second registered language turns from *stale* into *false*. A
//! spelling frozen in a template is TypeScript's; rendered for a Python agent it names a call that
//! agent's scope does not bind, and the model copies it verbatim.
//!
//! # The four rules, and what each of them can see
//!
//! Two read the template **sources**, so they cover every branch — including the sections a test's
//! context does not turn on:
//!
//! * [`no_template_spells_an_sdk_call_by_hand`] — no template contains a literal
//!   `<object>.<name>` any registered SDK binds.
//! * [`every_quoted_call_in_a_template_resolves_in_every_language`] — every `{{api.…}}` and
//!   `{{meta.…}}` reference a template makes names a function every registered language catalogues.
//!
//! One reads the sources for the *other* vocabulary a code prompt must not use:
//!
//! * [`no_code_reachable_template_names_a_bare_gg_tool`] — a gg tool name is the right identity in
//!   the tool-calling prompt and nowhere else, because a program calls a method on an object.
//!
//! And one reads what is actually **rendered**, for every language including the seam's fixture:
//!
//! * [`every_call_a_rendered_prompt_names_is_one_that_language_binds`].
//!
//! Together they are what makes "the model reads the code's own words" a property rather than an
//! intention.

use test_cabinet_core::gg::GgProgramLanguage;

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

/// The `object.name` pairs some registered SDK really binds — what a hand-typed spelling would have
/// to be one of.
fn every_bound_spelling() -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for language in all_languages() {
        for function in catalogue_functions(language) {
            out.push(format!("{}.{}", function.object, function.name));
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

/// The `object.name` head of a backticked span, when it has one: `fs.readFile(path)` → `("fs",
/// "readFile")`.
///
/// Only the head, because what follows it is the call's *arguments*, which are the template's own
/// worked example and are written in that language's syntax. A span that does not begin with two
/// identifiers separated by a dot is not naming a call and is answered with `None`.
fn call_head(span: &str) -> Option<(&str, &str)> {
    let ident = |text: &str| -> usize {
        text.char_indices()
            .take_while(|(index, character)| {
                character.is_ascii_alphanumeric()
                    || *character == '_'
                    || (*character == '$' && *index == 0)
            })
            .count()
    };
    let object_len = ident(span);
    if object_len == 0 || !span[object_len..].starts_with('.') {
        return None;
    }
    let after = &span[object_len + 1..];
    let name_len = ident(after);
    if name_len == 0 {
        return None;
    }
    Some((&span[..object_len], &after[..name_len]))
}

/// **No template spells an SDK call by hand.**
///
/// The rule the whole design rests on: a template quotes a call by writing
/// `{{api.<object>.<key>.call}}`, never by typing the name. This reads the template *sources* rather
/// than a rendering, so it covers a `{{#if}}` section no test context turns on — which is exactly
/// where a stale spelling survives longest.
///
/// It is checked against the spellings the registered SDKs actually bind, so it is not a ban on the
/// word `openText` in prose: it is a ban on writing, in a template, the string a model would copy.
#[test]
fn no_template_spells_an_sdk_call_by_hand() {
    let spellings = every_bound_spelling();
    let mut offenders = Vec::new();
    for (name, source) in every_template() {
        for span in backticked(source) {
            for spelling in &spellings {
                if span.starts_with(spelling.as_str()) {
                    offenders.push(format!("{name}: `{span}`"));
                    break;
                }
            }
        }
    }
    assert!(
        offenders.is_empty(),
        "a prompt template names an SDK call by hand. Quote it as \
         `{{{{api.<object>.<key>.call}}}}` (or `.signature`) so the name comes from the run's own \
         committed catalogue and a second language spells it its own way:\n{}",
        offenders.join("\n"),
    );
}

/// **Every call a template quotes is one every registered language offers.**
///
/// A `{{api.fs.read_fyle.call}}` is a strict-mode render failure — but only on a turn that renders
/// the section it is in, which for most of the prompt means only under a run with that capability
/// enabled. Reading the *source* is what makes a typo in a rarely-rendered branch a build failure
/// instead of a mid-run panic.
///
/// It is asserted per language, which is the half that matters once there is more than one: a
/// reference resolving in TypeScript's catalogue and nowhere else is a template that renders for one
/// arm of a study and panics for the other.
#[test]
fn every_quoted_call_in_a_template_resolves_in_every_language() {
    let mut offenders = Vec::new();
    for (name, source) in every_template() {
        for reference in references(source) {
            for language in all_languages().chain(crate::sandbox::fixture_languages()) {
                if !resolves(language, &reference) {
                    offenders.push(format!(
                        "{name}: `{{{{{}}}}}` names nothing in {}'s catalogue",
                        reference.join("."),
                        language.display_name()
                    ));
                }
            }
        }
    }
    assert!(
        offenders.is_empty(),
        "a prompt template quotes a call no catalogue carries:\n{}",
        offenders.join("\n"),
    );
}

/// Every `{{api.…}}` / `{{meta.…}}` path a template writes, split into its segments.
fn references(source: &str) -> Vec<Vec<String>> {
    let mut out = Vec::new();
    let mut rest = source;
    while let Some(open) = rest.find("{{") {
        let after = &rest[open + 2..];
        let Some(close) = after.find("}}") else {
            break;
        };
        let path = after[..close].trim();
        if path.starts_with("api.") || path.starts_with("meta.") {
            out.push(path.split('.').map(str::to_string).collect());
        }
        rest = &after[close + 2..];
    }
    out
}

/// Whether one `{{api.…}}`/`{{meta.…}}` path names something `language`'s catalogue carries.
fn resolves(language: &'static dyn ProgramLanguage, reference: &[String]) -> bool {
    // `api.<object>.<key>.<field>` and `meta.<key>.<field>` are the only two shapes; the field is
    // checked as well, because `{{api.view.open_text.cal}}` renders empty in every context that
    // reaches it rather than failing.
    const FIELDS: [&str; 3] = ["name", "call", "signature"];
    match reference.first().map(String::as_str) {
        Some("api") => {
            let [_, object, key, field] = reference else {
                return false;
            };
            FIELDS.contains(&field.as_str())
                && catalogue_functions(language)
                    .into_iter()
                    .any(|function| function.object == object && function.key == key)
        }
        Some("meta") => {
            let [_, key, field] = reference else {
                return false;
            };
            FIELDS.contains(&field.as_str())
                && crate::sandbox::meta_function(language, key).is_some()
        }
        _ => false,
    }
}

/// **A gg tool name is identity in the tool-calling prompt and a wrong answer everywhere else.**
///
/// `evict_file_view` is what a tool-calling model requests and what a run's enabled set is expressed
/// in — so `system-tools.hbs` naming it is correct, and is the one exception here. Every other
/// template is shared by both execution modes or belongs to a code arm, and a code agent that reads
/// `evict_file_view` reaches for a name its scope does not bind: it calls a method on an API object.
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
        "a template a code agent reads names a bare gg tool. Pass the call in as a variable, \
         spelled from the agent's own language for a code agent and as the tool name for a \
         tool-calling one:\n{}",
        offenders.join("\n"),
    );
}

/// **Every call a rendered prompt names is one that language's SDK really binds.**
///
/// The rendered half, and the one that covers what the source rules cannot: a name that arrived
/// through the *context* rather than through the template — an `{{#each}}` over something gg
/// computed — is only visible once it has been rendered.
///
/// Only spans whose object is a catalogued object are judged. That is deliberate: an example
/// program legitimately writes `source.replace(...)`, `console.log()` and `JSON.stringify(...)`, and
/// none of those is gg's surface. A span that *does* begin with an API object is a claim about that
/// object, and the claim has to be true.
#[test]
fn every_call_a_rendered_prompt_names_is_one_that_language_binds() {
    let mut offenders = Vec::new();
    for language in all_languages().chain(crate::sandbox::fixture_languages()) {
        let objects: Vec<&str> = catalogue_objects(language)
            .iter()
            .map(|object| object.object.as_str())
            .collect();
        let bound: Vec<(&str, &str)> = catalogue_functions(language)
            .into_iter()
            .map(|function| (function.object, function.name))
            .collect();
        let meta: Vec<&str> = language
            .catalogue()
            .meta
            .iter()
            .map(|entry| entry.name.as_str())
            .collect();

        let rendered = format!(
            "{}\n{}",
            render_system_for(
                language,
                &super::tests::every_code_section_on(GgProgramLanguage::TypeScript)
            ),
            render_code_nothing_shown_for(language),
        );
        for span in backticked(&rendered) {
            let Some((object, name)) = call_head(span) else {
                continue;
            };
            if !objects.contains(&object) {
                continue;
            }
            if !bound.contains(&(object, name)) && !meta.contains(&name) {
                offenders.push(format!(
                    "{}: `{span}` — `{object}` binds no `{name}`",
                    language.display_name()
                ));
            }
        }
    }
    assert!(
        offenders.is_empty(),
        "a rendered prompt names a call the language's SDK does not bind:\n{}",
        offenders.join("\n"),
    );
}
