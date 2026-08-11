//! **Every C# example a model is shown is put through `csc`.**
//!
//! # Why this gate exists, and why it exists *here*
//!
//! Two things gg renders contain C# a model is invited to copy: this arm's responses-as-code system
//! prompt (with the "your program showed you nothing" notice beside it) and its generated signature
//! catalogue, whose prose is reflected out of the SDK's own XML documentation comments and rendered
//! into documentation views. Everything about those two that can be checked without a compiler
//! already is — [`prompts::spellings`](crate::prompts) resolves every call *name* they quote against
//! the catalogue, and every argument name beside one against that signature — and none of it can
//! tell whether the surrounding code would build.
//!
//! On an interpreted arm that gap costs a model a runtime error it can read and work around. On a
//! **compiled** arm it costs the whole turn: the program is refused before it runs, and the
//! diagnostic the model gets back is about gg's own prose. [Rust](super::super::rust::examples) was
//! the first arm to be given this gate, because exactly that had shipped there.
//!
//! It lives with the arm rather than with the prompt tests because it needs the arm's whole compile
//! path: the real `csc`, the real reference set, the real flags and the real SDK compiled beside it.
//! That is also why it is one invocation rather than one per example — every snippet goes into a
//! `static class` of its own, so nothing one declares is visible to another and the compiler reports
//! all of their diagnostics at once.
//!
//! # What is treated as an example, and what is not
//!
//! **Fenced blocks**, from both sources, under one rule each. In the **templates**, which are
//! Markdown a model reads, a C# block is tagged ` ```csharp ` — an untagged fence there is
//! deliberately not code, because the one in the messages section shows the *shape of a message* gg
//! sends. In the **catalogue**, whose fences come from `<code>` elements in the SDK's XML
//! documentation, a block arrives already tagged `csharp`; an untagged one is accepted as C# too,
//! because that is what a documentation comment's fence means in this language.
//!
//! **Inline spans are not gathered**, which is [Swift's answer](super::super::swift::examples). A
//! span here is often a *fragment of a signature* rather than an expression — `` `ExitCode` ``,
//! `` `ToolErrorCode.NotFound` `` — and compiling one would mean guessing at the context it was
//! written for. What is already checked about those spans is what a compiler would have told us
//! anyway: [`prompts`](crate::prompts) resolves each name against the catalogue and refuses a
//! hand-typed spelling, and the surface gate compares the catalogue against the artifact the SDK
//! really binds.
//!
//! # The one thing this gate has to know about C#
//!
//! **A snippet is a statement sequence, and a statement needs a method to live in.** Every example
//! in both sources is a run of statements — this arm's programs are top-level statements, so its
//! examples show them — so each goes into a `static void` method of a `static class` of its own.
//! That is also what keeps two examples that both declare `var notes` from colliding.
//!
//! The compilation needs **one entry point**, because this arm's prepare step builds an executable,
//! and it is gg's rather than an example's: a single `return;` at the top of the file, which is a
//! top-level statement and therefore precedes every type declaration below it, as C# requires.
//! Nothing calls any of the examples: this gate compiles them rather than running them.

use test_cabinet_core::gg::GgProgramLanguage;

use super::compile::compile_program;
use crate::prompts::{
    AssignedIssueView, AutoloadView, BoardView, CodeHeadingView, EndingView, MemoriesView,
    ModuleView, ReadFileView, ShellView, SkillView, SpawnableAgentView, SystemContext, TasksView,
    render_code_nothing_shown_for, render_system_for,
};
use crate::sandbox::{
    HARNESS_FINISH, PrepareContext, ProgramLanguage, REVIEW_APPROVE, REVIEW_REQUEST_CHANGES, spell,
};

/// This arm, resolved from the registry.
fn csharp() -> &'static dyn ProgramLanguage {
    crate::sandbox::language(GgProgramLanguage::CSharp)
}

/// A context with every section this arm's prompt can render turned on, so no example is missed for
/// living in a branch a narrower run does not take.
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
        language: Some(GgProgramLanguage::CSharp),
        program_library: true,
        modules: vec![ModuleView {
            path: "Gg.Files".to_string(),
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
        shell: ShellView {
            offered: true,
            offloaded: true,
            tail: "last 200 lines".to_string(),
            directory: "/tmp/gg-shell".to_string(),
        },
        skills: vec![SkillView {
            name: "physics".to_string(),
            description: "How to tune the simulation.".to_string(),
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
            finish: spell(csharp(), HARNESS_FINISH),
            approve: spell(csharp(), REVIEW_APPROVE),
            request_changes: spell(csharp(), REVIEW_REQUEST_CHANGES),
        },
    }
}

/// **Every C# example a model is shown compiles.**
///
/// The prompt, the "nothing shown" notice and the generated catalogue, gathered into one
/// compilation unit and put through this arm's production prepare step — the same `csc`, the same
/// reference set and the same flags a model's own reply gets, with the same SDK compiled beside it.
#[test]
fn every_csharp_example_a_model_is_shown_compiles() {
    let prompt = render_system_for(csharp(), &everything_on());
    let notice = render_code_nothing_shown_for(csharp());
    let catalogue: serde_json::Value =
        serde_json::from_str(super::SIGNATURES).expect("the generated catalogue is JSON");

    let mut snippets: Vec<(String, String)> = Vec::new();

    // The templates: a C# block is tagged, because an untagged fence there is a message shape.
    for (source, text) in [("the system prompt", &prompt), ("the notice", &notice)] {
        for (index, (tag, body)) in fenced(text).into_iter().enumerate() {
            if tag == "csharp" {
                snippets.push((format!("{source}, fenced block {index}"), body));
            }
        }
    }

    // The catalogue: its fences come from `<code>` in XML documentation comments, where an untagged
    // one is C#.
    let mut prose: Vec<String> = Vec::new();
    collect_strings(&catalogue, &mut prose);
    for (index, text) in prose.iter().enumerate() {
        for (tag, body) in fenced(text) {
            assert!(
                tag.is_empty() || tag == "csharp",
                "the catalogue carries a fenced block tagged `{tag}`. An SDK documentation \
                 comment's fences are C# unless they say otherwise, and this gate compiles them — \
                 if that block is not C#, take it out of the `<code>` element it came from and \
                 regenerate."
            );
            snippets.push((format!("the catalogue, doc string {index}"), body));
        }
    }

    // The gate must not be able to go quiet. A floor, not a count: an example added is welcome, an
    // example that stopped being recognised as one is the failure this catches.
    // The floor came DOWN from twelve when the prompt stopped naming functions: the template's two
    // worked programs were exactly what that rewrite removed, and what is counted here is now
    // essentially the **catalogue**, whose fences come from the SDK's own `<code>` elements and are
    // the code a model is shown when it opens a documentation view. That half is untouched. Lowering
    // a floor is the right move only when the examples were deliberately deleted in the same change,
    // as they were here; read the templates before touching this number again.
    assert!(
        snippets.len() >= 9,
        "only {} fenced C# examples were found across the prompt, the notice and the catalogue. A \
         ```csharp fence lost its tag, or a template stopped rendering a section — either way this \
         gate is no longer reading what a model is shown.",
        snippets.len()
    );

    // The one entry point, and it comes first because C# requires top-level statements to precede
    // every type declaration in the file.
    let mut program = String::from("return;\n\n");
    for (index, (label, snippet)) in snippets.iter().enumerate() {
        let body = snippet.trim_end();
        program.push_str(&format!(
            "// {label}\nstatic class __GgExample{index}\n{{\n    static void Run()\n    \
             {{\n{body}\n    }}\n}}\n\n"
        ));
    }

    if let Err(failure) = compile_program(&program, &[], &PrepareContext::new()) {
        panic!(
            "gg shows a model C# that does not compile. csc said:\n\n{failure:?}\n\nThe program \
             every example was gathered into, with a comment naming where each came \
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

/// Every fenced block in `text`, as its info-string tag and its body.
///
/// Deliberately simple: an opening fence is a line whose text begins with three backticks, and the
/// next such line closes it. That is the whole of what gg's own templates and documentation comments
/// write, and a reading that tried to be a CommonMark parser would be a second implementation of one
/// for no gain.
fn fenced(text: &str) -> Vec<(String, String)> {
    let mut blocks = Vec::new();
    let mut open: Option<(String, Vec<&str>)> = None;
    for line in text.lines() {
        let Some(info) = line.trim_start().strip_prefix("```") else {
            if let Some((_, body)) = open.as_mut() {
                body.push(line);
            }
            continue;
        };
        match open.take() {
            Some((tag, body)) => blocks.push((tag, body.join("\n"))),
            None => open = Some((info.trim().to_ascii_lowercase(), Vec::new())),
        }
    }
    blocks
}
