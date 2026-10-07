//! **Every C# example a model is shown is put through `csc`.**
//!
//! # Why this gate exists, and why it exists *here*
//!
//! Two things gg renders contain C# a model is invited to copy: the responses-as-code system prompt
//! as it renders for this arm (with the "your program showed you nothing" notice beside it) and this
//! arm's generated signature catalogue, whose prose is reflected out of the SDK's own XML documentation comments and rendered
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
//! `` `ApiErrorCode.NotFound` `` — and compiling one would mean guessing at the context it was
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
    AssignedIssueView, AutoloadView, CodeHeadingView, EndingView, MemoriesView, ModuleView,
    ReadFileView, SkillView, SpawnableAgentView, SystemContext, TasksView,
    render_code_nothing_shown_for, render_system,
};
use crate::sandbox::{
    PrepareContext, ProgramLanguage, SESSION_APPROVE, SESSION_FINISH, SESSION_REQUEST_CHANGES,
    spell,
};

/// This arm, resolved from the registry.
fn csharp() -> &'static dyn ProgramLanguage {
    crate::sandbox::language(GgProgramLanguage::CSharp)
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
        language: Some(crate::prompts::language_view(GgProgramLanguage::CSharp)),
        program_library: true,
        modules: vec![ModuleView {
            path: "Gg.Files".to_string(),
            brief: "Read, write, edit and list the files of the workspace.".to_string(),
            import: Some(super::SURFACE_IMPORT.to_string()),
        }],
        code_headings: vec![CodeHeadingView {
            heading: "File".to_string(),
            description: "a file you opened a view of".to_string(),
        }],
        custom_instructions: None,
        read_file: ReadFileView {
            offered: true,
            line_cap: Some(250),
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
        assigned_issue: Some(AssignedIssueView {
            id: "feat-1".to_string(),
        }),
        autoload_specs: Some(AutoloadView { locked: true }),
        persistence: true,
        ending: EndingView {
            standard: true,
            review: true,
            finish: spell(csharp(), SESSION_FINISH),
            approve: spell(csharp(), SESSION_APPROVE),
            request_changes: spell(csharp(), SESSION_REQUEST_CHANGES),
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
    let prompt = render_system(&everything_on(), None).expect("the code system prompt renders");
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
    //
    // The floor came DOWN from twelve when the prompt stopped naming functions: the template's two
    // worked programs were exactly what that rewrite removed. The prompt now writes no ```csharp
    // fence at all, so every example counted here comes from the **catalogue**, whose fences are the
    // `<code>` elements on the SDK and are the code a model is shown when it opens a documentation
    // view. That half is what this number is a floor on.
    //
    // It came down again, from ten to six, when the [SDK documentation
    // policies](.claude/skills/gg-sdk-documentation/SKILL.md) were applied to this arm. Four of the
    // ten were deleted outright — `Views.OpenText`'s, `Docs.Search`'s, `Shell.Run`'s and
    // `ApiException`'s — because each one's body called INTO ANOTHER MODULE to show its result, and
    // a documentation view for a module a run did not bind is a page the model was never given.
    // None of the four taught an idiom its own prose did not already state, so none was replaced.
    // `Files.ReadFile`'s was kept and rewritten to stay inside `Files`, because that one carries the
    // closed-union narrowing the register gate names as real teaching.
    //
    // Lowering a floor is the right move only when the examples were deliberately deleted in the
    // same change, as they were here; read the templates before touching this number again.
    assert!(
        snippets.len() >= 6,
        "only {} fenced C# examples were found across the prompt, the notice and the catalogue. A \
         ```csharp fence lost its tag, or an SDK `<code>` element lost its example — either way \
         this gate is no longer reading what a model is shown.",
        snippets.len()
    );

    // What a program that copied these examples would have written above them. An example is a
    // fragment shown inside a documentation view, so it carries no `using` of its own and cannot:
    // the view states the line beside it (`ModuleView::import`), and the model writes it once at the
    // top of its own program. Reconstructing that context is what makes this gate compile what a
    // model would really have compiled.
    //
    // `using Gg;` alone, which is this arm's own import line, held to the catalogue's by
    // `csharp.test.rs` and the one line a documentation view quotes. Nothing else is opened: an
    // example that needed a .NET namespace would fail here, and that failure is the signal, because
    // either the example has to write the name in full or the view has to state the second line.
    //
    // The one entry point comes after it and before every type declaration, because C# requires
    // top-level statements to precede both.
    let mut program = format!("{}\n\nreturn;\n\n", super::SURFACE_IMPORT);
    for (index, (label, snippet)) in snippets.iter().enumerate() {
        let body = snippet.trim_end();
        program.push_str(&format!(
            "// {label}\nstatic class __GgExample{index}\n{{\n    static void Run()\n    \
             {{\n{body}\n    }}\n}}\n\n"
        ));
    }

    if let Err(failure) = compile_program(&program, &[], &PrepareContext::detached()) {
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
