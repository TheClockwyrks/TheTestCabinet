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
//! And two read what is actually **rendered**, for every language including the seam's fixture:
//!
//! * [`every_call_a_rendered_prompt_names_is_one_that_language_binds`];
//! * [`every_argument_a_rendered_prompt_names_is_one_that_signature_takes`] — the argument names a
//!   template writes beside a resolved call, which are the last hand-typed fragment of a signature
//!   left anywhere and are exactly the half `view.openText(slug, contents)` got wrong.
//!
//! Together they are what makes "the model reads the code's own words" a property rather than an
//! intention.

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

/// Every **grouping** `language` presents its surface under — the string that stands before the
/// member separator in a spelling gg quotes.
///
/// It is one function because the two rendered rules ask the same question and because the answer
/// has two shapes. A [`V1`](crate::sandbox::SchemaVersion::V1) catalogue's grouping is its API
/// object, a single identifier (`fs`); a converted arm's is its **module path**, which is several
/// (`gg.files`, `GG::Board`, `Gg.Files`). Both are read here, so a rule written over this covers the
/// registered arms and the seam's frozen fixture with one implementation.
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
/// The head and the remainder, because the remainder is the call's *arguments* — which one caller
/// judges and the other ignores. A span that names no grouping at all is not naming gg's surface —
/// `source.replace(…)`, `JSON.stringify(…)` — and is answered with `None`.
///
/// # Why the grouping is matched rather than parsed
///
/// It used to read exactly one leading identifier, which was right while every arm grouped its calls
/// under a single-identifier API object and became **wrong for all eleven** when the last was
/// converted: a rendered `gg.files.readFile` has the head `gg.files`, so reading one identifier
/// yields `gg` and every span in every shipped template fell through the caller's lookup. That was
/// measured rather than reasoned: a hand-typed `` `gg.files.thisCallDoesNotExist(x)` `` planted in a
/// shipped template passed both rendered rules. So the head is matched against the groupings the
/// language really publishes, **longest first**, which is a question with one answer whatever
/// punctuation an arm's module path is written with.
///
/// # Why it scans rather than anchoring at the start
///
/// Because a call is not always the first thing in the span it is written in: Swift's every fallible
/// call is quoted `` `try gg.views.openFile(path)` ``, and eight of that template's spans are shaped
/// that way — four of them quoting real argument names. Anchoring would leave every one of them
/// unjudged on the arm whose idiom it is. The scan takes the **first** grouping written at a token
/// boundary, so a nested call in an argument list is not mistaken for the call being quoted, and a
/// grouping that is merely the tail of a longer qualified name is not matched at all.
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
            // The path is gg's OWN identity — the pair a `SurfaceCall` names — which is what the
            // spellings map is keyed by. So the entry is resolved to its operation and the pair
            // compared against that, rather than against the grouping an arm happens to file it
            // under: a converted arm groups by module and carries gg's object name nowhere.
            FIELDS.contains(&field.as_str())
                && catalogue_functions(language).iter().any(|function| {
                    crate::sandbox::operation_of(function).is_some_and(|operation| {
                        operation.call.object == object && operation.call.key == key
                    })
                })
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
/// Only spans whose head is one of the [groupings](groupings_of) the language publishes are judged.
/// That is deliberate: an example program legitimately writes `source.replace(...)`,
/// `console.log()` and `JSON.stringify(...)`, and none of those is gg's surface. A span that *does*
/// begin with one of gg's groupings is a claim about that grouping, and the claim has to be true.
///
/// A **type** the grouping declares satisfies it too, because on a converted arm a module's own
/// types are qualified by the same path its functions are — `gg.files.FileRead` beside
/// `gg.files.readFile` — and a template naming one is quoting a real name rather than inventing a
/// call. What is refused either way is a name the arm does not carry at all.
#[test]
fn every_call_a_rendered_prompt_names_is_one_that_language_binds() {
    let mut offenders = Vec::new();
    for language in all_languages().chain(crate::sandbox::fixture_languages()) {
        let groupings = groupings_of(language);
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
        // What the arm's own TYPES contribute to a module's vocabulary, which on a converted arm is
        // qualified by the same path its calls are. Two shapes: the type itself
        // (`gg.files.FileRead`), and — on a language whose union arms are qualified by the module
        // rather than by the type — each arm. `Gg.Delegation.Prompt` is a real, correct,
        // reflected name in PureScript's prompt and is neither a function nor a type.
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
            if !bound.contains(&(object, name))
                && !meta.contains(&name)
                && !published.contains(&qualified)
            {
                offenders.push(format!(
                    "{}: `{span}` — `{object}` publishes no `{name}`",
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

/// **Every argument a rendered prompt names is one that signature really takes, in that order.**
///
/// A template quotes a call's *name* through the catalogue and then, where the argument matters more
/// than the return type does, writes the argument list beside it by hand:
/// `` `{{api.programs.rerun.call}}(source)` ``. That fragment is a signature typed into a template —
/// the same defect [`no_template_spells_an_sdk_call_by_hand`] exists to remove, in the one shape that
/// rule cannot see, because the span begins with a `{{api.…}}` reference rather than with a spelling.
/// An SDK that renamed `rerun`'s argument would put a wrong argument name in front of every code
/// agent with every other gate green.
///
/// It reads the **rendered** prompt, so it covers the argument names that arrive through the context
/// as well as the ones written in the template, and it runs per language, so an argument list correct
/// for TypeScript and wrong for a second arm is caught on the arm it is wrong for.
///
/// # What is judged, and what is deliberately not
///
/// Only a span whose head is a bound call **and** whose arguments are all bare identifiers: that
/// shape is a *quotation of the signature*, and nothing else it could be. A span carrying a literal,
/// an object, a nested call or a qualified name — `view.openText("fs", JSON.stringify(…))`,
/// `view.openFile(path, { offset: 400 })` — is a worked **example**, whose argument names are the
/// template's own local variables and are none of the catalogue's business. Judging those would be
/// judging prose.
///
/// The names are matched as a **prefix** of some signature's parameters, so quoting the required
/// arguments and leaving the optional ones off — which is what every one of these does — is correct,
/// and quoting them in the wrong order is not.
///
/// A **fenced block** is not judged either, and for the same reason: a several-line program between
/// triple backticks is the longest form of worked example a template writes, and the literals in it
/// are its own. Rust's `gg::programs::get(None)` is the measured case — a legitimate example whose
/// one argument is a literal that happens to be spelled like an identifier.
#[test]
fn every_argument_a_rendered_prompt_names_is_one_that_signature_takes() {
    let mut offenders = Vec::new();
    for language in all_languages().chain(crate::sandbox::fixture_languages()) {
        let groupings = groupings_of(language);
        let bound = catalogue_functions(language);
        let rendered = format!(
            "{}\n{}",
            render_system_for(language, &super::tests::every_code_section_on_for(language)),
            render_code_nothing_shown_for(language),
        );
        for span in backticked(&rendered) {
            if span.contains('\n') {
                continue;
            }
            let Some((object, name, arguments)) =
                call_head(span, language.member_separator(), &groupings)
            else {
                continue;
            };
            let Some(function) = bound
                .iter()
                .find(|function| function.object == object && function.name == name)
            else {
                // Not a bound call: `every_call_a_rendered_prompt_names_is_one_that_language_binds`
                // is the rule that has an opinion about that, and saying it twice would diagnose one
                // defect in two sentences.
                continue;
            };
            let Some(quoted) = quoted_arguments(arguments) else {
                continue;
            };
            let takes = function.signatures.iter().any(|entry| {
                entry.parameters.len() >= quoted.len()
                    && entry
                        .parameters
                        .iter()
                        .zip(&quoted)
                        .all(|(parameter, name)| parameter.name == *name)
            });
            if !takes {
                offenders.push(format!(
                    "{}: `{span}` — `{object}.{name}` takes {}",
                    language.display_name(),
                    function
                        .signatures
                        .iter()
                        .map(|entry| entry.signature.as_str())
                        .collect::<Vec<_>>()
                        .join(" / "),
                ));
            }
        }
    }
    assert!(
        offenders.is_empty(),
        "a rendered prompt names an argument the signature does not take, in the order it does not \
         take it. Quote the whole `{{{{api.<object>.<key>.signature}}}}` instead of typing the \
         argument list:\n{}",
        offenders.join("\n"),
    );
}

/// The bare identifiers a span's argument list quotes, or `None` when the list is empty or is a
/// worked example rather than a quotation of the signature.
///
/// `text` begins at the `(` that follows the call's name. Everything up to its matching close is
/// split on commas; the answer is `Some` only when every part is a plain identifier — no literal, no
/// bracket, no dot, no whitespace inside a part.
fn quoted_arguments(text: &str) -> Option<Vec<&str>> {
    let inner = text.strip_prefix('(')?;
    let close = inner.find(')')?;
    let inner = &inner[..close];
    if inner.trim().is_empty() {
        return None;
    }
    let mut out = Vec::new();
    for part in inner.split(',') {
        let part = part.trim();
        let identifier = !part.is_empty()
            && !part.starts_with(|c: char| c.is_ascii_digit())
            && part
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$');
        if !identifier {
            return None;
        }
        out.push(part);
    }
    Some(out)
}
