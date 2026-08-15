//! **Every C++ example a model is shown is put through `clang++`.**
//!
//! # Why this gate exists, and why it exists *here*
//!
//! Two things gg renders contain C++ a model is invited to copy: the responses-as-code system prompt
//! as it renders for this arm (with the "your program showed you nothing" notice beside it) and this
//! arm's generated signature catalogue, whose prose is reflected out of the SDK's own documentation comments and rendered into
//! documentation views. Everything about those two that can be checked without a compiler already is
//! — [`prompts::spellings`](crate::prompts) resolves every call *name* they quote against the
//! catalogue, and every argument name beside one against that signature — and none of it can tell
//! whether the surrounding code would build.
//!
//! On an interpreted arm that gap costs a model a runtime error it can read and work around. On a
//! **compiled** arm it costs the whole turn: the program is refused before it runs, and the
//! diagnostic the model gets back is about gg's own prose. [Rust](super::rust::examples) was the
//! first arm to be given this gate, because exactly that had shipped there.
//!
//! It lives with the arm rather than with the prompt tests because it needs the arm's whole compile
//! path: the real precompiled prelude, the real flags, the real SDK object. That is also why it is
//! one `clang++` rather than one per example — every snippet is enclosed in a `namespace` of its
//! own, so nothing one declares is visible to another and the compiler reports all of their
//! diagnostics at once.
//!
//! # What is treated as an example, and what is not
//!
//! **Fenced blocks**, from both sources, under one rule each. In the **templates**, which are
//! Markdown a model reads, a C++ block is tagged ` ```cpp ` — an untagged fence there is
//! deliberately not code, because the one in the messages section shows the *shape of a message* gg
//! sends. In the **catalogue**, whose fences come from `///` comments on the SDK, an untagged fence
//! is C++, because that is what a documentation comment's fence means in this language.
//!
//! **Inline spans are not gathered**, which is [Swift's answer](super::swift::examples) reached from
//! a different fact. A span here is often a *fragment of a signature* rather than an expression —
//! `` `{.limit = 40}` ``, `` `exit_code` `` — and compiling one would mean guessing at the context
//! it was written for. What is already checked about those spans is what a compiler would have told
//! us anyway: [`prompts`](crate::prompts) resolves each name against the catalogue and refuses a
//! hand-typed spelling, and the surface gate compares the catalogue against the artifact the SDK
//! really binds.
//!
//! # The one thing this gate has to know about C++
//!
//! **A snippet may be a whole program, and a whole program cannot be nested in a function.** The
//! prompt's examples are translation units — this arm's programs define `main`, so its examples show
//! one — while the catalogue's are statements out of a `///` comment. Both go into a `namespace` of
//! their own; a snippet that defines `main` goes in as it stands, because a `main` inside a namespace
//! is an ordinary function rather than an entry point, and one that does not is enclosed in a `void`
//! function first, because C++ has nowhere else for a statement to live. Nothing calls either: this
//! gate compiles examples rather than running them.

use test_cabinet_core::gg::GgProgramLanguage;

use super::compile::compile_program;
use crate::prompts::{
    AssignedIssueView, AutoloadView, BoardView, CodeHeadingView, EndingView, MemoriesView,
    ModuleView, ReadFileView, ShellView, SkillView, SpawnableAgentView, SystemContext, TasksView,
    render_code_nothing_shown_for, render_system,
};
use crate::sandbox::{
    PrepareContext, ProgramLanguage, SESSION_APPROVE, SESSION_FINISH, SESSION_REQUEST_CHANGES,
    spell,
};

/// This arm, resolved from the registry.
fn cpp() -> &'static dyn ProgramLanguage {
    crate::sandbox::language(GgProgramLanguage::Cpp)
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
        language: Some(crate::prompts::language_view(GgProgramLanguage::Cpp)),
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
        shell: ShellView {
            offered: true,
            offloaded: true,
            tail: "last 200 lines".to_string(),
            directory: "/tmp/gg-shell".to_string(),
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
            finish: spell(cpp(), SESSION_FINISH),
            approve: spell(cpp(), SESSION_APPROVE),
            request_changes: spell(cpp(), SESSION_REQUEST_CHANGES),
        },
    }
}

/// **Every C++ example a model is shown compiles.**
///
/// The prompt, the "nothing shown" notice and the generated catalogue, gathered into one program and
/// put through this arm's production prepare step — the same `clang++`, the same precompiled prelude
/// and the same flags a model's own reply gets.
#[test]
fn every_cpp_example_a_model_is_shown_compiles() {
    let prompt = render_system(&everything_on(), None).expect("the code system prompt renders");
    let notice = render_code_nothing_shown_for(cpp());
    let catalogue: serde_json::Value =
        serde_json::from_str(super::SIGNATURES).expect("the generated catalogue is JSON");

    let mut snippets: Vec<(String, String)> = Vec::new();

    // The templates: a C++ block is tagged, because an untagged fence there is a message shape.
    for (source, text) in [("the system prompt", &prompt), ("the notice", &notice)] {
        for (index, (tag, body)) in fenced(text).into_iter().enumerate() {
            if tag == "cpp" {
                snippets.push((format!("{source}, fenced block {index}"), body));
            }
        }
    }

    // The catalogue: its fences come from documentation comments, where an untagged one is C++.
    let mut prose: Vec<String> = Vec::new();
    collect_strings(&catalogue, &mut prose);
    for (index, text) in prose.iter().enumerate() {
        for (tag, body) in fenced(text) {
            assert!(
                tag.is_empty() || tag == "cpp",
                "the catalogue carries a fenced block tagged `{tag}`. An SDK documentation \
                 comment's fences are C++ unless they say otherwise, and this gate compiles them — \
                 if that block is not C++, tag it `text` in the comment it came from and regenerate."
            );
            snippets.push((format!("the catalogue, doc string {index}"), body));
        }
    }

    // The gate must not be able to go quiet. A floor, not a count: an example added is welcome, an
    // example that stopped being recognised as one is the failure this catches.
    assert!(
        snippets.len() >= 3,
        "only {} fenced C++ examples were found across the prompt, the notice and the catalogue. A \
         ```cpp fence lost its tag, or a template stopped rendering a section — either way this \
         gate is no longer reading what a model is shown.",
        snippets.len()
    );

    let mut program = String::new();
    for (index, (label, snippet)) in snippets.iter().enumerate() {
        let body = snippet.trim_end();
        // A whole program goes in as it stands; a statement fragment is enclosed in a function
        // first. See this module's own documentation for why the distinction is C++'s rather than
        // this gate's.
        let enclosed = match super::source::defines_main(body) {
            true => body.to_string(),
            false => format!("void run() {{\n{body}\n}}"),
        };
        program.push_str(&format!(
            "// {label}\nnamespace __gg_example_{index} {{\n{enclosed}\n}}\n"
        ));
    }
    // The one entry point, because this arm refuses a program that defines none — and it is gg's
    // rather than an example's, so no snippet has to be the one that provides it.
    program.push_str("int main() { return 0; }\n");

    if let Err(failure) = compile_program(&program, &[], &PrepareContext::new()) {
        panic!(
            "gg shows a model C++ that does not compile. clang++ said:\n\n{failure:?}\n\nThe \
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
