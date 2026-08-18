//! **Every Rust example a model is shown is put through `rustc`.**
//!
//! # Why this gate exists, and why it exists *here*
//!
//! Two things gg renders contain code a model is invited to copy: the responses-as-code system
//! prompt as it renders for this arm (with the "your program showed you nothing" notice beside it)
//! and this arm's signature catalogue, whose prose is reflected out of the SDK's own rustdoc and rendered into
//! documentation views. Everything about those two that can be checked without a compiler already
//! is — [`prompts::spellings`](crate::prompts) resolves every call *name* they quote against the
//! catalogue, and every argument name beside one against that signature — and none of it can tell
//! whether the surrounding code would build.
//!
//! On an interpreted arm that gap costs a model a runtime error it can read and work around. On a
//! **compiled** arm it costs the whole turn: the program is refused before it runs, and the
//! diagnostic the model gets back is about gg's own prose. This gate was written because exactly
//! that shipped — the prompt taught `files::list()?`, and `list` returns a `Vec`, not a `Result`, so
//! the `?` was an `E0277` on a line the model had been shown.
//!
//! It lives with the arm rather than with the prompt tests because it needs the arm's whole compile
//! path: the real wrapper, the real flags and the real library set this build compiled. That is also why it
//! is one `rustc` rather than one per example — every snippet goes into a single program, each in
//! its own block so nothing one binds is visible to another, and `rustc` reports all of their
//! diagnostics at once.
//!
//! # Which text is treated as code
//!
//! **Fenced blocks** are taken from two sources under two rules, because the two sources say
//! "this is Rust" differently:
//!
//! * in the **templates**, which are Markdown a model reads, a Rust block is tagged ` ```rust `. An
//!   untagged fence there is deliberately *not* code — the one in the messages section shows the
//!   shape of a message gg sends, which is prose with a rule under it;
//! * in the **catalogue**, whose fences come from `///` comments on the SDK, an untagged fence is
//!   Rust, because that is rustdoc's own convention (it is what makes a doc example a doctest).
//!   A block of anything else in an SDK doc comment must be tagged, and this gate says so when it
//!   fails on one.
//!
//! **Inline spans** — text between single backticks — are taken when they read as a *call*: a path
//! of two or more `::`-separated identifiers followed by `(`. That admits `files::list()`,
//! `programs::get(turn)` and `Brief::Prompt("…")`, and passes over `unwrap()` (no path),
//! `#[derive(…)]`, `Result<(), Failure>`, `<object>::<function>(args...)` and
//! `<key>::<name>(args…)` (segments that are not identifiers), and `std::thread::spawn` (no
//! call). The one thing that rule *would* wrongly admit is a rendered `{{api.….signature}}`, which
//! is a declaration rather than an expression — so those are subtracted by matching the catalogue's
//! own signature strings, exactly as [`prompts`](crate::prompts) spells them.
//!
//! A span that names something the [`PREAMBLE`] does not bind fails here with `E0425` naming it.
//! That is the intended way to find out that the prompt gained an example with a new free variable
//! in it: bind it there, in the shape the prose implies.
//!
//! # What is left in the prompt to read
//!
//! Almost nothing, and that is the design rather than a regression. The prompt names no function, so
//! its worked programs and its inline calls went with the names in them; what this gate reads there
//! now is the one call the prompt still writes because no catalogue carries it and a search could
//! never hand it over — the constructor a program builds a failure of its own with. Everything else
//! it compiles comes from the **catalogue**, which is what a model is shown when it opens a
//! documentation view, and which is untouched by any of that.

use test_cabinet_core::gg::GgProgramLanguage;

use super::compile::compile_program;
use crate::prompts::{
    AssignedIssueView, AutoloadView, BoardView, CodeHeadingView, EndingView, MemoriesView,
    ModuleView, ReadFileView, SkillView, SpawnableAgentView, SystemContext, TasksView,
    render_code_nothing_shown_for, render_system,
};
use crate::sandbox::{
    PrepareContext, ProgramLanguage, SESSION_APPROVE, SESSION_FINISH, SESSION_REQUEST_CHANGES,
    catalogue_functions, spell,
};

/// This arm, resolved from the registry.
fn rust() -> &'static dyn ProgramLanguage {
    crate::sandbox::language(GgProgramLanguage::Rust)
}

/// The names the prompt's own examples use without introducing, bound to the values its prose says
/// they hold.
///
/// These are placeholders in a sentence — "read a file" is written `gg::views::open_file(path, …)`,
/// because naming a real path in that sentence would teach a path — so a gate that compiles the
/// sentence has to supply them. Everything here is used by at least one snippet; the tuple at the
/// end is what keeps the ones a given rendering did not reach from warning.
const PREAMBLE: &str = "\
    let path = \"notes.md\";
    let label = \"notes\";
    let body = \"what the program computed\";
    let name = \"physics\";
    let options = files::ReadOptions::default();
    let turn: Option<u32> = None;
    let source = String::from(\"fn main() {}\");
    let _ = (path, label, body, name, &options, turn, &source);
";

/// **The lines a model copying one of these examples would have written above it**, taken from the
/// catalogue's own `import` field rather than restated here.
///
/// An example in a documentation view is written `files::read_file(…)`, and the view that carries it
/// states `use gg::files;` beside it — so the honest thing to compile is the example *under that
/// line*. Reconstructing them from the catalogue is what makes this a check on the pair: an arm
/// whose stated import did not reach the module its examples call fails here.
fn stated_imports() -> String {
    let mut lines: Vec<String> = crate::sandbox::catalogue_modules(rust())
        .iter()
        .filter_map(|module| module.import.map(str::to_string))
        .collect();
    lines.sort_unstable();
    lines.dedup();
    assert!(
        !lines.is_empty(),
        "the catalogue states no import line for any module, so nothing here would be reconstructed"
    );
    format!("{}\n", lines.join("\n"))
}

/// Every fenced block in `text`, as `(tag, body)`.
fn fenced(text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut lines = text.lines();
    while let Some(line) = lines.next() {
        let Some(tag) = line.strip_prefix("```") else {
            continue;
        };
        let mut body = String::new();
        for inner in lines.by_ref() {
            if inner.starts_with("```") {
                break;
            }
            body.push_str(inner);
            body.push('\n');
        }
        out.push((tag.trim().to_string(), body));
    }
    out
}

/// `text` with every fenced block removed, so the inline scan below cannot pair a fence's
/// backticks with a real span's.
fn outside_fences(text: &str) -> String {
    let mut out = String::new();
    let mut inside = false;
    for line in text.lines() {
        if line.starts_with("```") {
            inside = !inside;
            continue;
        }
        if !inside {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

/// The text inside each pair of single backticks, with runs of whitespace collapsed to one space.
///
/// The collapse is what lets a span that the template hard-wrapped across two lines —
/// `files::read_text_file("notes.md",` / `files::ReadOptions::default())?` is one — be read as the
/// one call it is. It would also rewrite a run of spaces inside a string literal, which none of
/// these examples has and
/// which would show up as a failure rather than as a silent pass.
fn backticked(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(open) = rest.find('`') {
        let after = &rest[open + 1..];
        let Some(close) = after.find('`') else {
            break;
        };
        out.push(
            after[..close]
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" "),
        );
        rest = &after[close + 1..];
    }
    out
}

/// The `::`-separated path a span *calls*, when it is a call at all.
fn call_path(span: &str) -> Option<&str> {
    let open = span.find('(')?;
    let head = span[..open].trim_end();
    if !head.contains("::") {
        return None;
    }
    let identifiers = head.split("::").all(|segment| {
        segment
            .chars()
            .next()
            .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
            && segment
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '_')
    });
    identifiers.then_some(head)
}

/// Every signature string a template can render, spelled exactly as [`crate::prompts`] spells it.
///
/// Subtracted from the inline candidates because a signature is a declaration — `gg::shell::run(
/// command: &str, timeout_secs: Option<f64>) -> Result<shell::ShellOutput, ApiError>` reads as a
/// call to the rule above and is not one. What a template writes *beside* a signature is already gated by
/// `every_argument_a_rendered_prompt_names_is_one_that_signature_takes`.
fn signature_spellings() -> Vec<String> {
    let separator = rust().member_separator();
    let mut out = Vec::new();
    for function in catalogue_functions(rust()) {
        if let Some(entry) = function.signatures.first() {
            out.push(format!("{}{separator}{}", function.object, entry.signature));
        }
    }
    out
}

/// A context with every section the prompt can render for this arm turned on, so no example is
/// missed for living in a branch a narrower run does not take.
///
/// Both ending roles are on at once, which no real run is: the template asks after each
/// independently, and rendering both is how one pass covers all three ending spellings.
fn everything_on() -> SystemContext {
    let agent = |name: &str| SpawnableAgentView {
        name: name.to_string(),
        description: "does scoped work".to_string(),
    };
    SystemContext {
        responses_as_code: true,
        language: Some(crate::prompts::language_view(GgProgramLanguage::Rust)),
        program_library: true,
        modules: vec![ModuleView {
            path: "gg::files".to_string(),
            brief: "Read, write, edit and list the files of the workspace.".to_string(),
            import: None,
        }],
        code_headings: vec![CodeHeadingView {
            heading: "File".to_string(),
            description: "a file you opened a view of".to_string(),
        }],
        custom_instructions: None,
        fences_are_stripped: true,
        read_file: ReadFileView {
            offered: true,
            capped: true,
            line_cap: 250,
            images: true,
        },
        skills: vec![SkillView {
            name: "physics".to_string(),
            description: "How to tune the simulation.".to_string(),
            carries_code: true,
            carries_on_use_script: true,
        }],
        memories: Some(MemoriesView {
            scratchpad: false,
            markdown: true,
            keyword_search: true,
            max_count: Some(8),
            max_len_per_memory: Some(2_000),
            max_total_len: Some(8_000),
            max_len_index: None,
            max_len_description: Some(200),
            max_results: Some(10),
            read_only: false,
            linked: true,
            scope: "shared".to_string(),
        }),
        tasks: Some(TasksView { max_tasks: 100 }),
        subagents: true,
        spawnable_agents: vec![agent("helper")],
        board: Some(BoardView {
            max_epics: 50,
            max_issues: 2000,
            max_retries: 1,
            reviewers_required: true,
            issue_agents: vec![agent("builder")],
            reviewer_agents: vec![agent("critic")],
        }),
        assigned_issue: Some(AssignedIssueView {
            id: "feat-1".to_string(),
        }),
        autoload_specs: Some(AutoloadView { locked: true }),
        persistence: true,
        ending: EndingView {
            standard: true,
            review: true,
            finish: spell(rust(), SESSION_FINISH),
            approve: spell(rust(), SESSION_APPROVE),
            request_changes: spell(rust(), SESSION_REQUEST_CHANGES),
        },
    }
}

/// **Every Rust example a model is shown compiles.**
///
/// The prompt, the "nothing shown" notice and the generated catalogue, gathered into one program and
/// put through this arm's production prepare step — the same `rustc`, the same wrapper and the same
/// library set a model's own reply gets.
#[test]
fn every_rust_example_a_model_is_shown_compiles() {
    let prompt = render_system(&everything_on(), None).expect("the code system prompt renders");
    let notice = render_code_nothing_shown_for(rust());
    let catalogue: serde_json::Value =
        serde_json::from_str(super::SIGNATURES).expect("the generated catalogue is JSON");

    let mut snippets: Vec<(String, String)> = Vec::new();

    // The templates: a Rust block is tagged, because an untagged fence there is a message shape.
    for (source, text) in [("the system prompt", &prompt), ("the notice", &notice)] {
        for (index, (tag, body)) in fenced(text).into_iter().enumerate() {
            if tag == "rust" {
                snippets.push((format!("{source}, fenced block {index}"), body));
            }
        }
    }

    // The catalogue: its fences come from rustdoc, where an untagged one is Rust.
    let mut prose: Vec<String> = Vec::new();
    collect_strings(&catalogue, &mut prose);
    for (index, text) in prose.iter().enumerate() {
        for (tag, body) in fenced(text) {
            assert!(
                tag.is_empty() || tag == "rust",
                "the catalogue carries a fenced block tagged `{tag}`. An SDK doc comment's fences \
                 are Rust unless they say otherwise, and this gate compiles them — if that block \
                 is not Rust, tag it `text` in the doc comment it came from and regenerate."
            );
            snippets.push((format!("the catalogue, doc string {index}"), body));
        }
    }
    let fenced_count = snippets.len();

    // The inline spans, from the prompt and the notice both.
    let signatures = signature_spellings();
    let mut inline = 0;
    for (source, text) in [("the system prompt", &prompt), ("the notice", &notice)] {
        for span in backticked(&outside_fences(text)) {
            if call_path(&span).is_none() || signatures.contains(&span) {
                continue;
            }
            let statement = match span.ends_with([';', '}']) {
                true => span.clone(),
                false => format!("{span};"),
            };
            snippets.push((format!("{source}, `{span}`"), statement));
            inline += 1;
        }
    }

    // The gate must not be able to go quiet. These are floors, not counts: an example added is
    // welcome, an example that stopped being recognised as one is the failure this catches.
    //
    // Both floors came DOWN when the prompt stopped naming functions. The template's two worked
    // programs and its dozen inline calls were exactly the thing the rewrite removed — a model
    // finds a call by searching for it, and a prompt that pre-writes twelve of them has decided
    // which twelve are cheap. So what this gate reads is now almost entirely the **catalogue**,
    // whose fences come from the SDK's own `///` comments and are the code a model is shown when it
    // opens a documentation view. That half is untouched and is the half that grows.
    //
    // Lowering a floor is therefore the right move here and is the wrong move almost everywhere
    // else: it was done because the examples were deliberately deleted, in the same change, by the
    // stage whose whole subject is what the prompt may say. If this fails again, read the templates
    // before touching the number.
    assert!(
        fenced_count >= 3,
        "only {fenced_count} fenced Rust examples were found across the prompt, the notice and the \
         catalogue. A ```rust fence lost its tag, or an SDK doc comment lost its example — either \
         way this gate is no longer reading what a model is shown."
    );
    assert!(
        inline >= 1,
        "no inline Rust call was found in the prompt or the notice. The prompt names no function, \
         so this floor is about the ONE thing it still writes — the failure constructor, which no \
         catalogue carries and which a model therefore cannot look up. If that went, the arm's \
         programs can no longer build a failure of their own."
    );

    // A WHOLE Rust program, because that is the only kind this arm compiles: the crate attribute,
    // the lines the catalogue says a program writes to reach these modules, and one `fn main`
    // holding every example.
    let mut program = format!(
        "#![allow(unused, unused_must_use)]\n{}\nfn main() -> Result<(), gg::Failure> {{\n{PREAMBLE}",
        stated_imports()
    );
    for (label, snippet) in &snippets {
        program.push_str(&format!(
            "    // {label}\n    {{\n{}\n    }}\n",
            snippet.trim_end()
        ));
    }
    program.push_str("    Ok(())\n}\n");

    if let Err(failure) = compile_program(&program, &[], &PrepareContext::new()) {
        panic!(
            "gg shows a model Rust that does not compile. rustc said:\n\n{failure:?}\n\nThe \
             program every example was gathered into, with a comment naming where each came \
             from:\n\n{program}"
        );
    }
}

/// Every string anywhere in `value`, so a fenced example is found whichever doc field it sits in.
fn collect_strings(value: &serde_json::Value, out: &mut Vec<String>) {
    match value {
        serde_json::Value::String(text) => {
            if text.contains("```") {
                out.push(text.clone());
            }
        }
        serde_json::Value::Array(items) => items.iter().for_each(|item| collect_strings(item, out)),
        serde_json::Value::Object(fields) => fields
            .values()
            .for_each(|field| collect_strings(field, out)),
        _ => {}
    }
}
