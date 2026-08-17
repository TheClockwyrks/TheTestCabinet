use test_cabinet_core::gg::{GgAgentConfig, GgProgramLanguage};

use super::*;
use crate::ending::EndingRole;
// The registry, imported here rather than inherited through the glob: `prompts` itself no longer
// walks the languages — it registers one code template — so nothing above this module names it.
use crate::sandbox::all_languages;

/// [`super::render_system`] for the tests, which render gg's own templates against contexts they
/// built to be renderable.
///
/// It shadows the glob-imported production function deliberately, so the ~40 assertions below stay
/// about *what the prompt says* rather than each unwrapping the same `Result`. Both of that
/// function's failures are gg's own defects — an override that will not render, a code-mode context
/// naming no program language — and each has a test of its own that calls `super::render_system`
/// and asserts the `Err`.
fn render_system(context: &SystemContext, template_override: Option<&str>) -> String {
    super::render_system(context, template_override).expect("this system prompt renders")
}

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

/// The [language view](LanguageView) a code-mode context needs, for the arm most of these tests
/// happen to render.
///
/// Which arm it is does not matter to a test about the shared body — there is one code template and
/// every arm renders all of it — but *some* arm has to be named, because a code prompt that names
/// none is an error rather than a document.
fn code_language() -> Option<LanguageView> {
    Some(language_view(GgProgramLanguage::TypeScript))
}

/// One skill as the prompt lists it, carrying neither code nor an on-use script — the ordinary
/// entry the roster assertions are about.
fn skill(name: &str, description: &str) -> SkillView {
    SkillView {
        name: name.to_string(),
        description: description.to_string(),
        carries_code: false,
        carries_on_use_script: false,
    }
}

/// A context with every capability **on**, so the maximal prompt is exercised. In tool-calling mode
/// (`responses_as_code` off), so the non-code sections — the read facts, the tasks section — are the
/// ones under test.
fn full_system() -> SystemContext {
    SystemContext {
        modules: vec![
            ModuleView {
                path: "fs".to_string(),
                brief: "read, write, and edit workspace files".to_string(),
                import: None,
            },
            ModuleView {
                path: "harness".to_string(),
                brief: "the run itself — end it with `finish`, and read documentation".to_string(),
                import: None,
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
        skills: vec![skill("physics", "How to tune the simulation.")],
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

/// In responses-as-code mode the prompt names the [modules](ModuleView) a program's surface is
/// divided into, describes discovery as a **mechanism** — search for what you need, then open a
/// documentation view of it — and points at the ending call, the one catalogued spelling it is
/// allowed to write. It lists no tool signatures and no type declarations at all. Those are
/// discovered on demand.
///
/// Discovery is described rather than demonstrated because naming either of the two calls would be
/// naming a function, which `prompts.spellings.test.rs` fails the build over; the spellings reach the
/// model out of the [bootstrap](crate::bootstrap) turn instead. So the assertions check for the words
/// the prompt must contain — each module's path and a distinctive phrase from its brief, and the
/// words the mechanism is described in — not the punctuation that separates them, so the prompt's
/// wording can be revised without breaking a test that was only ever about its content.
#[test]
fn code_mode_names_objects_and_teaches_discovery() {
    let context = SystemContext {
        responses_as_code: true,
        language: code_language(),
        modules: vec![
            ModuleView {
                path: "fs".to_string(),
                brief: "read, write, and edit workspace files".to_string(),
                import: None,
            },
            ModuleView {
                path: "system".to_string(),
                brief: "run shell commands in the workspace".to_string(),
                import: None,
            },
            ModuleView {
                path: "harness".to_string(),
                brief: "the run itself — end it with `finish`, and read documentation".to_string(),
                import: None,
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
        // Discovery is taught as a mechanism rather than as two calls: the prompt names neither
        // the search nor the documentation view, because naming either would be naming a function.
        "searching",
        "documentation view",
    ] {
        assert!(flat.contains(keyword), "missing `{keyword}`:\n{prompt}");
    }
    // The signature dump is gone: no return types and no type declarations of any kind. A type's
    // *name* is allowed — the type-check section names `ApiError`, because narrowing a caught error
    // is the one thing a model has to spell to read a failure at all, and a prompt that withheld it
    // would buy a strict-mode diagnostic every time a program caught something. What is banned is
    // a block of declarations in the prompt, which the on-demand documentation lookup replaces.
    //
    // So the ban is on the declaration *shape* rather than on a list of spellings: any line that
    // opens a declaration fails, whatever it goes on to declare. Naming three types would leave a
    // reintroduced `interface ApiError { … }` — or a fourth type nobody thought of — passing.
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

/// **The code prompt teaches views, not printing.**
///
/// This is the one section of the system prompt the whole context-view feature rests on. A model
/// that is still told to print values will print them, and its output will vanish into the
/// operator's stream — so the prompt has to name the channel that carries and say plainly that
/// printing is not one.
///
/// The teaching is drawn from what the run actually binds: showing yourself a value you computed is
/// ungated (a run with no tools at all must still be able to show its model something), while the
/// sentence about reading a file appears only when this run offers `read_file`.
///
/// **Neither is named as a call**, and that is the change this test now guards from the other side:
/// what a model can *do* is stated, and which function does it is left to a search. So the gating
/// is asserted over the sentence rather than over a spelling.
///
/// It is taught in the opening paragraphs rather than under a section of its own — the rewrite in
/// `b60d2798` folded the old *Showing yourself things* section into the intro, on the reasoning
/// that the one fact a code-mode model has to hold from its first turn should not be four screens
/// down. So these assertions pin the *content* — the channel, the gating, that printing is unread —
/// and not the heading it happens to sit under.
///
/// The **printing call itself** is no longer read here. One template serves eleven arms, so the word
/// for a dead output channel (`println!`, `puts`, `Console.WriteLine`) is either one arm's segment
/// or nothing at all; what every arm's model must be told is that whatever it printed did not reach
/// it, which is the sentence asserted. The notice a program that showed itself nothing earns does
/// name the arm's own call, and [`the_nothing_shown_notice_says_a_view_is_the_only_channel_back`]
/// is where that is read.
#[test]
fn code_mode_teaches_views_rather_than_logging() {
    let with_reads = render_system(
        &SystemContext {
            responses_as_code: true,
            language: code_language(),
            modules: vec![ModuleView {
                path: "view".to_string(),
                brief: "show yourself a file or a value — the only way material enters your \
                              context"
                    .to_string(),
                import: None,
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
    // The channel that carries: views are what the next turn is built from, and both things a view
    // is opened *of* are stated where the model first meets them — the value it computed, and the
    // file it reads. Neither is named as a call; the sentence is what is asserted.
    assert!(flat_reads.contains("next turn"), "{with_reads}");
    assert!(
        flat_reads.contains("discarded unless you open a view of it"),
        "{with_reads}"
    );
    assert!(
        flat_reads.contains("You can read a workspace file"),
        "{with_reads}"
    );
    // Printing is named, as the thing that does NOT reach the model — never as an instruction, and
    // never with the channel it *does* reach named either. A prompt that says where the output goes
    // gives a model a reason to aim at it, and most runs have only their result and metrics read.
    assert!(flat_reads.contains("the only way"), "{with_reads}");
    assert!(
        flat_reads.contains("nothing your program prints is readable by you"),
        "{with_reads}"
    );
    for aimed in ["the run's operator", "goes to the run"] {
        assert!(
            !flat_reads.contains(aimed),
            "the prompt names a destination for output the model cannot read (`{aimed}`), which \
             is a channel it will start writing to:\n{with_reads}"
        );
    }
    assert!(
        !with_reads.contains("\n\n\n"),
        "blank-line run:\n{with_reads}"
    );

    // A run that withholds `read_file` is not taught the file view — the same discipline
    // every other section follows — but keeps the text view, which nothing gates.
    let no_reads = render_system(
        &SystemContext {
            responses_as_code: true,
            language: code_language(),
            modules: vec![ModuleView {
                path: "view".to_string(),
                brief: "show yourself a file or a value".to_string(),
                import: None,
            }],
            ..SystemContext::default()
        },
        None,
    );
    assert!(
        no_reads.contains("discarded unless you open a view of it"),
        "{no_reads}"
    );
    assert!(
        !no_reads.contains("You can read a workspace file"),
        "{no_reads}"
    );
    assert!(!no_reads.contains("\n\n\n"), "blank-line run:\n{no_reads}");
}

// The four helpers that resolved one function's name, qualified name and signature out of a
// language's own catalogue are **gone with the thing they served**. They existed so a test
// could assert that a template quoted the SDK's own declaration rather than a copy of it; no
// template quotes a declaration any more, and a helper kept for a rule nobody enforces is a helper
// that will be used to write the rule back. What resolves per language here now is the ending call
// and nothing else, and `crate::sandbox::spell` is the one call that does it.

/// **The code prompt says a program can read a file and run a command — and states nothing else
/// about either.**
///
/// Two capabilities are named where the others are described, and they earn it for the same reason:
/// reading a file and running a build are what a program is usually *for*, and an agent that does not
/// know it may do them at all does not go looking. What it may *not* do is describe them, and this
/// pins both halves of that.
///
/// The **read cap** is the case worth writing down. The prompt used to state the line cap, that a
/// window could be named to move it, and that a larger `limit` was honored — three sentences every
/// agent paid for, in front of an error that states all three at the moment a read is actually
/// windowed. That is the just-in-time rule's own worked example, so the cap is asserted **absent**
/// here rather than left untested: re-adding it must be a deliberate edit.
///
/// The gating is unchanged: a run that withholds the capability says nothing about it at all.
#[test]
fn code_mode_names_the_two_capabilities_a_program_starts_from() {
    let code = |read_file: ReadFileView, shell: ShellView| {
        render_system(
            &SystemContext {
                responses_as_code: true,
                language: code_language(),
                modules: vec![ModuleView {
                    path: "view".to_string(),
                    brief: "show yourself a file or a value".to_string(),
                    import: None,
                }],
                read_file,
                shell,
                ..SystemContext::default()
            },
            None,
        )
    };

    // A capped run and an uncapped one are told the same thing, which is the point: the cap is a
    // number the read's own result carries when it matters.
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
        flat_capped.contains("You can read a workspace file"),
        "{capped}"
    );
    assert!(
        flat_capped.contains("Reading images is supported"),
        "{capped}"
    );
    for delivered_at_the_error in ["250", "offset", "limit"] {
        assert!(
            !flat_capped.contains(delivered_at_the_error),
            "the code prompt states the read window up front (`{delivered_at_the_error}`), which \
             the read that is actually windowed states at the moment it matters:\n{capped}"
        );
    }

    let uncapped = code(
        ReadFileView {
            offered: true,
            images: true,
            ..ReadFileView::default()
        },
        ShellView::default(),
    );
    assert!(
        uncapped.contains("You can read a workspace file"),
        "{uncapped}"
    );

    // Running a command is the most common thing a program does, and it is named exactly when the
    // run offers it — independently of whether that run offloads the output.
    let with_shell = code(
        ReadFileView::default(),
        ShellView {
            offered: true,
            ..ShellView::default()
        },
    );
    // What the call hands back rather than what it is called: a model that does not know a command
    // returns its output to the program will open a view it did not need, or go looking for a log.
    assert!(
        with_shell.contains("You can run a shell command in the workspace"),
        "{with_shell}"
    );
    assert!(
        flat(&with_shell).contains("exit code and its merged output"),
        "{with_shell}"
    );
    assert!(
        !with_shell.contains("\n\n\n"),
        "blank-line run:\n{with_shell}"
    );

    let without_shell = code(ReadFileView::default(), ShellView::default());
    assert!(!without_shell.contains("shell command"), "{without_shell}");
    assert!(
        !without_shell.contains("\n\n\n"),
        "blank-line run:\n{without_shell}"
    );
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
                language: code_language().filter(|_| responses_as_code),
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
        let modules = if responses_as_code {
            vec![ModuleView {
                path: "harness".to_string(),
                brief: "end your session".to_string(),
                import: None,
            }]
        } else {
            Vec::new()
        };
        let prompt = render_system(
            &SystemContext {
                responses_as_code,
                language: code_language().filter(|_| responses_as_code),
                modules,
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
                language: code_language(),
                modules: vec![ModuleView {
                    path: "harness".to_string(),
                    brief: "read documentation".to_string(),
                    import: None,
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

/// The two execution modes render **different** capability sections, and the split is now asymmetric.
///
/// A tool-calling run names each capability's free-standing tools (`add_task`, `spawn_subagent`,
/// `create_epic`) — correctly, because those names *are* what such a model requests, and they arrive
/// with the request's own tool schemas whether the prompt names them or not. A responses-as-code run
/// names **no call at all**: it says what each capability is, lists the modules its surface is
/// divided into, and leaves the functions to be searched for.
///
/// So this pins both halves. The tool arm must still name its tools; the code arm must name neither
/// a tool name (which is not what a program calls) nor a grouped call (which is what the model is
/// meant to discover). The same context, rendered in each mode, must teach what that mode offers and
/// nothing the other one does.
#[test]
fn the_two_modes_name_calls_in_their_own_form() {
    // A context with every capability section on, in the given mode. `modules` carries `harness` so
    // the code arm has a module to render; it is inert on the tool-calling arm.
    fn every_section_on(responses_as_code: bool) -> SystemContext {
        SystemContext {
            responses_as_code,
            language: code_language().filter(|_| responses_as_code),
            modules: vec![ModuleView {
                path: "harness".to_string(),
                brief: "the run itself".to_string(),
                import: None,
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
        "gg.tasks.addTask",
        "gg.delegation.spawnSubagent",
        "gg.board.createEpic",
    ] {
        assert!(
            !tools.contains(grouped),
            "tool-calling leaked grouped form `{grouped}`:\n{tools}"
        );
    }

    // Responses-as-code: neither vocabulary. Not the free-standing tool names, which are not what a
    // program calls, and not the grouped calls either, which are what a model is meant to find.
    let code = flat(&render_system(&every_section_on(true), None));
    for grouped in [
        "gg.tasks.addTask",
        "gg.tasks.setBlockedBy",
        "gg.delegation.spawnSubagent",
        "gg.board.createEpic",
        "gg.board.createIssue",
    ] {
        assert!(
            !code.contains(grouped),
            "code mode names `{grouped}`. The prompt names no function — say what the capability \
             is and let the model search for the call:\n{code}"
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
    // And what it says instead: each capability described, so a section that lost its calls did not
    // lose its subject with them.
    for stated in [
        "You have access to a task list",
        "delegate work to another agent",
        "access to a project board",
    ] {
        assert!(
            code.contains(stated),
            "code mode no longer describes a capability it granted (`{stated}`):\n{code}"
        );
    }
}

/// **A skill is described by what reading it will actually do, not by what reading *a* skill might
/// do.**
///
/// The prompt used to enumerate all three outcomes — prose is pinned, code may be bound, an on-use
/// script may run — at every agent, for every skill, and then say that the reply would tell the model
/// which of them happened. Two of those three are things gg knows per skill before it renders
/// anything, so a run whose skills are plain guides paid for two paragraphs about a mechanism none of
/// them has, and every model reading them had to hold a branch it would never take.
///
/// Asserted as **differences** rather than as phrases: which words the two branches use is the
/// template's to choose, and the property is that they are emitted per skill rather than for all of
/// them. A skill with neither flag renders the shortest entry, each flag adds to it, and the two
/// flags do not add the same thing.
#[test]
fn a_skills_entry_names_only_what_reading_that_skill_does() {
    let listing = |carries_code: bool, carries_on_use_script: bool| {
        render_system(
            &SystemContext {
                responses_as_code: true,
                language: code_language(),
                modules: vec![ModuleView {
                    path: "harness".to_string(),
                    brief: "the run itself".to_string(),
                    import: None,
                }],
                skills: vec![SkillView {
                    name: "gg-filesystem".to_string(),
                    description: "reading and writing files".to_string(),
                    carries_code,
                    carries_on_use_script,
                }],
                ..SystemContext::default()
            },
            None,
        )
    };

    let prose_only = listing(false, false);
    let with_code = listing(true, false);
    let with_script = listing(false, true);
    let with_both = listing(true, true);

    assert!(
        prose_only.contains("`gg-filesystem`"),
        "every skill is listed whatever it carries:\n{prose_only}"
    );
    for (what, longer) in [("code", &with_code), ("an on-use script", &with_script)] {
        assert!(
            longer.len() > prose_only.len(),
            "a skill that carries {what} is described no differently from one that carries \
             nothing:\n{longer}"
        );
        assert!(
            with_both.len() > longer.len(),
            "the two branches are not independent — a skill that carries both reads the same as one \
             that carries only {what}:\n{with_both}"
        );
    }
    assert_ne!(
        with_code, with_script,
        "carrying code and carrying an on-use script are described the same way, so a model cannot \
         tell which one reading this skill will do"
    );
    assert_no_blank_run(&with_both);
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
        language: code_language(),
        modules: vec![ModuleView {
            path: "harness".to_string(),
            brief: "read documentation".to_string(),
            import: None,
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

/// The one notice a **successful** program can earn: it ran, and it put nothing in the window.
///
/// It exists for a protocol reason rather than an informational one — a request whose last message
/// is the assistant's own is a request to continue that message — so it earns its place by telling
/// the model the two things that turn cost it: that a view is the only channel back, and that what
/// it wrote to this arm's own output is not readable by it.
///
/// It names **no call**, on the same rule the prompt follows. It also does not name a *destination*
/// for the vanished output: the half of the old sentence that earns its place is "you cannot read
/// it", and the half that had to go named a channel the model then had a reason to aim at.
#[test]
fn the_nothing_shown_notice_says_a_view_is_the_only_channel_back() {
    let rendered = render_code_nothing_shown(GgProgramLanguage::TypeScript);
    assert!(
        rendered.contains("A view is the only way to see anything"),
        "{rendered}"
    );
    assert!(
        flat(&rendered).contains("`console.log` writes is readable by you"),
        "a model whose output vanished must be told it cannot read it: {rendered}"
    );
    for aimed in ["operator", "goes to the run"] {
        assert!(
            !rendered.contains(aimed),
            "the notice names a destination for output the model cannot read (`{aimed}`): \
             {rendered}"
        );
    }
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
        language: code_language().filter(|_| responses_as_code),
        // The code arm lists the objects a program reaches; the tool-calling arm ignores them.
        modules: vec![ModuleView {
            path: "fs".to_string(),
            brief: "read, write, and edit workspace files".to_string(),
            import: None,
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

/// The headings the one responses-as-code prompt must carry, whichever
/// [language](GgProgramLanguage) it is rendered for: each is rendered under a context that turns its
/// section **on**, so a template that dropped one fails here rather than shipping a model a prompt
/// with a hole in it.
///
/// It used to be the list that paid for eleven template files — a copied template can silently lose
/// a section, and a table of required headings was the cheapest way to catch one that had. There is
/// one file now and that failure is gone with it, but the list is not: what it catches now is a
/// section swallowed by a `{{#if}}` that should not have been wrapped around it, and it is still
/// rendered **for every arm**, because a language segment that forgot to close a block would take
/// the rest of the document with it on that arm alone.
const REQUIRED_SECTIONS: &[&str] = &[
    "## Responses as Code",
    "### The program you are writing",
    "### Ending your session",
    "### Your modules",
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
/// The **ending call is spelled the way `language` spells it**, because it is the one call in a code
/// prompt that reaches the template as data rather than through the catalogue: the loop resolves it
/// from the agent's [role](crate::ending::EndingRole) and hands the template a string. A fixture that
/// hard-coded TypeScript's spelling wrote `harness.finish` into a document whose SDK binds
/// `harness.Finish`, and it went unnoticed for ten arms — every `.`-separated arm before C# also
/// spells it `finish`, and Rust's and C++'s `::` kept them out of the reading entirely.
pub(super) fn every_code_section_on(language: GgProgramLanguage) -> SystemContext {
    SystemContext {
        responses_as_code: true,
        language: Some(language_view(language)),
        custom_instructions: Some("Prefer the smaller change.".to_string()),
        modules: vec![ModuleView {
            path: "harness".to_string(),
            brief: "the run itself".to_string(),
            import: None,
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
        skills: vec![skill("gg-filesystem", "reading and writing files")],
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
            finish: crate::sandbox::spell(
                crate::sandbox::language(language),
                crate::sandbox::SESSION_FINISH,
            ),
            ..EndingView::default()
        },
        ..SystemContext::default()
    }
}

/// **Every registered language's responses-as-code prompt renders, and carries every section.**
///
/// Three failures at once. A template that does not *parse* panics in [`engine`]. One that references
/// a variable [`SystemContext`] does not carry fails strict-mode rendering here rather than in a run.
/// And one whose language segment swallowed the document below it — an unclosed `{{#if}}`, which is
/// a failure exactly one arm exhibits and every other arm hides — is caught by
/// [`REQUIRED_SECTIONS`], which is why one shared template is still rendered eleven times.
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

/// A language id **no segment is written for**, so a prompt rendered under it is the shared body and
/// nothing else.
///
/// It is what makes a language's segment a thing a test can hold in its hand: everything else about
/// the two renders — the sections, the rosters, the ceilings, the ending, even the display name and
/// the checker — is identical, so their difference is exactly what `{{#if (eq language.id …)}}`
/// contributed and nothing else.
const NO_SUCH_LANGUAGE: &str = "no-such-language";

/// The most paragraphs a language's own [segment](language_segment) may render.
///
/// The design's number, and it is a ceiling on **prose a model reads about its own language**, not a
/// budget to spend. Three is what is left when everything discoverable has been taken out of a
/// segment: how a reply is shaped, what a failed call does, and how a call's optional arguments are
/// written. A fourth paragraph is not a formatting choice — it is something the model could have
/// found by searching, or something the error that reports it should be saying instead.
const MAX_SEGMENT_PARAGRAPHS: usize = 3;

/// The most characters a language's own [segment](language_segment) may render, which is the half of
/// the ceiling that stops three paragraphs from becoming three pages.
///
/// Both halves are needed. A paragraph count alone is satisfied by one enormous paragraph, and a
/// character bound alone is satisfied by nine short ones — and the eleven templates this replaced
/// failed in both directions at once, at 289–372 lines each.
const MAX_SEGMENT_CHARS: usize = 1_400;

/// Every paragraph of `rendered`, blank-line separated and trimmed.
///
/// A paragraph is the unit the ceiling is written in because it is the unit the prompt is written
/// in: [`tidy`](super::tidy) has already collapsed every longer run of newlines to one blank line, so
/// a bulleted list or a fenced block is one paragraph and a sentence added to a segment is visible as
/// what it is.
fn paragraphs(rendered: &str) -> Vec<String> {
    rendered
        .split("\n\n")
        .map(|paragraph| paragraph.trim().to_string())
        .filter(|paragraph| !paragraph.is_empty())
        .collect()
}

/// **The language segment**: the paragraphs `language`'s prompt has that the same prompt rendered
/// under [an id no segment is written for](NO_SUCH_LANGUAGE) does not.
///
/// This is a measurement rather than a claim about where the segment sits in the file. A segment
/// written in three places would be found the same way, and so would a sentence somebody gated
/// halfway down the document — which is exactly the drift a ceiling has to be able to see.
fn language_segment(language: GgProgramLanguage) -> Vec<String> {
    let mut without = every_code_section_on(language);
    without
        .language
        .as_mut()
        .expect("a code context names its language")
        .id = NO_SUCH_LANGUAGE.to_string();
    let shared = paragraphs(&render_system(&without, None));
    paragraphs(&render_system(&every_code_section_on(language), None))
        .into_iter()
        .filter(|paragraph| !shared.contains(paragraph))
        .collect()
}

/// **No language's segment runs longer than three paragraphs.**
///
/// The gate the one-template design rests on, and the one that will actually be load-bearing over
/// time: nothing stops a shared file from growing eleven private appendices except a test that
/// refuses them. It fails with the offending paragraphs printed, because the fix is never "raise the
/// ceiling" — it is deciding, for the paragraph that pushed the arm over, whether a model could have
/// found it by searching or whether the error that reports the thing should be carrying it.
///
/// It also asserts each segment is **non-empty**, which is the failure the ceiling cannot see: a gate
/// whose id is misspelled (`c#` for `csharp`) renders a document with no segment at all, and every
/// other assertion in this file would pass over it.
#[test]
fn no_language_segment_runs_longer_than_three_paragraphs() {
    for &language in GgProgramLanguage::ALL {
        let segment = language_segment(language);
        assert!(
            !segment.is_empty(),
            "{language}: nothing in the prompt is gated on this arm's id, so it is rendered a \
             document that never says how a reply of its own is shaped. Check the spelling in \
             `{{{{#if (eq language.id \"{}\")}}}}`.",
            language.id()
        );
        assert!(
            segment.len() <= MAX_SEGMENT_PARAGRAPHS,
            "{language}: the language segment is {} paragraphs, and the ceiling is \
             {MAX_SEGMENT_PARAGRAPHS}. What a segment may say is how a reply is shaped, what a \
             failed call does, and how optional arguments are written — everything else a model can \
             search for, or the error should be saying:\n\n{}",
            segment.len(),
            segment.join("\n\n")
        );
        let characters: usize = segment
            .iter()
            .map(|paragraph| paragraph.chars().count())
            .sum();
        assert!(
            characters <= MAX_SEGMENT_CHARS,
            "{language}: the language segment is {characters} characters, and the ceiling is \
             {MAX_SEGMENT_CHARS}:\n\n{}",
            segment.join("\n\n")
        );
    }
}

/// **Every arm's segment is its own.**
///
/// Two arms may legitimately share a *sentence* — JavaScript and TypeScript are one syntax, and the
/// paragraph describing how a reply is shaped is the same paragraph for both — so the claim is made
/// over the whole segment rather than paragraph by paragraph. What it refuses is a gate that was
/// copied and not edited, which renders one arm's contract to another and is otherwise invisible:
/// the document still parses, still carries every section, and is still the wrong document.
#[test]
fn every_arms_segment_is_its_own() {
    let segments: Vec<(GgProgramLanguage, Vec<String>)> = GgProgramLanguage::ALL
        .iter()
        .map(|&language| (language, language_segment(language)))
        .collect();
    for (index, (language, segment)) in segments.iter().enumerate() {
        for (other, theirs) in &segments[index + 1..] {
            assert_ne!(
                segment, theirs,
                "{language} and {other} render the same language segment, so one of them is \
                 reading the other's contract"
            );
        }
    }
}

/// **A checked language's prompt says its programs are checked; an unchecked one's says nothing at
/// all about a compiler.**
///
/// Deliberately outside [`REQUIRED_SECTIONS`] and [`REQUIRED_RULES`], which are the *universal*
/// tables: whether a program is checked before it runs is precisely the axis a cross-language study
/// varies, so an arm that checks nothing must render no such sentence. What is not free is either
/// direction of getting it wrong — a model that believes its program is checked writes differently
/// (and worse) than one that knows it is not, and a model promised diagnostics it will never receive
/// spends turns waiting for them.
///
/// Every assertion here is **identity**, never spelling — the compiler's name is taken from the
/// language ([`ProgramLanguage::checker`]) rather than written down, because `tsc` is TypeScript's
/// word for its own checker and a Rust or a Kotlin arm naming `rustc` or `kotlinc` is making the
/// same statement, correctly.
///
/// **What the check *is* is not asserted**, and that took a second checked arm to notice. This once
/// demanded the word `type-check`, which is TypeScript's answer to a question the seam never asked:
/// [`checker`](ProgramLanguage::checker) says a program is read and judged before it runs, not that
/// its *types* are. Ruby's Opal has no type system at all and refuses a program on grammar alone. The
/// term both can be stated without lying is gg's own — a program is **compiled**, which is what
/// naming a checker means here and what
/// [`PrepareError::Compile`](crate::sandbox::PrepareError::Compile) is the band for.
///
/// The **cross-arm** half is new with the shared template and is the failure it makes possible: one
/// file that names `rustc` outside its gate names it at every arm, and a Swift model told its program
/// is compiled by `rustc` has been handed a sentence that is false in a document it has no reason to
/// doubt.
#[test]
fn a_prompt_says_which_compiler_judges_it_or_names_none_at_all() {
    for language in all_languages() {
        let name = language.display_name();
        let rendered = plain(&render_system(&every_code_section_on(language.id()), None));
        match language.checker() {
            Some(checker) => {
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
            None => assert!(
                !rendered.contains("not executed"),
                "{name}: nothing reads this arm's programs before they run, so its prompt must not \
                 promise a program can be refused before it does:\n{rendered}"
            ),
        }
        // Whatever this arm's answer, it is not another arm's compiler.
        for other in all_languages() {
            let Some(checker) = other.checker() else {
                continue;
            };
            if language.checker() == Some(checker) {
                continue;
            }
            assert!(
                !rendered.contains(&format!("`{checker}`")),
                "{name}: the prompt names `{checker}`, which judges {}'s programs and not this \
                 arm's:\n{rendered}",
                other.display_name()
            );
        }
    }
}

/// **`language.checker` gates prose, and not only the compiler's name.**
///
/// The withheld-capability paragraph is the reason the flag is on the context at all. On a compiled
/// arm the SDK declares every function whatever the run enabled, so a call to a capability this run
/// withheld *compiles* and then fails when it runs — a model that was not told reads that as a bug in
/// gg and retries. On an interpreted arm the same failure is indistinguishable from any other, so
/// the paragraph is withheld rather than restated for every reader who cannot act on it.
///
/// Asserted as a **difference** rather than as a phrase: what the paragraph says is the template's to
/// word, and pinning it here would make an editing pass fail a test about gating. What is pinned is
/// that flipping the flag changes the document at all — which is the property a `{{#if}}` either has
/// or does not.
#[test]
fn the_checker_gates_more_than_its_own_name() {
    for language in all_languages() {
        let name = language.display_name();
        let mut flipped = every_code_section_on(language.id());
        let view = flipped
            .language
            .as_mut()
            .expect("a code context names its language");
        view.checker = match language.checker() {
            Some(_) => None,
            None => Some("some-compiler".to_string()),
        };
        assert_ne!(
            render_system(&every_code_section_on(language.id()), None),
            render_system(&flipped, None),
            "{name}: `language.checker` gates nothing, so an arm whose programs are compiled and \
             one whose programs are not are told the same thing"
        );
    }
}

/// **Every registered language's "nothing shown" notice renders, is not the fallback, and is worded
/// for the arm it is rendered for.**
///
/// The fallback exists so a broken template costs a turn its wording rather than the run its
/// process, which means a template that stopped rendering would be invisible in production. So it is
/// made visible here: the rendered notice must differ from the sentence that stands in for it.
///
/// The per-arm half is what the notice is a language's at all *for*. It no longer names the calls
/// that would have shown the model something — nothing gg says does — so the one thing left in it
/// that only one arm's model would recognize is that arm's own dead output channel: `println!`,
/// `puts`, `Console.WriteLine`. That is asserted the way [`language_segment`] asserts a segment, by
/// rendering the same notice under an id no clause is written for.
#[test]
fn every_language_renders_its_own_nothing_shown_notice() {
    let bodiless = super::try_render(
        "code-nothing-shown",
        &serde_json::json!({ "language": { "id": NO_SUCH_LANGUAGE, "displayName": "None" } }),
    )
    .expect("the notice renders for a language no clause is written for");
    for &language in GgProgramLanguage::ALL {
        let rendered = render_code_nothing_shown(language);
        assert!(!rendered.trim().is_empty(), "{language}: an empty notice");
        assert_ne!(
            rendered,
            super::nothing_shown_fallback(),
            "{language}: the notice fell back, so its template did not render"
        );
        assert_ne!(
            rendered, bodiless,
            "{language}: the notice says nothing about this arm's own output, so a model whose \
             program printed its answer is not told the printing went nowhere"
        );
        assert_no_blank_run(&rendered);
    }
}

// ---------------------------------------------------------------------------
// What a prompt still tells the model
// ---------------------------------------------------------------------------

// The seam's fixture language is no longer rendered anywhere in this file, and its absence is the
// change rather than an oversight. It was here to tell "the prompt is selected per language" apart
// from "there is one prompt" — a distinction that existed while there were eleven templates and one
// registered arm to compare them with. There is one template now, every arm renders all of it, and
// what is per language is a segment gated on a **wire id**, which is exactly the thing the fixture
// deliberately does not have.

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
    // ### Your modules — the modules a program's surface is divided into, and what each is for.
    // Without these a model is told to call `<module>.<function>()`, told no function, and never
    // told where to start looking: the module list is the only vocabulary the prompt supplies.
    ("the module the run granted", "`harness`"),
    ("the module's description", "the run itself"),
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
    // ## Skills — the library's roster. Reading a skill takes one of these names and no others.
    ("the skill's name", "`gg-filesystem`"),
    ("the skill's description", "reading and writing files"),
    // ## Memory and ## Tasks carry no entry here any more, and the three that went are all one
    // decision. The memory description ceiling and the task ceiling were numbers every agent read
    // in front of an error that states them at the moment one is actually exceeded, which is the
    // just-in-time rule's own worked example. The memory *scope* went with the paragraph that
    // needed it: an agent is not told that other agents hold the same memories and curate them
    // alongside it, because knowing changes nothing it can do.
    // ## Subagents — the roster a delegation may name.
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
/// for every registered language — because a language segment is a `{{#if}}` like any other, and one
/// that failed to close would take the rosters and the ceilings below it with it on that arm alone.
#[test]
fn every_language_prompt_states_what_the_run_configured() {
    for language in all_languages() {
        let name = language.display_name();
        let rendered = flat(&render_system(&every_code_section_on(language.id()), None));
        for (what, phrase) in REQUIRED_PHRASES {
            assert!(
                rendered.contains(phrase),
                "{name}: the prompt no longer states {what} (`{phrase}`):\n{rendered}"
            );
        }
        // The ending, spelled by this arm rather than written down: a session that cannot be ended
        // deliberately is the failure, and `harness.finish` is only one language's way of saying it.
        let finish = crate::sandbox::spell(language, crate::sandbox::SESSION_FINISH);
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
/// rewritten, re-wrapped or re-emphasized around it and still pass.
///
/// All five are in the **shared body**, and that is where they belong: none of them is a fact about a
/// language. A segment that restated one would be spending an arm's three paragraphs on something
/// every arm is already told.
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
        let rendered = plain(&render_system(&every_code_section_on(language.id()), None));
        for (what, phrase) in REQUIRED_RULES {
            assert!(
                rendered.contains(phrase),
                "{name}: the prompt no longer states {what} (`{phrase}`):\n{rendered}"
            );
        }
    }
}

/// **A rendered prompt names no function of gg's surface — except the one that ends the session.**
///
/// The positive half of the capability model, and the shape of it inverted. It used to be
/// `REQUIRED_CALLS`: a table pairing every capability with the call its section had to name, so a
/// model handed "You have access to a task list" and no call could not be mistaken for a model that
/// simply could not use tasks. With the prompt naming nothing, that table is retired rather than
/// retargeted, and the reason is the template rather than the design: one file now serves every
/// [program language](crate::sandbox::ProgramLanguage), and a language-agnostic template **cannot
/// spell a call** — the spelling is the arm's. There is no sentence left for such a table to hold to
/// account. What it once asserted is not withheld from the model either: the
/// [bootstrap](crate::bootstrap)'s opening turn runs a program that lists every module the run
/// granted, with a one-line brief per function, so the surface still arrives on turn one — just not
/// out of a `.hbs` file.
///
/// What it was protecting moved to [the discoverability gate](crate::docs), which verifies the same
/// property end to end and far better: for every capability an agent is granted, the words a model
/// would reach for return something it may actually call, through the real catalogue, the real
/// ranking and the real permission filter.
///
/// So this asserts the other side. Every arm's prompt is rendered with every section on, and the
/// only catalogued spelling allowed to appear anywhere in it is the **ending** call — which is bound
/// to a role rather than to a capability, is therefore outside the discoverability gate's reach, and
/// would leave an agent unable to stop if it were not named. Any other call appearing here is a
/// section that has started teaching the surface again.
///
/// # It is rendered through the real projections, and that is the whole of its worth
///
/// Two of the [`SystemContext`] fields a prompt is built from carry text that is **not** a
/// template's: [`modules`](SystemContext::modules), whose lines are the catalogue's own prose, and
/// [`code_headings`](SystemContext::code_headings), whose descriptions are authored in Rust. Both
/// are exactly where a call name gets in — and running this against
/// [`every_code_section_on`]'s literals, which is what it used to do, is running it against the
/// one input that cannot exhibit the failure. It passed over a prompt that named a function on
/// every arm.
///
/// So the two fields come from [`module_views`](crate::agent::module_views) and
/// [`code_heading_views`](crate::agent::code_heading_views), the functions the loop itself calls,
/// driven by a real [`ToolRegistry`] over real capability modules. Everything else stays the
/// fixture's, because everything else is a template's own words and the fixture renders every
/// section of them.
///
/// Two grants, because one is not enough in either direction. A **granted** agent binds every module
/// its arm declares — nothing gated can hide a leak from the scan — and a **withheld** one binds
/// only what nothing gates, which is where an unconditional leak lives and where a leak that rides
/// on a granted capability must not appear at all. The module-coverage assertion below is what keeps
/// the first claim honest as the surface grows.
#[test]
fn a_rendered_prompt_names_no_function_but_the_one_that_ends_the_session() {
    // Every capability that gates a call, with every operation those capabilities offer — the grant
    // under which every module an arm declares binds, so nothing gated can hide a leak from the
    // scan.
    let capabilities: Vec<String> = crate::sandbox::gating_capabilities()
        .into_iter()
        .map(str::to_string)
        .collect();
    let operations = crate::sandbox::capability_operations(capabilities.iter().map(String::as_str));

    for (what, held, granted) in [
        ("granted", capabilities.as_slice(), operations.as_slice()),
        ("withheld", &[][..], &[][..]),
    ] {
        for &id in GgProgramLanguage::ALL {
            let language = crate::sandbox::language(id);
            let name = language.display_name();
            // The fixture supplies the sections; the loop's own projections supply the two fields
            // whose text is the catalogue's rather than a template's.
            let mut context = every_code_section_on(id);
            context.modules = crate::agent::module_views(held, granted, EndingRole::Standard, id);
            context.code_headings = crate::agent::code_heading_views(true, true, true, true);

            // Every module this arm declares a function in is one this scan has read, or the
            // configurations above have stopped being maximal and a leak could hide behind a gate.
            // A module with no functions — the type-only `core` one — is dropped by the surface
            // itself and has no line in any prompt, so it is not one of them.
            if what == "granted" {
                let rendered_modules: Vec<&str> = context
                    .modules
                    .iter()
                    .map(|view| view.path.as_str())
                    .collect();
                for module in crate::sandbox::catalogue_modules(language) {
                    let has_functions = crate::sandbox::catalogue_functions(language)
                        .iter()
                        .any(|function| function.module == module.id);
                    assert!(
                        !has_functions || rendered_modules.contains(&module.path),
                        "{name}: `{}` binds functions but no configuration here renders it, so \
                         this gate cannot see what its line says",
                        module.path
                    );
                }
            }

            let rendered = render_system(&context, None);
            // The ending this context was rendered with, spelled as this arm writes it: the one
            // exception, named rather than pattern-matched so widening it is a visible edit.
            let allowed = [context.ending.finish.as_str()];
            let separator = language.member_separator();
            for function in crate::sandbox::catalogue_functions(language) {
                for spelling in [
                    format!("{}{separator}{}", function.object, function.name),
                    function.fqn.to_string(),
                ] {
                    if allowed.contains(&spelling.as_str()) {
                        continue;
                    }
                    assert!(
                        !rendered.contains(&spelling),
                        "{name} ({what}): the prompt names `{spelling}`. No call belongs in it — \
                         say what the capability is and which module it lives in, and let the \
                         model search:\n{rendered}"
                    );
                }
            }
            assert!(
                rendered.contains(&context.ending.finish),
                "{name} ({what}): the prompt no longer names the call that ends the session, which \
                 is the one a model cannot discover — an ending is bound to a role, and the \
                 discoverability gate covers capabilities:\n{rendered}"
            );
        }
    }
}

/// **A read-only memory holder's section is written for a reader, not a curator.**
///
/// A holder that may write is told to record what matters. A read-only holder is being told about
/// somebody else's memories, and most of the family is withheld from it, so the same paragraph would
/// be an instruction it cannot follow — an agent told to write memories regularly and then refused
/// every call that writes one spends its turns looking for the one it was promised.
///
/// It used to assert that the section **named** the one or two calls such a holder keeps, on the
/// grounds that the naming was load-bearing where the writing half's was not. It is not asserted any
/// more, because the prompt names no call at all: a read-only holder finds the read side the way
/// every other agent finds every other call, and the
/// [discoverability gate](crate::docs) is what holds that it can. What survives is the half that was
/// always the section's own — that the prose changes shape.
///
/// The tool-calling rendering of the same property is
/// [`the_memory_section_changes_shape_for_a_read_only_holder`]; this is the code-mode half.
#[test]
fn a_read_only_memory_holder_is_told_the_memories_are_not_its_own() {
    for (what, (markdown, keyword_search)) in [
        ("a markdown index", (true, false)),
        ("keyword search", (false, true)),
    ] {
        for language in all_languages() {
            let name = language.display_name();
            let mut context = every_code_section_on(language.id());
            let memories = context.memories.as_mut().expect("the memory section is on");
            memories.scratchpad = false;
            memories.markdown = markdown;
            memories.keyword_search = keyword_search;
            memories.read_only = true;
            let rendered = flat(&render_system(&context, None));
            assert!(
                rendered.contains("read-only access to another agent's memories"),
                "{name}: a read-only holder reading {what} is not told whose memories these \
                 are:\n{rendered}"
            );
            assert!(
                !rendered.contains("Write memory"),
                "{name}: a read-only holder reading {what} is told to write memories it cannot \
                 write:\n{rendered}"
            );
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
    fn board(language: GgProgramLanguage, reviewers_required: bool) -> SystemContext {
        let mut context = every_code_section_on(language);
        context
            .board
            .as_mut()
            .expect("the board section is on")
            .reviewers_required = reviewers_required;
        context
    }

    for language in all_languages() {
        let name = language.display_name();
        let required = flat(&render_system(&board(language.id(), true), None));
        assert!(
            required.contains("Every issue must name one or more `reviewers`"),
            "{name}: a run requiring reviewers no longer says so:\n{required}"
        );
        let optional = flat(&render_system(&board(language.id(), false), None));
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
        crate::sandbox::DELEGATION_SPAWN_SUBAGENT,
        crate::sandbox::TASKS_ADD_TASK,
        crate::sandbox::BOARD_CREATE_ISSUE,
        crate::sandbox::SKILLS_READ_SKILL,
        crate::sandbox::MEMORIES_READ_MEMORY,
        crate::sandbox::PROGRAMS_RERUN,
        // The two capabilities that render a line rather than a heading, and so are the two a
        // heading check could never have covered.
        crate::sandbox::VIEWS_OPEN_FILE,
        crate::sandbox::SHELL_SHELL,
    ];
    for language in all_languages() {
        let name = language.display_name();
        // Every section off, and only the ending — which every agent has — left on.
        let context = SystemContext {
            responses_as_code: true,
            language: Some(language_view(language.id())),
            modules: vec![ModuleView {
                path: "harness".to_string(),
                brief: "the run itself".to_string(),
                import: None,
            }],
            ending: EndingView {
                standard: true,
                finish: "harness.finish".to_string(),
                ..EndingView::default()
            },
            ..SystemContext::default()
        };
        let rendered = render_system(&context, None);
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

// ---------------------------------------------------------------------------
// The per-agent override, and the two ways rendering one fails
// ---------------------------------------------------------------------------

/// An override gg **can** render is rendered, against the same context the built-in template gets —
/// which is the whole of what an override is for.
#[test]
fn an_override_renders_against_the_runs_own_context() {
    let context = SystemContext {
        read_file: ReadFileView {
            offered: true,
            capped: true,
            line_cap: 40,
            images: false,
        },
        ..SystemContext::default()
    };
    let rendered = super::render_system(&context, Some("You may read {{readFile.lineCap}} lines."))
        .expect("an override naming a variable the context carries renders");
    assert_eq!(rendered, "You may read 40 lines.");
}

/// **An override that will not render ends the run, rather than being swapped for gg's own.**
///
/// This is the single most consequential silent fallback gg had: the prompt an agent reasons under
/// *is* the experiment, and gg used to answer a failed render by rendering the built-in template for
/// the run's mode — with no log line anywhere. The run then measured gg's prompt while its record,
/// its capability set and its console all named the operator's.
///
/// The failure that survives to here is a template that **parses** and names a variable the context
/// does not carry: [`check_launch`] has already refused everything that does not parse.
#[test]
fn an_override_that_will_not_render_is_an_error() {
    let problem = super::render_system(
        &SystemContext::default(),
        Some("Read {{noSuchVariable}} of them."),
    )
    .expect_err("strict mode makes an unknown variable a render failure");
    assert!(problem.contains("systemPromptTemplate"), "{problem}");
}

/// A **blank** override is not an override: it takes the built-in template for the run's mode, the
/// same as an absent one. Nothing was written, so nothing is substituted.
#[test]
fn a_blank_override_takes_the_built_in_template() {
    let built_in = render_system(&bare_system(), None);
    assert_eq!(render_system(&bare_system(), Some("   \n ")), built_in);
}

/// **A responses-as-code context that names no program language is an error in every build.**
///
/// It was a `debug_assert!` over `unwrap_or_default()`, which compiles out of exactly the builds
/// that run studies — so a construction site that forgot the field would have rendered TypeScript's
/// contract to an agent writing something else, in release only. Its own comment named the failure:
/// "a silent default is exactly how a second language would come to behave like TypeScript".
#[test]
fn a_code_context_with_no_language_is_an_error() {
    let context = SystemContext {
        responses_as_code: true,
        language: None,
        ..SystemContext::default()
    };
    let problem = super::render_system(&context, None)
        .expect_err("a code prompt cannot be rendered without knowing which arm it is");
    assert!(problem.contains("program language"), "{problem}");
}

/// The launch pass refuses an override that is not a Handlebars template at all, so the render
/// failure above can only ever be about a *variable*.
#[test]
fn an_override_that_does_not_parse_is_refused_at_launch() {
    let mut profile = GgAgentConfig::root();
    profile.system_prompt_template = Some("Unclosed {{#if skills}} section".to_string());
    let mut report = crate::validate::LaunchReport::collecting();
    check_launch(&profile, &mut report);
    let defects = report.into_defects();
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert_eq!(defects[0].locus, "systemPromptTemplate");

    // …and an absent override is the ordinary case, not a defect.
    let mut report = crate::validate::LaunchReport::collecting();
    check_launch(&GgAgentConfig::root(), &mut report);
    assert!(report.is_empty());
}

// ---------------------------------------------------------------------------------------------
// The copy the console reads
// ---------------------------------------------------------------------------------------------

/// The generated-and-committed copy of both templates the console seeds its editors from.
///
/// `scripts/gen-contract.mjs` writes it out of the two `.hbs` files gg embeds, and
/// `scripts/ci/contract-drift.sh` regenerates and diffs it in CI. It is included here so the
/// staleness is a *suite* failure as well, for the reason it went unnoticed once: the drift script
/// is reached for when somebody thinks a contract **type** moved, and a template is not a type.
const COMMITTED_TEMPLATES: &str =
    include_str!("../../../packages/run-record/src/gg-system-prompt.ts");

/// The string literal `name` is assigned in [`COMMITTED_TEMPLATES`], unescaped.
///
/// Written out rather than taken from a parser because the escaping is the whole of it: the
/// generator writes `JSON.stringify(template)` and prettier then re-quotes the literal to whichever
/// quote character needs fewer escapes, so a byte comparison against either spelling would be a test
/// about prettier. Unescaping answers the question actually being asked — *is the text in this file
/// the text gg embeds* — in either spelling.
fn committed_template(name: &str) -> String {
    let assignment = format!("export const {name} =");
    let tail = COMMITTED_TEMPLATES
        .split_once(&assignment)
        .unwrap_or_else(|| {
            panic!("{name} is exported by packages/run-record/src/gg-system-prompt.ts")
        })
        .1;
    let opened = tail
        .find(['\'', '"'])
        .expect("the constant is assigned a string literal");
    let quote = tail.as_bytes()[opened] as char;
    let mut text = String::new();
    let mut characters = tail[opened + 1..].chars();
    while let Some(character) = characters.next() {
        match character {
            _ if character == quote => return text,
            '\\' => match characters
                .next()
                .expect("an escape is not the last character")
            {
                'n' => text.push('\n'),
                't' => text.push('\t'),
                'r' => text.push('\r'),
                escaped => text.push(escaped),
            },
            _ => text.push(character),
        }
    }
    panic!("the string literal assigned to {name} is never closed");
}

/// **What the console shows an operator is what gg would render.**
///
/// The console seeds its per-agent System Prompt editor from these two constants and stores an
/// override whenever the text an operator saves differs from them — and
/// [`render_system`](super::render_system) runs an override *instead of* gg's own template. So a
/// committed copy that has fallen behind is not a stale comment: it is a path from a template edit
/// to a real model reading a paragraph describing an arrangement this tree deleted. That is not
/// hypothetical either — the eleventh and last arm to convert on this branch edited
/// `system-code.hbs` and did not regenerate, and every gate but the drift script stayed green.
#[test]
fn the_committed_copy_of_each_template_is_the_one_gg_embeds() {
    for (name, embedded) in [
        ("DEFAULT_GG_SYSTEM_PROMPT_TEMPLATE", SYSTEM_TOOLS_TEMPLATE),
        (
            "DEFAULT_GG_SYSTEM_PROMPT_TEMPLATE_CODE",
            SYSTEM_CODE_TEMPLATE,
        ),
    ] {
        let committed = committed_template(name);
        // The first line that differs rather than `assert_eq!`, because these are ~500-line
        // documents and the whole of both printed twice buries the one line that moved.
        let differing = committed
            .lines()
            .zip(embedded.lines())
            .enumerate()
            .find(|(_, (committed, embedded))| committed != embedded)
            .map(|(index, (committed, embedded))| {
                format!(
                    "first at line {}:\n  committed: {committed}\n  gg embeds: {embedded}",
                    index + 1
                )
            })
            .unwrap_or_else(|| {
                format!(
                    "the committed copy is {} lines and gg's is {}",
                    committed.lines().count(),
                    embedded.lines().count()
                )
            });
        assert!(
            committed == embedded,
            "{name} in packages/run-record/src/gg-system-prompt.ts is not the template gg embeds \
             — {differing}\n\nRun `npm run gen:contract` and commit the result."
        );
    }
}
