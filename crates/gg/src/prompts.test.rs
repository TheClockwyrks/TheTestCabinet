use test_cabinet_core::gg::GgProgramLanguage;

use super::*;
use crate::ending::EndingRole;

/// A rendered prompt with every run of whitespace collapsed to one space.
///
/// The templates hard-wrap their prose (that is what makes them editable), so where a line
/// happens to break is not a property worth asserting — a phrase check runs against this.
fn flat(rendered: &str) -> String {
    rendered.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A [flattened](flat) prompt with Markdown emphasis stripped.
///
/// Where a sentence is worth asserting at all, which of its words the template happens to bold is
/// not part of what it says: `**returns**` and `*returns*` and `returns` are one statement, and a
/// test that can tell them apart is a test that fires on an editing pass. Only `*` is removed —
/// `_` is a character gg's own spellings contain, and a language whose calls are `read_file` would
/// have its identifiers dismantled by stripping it.
fn plain(rendered: &str) -> String {
    flat(rendered).replace('*', "")
}

/// A context with every capability **off**: the minimum a run can render.
fn bare_system() -> SystemContext {
    SystemContext::default()
}

/// A context with every capability **on**, so the maximal prompt is exercised. In tool-calling mode
/// (`responses_as_code` off), so the non-code sections — the read facts, the tasks section — are the
/// ones under test.
fn full_system() -> SystemContext {
    SystemContext {
        apis: vec![
            ApiView {
                object: "fs".to_string(),
                description: "read, write, and edit workspace files".to_string(),
            },
            ApiView {
                object: "harness".to_string(),
                description: "the run itself — end it with `finish`, and read documentation"
                    .to_string(),
            },
        ],
        responses_as_code: false,
        language: None,
        program_library: false,
        code_headings: Vec::new(),
        custom_instructions: None,
        subagents: false,
        spawnable_agents: Vec::new(),
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
            scratchpad: true,
            markdown: false,
            keyword_search: false,
            max_count: Some(8),
            max_len_per_memory: Some(2_000),
            max_total_len: Some(8_000),
            max_len_index: None,
            max_len_description: None,
            max_results: None,
            read_only: false,
            linked: false,
            scope: "isolated".to_string(),
        }),
        tasks: Some(TasksView { max_tasks: 100 }),
        board: Some(BoardView {
            max_epics: 50,
            max_issues: 2000,
            max_retries: 1,
            reviewers_required: true,
            issue_agents: vec![SpawnableAgentView {
                name: "builder".to_string(),
                description: "implements issues".to_string(),
            }],
            reviewer_agents: vec![SpawnableAgentView {
                name: "critic".to_string(),
                description: "reviews finished work".to_string(),
            }],
        }),
        assigned_issue: Some(AssignedIssueView {
            id: "feat-1".to_string(),
        }),
        autoload_specs: Some(AutoloadView { locked: true }),
        persistence: true,
        ending: ending_view(EndingRole::Standard, false),
    }
}

/// The [`EndingView`] a role renders under, built the way [`crate::agent`] builds it so the tests
/// and the loop cannot disagree about what a call is spelled.
fn ending_view(role: EndingRole, responses_as_code: bool) -> EndingView {
    let call = |object: &str, code: &str, tool: &str| {
        if responses_as_code {
            format!("{object}.{code}")
        } else {
            tool.to_string()
        }
    };
    EndingView {
        standard: matches!(role, EndingRole::Standard),
        review: matches!(role, EndingRole::Review),
        finish: call("harness", "finish", "finish"),
        approve: call("review", "approve", "approve"),
        request_changes: call("review", "requestChanges", "request_changes"),
    }
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/// Every embedded template parses and is registered under its name — the check that a `.hbs`
/// edit cannot ship a syntax error.
#[test]
fn every_template_is_registered() {
    let engine = engine();
    for (name, _) in TEMPLATES.iter() {
        assert!(
            engine.get_template(name).is_some(),
            "template `{name}` is not registered"
        );
    }
}

/// The whitespace tidier collapses the blank runs a skipped `{{#if}}` section leaves behind,
/// keeps a single blank line as the paragraph separator, and trims the ends.
#[test]
fn tidy_collapses_blank_runs() {
    assert_eq!(tidy("\n\na\n\n\n\n\nb\n\n"), "a\n\nb");
    assert_eq!(tidy("a\nb"), "a\nb");
    assert_eq!(tidy("a\n\nb"), "a\n\nb");
}

// ---------------------------------------------------------------------------
// The system prompt
// ---------------------------------------------------------------------------

/// With every capability off, the base prompt is (almost) nothing: no custom instructions, no code
/// section, no image or read guidance, and none of the capability sections.
///
/// `## Reading Files` is in the list because a heading is as much a leak as a sentence is. It sits
/// inside the `readFile.offered` guard rather than above it, so a run that withholds `read_file`
/// does not end on a section title with nothing underneath it — which is what a model reads as
/// *there was supposed to be something here*.
#[test]
fn a_bare_run_renders_almost_nothing() {
    let prompt = render_system(&bare_system(), None);
    for absent in [
        "## Responses as Code",
        "## Tasks",
        "## Subagents",
        "## Reading Files",
        "Reading images",
        "Your APIs",
    ] {
        assert!(
            !prompt.contains(absent),
            "the bare prompt leaked `{absent}`:\n{prompt}"
        );
    }
    assert!(!prompt.contains("\n\n\n"), "prompt has a blank-line run");
}

/// In responses-as-code mode the prompt names the API objects a program has, teaches discovery
/// through `object.list()` and `fn.docs()`, and points at `finish` to end the run — and it lists no
/// tool signatures or type declarations at all. Those are discovered on demand.
///
/// The assertions check for the words the prompt must contain — each object's name and its
/// description, the discovery calls, `finish` — not the punctuation that separates them, so the
/// prompt's wording can be revised without breaking a test that was only ever about its content.
#[test]
fn code_mode_names_objects_and_teaches_discovery() {
    let context = SystemContext {
        responses_as_code: true,
        language: Some(GgProgramLanguage::TypeScript),
        apis: vec![
            ApiView {
                object: "fs".to_string(),
                description: "read, write, and edit workspace files".to_string(),
            },
            ApiView {
                object: "system".to_string(),
                description: "run shell commands in the workspace".to_string(),
            },
            ApiView {
                object: "harness".to_string(),
                description: "the run itself — end it with `finish`, and read documentation"
                    .to_string(),
            },
        ],
        ..SystemContext::default()
    };
    let prompt = render_system(&context, None);
    let flat = flat(&prompt);
    assert!(prompt.contains("## Responses as Code"), "{prompt}");
    // Each object is named and described — the name and a distinctive phrase from its description,
    // not the separator (`:` / ` — `) the template happens to put between them.
    for keyword in [
        "`fs`",
        "read, write, and edit workspace files",
        "`system`",
        "run shell commands in the workspace",
        "`harness`",
        "<object>.list()",
        "view.openDocsView",
        "finish",
    ] {
        assert!(flat.contains(keyword), "missing `{keyword}`:\n{prompt}");
    }
    // The signature dump is gone: no return types and no type declarations of any kind. A type's
    // *name* is allowed — the type-check section names `ToolError`, because narrowing a caught error
    // is the one thing a model has to spell to read a failure at all, and a prompt that withheld it
    // would buy a strict-mode diagnostic every time a program caught something. What is banned is
    // the block of declarations the prompt used to carry, which is what the on-demand documentation
    // lookup replaced.
    //
    // So the ban is on the declaration *shape* rather than on a list of spellings: any line that
    // opens a declaration fails, whatever it goes on to declare. Naming three types would leave a
    // reintroduced `interface ToolError { … }` — or a fourth type nobody thought of — passing.
    assert!(!prompt.contains("): FileRead"), "{prompt}");
    for line in prompt.lines() {
        let opener = line.trim_start();
        assert!(
            !["interface ", "declare ", "class ", "type "]
                .iter()
                .any(|keyword| opener.starts_with(keyword)),
            "the prompt declares a type again:\n{line}\n\nin:\n{prompt}"
        );
    }
}

/// **The code prompt teaches views, not `console.log`.**
///
/// This is the one section of the system prompt the whole context-view feature rests on. A model
/// that is still told to print values will print them, and its output will vanish into the
/// operator's stream — so the prompt has to name the channel that carries, show it being used, and
/// say plainly where logging goes instead.
///
/// The teaching is drawn from what the run actually binds: `view.openText` is ungated (a run with
/// no tools at all must still be able to show its model something), while the `view.openFile` line
/// appears only when this run offers `read_file`.
///
/// It is taught in the opening paragraphs rather than under a section of its own — the rewrite in
/// `b60d2798` folded the old *Showing yourself things* section into the intro, on the reasoning
/// that the one fact a code-mode model has to hold from its first turn should not be four screens
/// down. So these assertions pin the *content* — the calls, the gating, where logging goes — and
/// not the heading it happens to sit under.
#[test]
fn code_mode_teaches_views_rather_than_logging() {
    let with_reads = render_system(
        &SystemContext {
            responses_as_code: true,
            language: Some(GgProgramLanguage::TypeScript),
            apis: vec![ApiView {
                object: "view".to_string(),
                description: "show yourself a file or a value — the only way material enters your \
                              context"
                    .to_string(),
            }],
            read_file: ReadFileView {
                offered: true,
                ..ReadFileView::default()
            },
            ..SystemContext::default()
        },
        None,
    );
    let flat_reads = flat(&with_reads);
    // The channel that carries: views are what the next turn is built from, and both calls that
    // open one are named where the model first meets them. The *argument shape* of each is
    // [another test](code_mode_names_the_argument_shapes_a_program_starts_from)'s subject; what is
    // asserted here is that the call is named at all, and named under the right gate.
    assert!(flat_reads.contains("next turn"), "{with_reads}");
    assert!(flat_reads.contains("view.openText"), "{with_reads}");
    assert!(flat_reads.contains("view.openFile"), "{with_reads}");
    // Logging is named, as the thing that does NOT reach the model — never as an instruction.
    assert!(flat_reads.contains("the only way"), "{with_reads}");
    assert!(flat_reads.contains("console.log"), "{with_reads}");
    assert!(
        !flat_reads.contains("Use `console.log()`"),
        "the prompt still instructs the model to log:\n{with_reads}"
    );
    assert!(
        !with_reads.contains("\n\n\n"),
        "blank-line run:\n{with_reads}"
    );

    // A run that withholds `read_file` is not taught the file view — the same ablation discipline
    // every other section follows — but keeps the text view, which nothing gates.
    let no_reads = render_system(
        &SystemContext {
            responses_as_code: true,
            language: Some(GgProgramLanguage::TypeScript),
            apis: vec![ApiView {
                object: "view".to_string(),
                description: "show yourself a file or a value".to_string(),
            }],
            ..SystemContext::default()
        },
        None,
    );
    assert!(no_reads.contains("view.openText"), "{no_reads}");
    assert!(!no_reads.contains("view.openFile"), "{no_reads}");
    assert!(!no_reads.contains("\n\n\n"), "blank-line run:\n{no_reads}");
}

/// One function's signature as TypeScript's committed catalogue declares it, qualified by its
/// object — what a prompt that quotes a signature must be quoting.
fn catalogued_signature(object: &str, key: &str) -> String {
    catalogued_signature_in(
        crate::sandbox::language(GgProgramLanguage::TypeScript),
        object,
        key,
    )
}

/// One function's **name**, qualified by its object, as `language`'s catalogue spells it — the
/// `object.name` head a template renders from an `{{api.…}}.call` reference.
fn catalogued_call_in(
    language: &'static dyn crate::sandbox::ProgramLanguage,
    object: &str,
    key: &str,
) -> String {
    let function = crate::sandbox::catalogue_functions(language)
        .into_iter()
        .find(|function| function.object == object && function.key == key)
        .unwrap_or_else(|| panic!("`{object}.{key}` is catalogued"));
    format!("{object}.{}", function.name)
}

/// The same, for any language the seam registers — including the
/// [fixture](crate::sandbox::fixture_languages), which is the only way to assert that a prompt
/// quoted *that* language's shape rather than TypeScript's.
///
/// Written this way rather than as a literal because the literal is the defect: a signature typed
/// into a test is a second copy of the SDK's declaration, and a test that pinned one would go on
/// passing after the SDK's argument was renamed and the prompt started describing a call nobody has.
fn catalogued_signature_in(
    language: &'static dyn crate::sandbox::ProgramLanguage,
    object: &str,
    key: &str,
) -> String {
    let function = crate::sandbox::catalogue_functions(language)
        .into_iter()
        .find(|function| function.object == object && function.key == key)
        .unwrap_or_else(|| panic!("`{object}.{key}` is catalogued"));
    format!(
        "{object}.{}",
        function
            .signatures
            .first()
            .expect("every catalogue entry carries a signature")
            .signature
    )
}

/// **The code prompt names the shape of the calls a program cannot get started without.**
///
/// The surface is otherwise [read on demand](https://docs.testcabinet.ai/gg/responses-as-code/), and
/// that stays true — but three calls are load-bearing enough that discovering them costs a turn each,
/// and a turn spent finding `system.shell` is a turn not spent working. So the opening section names
/// the argument shape of exactly these, and no others.
///
/// Both facts under test are **gated**, on the same rule every named call in this prompt follows: a
/// call named to a run that does not bind it is a `ReferenceError` the model copies verbatim, and an
/// argument named to a run where it does nothing is worse than not naming it — the model spends the
/// turn wondering why the window it asked for was ignored.
#[test]
fn code_mode_names_the_argument_shapes_a_program_starts_from() {
    let code = |read_file: ReadFileView, shell: ShellView| {
        render_system(
            &SystemContext {
                responses_as_code: true,
                language: Some(GgProgramLanguage::TypeScript),
                apis: vec![ApiView {
                    object: "view".to_string(),
                    description: "show yourself a file or a value".to_string(),
                }],
                read_file,
                shell,
                ..SystemContext::default()
            },
            None,
        )
    };

    // A capped read is the only one that has a window to teach: under the unlimited policy
    // `read_file` takes no `offset`/`limit` at all, so naming them would describe knobs that do
    // nothing to the one run that cannot use them.
    let capped = code(
        ReadFileView {
            offered: true,
            capped: true,
            line_cap: 250,
            images: true,
        },
        ShellView::default(),
    );
    let flat_capped = flat(&capped);
    assert!(
        flat_capped.contains("view.openFile(path, { offset: 400, limit: 200 })"),
        "{capped}"
    );
    assert!(
        flat_capped.contains("A `limit` larger than 250 is honored."),
        "{capped}"
    );

    let uncapped = code(
        ReadFileView {
            offered: true,
            images: true,
            ..ReadFileView::default()
        },
        ShellView::default(),
    );
    assert!(uncapped.contains("view.openFile(path)"), "{uncapped}");
    assert!(!uncapped.contains("offset"), "{uncapped}");
    assert!(!uncapped.contains("limit"), "{uncapped}");

    // Running a command is the most common thing a program does, and it is named exactly when the
    // run offers it — independently of whether that run offloads the output.
    let with_shell = code(
        ReadFileView::default(),
        ShellView {
            offered: true,
            ..ShellView::default()
        },
    );
    // The signature is quoted from the catalogue rather than written out here, which is the whole
    // of what this asserts: whatever the SDK declares `shell` to take is what the prompt says it
    // takes, and a renamed argument reaches the model without anyone editing a template.
    assert!(
        with_shell.contains(&catalogued_signature("system", "shell")),
        "{with_shell}"
    );
    assert!(with_shell.contains("`exitCode`"), "{with_shell}");
    assert!(
        !with_shell.contains("\n\n\n"),
        "blank-line run:\n{with_shell}"
    );

    let without_shell = code(ReadFileView::default(), ShellView::default());
    assert!(!without_shell.contains("system.shell"), "{without_shell}");
    assert!(
        !without_shell.contains("\n\n\n"),
        "blank-line run:\n{without_shell}"
    );
}

/// **The prompt says which of the two discovery calls actually reaches the model.**
///
/// They read as a pair and they are not one: `<object>.list()` **returns** its directory to the
/// program, and `view.openDocsView` **opens a view**. A prompt that offers them as two ways to look
/// something up teaches that calling `system.list()` shows you the functions on `system` — and it
/// does not. It shows them to your program, which then discards them, and the turn produces nothing
/// at all: the model reads a `Notice` saying its program put nothing in its context, having done
/// exactly what it was told.
///
/// So the route each takes is the thing the paragraph is about, and the wrapping call a directory
/// needs is written out rather than left to be inferred.
#[test]
fn code_mode_distinguishes_a_returned_directory_from_an_opened_view() {
    let prompt = render_system(
        &SystemContext {
            responses_as_code: true,
            language: Some(GgProgramLanguage::TypeScript),
            apis: vec![ApiView {
                object: "fs".to_string(),
                description: "read, write, and edit workspace files".to_string(),
            }],
            ..SystemContext::default()
        },
        None,
    );
    let flat = plain(&prompt);
    // `list()` hands its answer to the PROGRAM, and the prompt shows the one call that forwards it
    // to the model.
    assert!(flat.contains("`<object>.list()` returns"), "{prompt}");
    assert!(flat.contains("to your program"), "{prompt}");
    assert!(
        flat.contains("view.openText") && flat.contains("fs.list()"),
        "the worked example that forwards a directory to a view is gone:\n{prompt}"
    );
    // `openDocsView` is the one that opens a view directly.
    assert!(flat.contains("view.openDocsView"), "{prompt}");
    assert!(flat.contains("opens a view"), "{prompt}");
    // And whichever route was taken, the material lands on the next turn.
    assert!(flat.contains("next turn"), "{prompt}");
    // The example is written inline: this prompt forbids Markdown formatting in a reply, so it can
    // hardly fence a line of program code as the model it wants copied.
    assert!(!prompt.contains("```"), "{prompt}");
}

/// A tool-calling run's non-code sections still render: the read-cap and image facts (when
/// `read_file` is offered and capped), and the task instructions. The remaining capability sections
/// were trimmed from the prompt and are re-added as they are validated.
#[test]
fn a_full_run_renders_the_read_facts_and_tasks() {
    let prompt = render_system(&full_system(), None);
    let flat = flat(&prompt);
    assert!(prompt.contains("Reading images is supported."), "{prompt}");
    assert!(
        flat.contains("250 lines per call unless you ask for more"),
        "{prompt}"
    );
    assert!(prompt.contains("## Tasks"), "{prompt}");
    assert!(!prompt.contains("\n\n\n"), "prompt has a blank-line run");
}

/// No run describes shell offloading, whether it is in force or not.
///
/// The section that stated the tail, the directory the full output is kept in, and that the
/// remainder is grep-able was trimmed from both templates (commit `97a7435c`): when offloading
/// actually kicks in, every one of those facts travels with the truncated output itself, so
/// stating them up front only spends window on a rule the model is told again at the moment it
/// applies. This pins the absence in both execution modes and under both shell views.
#[test]
fn no_run_describes_shell_offloading() {
    for responses_as_code in [false, true] {
        for shell in [full_system().shell, ShellView::default()] {
            let context = SystemContext {
                responses_as_code,
                language: responses_as_code.then_some(GgProgramLanguage::TypeScript),
                shell,
                ..full_system()
            };
            let prompt = render_system(&context, None);
            assert!(!prompt.contains("## Shell output"), "{prompt}");
            assert!(!prompt.contains("/tmp/gg-shell"), "{prompt}");
        }
    }
}

/// **The ending section always demands an explicit call**, whatever the agent's role.
///
/// There is no "a reply with no tool call ends the run" arm any more, in either mode. The prompt
/// says so plainly, because the alternative is a model that answers in prose believing it has
/// finished and is instead handed an error turn it was never warned about.
#[test]
fn the_ending_section_always_demands_an_explicit_call() {
    let prompt = render_system(
        &SystemContext {
            ending: ending_view(EndingRole::Standard, false),
            ..SystemContext::default()
        },
        None,
    );
    let flat = flat(&prompt);
    assert!(prompt.contains("## Ending your session"), "{prompt}");
    assert!(
        flat.contains("A reply with no tool call is an error."),
        "{prompt}"
    );
    assert!(!prompt.contains("\n\n\n"), "blank-line run:\n{prompt}");
}

/// No run describes compaction, under any strategy or execution mode.
///
/// The section that named the trigger, what survives the boundary, and what each in-loop strategy
/// would ask of the model is absent from both templates: compaction is gg's process, not the
/// agent's, and the one moment the agent has a part to play — the turn gg asks for a summary, a
/// `compact` call, or a round of memory writes — carries its own instructions. Most sessions never
/// compact at all, so every one of them would have paid for a paragraph about a thing that never
/// happened. This pins the absence, so re-adding the section is a deliberate edit rather than a
/// silent one.
#[test]
fn no_run_describes_compaction() {
    for responses_as_code in [false, true] {
        // `harness` is the object a standard role's `finish` lives on, and the code template
        // renders its object list, so a realistic code context carries at least it.
        let apis = if responses_as_code {
            vec![ApiView {
                object: "harness".to_string(),
                description: "end your session".to_string(),
            }]
        } else {
            Vec::new()
        };
        let prompt = render_system(
            &SystemContext {
                responses_as_code,
                language: responses_as_code.then_some(GgProgramLanguage::TypeScript),
                apis,
                ending: ending_view(EndingRole::Standard, responses_as_code),
                ..SystemContext::default()
            },
            None,
        );
        let flat = flat(&prompt);
        for absent in [
            "compaction",
            "Compaction",
            "80% full",
            "`compact`",
            "context.compact",
        ] {
            assert!(!flat.contains(absent), "leaked `{absent}`:\n{prompt}");
        }
    }
}

/// Each [role](EndingRole) is told exactly its own ending calls, in the form its execution mode
/// writes them — and is told about no others.
///
/// The negative half is the load-bearing one. A reviewer that reads "call `finish` when the work is
/// complete" has been handed a second, wrong way to end, and the one it would reach for returns no
/// verdict at all — which leaves the issue it reviewed unaccepted.
#[test]
fn each_role_is_told_only_its_own_ending() {
    let cases = [
        (
            EndingRole::Standard,
            "finish",
            ["approve", "request_changes"],
        ),
        (EndingRole::Review, "approve", ["finish", "finish"]),
    ];
    for (role, present, absent) in cases {
        let prompt = render_system(
            &SystemContext {
                ending: ending_view(role, false),
                ..SystemContext::default()
            },
            None,
        );
        let flat = flat(&prompt);
        assert!(flat.contains("## Ending your session"), "{prompt}");
        assert!(flat.contains(&format!("`{present}`")), "{prompt}");
        for name in absent {
            assert!(
                !flat.contains(&format!("`{name}`")),
                "role {role:?} was offered `{name}`:\n{prompt}"
            );
        }
        assert!(!prompt.contains("\n\n\n"), "blank-line run:\n{prompt}");
    }
}

/// A code run names its ending calls in the grouped form a program actually writes — **all** of its
/// role's calls, and none of the other role's.
///
/// A reviewer holds two, not one: approving and requesting changes are the two halves of a verdict,
/// and a prompt that named only the first would leave an agent that found a defect with no way to
/// say so that does not read as approval. The negative half is
/// [`each_role_is_told_only_its_own_ending`]'s argument, asserted again here because the grouped
/// spellings are a different rendering and a template can lose the distinction in either one.
#[test]
fn code_mode_names_the_grouped_ending_calls() {
    for (role, expected, absent) in [
        (
            EndingRole::Standard,
            &["harness.finish"][..],
            &["review.approve", "review.requestChanges"][..],
        ),
        (
            EndingRole::Review,
            &["review.approve", "review.requestChanges"][..],
            &["harness.finish"][..],
        ),
    ] {
        let prompt = render_system(
            &SystemContext {
                responses_as_code: true,
                language: Some(GgProgramLanguage::TypeScript),
                apis: vec![ApiView {
                    object: "harness".to_string(),
                    description: "read documentation".to_string(),
                }],
                ending: ending_view(role, true),
                ..SystemContext::default()
            },
            None,
        );
        for call in expected {
            assert!(
                prompt.contains(call),
                "role {role:?} lost `{call}`:\n{prompt}"
            );
        }
        for call in absent {
            assert!(
                !prompt.contains(call),
                "role {role:?} was offered `{call}`:\n{prompt}"
            );
        }
        assert!(!prompt.contains("\n\n\n"), "blank-line run:\n{prompt}");
    }
}

/// The task section carries its tool instructions and this run's ceiling.
#[test]
fn the_task_section_carries_the_tool_instructions() {
    let context = SystemContext {
        tasks: Some(TasksView { max_tasks: 100 }),
        ..SystemContext::default()
    };
    let prompt = render_system(&context, None);
    for instruction in ["`add_task`", "`complete_task`", "directed acyclic graph"] {
        assert!(
            flat(&prompt).contains(instruction),
            "missing `{instruction}`:\n{prompt}"
        );
    }
    assert!(flat(&prompt).contains("At most 100 may be recorded."));
}

/// The two execution modes render **different** capability sections: a tool-calling run names each
/// capability's free-standing tools (`add_task`, `spawn_subagent`, `create_epic`), while a
/// responses-as-code run names their grouped methods (`tasks.addTask`, `agents.spawnSubagent`,
/// `project.createEpic`) — because in code mode there is no free-standing `add_task`, only a method
/// on the `tasks` object. This is the whole point of the split, so it is pinned directly: the same
/// context, rendered in each mode, must teach the calls that mode actually offers.
#[test]
fn the_two_modes_name_calls_in_their_own_form() {
    // A context with every call-naming section on, in the given mode. `apis` carries `harness` so
    // the code arm has an object to render; it is inert on the tool-calling arm.
    fn every_section_on(responses_as_code: bool) -> SystemContext {
        SystemContext {
            responses_as_code,
            language: responses_as_code.then_some(GgProgramLanguage::TypeScript),
            apis: vec![ApiView {
                object: "harness".to_string(),
                description: "the run itself".to_string(),
            }],
            tasks: Some(TasksView { max_tasks: 100 }),
            subagents: true,
            spawnable_agents: vec![SpawnableAgentView {
                name: "helper".to_string(),
                description: "does scoped work".to_string(),
            }],
            board: Some(BoardView {
                max_epics: 50,
                max_issues: 2000,
                max_retries: 1,
                reviewers_required: true,
                issue_agents: vec![SpawnableAgentView {
                    name: "builder".to_string(),
                    description: "implements issues".to_string(),
                }],
                reviewer_agents: vec![SpawnableAgentView {
                    name: "critic".to_string(),
                    description: "reviews finished work".to_string(),
                }],
            }),
            ..SystemContext::default()
        }
    }

    // Tool-calling: the free-standing tool names, and none of the grouped forms.
    let tools = flat(&render_system(&every_section_on(false), None));
    for tool in [
        "`add_task`",
        "`spawn_subagent`",
        "`create_epic`",
        "`create_issue`",
    ] {
        assert!(
            tools.contains(tool),
            "tool-calling missing `{tool}`:\n{tools}"
        );
    }
    for grouped in [
        "tasks.addTask",
        "agents.spawnSubagent",
        "project.createEpic",
    ] {
        assert!(
            !tools.contains(grouped),
            "tool-calling leaked grouped form `{grouped}`:\n{tools}"
        );
    }

    // Responses-as-code: the grouped methods, and none of the free-standing tool names.
    let code = flat(&render_system(&every_section_on(true), None));
    for grouped in [
        "`tasks.addTask`",
        "`tasks.setBlockedBy`",
        "`agents.spawnSubagent`",
        "`project.createEpic`",
        "`project.createIssue`",
    ] {
        assert!(
            code.contains(grouped),
            "code mode missing `{grouped}`:\n{code}"
        );
    }
    for tool in [
        "`add_task`",
        "`spawn_subagent`",
        "`create_epic`",
        "`create_issue`",
    ] {
        assert!(
            !code.contains(tool),
            "code mode leaked free-standing tool `{tool}`:\n{code}"
        );
    }
}
/// The **Subagents** section is gated on the agent actually having `spawn_subagent`,
/// **not** on its roster being non-empty — and the project-management section lists the
/// roster's implementers and reviewers separately.
///
/// The two are independent by design: a run may give an agent a roster purely so it can
/// staff board issues, with no delegation anywhere in sight, and teaching that agent to
/// spawn would be teaching it about a tool it does not have. The old prompt derived the
/// section from the roster and so did exactly that.
#[test]
fn the_subagents_section_follows_the_capability_not_the_roster() {
    let roster = |name: &str, description: &str| SpawnableAgentView {
        name: name.to_string(),
        description: description.to_string(),
    };
    // A board-only agent: implementers and reviewers on the roster, no spawn tool.
    let board_only = SystemContext {
        subagents: false,
        spawnable_agents: vec![roster("helper", "does scoped work")],
        board: Some(BoardView {
            max_epics: 50,
            max_issues: 2000,
            max_retries: 1,
            reviewers_required: false,
            issue_agents: vec![roster("builder", "implements issues")],
            reviewer_agents: vec![roster("critic", "reviews finished work")],
        }),
        ..SystemContext::default()
    };
    let rendered = flat(&render_system(&board_only, None));
    assert!(
        !rendered.contains("spawn_subagent"),
        "an agent without the capability is never taught to spawn:\n{rendered}"
    );
    assert!(
        !rendered.contains("`helper`"),
        "and its spawnable roster is not listed either:\n{rendered}"
    );
    // Both issue rosters are named, so the model knows which names each call accepts.
    for expected in [
        "`builder`",
        "implements issues",
        "`critic`",
        "reviews finished work",
    ] {
        assert!(
            rendered.contains(expected),
            "the project-management section must name {expected}:\n{rendered}"
        );
    }

    // The same roster with the capability on adds the Subagents section, unchanged.
    let delegating = SystemContext {
        subagents: true,
        ..board_only
    };
    let rendered = flat(&render_system(&delegating, None));
    assert!(rendered.contains("spawn_subagent"), "{rendered}");
    assert!(rendered.contains("`helper`"), "{rendered}");
}

/// The image line states, neutrally, whether reading images is supported — and says nothing at all
/// when `read_file` is not offered, since there is then no tool that could show or describe one.
#[test]
fn the_image_support_is_stated_only_when_read_file_is_offered() {
    let supported = SystemContext {
        read_file: ReadFileView {
            offered: true,
            images: true,
            ..ReadFileView::default()
        },
        ..SystemContext::default()
    };
    assert!(
        render_system(&supported, None).contains("Reading images is supported."),
        "supported run"
    );
    let blind = SystemContext {
        read_file: ReadFileView {
            offered: true,
            images: false,
            ..ReadFileView::default()
        },
        ..SystemContext::default()
    };
    assert!(
        render_system(&blind, None).contains("Reading images is not supported."),
        "text-only run"
    );
    let withheld = SystemContext {
        read_file: ReadFileView {
            offered: false,
            ..ReadFileView::default()
        },
        ..SystemContext::default()
    };
    assert!(!render_system(&withheld, None).contains("Reading images"));
}

/// The read cap is stated only when one is in force, and it gives the configured number.
#[test]
fn the_read_cap_is_stated_only_when_one_is_in_force() {
    let capped = SystemContext {
        read_file: ReadFileView {
            offered: true,
            capped: true,
            line_cap: 40,
            images: true,
        },
        ..SystemContext::default()
    };
    assert!(
        flat(&render_system(&capped, None)).contains("40 lines per call unless you ask for more")
    );
    let uncapped = SystemContext {
        read_file: ReadFileView {
            offered: true,
            capped: false,
            images: true,
            ..ReadFileView::default()
        },
        ..SystemContext::default()
    };
    assert!(!render_system(&uncapped, None).contains("lines"));
}

/// A code run with no workspace capabilities still names `harness` — a program can always read
/// documentation and end its session — and names no other object.
#[test]
fn code_mode_with_no_workspace_tools_still_names_harness() {
    let context = SystemContext {
        responses_as_code: true,
        language: Some(GgProgramLanguage::TypeScript),
        apis: vec![ApiView {
            object: "harness".to_string(),
            description: "read documentation".to_string(),
        }],
        ending: ending_view(EndingRole::Standard, true),
        ..SystemContext::default()
    };
    let prompt = render_system(&context, None);
    assert!(prompt.contains("`harness`"), "{prompt}");
    // A program can always end its session — the prompt names the call however it spells it.
    assert!(prompt.contains("harness.finish"), "{prompt}");
    assert!(!prompt.contains("`fs`"), "{prompt}");
}

/// The tool-calling prompt names no tools at all: on that path the tools are in the request, so the
/// prompt renders no API section and no tool name.
#[test]
fn the_tool_calling_prompt_names_no_tools() {
    // `full_system()` is a tool-calling context (`responses_as_code` is false).
    let prompt = render_system(&full_system(), None);
    assert!(!prompt.contains("## Responses as Code"), "{prompt}");
    assert!(!prompt.contains("Your APIs"), "{prompt}");
    assert!(!prompt.contains("`fs`"), "{prompt}");
    assert!(!prompt.contains("write_file"), "{prompt}");
}

// ---------------------------------------------------------------------------
// The code-turn feedback
// ---------------------------------------------------------------------------

/// A skipped `{{#if}}` section must not leave a run of blank lines behind. The one feedback template
/// that still takes a context is not put through [`tidy`], so the whitespace has to be right in the
/// template itself.
fn assert_no_blank_run(rendered: &str) {
    assert!(
        !rendered.contains("\n\n\n"),
        "a skipped section left a blank-line run:\n{rendered}"
    );
}

/// **A program that ran is not reported on, so there is no template to report it with.**
///
/// The four templates that used to answer a code turn — the result report, the transpile error, the
/// sandbox error, the timeout — are gone, and this is what stands in their place. A compiler or
/// runtime error *is* its error: gg renders no prose around it, so there is nothing to template and
/// nothing that can drift between what gg says and what the model was told to expect.
#[test]
fn the_code_turn_has_no_result_template_to_render() {
    let registered: Vec<&str> = TEMPLATES.iter().map(|(name, _)| *name).collect();
    for retired in [
        "code-result",
        "code-transpile-error",
        "code-sandbox-error",
        "code-timeout",
    ] {
        assert!(
            !registered.contains(&retired),
            "`{retired}` is retired and must not be registered: {registered:?}"
        );
    }
}

/// The one notice a **successful** program can earn: it ran, and it put nothing in the window.
///
/// It exists for a protocol reason rather than an informational one — a request whose last message
/// is the assistant's own is a request to continue that message — so it earns its place by also
/// naming the two calls that would have put something there.
#[test]
fn the_nothing_shown_notice_names_the_calls_that_would_have_shown_something() {
    let rendered = render_code_nothing_shown(GgProgramLanguage::TypeScript);
    assert!(rendered.contains("view.openText"), "{rendered}");
    assert!(rendered.contains("view.openFile"), "{rendered}");
    assert!(
        rendered.contains("console.log"),
        "a model whose output vanished must be told where it went: {rendered}"
    );
    assert_no_blank_run(&rendered);
}

// ---------------------------------------------------------------------------
// The pinned blocks
// ---------------------------------------------------------------------------

/// The task block is **state only**: a heading and the list. It does not re-teach the tools —
/// that is the system prompt's job, and repeating it every turn is what this replaced.
#[test]
fn the_task_block_is_state_not_instructions() {
    let block = render_tasks(&TasksBlockContext {
        tasks: vec![
            TaskItemView {
                id: "scaffold".to_string(),
                title: "Scaffold the project".to_string(),
                description: None,
                status: "done".to_string(),
                marker: "[x]".to_string(),
                ready: false,
                blocked_by: None,
                in_scope: None,
                out_of_scope: None,
                completion_criteria: None,
            },
            TaskItemView {
                id: "movement".to_string(),
                title: "Player movement".to_string(),
                description: Some("arrow keys".to_string()),
                status: "pending".to_string(),
                marker: "[ ]".to_string(),
                ready: false,
                blocked_by: Some("`scaffold`".to_string()),
                in_scope: None,
                out_of_scope: None,
                completion_criteria: None,
            },
        ],
    });
    assert_eq!(
        block,
        "# Your tasks\n\
         - [x] `scaffold` (done) — Scaffold the project\n\
         - [ ] `movement` (pending) — Player movement: arrow keys  [blocked by `scaffold`]"
    );
    for instruction in ["add_task", "You maintain", "compacted"] {
        assert!(
            !block.contains(instruction),
            "the block must not repeat `{instruction}`"
        );
    }
}

/// The board block renders its epics and issues, each issue with the structured brief that makes
/// it dispatchable — and, like the task block, no tool instructions.
#[test]
fn the_board_block_renders_epics_issues_and_briefs() {
    let block = render_board(&BoardBlockContext {
        epics: vec![EpicItemView {
            id: "core".to_string(),
            title: "Core loop".to_string(),
            description: "The playable core.".to_string(),
        }],
        issues: vec![IssueItemView {
            id: "render".to_string(),
            title: "Render the board".to_string(),
            description: Some("canvas".to_string()),
            status: "open".to_string(),
            marker: "[ ]".to_string(),
            epic_id: Some("core".to_string()),
            ready: true,
            blocked_by: None,
            in_scope: "the grid".to_string(),
            out_of_scope: "animation".to_string(),
            completion_criteria: "the grid draws".to_string(),
            agent: "implementer".to_string(),
            reviewers: Some("`critic`".to_string()),
        }],
    });
    assert_eq!(
        block,
        "# Your epic/issue board\n\
         \n\
         ## Epics\n\
         - `core` — Core loop: The playable core.\n\
         \n\
         ## Issues\n\
         - [ ] `render` (open) — Render the board  [epic: `core`]  [ready]\n\
         \x20 - overview: canvas\n\
         \x20 - in scope: the grid\n\
         \x20 - out of scope: animation\n\
         \x20 - done when: the grid draws\n\
         \x20 - assigned to: `implementer`\n\
         \x20 - reviewers: `critic`"
    );
    assert!(!block.contains("create_issue"));
}

/// **An agent dispatched to implement an issue is told which issue it is working, and that the
/// workspace it is in is that issue's own** — whether or not it may author the board, since an
/// implementer profile normally cannot.
///
/// Its brief says what to *build*; this section is the only thing that tells it the work belongs to
/// an issue at all, and it is rendered for profiles whose board-authoring section is (rightly)
/// absent. What it must not be told is to make a board move it has no tool for — the issue is
/// completed by the agent completing, and nothing else.
#[test]
fn an_assigned_issue_names_the_issue_and_its_worktree() {
    let implementer = |responses_as_code: bool| SystemContext {
        responses_as_code,
        language: responses_as_code.then_some(GgProgramLanguage::TypeScript),
        // The code arm lists the objects a program reaches; the tool-calling arm ignores them.
        apis: vec![ApiView {
            object: "fs".to_string(),
            description: "read, write, and edit workspace files".to_string(),
        }],
        // No `board`: this profile may not author the board, only work an issue on it.
        board: None,
        assigned_issue: Some(AssignedIssueView {
            id: "feat-1".to_string(),
        }),
        ..SystemContext::default()
    };

    let tools = flat(&render_system(&implementer(false), None));
    assert!(
        !tools.contains("`create_issue`"),
        "without teaching it the board tools it does not have:\n{tools}"
    );

    let code = flat(&render_system(&implementer(true), None));
    assert!(
        !code.contains("`project.createIssue`"),
        "and still teaches no authoring API:\n{code}"
    );
    for prompt in [&tools, &code] {
        assert!(
            prompt.contains("You have been assigned issue `feat-1`."),
            "the section names the issue:\n{prompt}"
        );
        assert!(
            prompt.contains("Implement it in the current worktree"),
            "and says where the work is done:\n{prompt}"
        );
        assert!(
            !prompt.contains("completeIssue") && !prompt.contains("complete_issue"),
            "and never names a completion move that does not exist:\n{prompt}"
        );
    }

    // An agent that was not dispatched off the board renders no such section at all.
    let undispatched = flat(&render_system(&SystemContext::default(), None));
    assert!(
        !undispatched.contains("Your assigned issue"),
        "an agent with no assignment is told nothing about one:\n{undispatched}"
    );
}

/// A **read-only** memory holder is told the memories are another agent's and that its access to
/// them is read-only — instead of being told, as every other holder is, to write them regularly.
///
/// A prompt that tells a model to curate memories and a toolset that offers it nothing to curate
/// them with is how an agent spends turns hunting for a call that was never there.
#[test]
fn the_memory_section_changes_shape_for_a_read_only_holder() {
    let read_only = |view: MemoriesView| {
        flat(&render_system(
            &SystemContext {
                memories: Some(view),
                ..full_system()
            },
            None,
        ))
    };
    let markdown = MemoriesView {
        scratchpad: false,
        markdown: true,
        keyword_search: false,
        read_only: true,
        ..memories_view()
    };
    let prompt = read_only(markdown);
    assert!(
        prompt.contains("another agent's memories"),
        "the memories are named as somebody else's:\n{prompt}"
    );
    assert!(
        prompt.contains("use `read_memory` to read the memory in full"),
        "and the call it does have is named:\n{prompt}"
    );
    assert!(
        prompt.contains("read-only access"),
        "and the ones it does not are ruled out:\n{prompt}"
    );
    assert!(
        !prompt.contains("Write to this regularly"),
        "it is not also told to curate them:\n{prompt}"
    );

    // The writable holder still reads the original paragraph.
    let writable = read_only(MemoriesView {
        scratchpad: false,
        markdown: true,
        keyword_search: false,
        ..memories_view()
    });
    assert!(writable.contains("Write to this regularly"), "{writable}");
    assert!(!writable.contains("another agent's memories"), "{writable}");
}

/// A holder whose instance may be shared is told what the linked notices are, before it ever gets
/// one — a mid-thread message announcing another agent's write has to read as this system reporting
/// a fact rather than as a stranger addressing the model.
#[test]
fn the_memory_section_explains_the_linked_notices() {
    let linked = flat(&render_system(
        &SystemContext {
            memories: Some(MemoriesView {
                linked: true,
                scope: "shared".to_string(),
                ..memories_view()
            }),
            ..full_system()
        },
        None,
    ));
    assert!(linked.contains("These memories are `shared`"), "{linked}");
    assert!(
        linked.contains("other agents in this run hold the same set"),
        "{linked}"
    );
    assert!(
        linked.contains("you will be given a system-generated notification"),
        "the notice is named as this system's, not as another agent addressing the \
         model:\n{linked}"
    );

    // An isolated holder — the default — reads none of it, because none of it can happen to it.
    let alone = flat(&render_system(
        &SystemContext {
            memories: Some(memories_view()),
            ..full_system()
        },
        None,
    ));
    assert!(!alone.contains("other agents in this run hold"), "{alone}");
}

/// The scratchpad memory view every memory-section test varies one field of: writable, unshared,
/// and organized the way an unconfigured run organizes memories.
fn memories_view() -> MemoriesView {
    MemoriesView {
        scratchpad: true,
        markdown: false,
        keyword_search: false,
        max_count: Some(8),
        max_len_per_memory: Some(2_000),
        max_total_len: Some(8_000),
        max_len_index: None,
        max_len_description: None,
        max_results: None,
        read_only: false,
        linked: false,
        scope: "isolated".to_string(),
    }
}

/// The linked-memory notice names each memory once, says what happened to it, and points at the
/// call that reads it — or, under the scratchpad, carries the body instead, because there is no
/// such call and a notice pointing at one the agent does not have is not actionable.
#[test]
fn the_memory_notice_names_what_changed_and_how_to_act_on_it() {
    let indexed = render_memory_notice(&MemoryNoticeContext {
        entries: vec![
            MemoryNoticeEntry {
                name: "deploy-runbook".to_string(),
                change: "added".to_string(),
                description: "how the staging cluster is rolled".to_string(),
                body: None,
            },
            MemoryNoticeEntry {
                name: "scratch-notes".to_string(),
                change: "deleted".to_string(),
                description: String::new(),
                body: None,
            },
        ],
        read_call: Some("`read_memory`".to_string()),
        inline_bodies: false,
        indexed: true,
    });
    assert!(indexed.contains("- added `deploy-runbook` — how the staging cluster is rolled"));
    assert!(indexed.contains("- deleted `scratch-notes`"));
    assert!(indexed.contains("Read one with `read_memory`"));
    assert!(
        flat(&indexed).contains("Your memory index still shows the set as it stood"),
        "the lagging index is explained:\n{indexed}"
    );

    let scratchpad = render_memory_notice(&MemoryNoticeContext {
        entries: vec![MemoryNoticeEntry {
            name: "plan".to_string(),
            change: "added".to_string(),
            description: "the plan".to_string(),
            body: Some("beat the boss with the grapple".to_string()),
        }],
        read_call: None,
        inline_bodies: true,
        indexed: false,
    });
    assert!(scratchpad.contains("beat the boss with the grapple"));
    assert!(!scratchpad.contains("Read one with"));
    assert!(!scratchpad.contains("memory index"));
}

/// The memories block lists each note verbatim under the heading — and leaves the model's own
/// formatting (blank lines and all) untouched, since it is the agent's text being shown back.
#[test]
fn the_memory_block_lists_notes_verbatim() {
    let block = render_memories(&MemoriesBlockContext {
        memories: vec![MemoryItemView {
            name: "physics".to_string(),
            description: "tuning".to_string(),
            body: "gravity: 9.8\n\n\ndrag: 0.1".to_string(),
        }],
    });
    assert_eq!(
        block,
        "# Your memories\n\n## physics — tuning\ngravity: 9.8\n\n\ndrag: 0.1"
    );
    assert!(!block.contains("write_memory"));
}

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------

/// One brief-rendering context per generated brief.
///
/// Rendering is where a `.hbs` typo becomes a panic (the engine is strict), so every brief has to be
/// rendered by *some* test or a misspelled variable reaches a dispatched agent instead of the build.
/// What is asserted here is the **stable markers** other parts of gg read back out of a brief — the
/// issue heading and the fix heading the offline mock keys off, and the approach an attempt is
/// handed, which is the only thing that distinguishes one attempt's brief from another's.
///
/// There is no execution-mode arm any more. A brief describes the work; the ending is the agent's
/// role's, and is named once, in the system prompt.
#[test]
fn every_generated_brief_renders() {
    let issue = render_issue_brief(&IssueBriefContext {
        id: "AUTH-1".to_string(),
        title: "Log in".to_string(),
        description: Some("An overview.".to_string()),
        in_scope: "The form.".to_string(),
        out_of_scope: "Signup.".to_string(),
        completion_criteria: "A user can log in.".to_string(),
    });
    assert!(issue.starts_with("# Issue `AUTH-1`: Log in"), "{issue}");
    assert!(
        flat(&issue).contains("## Done when A user can log in."),
        "{issue}"
    );

    let review = render_review_brief(&ReviewBriefContext {
        issue_brief: issue.clone(),
        history: vec![
            ReviewRecordView {
                reviewer: "critic".to_string(),
                approved: false,
                items: vec!["Fix the score.".to_string()],
            },
            ReviewRecordView {
                reviewer: "second".to_string(),
                approved: true,
                items: Vec::new(),
            },
        ],
        changes: ReviewChangesView {
            summary: Some(" src/main.rs | 2 +-".to_string()),
            baseline: Some("0".repeat(40)),
        },
    });
    assert!(review.contains("`critic` requested changes:"), "{review}");
    assert!(review.contains("  - Fix the score."), "{review}");
    assert!(review.contains("`second` approved the work."), "{review}");
    // The baseline sha is named whole, so a reviewer can diff against it itself.
    assert!(review.contains(&"0".repeat(40)), "{review}");

    let fix = render_fix_brief(&FixBriefContext {
        issue_brief: issue,
        items: vec![
            NumberedItem {
                number: 1,
                text: "Fix the score.".to_string(),
            },
            NumberedItem {
                number: 2,
                text: "Add a test.".to_string(),
            },
        ],
    });
    assert!(fix.contains("## Requested changes"), "{fix}");
    assert!(fix.contains("1. Fix the score.\n2. Add a test."), "{fix}");

    let merge = render_merge_brief(&MergeBriefContext {
        branch: "gg/issue-auth-1".to_string(),
        reason: "CONFLICT (content): src/main.rs".to_string(),
    });
    assert!(merge.contains("gg/issue-auth-1"), "{merge}");
    assert!(merge.contains("CONFLICT (content): src/main.rs"), "{merge}");
    assert!(merge.contains("commit the merge"), "{merge}");
}

/// The reviewer's brief degrades cleanly on a first review of a run with no git baseline: no
/// history section, an explicit "nothing changed" note, and **no baseline commit named that does
/// not exist**.
#[test]
fn the_review_brief_renders_without_history_or_a_baseline() {
    let brief = render_review_brief(&ReviewBriefContext {
        issue_brief: "# Issue `AUTH-1`: Log in".to_string(),
        history: Vec::new(),
        changes: ReviewChangesView {
            summary: None,
            baseline: None,
        },
    });
    assert!(!brief.contains("Earlier review feedback"), "{brief}");
    assert!(brief.contains("Nothing changed"), "{brief}");
    assert!(!brief.contains("Against `"), "{brief}");
}

// ---------------------------------------------------------------------------
// Compaction, completion, and context pressure
// ---------------------------------------------------------------------------

/// Each pending compaction's three messages name the calls **that run** actually offers: the
/// requirement decides the wording, the execution mode decides its shape, and the memory calls are
/// interpolated from the run's memory strategy rather than written into the template.
#[test]
fn the_compaction_prompts_render_for_every_requirement() {
    let context = |summary, compact_call, memory_writes, code_mode| CompactionPromptContext {
        summary,
        compact_call,
        memory_writes,
        code_mode,
        compact_tool: "compact".to_string(),
        memory_create: "`record_memory`".to_string(),
        memory_revise: "`revise_memory`".to_string(),
        memory_delete: "`delete_memory`".to_string(),
        refused: Some("shell".to_string()),
    };
    for code_mode in [false, true] {
        let summary = context(true, false, false, code_mode);
        let instruction = render_compaction_instruction(&summary);
        assert!(
            flat(&instruction).starts_with("Your context window is full."),
            "{instruction}"
        );
        assert!(
            flat(&instruction).contains("what is left to do"),
            "{instruction}"
        );
        // A code agent's summary arrives as a call carrying it; a tool-calling agent's is its
        // reply's own text. Neither is ever asked to stop replying the way its protocol replies.
        assert_eq!(
            flat(&instruction).contains("Call `compact(summary)`"),
            code_mode,
            "{instruction}"
        );
        assert_eq!(
            flat(&instruction).contains("Reply with a plain text summary"),
            !code_mode,
            "{instruction}"
        );

        let compact = context(false, true, false, code_mode);
        let instruction = render_compaction_instruction(&compact);
        assert_eq!(
            flat(&instruction).contains("Call `compact(summary, files)`"),
            code_mode,
            "{instruction}"
        );
        assert_eq!(
            flat(&instruction).contains("Call `compact` and nothing else."),
            !code_mode,
            "{instruction}"
        );

        let memories = context(false, false, true, code_mode);
        let instruction = render_compaction_instruction(&memories);
        assert!(instruction.contains("`record_memory`"), "{instruction}");
        assert!(instruction.contains("`delete_memory`"), "{instruction}");
        assert!(!instruction.contains("write_memory"), "{instruction}");

        // The refusal names what was refused *and* what is wanted; the unsatisfied feedback is the
        // instruction again, prefaced by what went wrong.
        for pending in [summary, compact, memories] {
            let refusal = render_compaction_refusal(&pending);
            assert!(
                flat(&refusal).starts_with("`shell` was NOT run:"),
                "{refusal}"
            );
            assert!(
                flat(&refusal).contains("Everything is blocked until you"),
                "{refusal}"
            );

            let unsatisfied = render_compaction_unsatisfied(&pending);
            assert!(
                flat(&unsatisfied).starts_with("Your reply did not compact your context,"),
                "{unsatisfied}"
            );
            assert!(
                unsatisfied.contains(&render_compaction_instruction(&pending)),
                "{unsatisfied}"
            );
        }
    }
}

/// The out-of-band prompts and the two fixed summaries render, and the preface carries the summary
/// it frames rather than replacing it.
#[test]
fn the_out_of_band_compaction_prompts_render() {
    let summary = render_compaction_handoff_summary();
    let compact = render_compaction_handoff_compact("compact");
    for prompt in [&summary, &compact] {
        assert!(
            flat(prompt).contains("You are responsible for compacting the session transcript"),
            "{prompt}"
        );
    }
    // The two differ only in what the answer is, which is also how the offline mock tells them
    // apart — see `SUMMARIZATION_MARKER` / `COMPACT_CALL_MARKER`.
    assert!(
        flat(&summary).contains("Reply with the summary of the session."),
        "{summary}"
    );
    assert!(compact.contains("`compact` tool"), "{compact}");

    let preface = render_compaction_preface("You were building the grid.");
    assert!(flat(&preface).starts_with("Session compaction completed."));
    assert!(preface.ends_with("You were building the grid."));

    assert!(
        flat(&render_compaction_fallback())
            .starts_with("(The earlier thread could not be summarized")
    );
    assert!(
        render_compaction_memory_summary().starts_with("Session compaction completed."),
        "the memory strategy restarts the thread from a note that a boundary was crossed"
    );
}

/// The completion feedbacks name this role's ending calls from one source and quote the command
/// that actually failed.
#[test]
fn the_completion_prompts_render() {
    let missing = render_completion_missing(&["finish"]);
    assert!(missing.contains("`finish`"), "{missing}");

    // A role with two endings offers both, joined so the sentence reads.
    let reviewer = render_completion_missing(&["approve", "request_changes"]);
    assert!(
        flat(&reviewer).contains("call `approve` or `request_changes`."),
        "{reviewer}"
    );
}

/// The context-usage block opens with its stable heading, lists each category as a share of the
/// window, and nests the per-file breakdown under the file-view category.
#[test]
fn the_context_usage_signal_renders() {
    let full = render_context_pressure(&ContextPressureContext {
        overall: "80.1%".to_string(),
        categories: vec![
            UsageCategoryView {
                label: "System Prompt".to_string(),
                percent: "4.9%".to_string(),
                top_files: Vec::new(),
            },
            UsageCategoryView {
                label: "File Views".to_string(),
                percent: "62.1%".to_string(),
                top_files: vec![
                    UsageFileView {
                        path: "src/main.rs".to_string(),
                        percent: "12.7%".to_string(),
                    },
                    UsageFileView {
                        path: "src/foo.rs".to_string(),
                        percent: "4.6%".to_string(),
                    },
                ],
            },
            UsageCategoryView {
                label: "Tasks".to_string(),
                percent: "2.0%".to_string(),
                top_files: Vec::new(),
            },
        ],
        can_evict: true,
        evict_file_view: "context.evictFileView".to_string(),
        can_close_views: true,
        close_view: "view.close".to_string(),
        can_archive: true,
        archive_thread: "context.archiveThread".to_string(),
    });
    assert!(
        full.starts_with("Context Usage:\n- Overall: 80.1%\n"),
        "{full}"
    );
    assert!(full.contains("\n- System Prompt: 4.9%\n"), "{full}");
    assert!(full.contains("\n- File Views: 62.1%\n"), "{full}");
    assert!(full.contains("\n- Top File Views:\n"), "{full}");
    assert!(full.contains("\n  - `src/main.rs`: 12.7%\n"), "{full}");
    assert!(full.contains("\n  - `src/foo.rs`: 4.6%\n"), "{full}");
    assert!(full.contains("\n- Tasks: 2.0%\n"), "{full}");
    // Each reclaim call is named exactly as the caller spelled it, so a code agent is pointed at a
    // method on an API object rather than at a gg tool name it cannot call.
    assert!(full.contains("`context.evictFileView`"), "{full}");
    assert!(full.contains("`view.close`"), "{full}");
    assert!(full.contains("`context.archiveThread`"), "{full}");

    // An agent with neither reclaim tool is given the figures and no advice it cannot take.
    let bare = render_context_pressure(&ContextPressureContext {
        overall: "10.0%".to_string(),
        categories: vec![UsageCategoryView {
            label: "System Prompt".to_string(),
            percent: "10.0%".to_string(),
            top_files: Vec::new(),
        }],
        can_evict: false,
        evict_file_view: String::new(),
        can_close_views: false,
        close_view: String::new(),
        can_archive: false,
        archive_thread: String::new(),
    });
    assert!(
        bare.starts_with("Context Usage:\n- Overall: 10.0%\n"),
        "{bare}"
    );
    assert!(!bare.contains("Top File Views"), "{bare}");
    assert!(!bare.contains("evictFileView"), "{bare}");
    assert!(!bare.contains("view.close"), "{bare}");
    assert!(!bare.contains("archiveThread"), "{bare}");
}

// ---------------------------------------------------------------------------
// The per-language gate
// ---------------------------------------------------------------------------

/// The headings every registered [program language](GgProgramLanguage)'s responses-as-code prompt
/// must carry, paired with nothing: each is rendered under a context that turns its section **on**,
/// so a template that dropped one fails here rather than shipping a model a prompt with a hole in
/// it.
///
/// This list is what pays for the decision to give each language its own template file rather than
/// branching one shared file at every bullet. A copied template can silently lose a section — that
/// is the one real cost of the split — and it is a cost a list of required headings buys off
/// entirely, more cheaply and more honestly than a merged file with a branch at every line would
/// have.
const REQUIRED_SECTIONS: &[&str] = &[
    "## Responses as Code",
    "### Ending your session",
    "### Your APIs",
    "### Reusing a program you already ran",
    "### Messages you receive",
    "## Skills",
    "## Memory",
    "## Tasks",
    "## Subagents",
    "## Project management",
    "## Your assigned issue",
];

/// A context with every section a responses-as-code prompt renders turned on, in `language`.
///
/// That includes the two capabilities that render a line rather than a heading — `read_file` and
/// `shell` — because a context that left them off would render a prompt with two calls missing from
/// it and no gate here could tell that apart from a template that dropped them. It also includes
/// [`custom_instructions`](SystemContext::custom_instructions), whose text is deliberately inert:
/// operator prose frames the prompt but must not be able to satisfy an assertion about what gg's
/// own template says.
///
/// Three [`SystemContext`] fields are **not** set, and the omission is not an oversight:
/// `autoload_specs`, `persistence` and `fences_are_stripped` are read by no template in
/// `crates/gg/templates/` — the prompt rewrites that folded the old sections into the intro left
/// them behind. Turning them on here would render nothing, so no gate below can cover them; they
/// are either sections the templates should regain or fields that should go, and that is a decision
/// rather than a test fix.
///
/// The **ending call it carries is TypeScript's**, and that is only correct for a gate reading the
/// prompt's prose or its `{{#each}}` rosters. `ending.finish` is a *spelling* that arrives through
/// the context rather than through the catalogue, so rendering this for another arm puts
/// `harness.finish` into a document whose SDK may bind `harness.Finish` — which is a call that arm
/// does not have. A gate that judges the calls a rendered prompt names must use
/// [`every_code_section_on_for`] instead, which spells the ending the way the language it is
/// rendered for does.
pub(super) fn every_code_section_on(language: GgProgramLanguage) -> SystemContext {
    SystemContext {
        responses_as_code: true,
        language: Some(language),
        custom_instructions: Some("Prefer the smaller change.".to_string()),
        apis: vec![ApiView {
            object: "harness".to_string(),
            description: "the run itself".to_string(),
        }],
        read_file: ReadFileView {
            offered: true,
            capped: true,
            line_cap: 250,
            images: true,
        },
        shell: ShellView {
            offered: true,
            offloaded: false,
            tail: String::new(),
            directory: String::new(),
        },
        code_headings: vec![CodeHeadingView {
            heading: "Task".to_string(),
            description: "the task you are working on".to_string(),
        }],
        program_library: true,
        skills: vec![SkillView {
            name: "gg-filesystem".to_string(),
            description: "reading and writing files".to_string(),
        }],
        memories: Some(MemoriesView {
            scratchpad: true,
            markdown: false,
            keyword_search: false,
            max_count: Some(10),
            max_len_per_memory: Some(1000),
            max_total_len: Some(10_000),
            max_len_index: None,
            max_len_description: Some(120),
            max_results: None,
            read_only: false,
            linked: true,
            scope: "run".to_string(),
        }),
        tasks: Some(TasksView { max_tasks: 100 }),
        subagents: true,
        spawnable_agents: vec![SpawnableAgentView {
            name: "helper".to_string(),
            description: "does scoped work".to_string(),
        }],
        board: Some(BoardView {
            max_epics: 50,
            max_issues: 2000,
            max_retries: 1,
            reviewers_required: true,
            issue_agents: vec![SpawnableAgentView {
                name: "builder".to_string(),
                description: "implements issues".to_string(),
            }],
            reviewer_agents: vec![SpawnableAgentView {
                name: "critic".to_string(),
                description: "reviews finished work".to_string(),
            }],
        }),
        assigned_issue: Some(AssignedIssueView {
            id: "issue-1".to_string(),
        }),
        ending: EndingView {
            standard: true,
            finish: "harness.finish".to_string(),
            ..EndingView::default()
        },
        ..SystemContext::default()
    }
}

/// [`every_code_section_on`] with the **ending call spelled the way `language` spells it** — the
/// context a gate reading the *calls* a rendered prompt names has to use.
///
/// The ending is the one call in a code prompt that reaches the template as data rather than through
/// the catalogue: the loop resolves it once, from the agent's [role](crate::ending::EndingRole), and
/// hands the template a string. A fixture that hard-codes TypeScript's spelling of it therefore
/// writes `harness.finish` into every arm's prompt, and it went unnoticed for ten arms because every
/// `.`-separated arm before C# also spelled it `finish` — Java, Kotlin, Python, Ruby, PureScript and
/// Swift all do, and Rust's and C++'s `::` kept them out of the reading entirely. C# is the first
/// arm that writes `.` **and** `PascalCase`, so it is the first for which the fixture's own string
/// names a call the language does not bind.
///
/// It takes the trait object rather than a [`GgProgramLanguage`] so the seam's
/// [fixture language](crate::sandbox::fixture_languages) can be handed to it too: that one has no
/// wire id at all, on purpose.
pub(super) fn every_code_section_on_for(
    language: &dyn crate::sandbox::ProgramLanguage,
) -> SystemContext {
    let mut context = every_code_section_on(GgProgramLanguage::TypeScript);
    context.ending.finish = crate::sandbox::spell(language, crate::sandbox::HARNESS_FINISH);
    context
}

/// **Every registered language's responses-as-code prompt renders, and carries every section.**
///
/// Three failures at once, and each of them is one a single-language tree could not have had. A
/// template that does not *parse* panics in [`engine`]. One that references a variable
/// [`SystemContext`] does not carry fails strict-mode rendering here rather than in a run. And one
/// that was copied from another language and lost a heading on the way is caught by
/// [`REQUIRED_SECTIONS`], which is the failure the per-language split makes possible and this gate
/// exists to close.
#[test]
fn every_language_renders_a_complete_system_prompt() {
    for &language in GgProgramLanguage::ALL {
        let rendered = render_system(&every_code_section_on(language), None);
        for section in REQUIRED_SECTIONS {
            assert!(
                rendered.contains(section),
                "{language}: the responses-as-code prompt is missing `{section}`:\n{rendered}"
            );
        }
    }
}

/// **A language that declares a library set names every library in it, and names nothing else.**
///
/// Rule 8 of the seam — commonly used libraries are available by default — is the one part of an
/// arm's model-facing surface that is not a signature, and it drifts exactly the way a hand-written
/// signature does. The Python arm's prompt claimed "the whole standard library of CPython 3.14"
/// where `componentize-py` had baked a curated subset of it, and a model that believed it lost a
/// turn to `import unittest`. Nothing caught that, because the sentence was prose.
///
/// So the set is reflected into the language's [catalogue](crate::sandbox) from the code that
/// decides it, and this is what holds the prompt to it: every group's heading and its exact,
/// comma-joined list must appear in the rendered prompt. Joined rather than name-by-name because
/// `rendered.contains("os")` is true of any English paragraph — the assertion has to be the line
/// itself.
///
/// A language whose catalogue declares no libraries is skipped rather than failed: whether an arm
/// ships a curated set or gives a program its runtime's own standard library and nothing else is a
/// property of the arm, and TypeScript's answer (ES2022, enforced by the checker's `lib`) is as
/// legitimate as Python's.
#[test]
fn a_language_that_declares_libraries_names_every_one_in_its_prompt() {
    for &id in GgProgramLanguage::ALL {
        let libraries = &crate::sandbox::language(id).catalogue().libraries;
        if libraries.is_empty() {
            continue;
        }
        let rendered = render_system(&every_code_section_on(id), None);
        for group in libraries {
            assert!(
                rendered.contains(&group.group),
                "{id}: the prompt does not carry the `{}` library group:\n{rendered}",
                group.group
            );
            let listed = group.modules.join(", ");
            assert!(
                rendered.contains(&listed),
                "{id}: the prompt does not list `{}`'s libraries as the catalogue has them \
                 (`{listed}`):\n{rendered}",
                group.group
            );
        }
    }
}

/// **A checked language's prompt says its programs are checked, and what that means for a model.**
///
/// Deliberately outside [`REQUIRED_SECTIONS`] and [`REQUIRED_RULES`], which are the *universal*
/// tables: whether a program is type-checked is precisely the axis a cross-language study varies, so
/// a language that checks nothing must be free to render no such section. What is not free is
/// checking a program and not saying so — a model that believes its types are erased writes
/// differently (and worse) than one that knows a mistake in a signature costs it a turn before any
/// work happens.
///
/// The phrases are the terms the statement cannot be made without, on the same discipline
/// [`REQUIRED_RULES`] keeps: the paragraph may be rewritten or re-emphasized around them.
///
/// Every assertion here is **identity**, never spelling — the compiler's name is taken from the
/// language ([`ProgramLanguage::checker`]) rather than written down, because `tsc` is TypeScript's
/// word for its own checker and a Rust or a Kotlin arm naming `rustc` or `kotlinc` is making the
/// same statement, correctly. A gate that demanded the token `tsc` of every checked language would
/// fail the next arm registered, and for exactly the wrong reason.
///
/// **What the check *is* is not asserted either**, and that took a second checked arm to notice.
/// This table once demanded the word `type-check`, which is TypeScript's answer to a question the
/// seam never asked: [`checker`](ProgramLanguage::checker) says a program is read and judged before
/// it runs, not that its *types* are. [Ruby](crate::sandbox::language)'s Opal has no type system at
/// all and refuses a program on grammar alone, so a Ruby prompt saying `type-check` would be a
/// sentence that is false about the arm it is rendered for. The term both can be stated without
/// lying is gg's own — a program is **compiled**, which is exactly what naming a checker means here
/// and what [`PrepareError::Compile`](crate::sandbox::PrepareError::Compile) is the band for.
#[test]
fn a_prompt_for_a_checked_language_says_its_programs_are_checked() {
    for language in all_languages() {
        let Some(checker) = language.checker() else {
            continue;
        };
        let name = language.display_name();
        let rendered = plain(&render_system_for(
            language,
            &every_code_section_on(language.id()),
        ));
        for (what, phrase) in [
            ("that the program is checked before it runs", "compile"),
            (
                "that a program which fails the check does not run",
                "not executed",
            ),
            ("which compiler judges it", checker),
        ] {
            assert!(
                rendered.contains(phrase),
                "{name}: the prompt no longer states {what} (`{phrase}`):\n{rendered}"
            );
        }
    }
}

/// **TypeScript's prompt says its programs are TYPE-checked, and not merely compiled.**
///
/// The coverage this restores. [`a_prompt_for_a_checked_language_says_its_programs_are_checked`]
/// once demanded the token `type-check` of every checked language, and had to stop when Ruby
/// registered — Opal refuses a program on grammar alone, so that word would be false there. But the
/// shared term it moved to (`compile`) is true of both, which leaves the single most load-bearing
/// sentence in the TypeScript arm unasserted: that a model's *types* are judged before its program
/// runs is the entire content of the TypeScript/JavaScript A/B, and a prompt that quietly lost it
/// would leave the two arms differing only in a `.ts` extension.
///
/// Scoped to this language rather than added back to the table for the reason
/// [`typescripts_checked_prompt_says_a_caught_error_arrives_unnarrowed`] is scoped: what a checker
/// checks is the language's own claim, and each arm gets to make its own.
#[test]
fn typescripts_prompt_says_its_programs_are_type_checked() {
    let language = crate::sandbox::language(GgProgramLanguage::TypeScript);
    let rendered = plain(&render_system_for(
        language,
        &every_code_section_on(language.id()),
    ));
    assert!(
        rendered.contains("type-check"),
        "the prompt no longer states that the program's TYPES are checked (`type-check`), which is \
         the whole difference between this arm and the JavaScript one:\n{rendered}"
    );
}

/// **TypeScript's checked prompt tells a model how to read the error a caught failure gives it.**
///
/// Split out of [`a_prompt_for_a_checked_language_says_its_programs_are_checked`] rather than folded
/// into it, because `unknown` is a **TypeScript spelling**: it is what `catch` binds under this
/// language's checker, and a program that treats it as anything else does not compile. Another
/// language's checker raises the same problem in its own vocabulary or not at all, so holding every
/// checked arm to this token would be holding them to TypeScript's grammar.
#[test]
fn typescripts_checked_prompt_says_a_caught_error_arrives_unnarrowed() {
    let language = crate::sandbox::language(GgProgramLanguage::TypeScript);
    let rendered = plain(&render_system_for(
        language,
        &every_code_section_on(language.id()),
    ));
    assert!(
        rendered.contains("unknown"),
        "the prompt no longer states that a caught error has to be narrowed (`unknown`):\n\
         {rendered}"
    );
}

/// **Every registered language's "nothing shown" notice renders, and is not the fallback.**
///
/// The fallback exists so a broken template costs a turn its wording rather than the run its
/// process, which means a template that stopped rendering would be invisible in production. So it is
/// made visible here: the rendered notice must differ from the sentence that stands in for it.
#[test]
fn every_language_renders_its_nothing_shown_notice() {
    for &language in GgProgramLanguage::ALL {
        let rendered = render_code_nothing_shown(language);
        assert!(!rendered.trim().is_empty(), "{language}: an empty notice");
        assert_ne!(
            rendered,
            super::nothing_shown_fallback(crate::sandbox::language(language)),
            "{language}: the notice fell back, so its template did not render"
        );
    }
}

/// **A language's prompt is its own**: the same context, rendered for two languages, produces two
/// documents written in two sets of spellings.
///
/// This is the assertion the per-language split exists for, and it is the one a tree with a single
/// registered language cannot make: with one template, "the prompt is selected per language" and
/// "there is one prompt" are the same observation. So it is made against the seam's
/// [fixture language](crate::sandbox::fixture_languages), through the **registered** template name
/// rather than through the override path — because the registered name is the path a run takes.
///
/// Three things are asserted, and the third is the one that would catch a regression: each document
/// carries its own language's spellings; neither carries the other's marker; and both are rendered
/// from *one* [`SystemContext`], so the shared machinery — the sections, the API list, the ending
/// block — is genuinely shared and only the wording is per language.
#[test]
fn each_language_renders_its_own_prompt_and_not_another_languages() {
    let context = every_code_section_on(GgProgramLanguage::TypeScript);
    let fixture = crate::sandbox::fixture_languages()
        .next()
        .expect("the seam registers a fixture language under test");

    let typescript = render_system_for(
        crate::sandbox::language(GgProgramLanguage::TypeScript),
        &context,
    );
    let rendered = render_system_for(fixture, &context);

    assert!(
        flat(&typescript).contains("TypeScript program"),
        "TypeScript's prompt names the language it is written in:\n{typescript}"
    );
    assert!(
        flat(&rendered).contains("program in the fixture language"),
        "the fixture's prompt names its own language:\n{rendered}"
    );
    assert!(
        !flat(&typescript).contains("fixture language"),
        "one language's prompt leaked into the other's:\n{typescript}"
    );

    // Both shapes the fixture's template quotes, each read from the fixture's own catalogue: the
    // call with its argument named, and the whole signature. A test that spelled either of them out
    // would stop being a statement about what the fixture declares the moment the fixture's
    // arguments were renamed — which is the defect the templates themselves were fixed for.
    assert!(
        rendered.contains(&format!(
            "{}(path)",
            catalogued_call_in(fixture, "fs", "read_file")
        )) && rendered.contains(&catalogued_signature_in(fixture, "view", "open_text")),
        "the fixture's prompt quotes the fixture's spellings:\n{rendered}"
    );
    assert!(
        !rendered.contains("readFile") && !rendered.contains("openText"),
        "the fixture's prompt quotes no other language's spellings:\n{rendered}"
    );

    // One context, two documents: the API list the run built is in both.
    for document in [&typescript, &rendered] {
        assert!(
            document.contains("`harness`"),
            "the shared context did not reach this language's template:\n{document}"
        );
    }
}

/// **The "nothing shown" notice is per language too**, for the same reason the prompt is: it names
/// the calls that would have shown the model something, and those are spellings.
#[test]
fn each_language_words_its_own_nothing_shown_notice() {
    let fixture = crate::sandbox::fixture_languages()
        .next()
        .expect("the seam registers a fixture language under test");
    let rendered = render_code_nothing_shown_for(fixture);
    assert!(rendered.contains("view.open_text"), "{rendered}");
    assert!(!rendered.contains("view.openText"), "{rendered}");
    assert_ne!(
        rendered,
        super::nothing_shown_fallback(fixture),
        "the notice fell back, so its template did not render"
    );
}

// ---------------------------------------------------------------------------
// What a prompt still tells the model
// ---------------------------------------------------------------------------

/// Every language a prompt can be rendered for: the registry, plus the seam's fixture language.
///
/// A gate that walked only [`GgProgramLanguage::ALL`] would be a gate exercised against one
/// implementation, which is the shape that cannot tell "the prompt is per language" apart from
/// "there is one prompt".
fn every_language() -> impl Iterator<Item = &'static dyn crate::sandbox::ProgramLanguage> {
    all_languages().chain(crate::sandbox::fixture_languages())
}

/// The [`SurfaceCall`](crate::sandbox::SurfaceCall) `object.key` names, from gg's own enumeration
/// of its model-facing surface — so a call renamed there is a failure here rather than a lookup
/// that silently finds nothing.
fn surface_call((object, key): (&str, &str)) -> crate::sandbox::SurfaceCall {
    *crate::sandbox::MODEL_FACING_CALLS
        .iter()
        .find(|call| call.object == object && call.key == key)
        .unwrap_or_else(|| panic!("`{object}.{key}` is part of gg's model-facing surface"))
}

/// The statements every registered language's responses-as-code prompt must still make about the
/// run it was rendered for, each paired with the label that says which one went missing.
///
/// [`REQUIRED_SECTIONS`] asserts the *headings* are there; this asserts the headings are not empty.
/// A section that renders its own prose but drops the roster, the ceiling or the identifier the run
/// put in it is a prompt that tells a model a capability exists and never says what it may name —
/// and that is a section-shaped hole no heading check can see.
///
/// Every phrase here is a **value the context carried**, not a turn of the template's phrasing: a
/// name, a description, a number, an identifier. That is deliberate and it is the whole discipline
/// of this table. Rewording a sentence, re-wrapping a paragraph or changing `**bold**` to `*italic*`
/// must not fail a test — a prompt is prose and it is meant to be edited. Dropping `{{#each
/// board.reviewerAgents}}` must.
const REQUIRED_PHRASES: &[(&str, &str)] = &[
    // ### Your APIs — the objects a program is given, and what each is for. Without these a model
    // is told to call `<object>.<function>()` and never told which objects it has.
    ("the API object the run granted", "`harness`"),
    ("the API object's description", "the run itself"),
    // ### Ending your session — the call is deliberately NOT here. It is the one entry that would
    // have to be a different literal per language, because it reaches the template as data rather
    // than through the catalogue, and this table's whole discipline is that every phrase in it is a
    // value the context carried. It is asserted below instead, spelled by the arm it is rendered
    // for.
    // ### Messages you receive — the heading vocabulary a plain-text transcript is read through.
    ("the message heading", "`Task`"),
    (
        "the message heading's description",
        "the task you are working on",
    ),
    // ## Skills — the library's roster. `skills.readSkill(name)` accepts these names and no others.
    ("the skill's name", "`gg-filesystem`"),
    ("the skill's description", "reading and writing files"),
    // ## Memory — the budget a model has to write within.
    ("the memory description ceiling", "120 characters"),
    ("the memory scope", "`run`"),
    // ## Tasks — the ceiling.
    ("the task ceiling", "100"),
    // ## Subagents — the roster `spawn_subagent` accepts.
    ("the spawnable agent's name", "`helper`"),
    ("the spawnable agent's description", "does scoped work"),
    // ## Project management — the two rosters an issue names.
    ("the issue agent's name", "`builder`"),
    ("the issue agent's description", "implements issues"),
    ("the reviewer agent's name", "`critic`"),
    ("the reviewer agent's description", "reviews finished work"),
    // ## Your assigned issue — which issue this agent was dispatched to implement.
    ("the assigned issue's id", "`issue-1`"),
];

/// **Every registered language's prompt still says what the run configured.**
///
/// Rendered under [`every_code_section_on`], which turns on every section a code prompt can carry,
/// for every **registered** language — so a template copied to a new language and pruned on the way
/// fails here as loudly as the shared one would. The seam's fixture language is deliberately out of
/// scope, on the same terms as [`REQUIRED_SECTIONS`]: its template is a stub that renders four
/// sections on purpose, and holding a stub to the registry's contract would only force the stub to
/// grow.
#[test]
fn every_language_prompt_states_what_the_run_configured() {
    for language in all_languages() {
        let name = language.display_name();
        let rendered = flat(&render_system_for(
            language,
            &every_code_section_on_for(language),
        ));
        for (what, phrase) in REQUIRED_PHRASES {
            assert!(
                rendered.contains(phrase),
                "{name}: the prompt no longer states {what} (`{phrase}`):\n{rendered}"
            );
        }
        // The ending, spelled by this arm rather than written down: a session that cannot be ended
        // deliberately is the failure, and `harness.finish` is only one language's way of saying it.
        let finish = crate::sandbox::spell(language, crate::sandbox::HARNESS_FINISH);
        assert!(
            rendered.contains(&finish),
            "{name}: the prompt no longer states the ending call (`{finish}`):\n{rendered}"
        );
    }
}

/// The rules a code turn runs under that a model cannot discover from a signature, each paired with
/// the one word that carries it.
///
/// These are the statements a program's author has to have read *before* writing the program: a
/// call blocks rather than returning a promise, a returned value goes nowhere, an ending is taken
/// back if the program then throws, and anything a view holds is read on the turn after the one that
/// asked for it. None of them is visible in a catalogue, none of them can be recovered by trying it
/// once — trying it once is a wasted turn — and a template that lost one would render a prompt that
/// still looks complete.
///
/// Unlike [`REQUIRED_PHRASES`], whose every entry is a value the context carried, each phrase here is
/// a word of the prompt's **own prose**. That is unavoidable — a rule is prose — so the discipline
/// instead is that the phrase must be the term the rule cannot be stated without. A paragraph may be
/// rewritten, re-wrapped or re-emphasized around it and still pass; a language whose template
/// translates the rule keeps the word because the word is the rule.
const REQUIRED_RULES: &[(&str, &str)] = &[
    // Every call blocks. The alternative reading — that a call returns something to be awaited — is
    // the one a model brings with it, and a program written under it does its work in a callback
    // that never runs.
    ("that every call is synchronous", "synchronous"),
    // A view is the only channel out of a program. Both of the other two things a model would
    // reach for — printing, and returning — silently do nothing.
    ("that a view is the only way to read data", "the only way"),
    ("that a returned value goes nowhere", "discarded"),
    // A view is read on the next turn. A program that opens one and then tries to use it within the
    // same turn is a program that cannot work, however it is written.
    (
        "that what a view holds arrives on the next turn",
        "next turn",
    ),
    // An ending is not a checkpoint: a program that ends its session and then throws has not ended
    // it. Without this the model retries the *work*, having been told the run was over.
    ("that a failed program's ending is taken back", "revoked"),
];

/// **Every registered language's prompt still states the rules a program is written under.**
///
/// Rendered under [`every_code_section_on`] for the same reason [`REQUIRED_PHRASES`] is: the rules
/// live in the opening section, which every capability set renders, so a maximal context is the one
/// that would hide a rule lost to a `{{#if}}` that should never have been wrapped around it.
#[test]
fn every_language_prompt_states_the_rules_a_program_runs_under() {
    for language in all_languages() {
        let name = language.display_name();
        let rendered = plain(&render_system_for(
            language,
            &every_code_section_on(GgProgramLanguage::TypeScript),
        ));
        for (what, phrase) in REQUIRED_RULES {
            assert!(
                rendered.contains(phrase),
                "{name}: the prompt no longer states {what} (`{phrase}`):\n{rendered}"
            );
        }
    }
}

/// Every capability [`every_code_section_on`] grants, paired with the call a program reaches it
/// through — the positive half of gg's capability model.
///
/// [`a_capability_the_run_withheld_is_absent_from_its_prompt`] asserts the negative half: a call the
/// run withheld is never advertised. On its own that is satisfied by a prompt that advertises
/// nothing at all. This is the half that says the section a run *did* turn on names the call it is
/// about — a model handed "You have access to a task list" and no call spends its turns guessing at
/// one, and it looks from the outside exactly like a model that cannot use tasks.
///
/// Named by [`SurfaceCall`](crate::sandbox::SurfaceCall) rather than by literal, so each is asserted
/// in whichever way its own language spells it and a call renamed in a catalogue is a failure here
/// rather than a sentence quietly naming something no scope holds.
const REQUIRED_CALLS: &[(&str, (&str, &str))] = &[
    // The opening section: the two ways to see anything, the way to read documentation, and the way
    // out to the workspace.
    ("show itself a value it computed", ("view", "open_text")),
    ("read a file", ("view", "open_file")),
    (
        "read one function's documentation",
        ("view", "open_docs_view"),
    ),
    ("run a command", ("system", "shell")),
    // ### Reusing a program you already ran
    ("fetch a program it already ran", ("programs", "get")),
    ("list the programs gg still holds", ("programs", "history")),
    ("hand a patched program back", ("programs", "rerun")),
    // ## Skills
    ("read a skill", ("skills", "read_skill")),
    // ## Tasks
    ("record work", ("tasks", "add_task")),
    ("revise a task", ("tasks", "update_task")),
    ("complete a task", ("tasks", "complete_task")),
    ("drop a task", ("tasks", "remove_task")),
    ("record a task dependency", ("tasks", "set_blocked_by")),
    // ## Subagents
    ("delegate", ("agents", "spawn_subagent")),
    // ## Project management
    ("group issues", ("project", "create_epic")),
    ("file an issue", ("project", "create_issue")),
    (
        "suspend until an issue lands",
        ("project", "wait_for_issue"),
    ),
];

/// **A prompt names the call for every capability its run granted**, in every registered language.
#[test]
fn a_prompt_names_the_call_for_every_capability_the_run_granted() {
    for language in all_languages() {
        let name = language.display_name();
        let rendered = render_system_for(
            language,
            &every_code_section_on(GgProgramLanguage::TypeScript),
        );
        for (what, call) in REQUIRED_CALLS {
            let spelling = crate::sandbox::spell(language, surface_call(*call));
            assert!(
                rendered.contains(&spelling),
                "{name}: the prompt no longer tells the model how to {what} \
                 (`{spelling}`):\n{rendered}"
            );
        }
        // The documentation carve-out is not a `SurfaceCall` — it is seeded onto every object, so
        // it has no fixed pair — but it is the call an agent reads its own surface with, and the
        // prompt is where its name is established. It is asserted in its *generic* form: the bare
        // name appears in the worked example too (`fs.list`), so a prompt that dropped the rule and
        // kept the example would satisfy `list` while teaching the model nothing about the other
        // eleven objects. The **placeholder receiver** is the rule, and it is the whole of the rule:
        // the parentheses this once demanded are spelling, and PureScript — where `list` takes no
        // argument and `fs.list ()` would apply `Unit` to an `Effect` — is the arm that proved it.
        //
        // Both halves of the step are the *language's*, for the same reason every call gg quotes
        // is. The **separator**: on Rust an API object is a module, so `<object>.list` is `E0423`
        // (expected value, found module) — a placeholder written in a syntax the arm does not have,
        // in the one sentence establishing how a model reaches its own surface. And the **name**:
        // `list` is gg's own key rather than any SDK's spelling of it, and C# spells the method it
        // catalogues under that key `List`, so demanding the key of every arm would be demanding
        // that one arm quote a method it does not bind. It is resolved out of the language's own
        // committed catalogue, exactly as every other call in this test is.
        let spelled = crate::sandbox::meta_spelling(language, crate::docs::LIST_FUNCTION);
        let list = format!("<object>{}{spelled}", language.member_separator());
        assert!(
            rendered.contains(&list),
            "{name}: the prompt no longer tells the model how to list any object's functions \
             (`{list}`):\n{rendered}"
        );
    }
}

/// **A read-only memory holder is told the calls its implementation leaves it**, spelled the way
/// its own language writes them.
///
/// A holder that may write is told what its store *is* and left to find the calls on the `memory`
/// object, which is what `list()` is for. A read-only holder cannot be left to that: it is being
/// told about somebody else's memories, most of the object is withheld from it, and the one or two
/// calls it does hold are named in the same sentence as the instruction to use them. That makes the
/// naming load-bearing rather than convenient — drop it and the section describes an index the
/// agent has no way to open an entry of.
///
/// The tool-calling rendering of the same property is
/// [`the_memory_section_changes_shape_for_a_read_only_holder`]; this is the code-mode half, where
/// the call is a method on an object and its spelling is the language's.
#[test]
fn a_read_only_memory_holder_is_told_the_calls_it_keeps() {
    let implementations = [
        (
            "a markdown index",
            (true, false),
            &[("memory", "read_memory")][..],
        ),
        (
            "keyword search",
            (false, true),
            &[("memory", "search_memories"), ("memory", "read_memory")][..],
        ),
    ];
    for (what, (markdown, keyword_search), calls) in implementations {
        for language in all_languages() {
            let name = language.display_name();
            let mut context = every_code_section_on(GgProgramLanguage::TypeScript);
            let memories = context.memories.as_mut().expect("the memory section is on");
            memories.scratchpad = false;
            memories.markdown = markdown;
            memories.keyword_search = keyword_search;
            memories.read_only = true;
            let rendered = render_system_for(language, &context);
            for call in calls {
                let spelling = crate::sandbox::spell(language, surface_call(*call));
                assert!(
                    rendered.contains(&spelling),
                    "{name}: a read-only holder reading {what} is not told about \
                     `{spelling}`:\n{rendered}"
                );
            }
        }
    }
}

/// **A run that requires reviewers says so, and one that does not says the opposite.**
///
/// Deliberately *not* in [`REQUIRED_PHRASES`], and this is the reason the table stays exceptionless:
/// `reviewers_required` carries no value into the prompt. It picks between two sentences that name
/// the same identifier, so the only thing that distinguishes them is their wording, and asserting on
/// wording belongs in a test that says it is doing that rather than in a table whose stated rule is
/// that rewording must never fail.
///
/// It still earns its place: the two sentences are the difference between an agent that must name a
/// reviewer on every issue and one that may, and a template collapsing them would silently make a
/// mandatory review optional.
#[test]
fn a_run_that_requires_reviewers_tells_the_model_it_must_name_one() {
    fn board(reviewers_required: bool) -> SystemContext {
        let mut context = every_code_section_on(GgProgramLanguage::TypeScript);
        context
            .board
            .as_mut()
            .expect("the board section is on")
            .reviewers_required = reviewers_required;
        context
    }

    for language in all_languages() {
        let name = language.display_name();
        let required = flat(&render_system_for(language, &board(true)));
        assert!(
            required.contains("Every issue must name one or more `reviewers`"),
            "{name}: a run requiring reviewers no longer says so:\n{required}"
        );
        let optional = flat(&render_system_for(language, &board(false)));
        assert!(
            optional.contains("An issue may name one or more `reviewers`"),
            "{name}: a run not requiring reviewers no longer says they are optional:\n{optional}"
        );
    }
}

/// **A capability the run withheld is absent from the prompt**, in every language.
///
/// This is the prompt half of gg's capability model: the host refuses a withheld call, and the
/// prompt never advertises one. The host half is asserted at the membrane; without this, a template
/// that describes a capability unconditionally would put a model into a loop calling something that
/// can only ever refuse — and the failure would look like a model defect.
///
/// Asserted against the **spelled** call rather than a literal, so it holds for a language that
/// writes `agents.spawn_subagent` as surely as for one that writes `agents.spawnSubagent`.
#[test]
fn a_capability_the_run_withheld_is_absent_from_its_prompt() {
    let withheld = [
        ("agents", "spawn_subagent"),
        ("tasks", "add_task"),
        ("project", "create_issue"),
        ("skills", "read_skill"),
        ("memory", "read_memory"),
        ("programs", "rerun"),
        // The two capabilities that render a line rather than a heading, and so are the two a
        // heading check could never have covered.
        ("view", "open_file"),
        ("system", "shell"),
    ]
    .map(surface_call);
    for language in every_language() {
        let name = language.display_name();
        // Every section off, and only the ending — which every agent has — left on.
        let context = SystemContext {
            responses_as_code: true,
            language: Some(GgProgramLanguage::TypeScript),
            apis: vec![ApiView {
                object: "harness".to_string(),
                description: "the run itself".to_string(),
            }],
            ending: EndingView {
                standard: true,
                finish: "harness.finish".to_string(),
                ..EndingView::default()
            },
            ..SystemContext::default()
        };
        let rendered = render_system_for(language, &context);
        for call in withheld {
            let spelling = crate::sandbox::spell(language, call);
            assert!(
                !rendered.contains(&spelling),
                "{name}: the prompt advertises `{spelling}`, which this run withheld:\n{rendered}"
            );
        }
        for section in ["## Skills", "## Memory", "## Tasks", "## Subagents"] {
            assert!(
                !rendered.contains(section),
                "{name}: the prompt carries `{section}` for a run that has none:\n{rendered}"
            );
        }
    }
}
