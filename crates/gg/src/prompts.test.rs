use super::*;
use crate::ending::EndingRole;
use crate::healing::{CandidateShape, NotAProgramReason};

/// A rendered prompt with every run of whitespace collapsed to one space.
///
/// The templates hard-wrap their prose (that is what makes them editable), so where a line
/// happens to break is not a property worth asserting — a phrase check runs against this.
fn flat(rendered: &str) -> String {
    rendered.split_whitespace().collect::<Vec<_>>().join(" ")
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
        speculative: true,
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
        judge: matches!(role, EndingRole::Judge { .. }),
        finish: call("harness", "finish", "finish"),
        approve: call("review", "approve", "approve"),
        request_changes: call("review", "requestChanges", "request_changes"),
        select_winner: call("judge", "selectWinner", "select_winner"),
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
        "view.openDocsView(fn)",
        "finish",
    ] {
        assert!(flat.contains(keyword), "missing `{keyword}`:\n{prompt}");
    }
    // The signature dump is gone: no TypeScript signatures, no type declarations, no `ToolError`.
    assert!(!prompt.contains("): FileRead"), "{prompt}");
    assert!(!prompt.contains("interface DirEntry"), "{prompt}");
    assert!(!prompt.contains("ToolError"), "{prompt}");
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
    // The channel that carries: views are what the next turn is built from, and the call that opens
    // one is spelled out where the model first meets it.
    assert!(
        flat_reads.contains(
            "Any views that your code opens will be provided to you on the next \
                             turn."
        ),
        "{with_reads}"
    );
    assert!(
        with_reads.contains("`view.openText(slug: str, contents: str)`"),
        "{with_reads}"
    );
    assert!(
        with_reads.contains("`view.openFile(path: str)`"),
        "{with_reads}"
    );
    // Logging is named once, as the thing that does NOT reach the model — never as an instruction.
    assert!(
        flat_reads.contains(
            "Views are the only way that you can read data from your code. `console.log()` will \
             not be visible."
        ),
        "{with_reads}"
    );
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
            apis: vec![ApiView {
                object: "view".to_string(),
                description: "show yourself a file or a value".to_string(),
            }],
            ..SystemContext::default()
        },
        None,
    );
    assert!(
        no_reads.contains("`view.openText(slug: str, contents: str)`"),
        "{no_reads}"
    );
    assert!(!no_reads.contains("view.openFile"), "{no_reads}");
    assert!(!no_reads.contains("\n\n\n"), "blank-line run:\n{no_reads}");
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
    assert!(uncapped.contains("view.openFile(path: str)"), "{uncapped}");
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
    assert!(
        with_shell.contains("`system.shell(command: str)`"),
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
            apis: vec![ApiView {
                object: "fs".to_string(),
                description: "read, write, and edit workspace files".to_string(),
            }],
            ..SystemContext::default()
        },
        None,
    );
    let flat = flat(&prompt);
    // `list()` hands its answer to the PROGRAM, and the prompt shows the one call that forwards it
    // to the model.
    assert!(
        flat.contains("`<object>.list()` **returns** an object's functions to your program"),
        "{prompt}"
    );
    assert!(
        flat.contains("it puts nothing in front of you on its own"),
        "{prompt}"
    );
    assert!(
        flat.contains("`view.openText(\"fs\", JSON.stringify(fs.list()))`"),
        "{prompt}"
    );
    // `openDocsView` is the one that opens a view directly.
    assert!(
        flat.contains("`view.openDocsView(fn)` **opens a view** directly"),
        "{prompt}"
    );
    // And whichever route was taken, the material lands on the next turn.
    assert!(
        flat.contains("arrives on your next turn and is not available during the turn you ask for"),
        "{prompt}"
    );
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
        (EndingRole::Standard, "finish", ["approve", "select_winner"]),
        (EndingRole::Review, "approve", ["finish", "select_winner"]),
        (
            EndingRole::Judge { attempts: 3 },
            "select_winner",
            ["finish", "approve"],
        ),
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

/// A code run names its ending calls in the grouped form a program actually writes.
#[test]
fn code_mode_names_the_grouped_ending_calls() {
    for (role, expected) in [
        (EndingRole::Standard, "harness.finish"),
        (EndingRole::Review, "review.approve"),
        (EndingRole::Judge { attempts: 2 }, "judge.selectWinner"),
    ] {
        let prompt = render_system(
            &SystemContext {
                responses_as_code: true,
                apis: vec![ApiView {
                    object: "harness".to_string(),
                    description: "read documentation".to_string(),
                }],
                ending: ending_view(role, true),
                ..SystemContext::default()
            },
            None,
        );
        assert!(prompt.contains(expected), "{prompt}");
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
    let rendered = render_code_nothing_shown();
    assert!(rendered.contains("view.openText"), "{rendered}");
    assert!(rendered.contains("view.openFile"), "{rendered}");
    assert!(
        rendered.contains("console.log"),
        "a model whose output vanished must be told where it went: {rendered}"
    );
    assert_no_blank_run(&rendered);
}

/// The ending it names is the reader's **own**. A reviewer that answers in prose because it has
/// reached a verdict is exactly the agent this turn is for, and pointing it at a `harness.finish`
/// that is not in its scope would send it to a function that does not exist.
#[test]
fn the_not_a_program_feedback_names_the_reply_and_this_role_s_ending() {
    let reasons = [
        NotAProgramReason::Empty,
        NotAProgramReason::ToolCallsOnly,
        NotAProgramReason::Prose,
        NotAProgramReason::CommentOnly,
        NotAProgramReason::NoProgramBlock,
        NotAProgramReason::SeveralBlocks {
            blocks: 7,
            shape: CandidateShape::Fenced,
        },
    ];
    for reason in reasons {
        let rendered = render_code_not_a_program(&CodeNotAProgramContext {
            reason: reason.message(),
            ending_calls: vec!["harness.finish".to_string()],
        });
        // The reason leads, in the model's own terms.
        assert!(
            rendered.starts_with(&reason.message()),
            "the reason must lead the feedback:\n{rendered}"
        );
        assert!(
            flat(&rendered).contains(
                "Your whole response must be TypeScript. Any non-code text — Markdown, prose, \
                 explanations — prevents it from being processed."
            ),
            "{rendered}"
        );
        assert!(
            flat(&rendered).contains(
                "Saying the work is done does not end your session. Call `harness.finish`."
            ),
            "{rendered}"
        );
        assert_no_blank_run(&rendered);
    }

    // A reviewer is pointed at both its verdicts and at no `finish` at all.
    let reviewer = render_code_not_a_program(&CodeNotAProgramContext {
        reason: NotAProgramReason::Prose.message(),
        ending_calls: vec![
            "review.approve".to_string(),
            "review.requestChanges".to_string(),
        ],
    });
    assert!(
        flat(&reviewer).contains("Call `review.approve` or `review.requestChanges`."),
        "{reviewer}"
    );
    assert!(!reviewer.contains("finish"), "{reviewer}");

    // The one reason whose sentence carries a number carries the real one.
    let several = render_code_not_a_program(&CodeNotAProgramContext {
        reason: NotAProgramReason::SeveralBlocks {
            blocks: 7,
            shape: CandidateShape::Fenced,
        }
        .message(),
        ending_calls: vec!["harness.finish".to_string()],
    });
    assert!(
        several.starts_with("Your reply contained 7 separate code blocks."),
        "{several}"
    );
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

    let attempt = render_attempt_brief(&AttemptBriefContext {
        base: "Build it.".to_string(),
        index: 2,
        count: 3,
        approach: Some("Use a state machine.".to_string()),
    });
    assert!(attempt.starts_with("Build it."), "{attempt}");
    // The assigned approach is what makes one attempt's brief differ from another's — and what the
    // offline attempt mock reads its own number out of.
    assert!(attempt.contains("### Approach"), "{attempt}");
    assert!(attempt.contains("Use a state machine."), "{attempt}");

    let judge = render_judge_brief(&JudgeBriefContext {
        task: "Build it.".to_string(),
        attempts: vec![
            JudgeAttemptView {
                number: 1,
                summary: Some("built it".to_string()),
            },
            JudgeAttemptView {
                number: 2,
                summary: None,
            },
        ],
        count: 2,
    });
    assert!(judge.contains("### Attempt 1"), "{judge}");
    assert!(judge.contains("built it"), "{judge}");
    // An attempt that produced nothing says so rather than rendering an empty section.
    assert!(judge.contains("(no summary)"), "{judge}");
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
            instruction.starts_with("Your context window is full."),
            "{instruction}"
        );
        assert!(
            flat(&instruction).contains("what is left to do"),
            "{instruction}"
        );
        // A code agent's summary arrives as a call carrying it; a tool-calling agent's is its
        // reply's own text. Neither is ever asked to stop replying the way its protocol replies.
        assert_eq!(
            instruction.contains("Call `compact(summary)`"),
            code_mode,
            "{instruction}"
        );
        assert_eq!(
            instruction.contains("Reply with a plain text summary"),
            !code_mode,
            "{instruction}"
        );

        let compact = context(false, true, false, code_mode);
        let instruction = render_compaction_instruction(&compact);
        assert_eq!(
            instruction.contains("Call `compact(summary, files)`"),
            code_mode,
            "{instruction}"
        );
        assert_eq!(
            instruction.contains("Call `compact` and nothing else."),
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
            assert!(refusal.starts_with("`shell` was NOT run:"), "{refusal}");
            assert!(
                flat(&refusal).contains("Everything is blocked until you"),
                "{refusal}"
            );

            let unsatisfied = render_compaction_unsatisfied(&pending);
            assert!(
                unsatisfied.starts_with("Your reply did not compact your context,"),
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
            prompt.contains("You are responsible for compacting the session transcript"),
            "{prompt}"
        );
    }
    // The two differ only in what the answer is, which is also how the offline mock tells them
    // apart — see `SUMMARIZATION_MARKER` / `COMPACT_CALL_MARKER`.
    assert!(
        summary.contains("Reply with the summary of the session."),
        "{summary}"
    );
    assert!(compact.contains("`compact` tool"), "{compact}");

    let preface = render_compaction_preface("You were building the grid.");
    assert!(preface.starts_with("Session compaction completed."));
    assert!(preface.ends_with("You were building the grid."));

    assert!(
        render_compaction_fallback().starts_with("(The earlier thread could not be summarized")
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

    let failure = render_completion_validation_failure(&ValidationFailureContext {
        index: 1,
        total: 2,
        command: "npm test",
        output: "1 test failed",
    });
    assert!(failure.contains("Failed command: `npm test`"), "{failure}");
    assert!(failure.contains("1 test failed"), "{failure}");
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
        can_close_views: true,
        can_archive: true,
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
    assert!(full.contains("`evict_file_view`"), "{full}");
    assert!(full.contains("`view.close`"), "{full}");
    assert!(full.contains("`archive_thread`"), "{full}");

    // An agent with neither reclaim tool is given the figures and no advice it cannot take.
    let bare = render_context_pressure(&ContextPressureContext {
        overall: "10.0%".to_string(),
        categories: vec![UsageCategoryView {
            label: "System Prompt".to_string(),
            percent: "10.0%".to_string(),
            top_files: Vec::new(),
        }],
        can_evict: false,
        can_close_views: false,
        can_archive: false,
    });
    assert!(
        bare.starts_with("Context Usage:\n- Overall: 10.0%\n"),
        "{bare}"
    );
    assert!(!bare.contains("Top File Views"), "{bare}");
    assert!(!bare.contains("evict_file_view"), "{bare}");
    assert!(!bare.contains("view.close"), "{bare}");
    assert!(!bare.contains("archive_thread"), "{bare}");
}
