use super::*;
use crate::healing::{
    CandidateShape, Healed, HealingApplication, HealingDetail, HealingStrategy, HealingVerdict,
    NotAProgramReason,
};

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
        delegated: false,
        fences_are_stripped: true,
        read_file: ReadFileView {
            offered: true,
            capped: true,
            hard_cap: true,
            line_cap: 250,
            images: true,
        },
        shell: ShellView {
            offloaded: true,
            tail: "last 200 lines".to_string(),
            directory: "/tmp/gg/shell".to_string(),
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
        planning: true,
        fsm: Some(FsmView {
            machine: "tdd".to_string(),
        }),
        speculative: true,
        autoload_specs: Some(AutoloadView { locked: true }),
        completion: CompletionView::default(),
        compaction: Some(CompactionView {
            trigger_percent: 80,
            writes_summary: false,
            calls_compact: true,
            writes_memories: false,
            compact_name: "compact".to_string(),
            memory_create: "`write_memory`".to_string(),
            memory_revise: "`update_memory`".to_string(),
        }),
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
#[test]
fn a_bare_run_renders_almost_nothing() {
    let prompt = render_system(&bare_system(), None);
    for absent in [
        "## Responses as code",
        "## Tasks",
        "## Subagents",
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
    assert!(prompt.contains("## Responses as code"), "{prompt}");
    // Each object is named and described — the name and a distinctive phrase from its description,
    // not the separator (`:` / ` — `) the template happens to put between them.
    for keyword in [
        "`fs`",
        "read, write, and edit workspace files",
        "`system`",
        "run shell commands in the workspace",
        "`harness`",
        "<object>.list()",
        ".docs()",
        "finish",
    ] {
        assert!(flat.contains(keyword), "missing `{keyword}`:\n{prompt}");
    }
    // The signature dump is gone: no TypeScript signatures, no type declarations, no `ToolError`.
    assert!(!prompt.contains("): FileRead"), "{prompt}");
    assert!(!prompt.contains("interface DirEntry"), "{prompt}");
    assert!(!prompt.contains("ToolError"), "{prompt}");
}

/// A tool-calling run's non-code sections still render: the read-cap and image facts (when
/// `read_file` is offered and capped), and the task instructions. The remaining capability sections
/// were trimmed from the prompt and are re-added as they are validated.
#[test]
fn a_full_run_renders_the_read_facts_and_tasks() {
    let prompt = render_system(&full_system(), None);
    let flat = flat(&prompt);
    assert!(prompt.contains("Reading images is supported."), "{prompt}");
    assert!(flat.contains("at most 250 lines"), "{prompt}");
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
            assert!(!prompt.contains("/tmp/gg/shell"), "{prompt}");
        }
    }
}

/// The default (plain-text) completion section tells the model that a reply with no tool calls ends
/// the run, and does not demand an explicit `finish` call.
#[test]
fn plain_text_completion_section_says_a_tool_free_reply_ends_the_run() {
    let prompt = render_system(&SystemContext::default(), None);
    let flat = flat(&prompt);
    assert!(prompt.contains("## Finishing"), "{prompt}");
    assert!(flat.contains("no tool calls"), "{prompt}");
    assert!(
        !flat.contains("does not end the run"),
        "plain-text completion must not demand an explicit finish:\n{prompt}"
    );
    assert!(!prompt.contains("\n\n\n"), "blank-line run:\n{prompt}");
}

/// No run describes compaction, under any strategy or execution mode.
///
/// The section that named the trigger, what survives the boundary, and what each in-loop strategy
/// would ask of the model was trimmed from both templates (commit `108a3184`): compaction is gg's
/// process, not the agent's, and the one moment the agent has a part to play — the turn gg asks for
/// a summary, a `compact` call, or a round of memory writes — carries its own instructions. This
/// pins the absence across every strategy, so re-adding the section is a deliberate edit rather
/// than a silent one.
#[test]
fn no_run_describes_compaction() {
    let base = CompactionView {
        trigger_percent: 80,
        compact_name: "compact".to_string(),
        // The memory calls a scratchpad run names; the memory-compaction section interpolated
        // them, since which memory tools exist is the memory capability's decision.
        memory_create: "`write_memory`".to_string(),
        memory_revise: "`update_memory`".to_string(),
        ..CompactionView::default()
    };
    let strategies = [
        None,
        Some(base.clone()),
        Some(CompactionView {
            writes_summary: true,
            ..base.clone()
        }),
        Some(CompactionView {
            calls_compact: true,
            ..base.clone()
        }),
        Some(CompactionView {
            writes_memories: true,
            ..base
        }),
    ];
    for responses_as_code in [false, true] {
        for compaction in strategies.clone() {
            // `harness` is always present in a code run — the object `finish` lives on — and the
            // code template renders its object list, so a realistic code context carries at least
            // it.
            let apis = if responses_as_code {
                vec![ApiView {
                    object: "harness".to_string(),
                    description: "the run itself".to_string(),
                }]
            } else {
                Vec::new()
            };
            let prompt = render_system(
                &SystemContext {
                    responses_as_code,
                    apis,
                    compaction,
                    ..SystemContext::default()
                },
                None,
            );
            let flat = flat(&prompt);
            for absent in [
                "Context compaction",
                "80% full",
                "You write that summary",
                "`compact` tool",
                "context.compact(summary, files)",
            ] {
                assert!(!flat.contains(absent), "leaked `{absent}`:\n{prompt}");
            }
        }
    }
}

/// The explicit-call completion section names the `finish` tool as the way to end the run.
///
/// The validation-command listing and the "a tool-free reply does not end the run" warning were
/// trimmed from the prompt (commit `dee15f9a`); they are re-added as the completion capability is
/// re-validated, so this pins only what the section renders today: that explicit-call mode names
/// its finish tool.
#[test]
fn explicit_call_completion_section_names_the_finish_tool() {
    let context = SystemContext {
        completion: CompletionView {
            explicit_call: true,
            finish_name: "finish".to_string(),
            validated: false,
            validation: Vec::new(),
        },
        ..SystemContext::default()
    };
    let prompt = render_system(&context, None);
    let flat = flat(&prompt);
    assert!(prompt.contains("## Finishing"), "{prompt}");
    assert!(
        flat.contains("`finish`"),
        "explicit-call completion names the finish tool:\n{prompt}"
    );
    assert!(!prompt.contains("\n\n\n"), "blank-line run:\n{prompt}");
}

/// In responses-as-code mode a run ends through `harness.finish()` — the program's own ending
/// call. (The validation-command listing that once accompanied it was trimmed in `dee15f9a` and is
/// re-added when the completion capability is re-validated.)
#[test]
fn code_mode_completion_ends_through_harness_finish() {
    let context = SystemContext {
        responses_as_code: true,
        // `harness` is always present in a code run — the object `finish` lives on — and the code
        // template renders its object list, so a realistic context carries at least it.
        apis: vec![ApiView {
            object: "harness".to_string(),
            description: "the run itself — end it with `finish`, and read documentation"
                .to_string(),
        }],
        ..SystemContext::default()
    };
    let prompt = render_system(&context, None);
    assert!(prompt.contains("harness.finish()"), "{prompt}");
    assert!(!prompt.contains("\n\n\n"), "blank-line run:\n{prompt}");
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
            ..ReadFileView::default()
        },
        ..SystemContext::default()
    };
    assert!(flat(&render_system(&capped, None)).contains("at most 40 lines"));
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

/// A code run with no workspace capabilities still names `harness` — a program can always end the
/// run — and names no other object.
#[test]
fn code_mode_with_no_workspace_tools_still_names_harness() {
    let context = SystemContext {
        responses_as_code: true,
        apis: vec![ApiView {
            object: "harness".to_string(),
            description: "the run itself".to_string(),
        }],
        ..SystemContext::default()
    };
    let prompt = render_system(&context, None);
    assert!(prompt.contains("`harness`"), "{prompt}");
    // A program can always end the run — the prompt names `finish` however it spells the call.
    assert!(prompt.contains("finish"), "{prompt}");
    assert!(!prompt.contains("`fs`"), "{prompt}");
}

/// The tool-calling prompt names no tools at all: on that path the tools are in the request, so the
/// prompt renders no API section and no tool name.
#[test]
fn the_tool_calling_prompt_names_no_tools() {
    // `full_system()` is a tool-calling context (`responses_as_code` is false).
    let prompt = render_system(&full_system(), None);
    assert!(!prompt.contains("## Responses as code"), "{prompt}");
    assert!(!prompt.contains("Your APIs"), "{prompt}");
    assert!(!prompt.contains("`fs`"), "{prompt}");
    assert!(!prompt.contains("write_file"), "{prompt}");
}

// ---------------------------------------------------------------------------
// The code-turn feedback
// ---------------------------------------------------------------------------

/// A skipped `{{#if}}` section must not leave a run of blank lines behind. The feedback templates
/// are not put through [`tidy`] — a program's own logs are its words, and squeezing blank lines out
/// of them would be editing the model's output back at it — so the whitespace has to be right in the
/// template itself.
fn assert_no_blank_run(rendered: &str) {
    assert!(
        !rendered.contains("\n\n\n"),
        "a skipped section left a blank-line run:\n{rendered}"
    );
}

/// The feedback for a program that ran cleanly, made no calls and logged nothing — every optional
/// section off at once.
fn quiet_result() -> CodeResultContext {
    CodeResultContext {
        healing: Vec::new(),
        error: None,
        returned_value: false,
        finish_revoked: false,
        calls: Vec::new(),
        call_count: 0,
        calls_suppressed: 0,
        refusals: Vec::new(),
        refusals_suppressed: 0,
        logs: Vec::new(),
        logs_suppressed: 0,
        unreachable: None,
        silent: true,
        images_dropped: 0,
        image_budget: 0,
        deferred: None,
        delegated: false,
    }
}

/// The clean-run branch: the roster of what the program called is shown, and what it logged is
/// shown back to it verbatim. The feedback carries no standing instructions — how a session ends is
/// the system prompt's job, and repeating it on every turn is the noise this template was stripped
/// of — so a clean turn is exactly a report of what happened.
#[test]
fn the_result_feedback_shows_the_output_and_the_roster() {
    let rendered = render_code_result(&CodeResultContext {
        logs: vec!["a.ts, b.ts".to_string()],
        calls: vec![
            CodeCallView {
                name: "list_dir".to_string(),
                ok: true,
                error: None,
            },
            CodeCallView {
                name: "edit_file".to_string(),
                ok: false,
                error: Some("`foo` appears 3 times".to_string()),
            },
        ],
        call_count: 2,
        silent: false,
        ..quiet_result()
    });
    assert!(rendered.starts_with("Your program ran to completion."));
    assert!(rendered.contains("Output:\na.ts, b.ts"));
    assert!(rendered.contains("2 tool call(s) were made:"));
    assert!(rendered.contains("- list_dir: ok"));
    // A failure the program CAUGHT is still reported, or it would be invisible.
    assert!(rendered.contains("- edit_file: failed: `foo` appears 3 times"));
    assert!(!rendered.contains("Your program stopped"));
    assert_no_blank_run(&rendered);
}

/// The throw branch: what threw, where in the **program's** coordinates, and — load-bearing — that
/// the work before it stands.
#[test]
fn the_result_feedback_locates_a_throw_and_says_the_work_stands() {
    let rendered = render_code_result(&CodeResultContext {
        error: Some(CodeErrorView {
            message: "`specs/rules.md` does not exist".to_string(),
            location: Some("line 3, column 7".to_string()),
        }),
        calls: vec![CodeCallView {
            name: "write_file".to_string(),
            ok: true,
            error: None,
        }],
        call_count: 1,
        silent: false,
        ..quiet_result()
    });
    assert!(
        rendered.starts_with(
            "Your program stopped at line 3, column 7: `specs/rules.md` does not exist"
        )
    );
    assert!(rendered.contains("Everything it did before that still stands."));
    assert!(!rendered.contains("Return value:"));

    // With no location and no calls, neither clause is invented.
    let bare = render_code_result(&CodeResultContext {
        error: Some(CodeErrorView {
            message: "boom".to_string(),
            location: None,
        }),
        silent: false,
        ..quiet_result()
    });
    assert!(bare.starts_with("Your program stopped: boom"));
    assert!(!bare.contains("still stands"));
    assert!(bare.contains("No tool calls were made."));
    assert_no_blank_run(&rendered);
    assert_no_blank_run(&bare);
}

/// The four things that would otherwise be invisible: dropped log lines, refusals, deferred work,
/// and dropped pictures.
#[test]
fn the_result_feedback_reports_what_was_dropped_refused_and_deferred() {
    let rendered = render_code_result(&CodeResultContext {
        logs: vec!["checked 12 files".to_string(), "wrote 3".to_string()],
        logs_suppressed: 41,
        refusals: vec!["`enter_plan_mode` — not composable inside a program".to_string()],
        refusals_suppressed: 3,
        deferred: Some("your program deferred work with `.then()`; it ran after the program had already ended.".to_string()),
        images_dropped: 2,
        image_budget: 4,
        silent: false,
        ..quiet_result()
    });
    assert!(rendered.contains("Output:\nchecked 12 files\nwrote 3"));
    assert!(flat(&rendered).contains("(41 earlier line(s) were dropped"));
    assert!(rendered.contains("- refused: `enter_plan_mode` — not composable inside a program"));
    assert!(rendered.contains("(3 further refusal(s) were not listed"));
    assert!(rendered.contains("it ran after the program had already ended."));
    assert!(rendered.contains("(2 image(s) were not attached: max image count reached)"));
    assert_no_blank_run(&rendered);
}

/// A roster the cap truncated says so, and a program that `return`ed a value is told where that
/// value went.
///
/// Both are the same failure of omission: a model shown "it made 738 tool call(s)" and then 500
/// bullets reads the gap as calls that vanished, and one whose returned value is nowhere in the
/// feedback reads it as a value that was lost rather than as the wrong channel.
#[test]
fn the_result_feedback_explains_a_truncated_roster_and_a_discarded_return_value() {
    let rendered = render_code_result(&CodeResultContext {
        returned_value: true,
        logs: vec!["checked 12 files".to_string()],
        calls: vec![CodeCallView {
            name: "read_file".to_string(),
            ok: true,
            error: None,
        }],
        call_count: 738,
        calls_suppressed: 737,
        silent: false,
        ..quiet_result()
    });
    assert!(rendered.contains("738 tool call(s) were made:"));
    assert!(
        rendered.contains("(737 further call(s) were made but not listed"),
        "a truncated roster must say so:\n{rendered}"
    );
    assert!(
        rendered.contains("Returning values does nothing"),
        "a discarded return value is named, and the model is pointed at the channel that works:\n\
         {rendered}"
    );
    assert!(rendered.contains("`console.log()`"));
    assert_no_blank_run(&rendered);
}

/// A program that logged nothing and threw nothing gets told so — the one outcome that teaches the
/// model absolutely nothing about its own workspace.
#[test]
fn the_result_feedback_nudges_a_silent_program() {
    let rendered = render_code_result(&quiet_result());
    assert!(rendered.contains("No output recorded."));
    assert!(rendered.contains("No tool calls were made."));
    // ...and a program that said something is not nagged.
    let spoke = render_code_result(&CodeResultContext {
        logs: vec!["12 files".to_string()],
        silent: false,
        ..quiet_result()
    });
    assert!(!spoke.contains("No output recorded."));
    assert_no_blank_run(&rendered);
    assert_no_blank_run(&spoke);
}

/// An ending the program declared and then lost is stated in the feedback, on both paths that can
/// lose one.
///
/// It is the one turn in which a model's belief about the run and gg's are opposite: the model wrote
/// `finish` and read a failure, and without this sentence the obvious reading — fix the throw, the
/// ending stands — leaves it never finishing the run at all.
#[test]
fn the_feedback_says_when_a_finish_was_revoked() {
    let threw = render_code_result(&CodeResultContext {
        error: Some(CodeErrorView {
            message: "`out/manifest.md` does not exist".to_string(),
            location: Some("line 9, column 3".to_string()),
        }),
        finish_revoked: true,
        silent: false,
        ..quiet_result()
    });
    assert!(
        flat(&threw).contains(
            "The `harness.finish()` call was suppressed because your program did not run to \
             completion."
        ),
        "{threw}"
    );

    let stopped = render_code_sandbox_error(&CodeSandboxErrorContext {
        healing: Vec::new(),
        error: "the program exceeded its 268435456-byte memory cap".to_string(),
        finish_revoked: true,
        calls: 3,
    });
    assert!(
        flat(&stopped).contains("The call to `harness.finish()` was suppressed due to the error."),
        "{stopped}"
    );

    // And a turn that declared no ending is told nothing about one.
    let ordinary = render_code_result(&CodeResultContext {
        logs: vec!["ok".to_string()],
        silent: false,
        ..quiet_result()
    });
    assert!(!ordinary.contains("was suppressed"));
    assert_no_blank_run(&threw);
    assert_no_blank_run(&ordinary);
}

/// A transpile failure hands back the compiler's own diagnostic, then restates the rule a failure
/// to compile most often means the model broke: the *entire reply* is compiled, so anything in it
/// that is not TypeScript is a syntax error in the program.
///
/// The diagnostic in the fixture is the shape the real pipeline produces — `line L, column C:` plus
/// the quoted source line — and it is the real round-1 failure: a model glued prose to its closing
/// fence, the prose was compiled as program text, and a locationless diagnostic left it unable to
/// see what had happened. An earlier version of this test asserted against a located-*looking*
/// string the transpiler never emitted, which certified a location the model was in fact never
/// given.
#[test]
fn the_transpile_feedback_reports_the_diagnostic_and_the_code_only_rule() {
    let rendered = render_code_transpile_error(&CodeTranspileErrorContext {
        healing: Vec::new(),
        error: "line 4, column 1: Expected a semicolon or an implicit semicolon after a \
                statement, but found none | ```Consumed fuel: 24,000 / 1,000,000 budget."
            .to_string(),
        delegated: false,
    });
    assert_eq!(
        rendered,
        "Your program did not compile:\n\n```\nline 4, column 1: Expected a semicolon or an \
         implicit semicolon after a statement, but found none | ```Consumed fuel: 24,000 / \
         1,000,000 budget.\n```\n\nYour entire response is treated as TypeScript code. Any \
         non-TypeScript code in\nthe response will cause the compilation to fail.\n\nIf the task \
         is complete, call `harness.finish()` with a summary to signal\ncompletion."
    );
}

/// A sandbox limit is framed as "too much for one program" — split it up — while a **timeout** gets
/// its own, opposite advice: the ceiling is far larger than any program needs, so a timeout means a
/// program that never terminated, not one that was too heavy.
#[test]
fn the_sandbox_feedback_separates_a_limit_a_timeout_and_a_mistake() {
    let memory = render_code_sandbox_error(&CodeSandboxErrorContext {
        healing: Vec::new(),
        error: "the program exceeded its 4194304-byte memory cap".to_string(),
        finish_revoked: false,
        calls: 12,
    });
    assert!(memory.contains("Your program could not be run to completion:"));
    assert!(memory.contains("Split the task across several smaller programs, one per turn."));
    assert!(flat(&memory).contains("The 12 tool call(s) your code made stand."));
    // A memory cap is "too heavy", not "you looped": it must not carry the timeout's runaway advice.
    assert!(!memory.contains("infinite loops"));

    let timeout = render_code_timeout(&CodeTimeoutContext {
        healing: Vec::new(),
        error: "the program ran longer than its 30s execution timeout and was stopped".to_string(),
        finish_revoked: false,
        calls: 0,
    });
    assert!(timeout.contains("Your code hit the execution limit:"));
    assert!(timeout.contains("no infinite loops or unbounded recursion exists"));
    // A timeout is not a "do less" problem, so it does not carry the "split it up" framing.
    assert!(!timeout.contains("Split the task"));
    assert!(!timeout.contains("made stand"));
    assert_no_blank_run(&memory);
    assert_no_blank_run(&timeout);
}

/// **What healing repaired is disclosed, on every one of the five feedback paths.**
///
/// A repair the model is not told about teaches it nothing and corrupts the measurement: the point
/// of the capability is to observe how well models follow a code-only contract, and a model whose
/// fences are silently removed will keep sending them forever while the numbers say it complied.
/// The disclosure has to reach the model whatever became of the healed reply — it happened to the
/// *message*, not to the program — which is why all five templates carry the same partial, and why
/// the note bounds what gg is allowed to change rather than merely listing what it did.
#[test]
fn every_code_feedback_reports_what_was_healed() {
    let healing = vec![
        "removed the Markdown code fence you wrapped it in".to_string(),
        "removed 2 lines of explanation before your program and 1 after it".to_string(),
    ];
    let ran = render_code_result(&CodeResultContext {
        healing: healing.clone(),
        logs: vec!["1".to_string()],
        silent: false,
        ..quiet_result()
    });
    let transpile = render_code_transpile_error(&CodeTranspileErrorContext {
        healing: healing.clone(),
        error: "line 1, column 1: Unexpected token".to_string(),
        delegated: false,
    });
    let sandbox = render_code_sandbox_error(&CodeSandboxErrorContext {
        healing: healing.clone(),
        error: "the program exceeded its memory cap".to_string(),
        finish_revoked: false,
        calls: 3,
    });
    let timeout = render_code_timeout(&CodeTimeoutContext {
        healing: healing.clone(),
        error: "the program ran longer than its 30s execution timeout and was stopped".to_string(),
        finish_revoked: false,
        calls: 3,
    });
    let refused = render_code_not_a_program(&CodeNotAProgramContext {
        healing,
        reason: NotAProgramReason::CommentOnly.message(),
        delegated: false,
    });

    for rendered in [&ran, &transpile, &sandbox, &timeout, &refused] {
        assert!(
            rendered.contains(
                ":\n- removed the Markdown code fence you wrapped it in\n- removed 2 lines of \
                 explanation before your program and 1 after it\n"
            ),
            "the note must lead the feedback, one clause per repair:\n{rendered}"
        );
        assert!(
            rendered.starts_with("gg repaired your reply"),
            "the note must be the first thing the turn says:\n{rendered}"
        );
        assert!(
            flat(rendered).contains(
                "Only text was removed — nothing was added, and nothing was reordered. Your whole \
                 reply is the program, so you can send the TypeScript on its own: anything you \
                 want to say belongs in a `console.log(…)`, or in the summary you pass to \
                 `harness.finish(…)`."
            ),
            "the note must bound what gg changed and say where prose belongs:\n{rendered}"
        );
        assert_no_blank_run(rendered);
    }

    // A reply that needed no repair earns no note at all — the feedback for a well-formed turn must
    // not spend its opening line on a rule the model did not break.
    let clean = render_code_result(&quiet_result());
    assert!(!clean.contains("gg repaired your reply"), "{clean}");
    assert!(
        clean.starts_with("Your program ran to completion."),
        "{clean}"
    );
}

/// **The healing disclosure says whether the repaired reply actually ran.**
///
/// The note used to open *"gg repaired your reply before running it"* on all four paths, and on two
/// of them that is false: a reply that did not type-strip, and a reply gg refused as not a program,
/// never ran at all. The turn then contradicted itself in its first two paragraphs — the disclosure
/// said the reply had been run, the body said nothing had — and a model cannot act on a turn that
/// asserts both.
///
/// Each feedback template passes `ran` to the partial, because *which feedback this is* is exactly
/// what settles the question: the result, the sandbox-limit and the timeout turns ran a program
/// (their landed calls stand, which is why they are not in the other group), while the transpile and
/// not-a-program turns did not. The non-running arm also hands the model the fact it needs to read
/// what follows: the diagnostic or verdict below it is about the **repaired** text, which is what
/// makes a located transpile error reconcilable with a reply the model remembers writing differently.
#[test]
fn the_healing_note_says_whether_the_repaired_reply_ran() {
    let healing = vec!["removed the Markdown code fence you wrapped it in".to_string()];
    let ran = [
        render_code_result(&CodeResultContext {
            healing: healing.clone(),
            logs: vec!["1".to_string()],
            silent: false,
            ..quiet_result()
        }),
        render_code_sandbox_error(&CodeSandboxErrorContext {
            healing: healing.clone(),
            error: "the program exceeded its memory cap".to_string(),
            finish_revoked: false,
            calls: 3,
        }),
        render_code_timeout(&CodeTimeoutContext {
            healing: healing.clone(),
            error: "the program ran longer than its 30s execution timeout and was stopped"
                .to_string(),
            finish_revoked: false,
            calls: 3,
        }),
    ];
    let never_ran = [
        render_code_transpile_error(&CodeTranspileErrorContext {
            healing: healing.clone(),
            error: "line 1, column 1: Unexpected token".to_string(),
            delegated: false,
        }),
        render_code_not_a_program(&CodeNotAProgramContext {
            healing,
            reason: NotAProgramReason::CommentOnly.message(),
            delegated: false,
        }),
    ];

    for rendered in &ran {
        assert!(
            rendered.starts_with("gg repaired your reply before running it:\n"),
            "a turn whose program ran says so:\n{rendered}"
        );
        assert!(
            !rendered.contains("What follows is about the repaired text"),
            "the reconciliation clause belongs only where nothing ran:\n{rendered}"
        );
        assert_no_blank_run(rendered);
    }
    for rendered in &never_ran {
        assert!(
            rendered.starts_with("gg repaired your reply first, but it still did not run:\n"),
            "a turn where nothing ran must not claim the reply was run:\n{rendered}"
        );
        assert!(
            !rendered.contains("before running it"),
            "the running wording must not survive on a turn where nothing ran:\n{rendered}"
        );
        assert!(
            flat(rendered).contains(
                "What follows is about the repaired text, not about the reply exactly as you sent \
                 it."
            ),
            "a model reading a diagnostic against healed source must be told so:\n{rendered}"
        );
        assert_no_blank_run(rendered);
    }
}

/// **The exact round-2 turn that fired the contradiction, rendered.**
///
/// `google/gemini-3.6-flash`, turn 1: five programs interleaved with a fabricated transcript of gg's
/// own replies. Healing stripped the trailing invented output (`strip-prose`) and then refused the
/// remainder as two programs pasted one after another (`drop-duplicate-program`, recorded on the
/// stream as `{"strategies":["strip-prose","drop-duplicate-program"],"notAProgram":"several_blocks",
/// "blocks":2}`) — a repair *and* a refusal in one turn, which is the combination the unconditional
/// note got wrong. Nothing ran, no tool was called, and the workspace was untouched; the feedback the
/// model actually received opened by telling it gg had run its reply.
///
/// The fixture is the [`Healed`] that [`heal`](crate::healing::heal) produces over that captured
/// reply, transcribed rather than re-derived here — the two applications in order, with the six-line
/// tail the prose strategy took, and the verdict with its shape and count. Transcribed because the
/// reply is six kilobytes of one model's mistake and belongs with healing's own fixtures; the
/// wording of both halves is still healing's own, so what this test pins is the one thing the
/// template decides: that a refused reply is never described as one that ran.
#[test]
fn a_healed_reply_gg_refused_is_never_told_it_ran() {
    let healed = Healed {
        program: "const srcEntries = listDir(\"src\");".to_string(),
        verdict: HealingVerdict::NotAProgram(NotAProgramReason::SeveralBlocks {
            blocks: 2,
            shape: CandidateShape::Bare,
        }),
        applied: vec![
            HealingApplication {
                strategy: HealingStrategy::StripProse,
                detail: HealingDetail::Prose {
                    leading: 0,
                    trailing: 6,
                },
            },
            HealingApplication {
                strategy: HealingStrategy::DropDuplicateProgram,
                detail: HealingDetail::SeveralPrograms,
            },
        ],
        did_not_converge: false,
    };
    let HealingVerdict::NotAProgram(reason) = healed.verdict else {
        unreachable!("the fixture is the refusal");
    };
    let rendered = render_code_not_a_program(&CodeNotAProgramContext {
        healing: healed.notes(),
        reason: reason.message(),
        delegated: false,
    });

    // What healing actually did is still disclosed — the refusal does not swallow the repair, or the
    // model would conclude gg never saw the invented transcript it wrote.
    assert!(
        rendered.starts_with(
            "gg repaired your reply first, but it still did not run:\n- removed 6 lines of \
             explanation after your program\n"
        ),
        "the refused turn must disclose the repair without claiming the reply ran:\n{rendered}"
    );
    // ...and the verdict follows the disclosure rather than contradicting it.
    assert!(
        flat(&rendered).contains(&flat(&reason.message())),
        "the verdict must follow the disclosure:\n{rendered}"
    );
    assert!(
        !rendered.contains("before running it"),
        "this is the exact wording the live turn contradicted:\n{rendered}"
    );
    assert_no_blank_run(&rendered);
}

/// **No code feedback tells any agent that `finish` would end the run.**
///
/// A model reading "this ends the run" while it is a subagent has the strongest available reason
/// not to call it, and a subagent that never calls it never returns a verdict — which leaves an
/// issue unaccepted, a speculation judge without a winner, and every worktree discarded unmerged.
/// The per-turn feedback no longer restates the termination rule at all (the system prompt owns
/// it), so the hazard is closed by silence rather than by a branch — and this test holds that
/// silence, on the delegated reader the wrong sentence would have cost the most.
#[test]
fn no_code_feedback_tells_a_delegated_agent_it_would_end_the_run() {
    let ran = render_code_result(&CodeResultContext {
        delegated: true,
        logs: vec!["1".to_string()],
        silent: false,
        ..quiet_result()
    });
    let transpile = render_code_transpile_error(&CodeTranspileErrorContext {
        healing: Vec::new(),
        error: "line 1, column 1: Unexpected token".to_string(),
        delegated: true,
    });
    let refused = render_code_not_a_program(&CodeNotAProgramContext {
        healing: Vec::new(),
        reason: NotAProgramReason::Prose.message(),
        delegated: true,
    });

    for rendered in [&ran, &transpile, &refused] {
        assert!(
            !flat(rendered).contains("end the run"),
            "a delegated worker was told `finish` ends the run:\n{rendered}"
        );
        assert_no_blank_run(rendered);
    }

    // The feedback is the same text either way: nothing in it depends on who is reading it.
    let root = render_code_result(&CodeResultContext {
        logs: vec!["1".to_string()],
        silent: false,
        ..quiet_result()
    });
    assert_eq!(
        root, ran,
        "the code result feedback must not vary with the reader"
    );
}

/// **A reply that was not a program is told what it was, and told that only `finish` ends the run.**
///
/// This is the feedback that closes the failure round 1 documented most starkly: a model narrated a
/// completed task, gg read the prose turn as "finished", and the run reported success over a
/// workspace with no deliverable in it. Under this protocol such a turn is a *failed* turn, and the
/// feedback has to carry both halves — what the reply was, and what a turn is supposed to look like
/// — for every one of the six reasons a reply can fail to be a program.
#[test]
fn the_not_a_program_feedback_names_the_reply_and_teaches_finish() {
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
            healing: Vec::new(),
            reason: reason.message(),
            delegated: false,
        });
        // The reason leads, in the model's own terms, and every one of the six ends by saying that
        // nothing ran and nothing changed.
        assert!(
            rendered.starts_with(&reason.message()),
            "the reason must lead the feedback:\n{rendered}"
        );
        assert!(
            flat(&rendered).contains(
                "All responses must be pure TypeScript. Returning any non-code text in your \
                 response will prevent your responses from being processed. Do not include any \
                 Markdown formatting, explanations, etc."
            ),
            "{rendered}"
        );
        assert!(
            flat(&rendered).contains(
                "If the task is complete, call `harness.finish()` to signal that the task is \
                 complete:"
            ),
            "{rendered}"
        );
        assert!(
            rendered.ends_with("    harness.finish(\"what you did, in a sentence or two\");"),
            "the feedback must close on the call that would have ended the run:\n{rendered}"
        );
        assert_no_blank_run(&rendered);
    }

    // The one reason whose sentence carries a number carries the real one.
    let several = render_code_not_a_program(&CodeNotAProgramContext {
        healing: Vec::new(),
        reason: NotAProgramReason::SeveralBlocks {
            blocks: 7,
            shape: CandidateShape::Fenced,
        }
        .message(),
        delegated: false,
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
// Planning
// ---------------------------------------------------------------------------

/// The plan-mode guidance names the read-only restriction and how to submit; the framing carries
/// the plan verbatim under its heading.
#[test]
fn the_planning_templates_render() {
    let guidance = render_plan_mode();
    assert!(guidance.starts_with("# Plan Mode"));
    assert!(guidance.contains("read-only"));
    assert!(guidance.contains("submit_plan"));

    let framed = render_plan_framing("  Build the grid first.  ");
    assert!(framed.starts_with("# Implementation Plan"));
    assert!(framed.ends_with("Build the grid first."));
}

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------

/// One brief-rendering context per generated brief, in both execution modes.
///
/// Rendering is where a `.hbs` typo becomes a panic (the engine is strict), so every brief has to
/// be rendered by *some* test or a misspelled variable reaches a dispatched agent instead of the
/// build. The ending each brief teaches is asserted next to the loop that depends on it, in
/// `agent.briefs.test.rs`; what is asserted here is the **stable markers** other parts of gg read
/// back out of a brief — the issue heading and the fix heading the offline mock keys off, and the
/// approach an attempt is handed, which is the only thing that distinguishes one attempt's brief
/// from another's.
#[test]
fn every_generated_brief_renders_in_both_execution_modes() {
    for code in [false, true] {
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
                workspace: "/work/.gg-worktrees/issue-1".to_string(),
                baseline: Some("0".repeat(40)),
            },
            code,
        });
        assert!(review.contains("`critic` requested changes:"), "{review}");
        assert!(review.contains("  - Fix the score."), "{review}");
        assert!(review.contains("`second` approved the work."), "{review}");
        // The baseline sha is named whole, so a reviewer can diff against it itself.
        assert!(
            review.contains(&format!("Baseline: {}", "0".repeat(40))),
            "{review}"
        );

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
            code,
        });
        assert!(fix.contains("## Requested changes"), "{fix}");
        assert!(fix.contains("1. Fix the score.\n2. Add a test."), "{fix}");

        let merge = render_merge_brief(&MergeBriefContext {
            issue_id: "AUTH-1".to_string(),
            branch: "gg/issue-auth-1".to_string(),
            reason: "CONFLICT (content): src/main.rs".to_string(),
            code,
        });
        assert!(merge.contains("gg/issue-auth-1"), "{merge}");
        assert!(merge.contains("CONFLICT (content): src/main.rs"), "{merge}");
        assert!(merge.contains("resolved and committed"), "{merge}");

        let attempt = render_attempt_brief(&AttemptBriefContext {
            base: "Build it.".to_string(),
            index: 2,
            count: 3,
            approach: Some("Use a state machine.".to_string()),
            code,
        });
        assert!(attempt.starts_with("Build it."), "{attempt}");
        // The assigned approach is what makes one attempt's brief differ from another's — and what
        // the offline attempt mock reads its own number out of.
        assert!(attempt.contains("### Approach"), "{attempt}");
        assert!(attempt.contains("Use a state machine."), "{attempt}");

        let judge = render_judge_brief(&JudgeBriefContext {
            task: "Build it.".to_string(),
            attempts: vec![
                JudgeAttemptView {
                    number: 1,
                    summary: Some("built it".to_string()),
                    diff: Some("+ a line".to_string()),
                },
                JudgeAttemptView {
                    number: 2,
                    summary: None,
                    diff: None,
                },
            ],
            count: 2,
            code,
        });
        assert!(judge.contains("### Attempt 1"), "{judge}");
        assert!(judge.contains("built it"), "{judge}");
        // An attempt that produced nothing says so rather than rendering an empty section.
        assert!(judge.contains("(no summary)"), "{judge}");
        assert!(judge.contains("SPECULATION JUDGE: WINNER <n>"), "{judge}");
    }
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
            workspace: "/work".to_string(),
            baseline: None,
        },
        code: false,
    });
    assert!(!brief.contains("Earlier review feedback"), "{brief}");
    assert!(brief.contains("No changes were detected"), "{brief}");
    assert!(!brief.contains("Baseline:"), "{brief}");
}

/// A review that requested changes without listing any still hands the fixing agent something to
/// act on, rather than an empty list under a heading that promises one.
#[test]
fn the_fix_brief_synthesizes_an_item_when_the_review_listed_none() {
    let brief = render_fix_brief(&FixBriefContext {
        issue_brief: "# Issue `AUTH-1`: Log in".to_string(),
        items: Vec::new(),
        code: false,
    });
    assert!(
        flat(&brief).contains("The reviewer requested changes but listed no specific items"),
        "{brief}"
    );
}

// ---------------------------------------------------------------------------
// Compaction, completion, context pressure, and the FSM guidance
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
            instruction.starts_with("This session's context window is full."),
            "{instruction}"
        );
        assert!(
            flat(&instruction).contains("all work yet to be completed"),
            "{instruction}"
        );
        // A code run has to be told, in so many words, that prose is expected for this one turn.
        assert_eq!(
            instruction.contains("do **NOT** write a program"),
            code_mode,
            "{instruction}"
        );

        let compact = context(false, true, false, code_mode);
        let instruction = render_compaction_instruction(&compact);
        assert_eq!(
            instruction.contains("context.compact(summary, files)"),
            code_mode,
            "{instruction}"
        );
        assert_eq!(
            instruction.contains("Call the `compact` tool."),
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
                flat(&refusal).contains("All other operations are blocked until you"),
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

/// The completion feedbacks name the finish tool from one source and quote the command that
/// actually failed.
#[test]
fn the_completion_prompts_render() {
    let missing = render_completion_missing("finish");
    assert!(missing.contains("`finish`"), "{missing}");

    let failure = render_completion_validation_failure(&ValidationFailureContext {
        index: 1,
        total: 2,
        command: "npm test",
        output: "1 test failed",
    });
    assert!(failure.contains("Failed command: `npm test`"), "{failure}");
    assert!(failure.contains("1 test failed"), "{failure}");
}

/// The pressure signal opens with the stable `Context window:` prefix the refresh keys off, and
/// names its consumers only when there are any.
#[test]
fn the_context_pressure_signal_renders() {
    let with_consumers = render_context_pressure(&ContextPressureContext {
        total: 90_000,
        limit: 100_000,
        percent: 90,
        consumers: vec!["history 40000".to_string(), "files 20000".to_string()],
    });
    assert!(with_consumers.starts_with("Context window: 90000/100000 tokens (90% full)."));
    assert!(with_consumers.contains("Largest consumers (tokens): history 40000, files 20000."));

    let bare = render_context_pressure(&ContextPressureContext {
        total: 10,
        limit: 100,
        percent: 10,
        consumers: Vec::new(),
    });
    assert!(bare.starts_with("Context window: 10/100 tokens (10% full)."));
    assert!(!bare.contains("Largest consumers"));
}

/// Every built-in FSM state's guidance renders, and each opens with its own heading — the model
/// reads it as the state it is in, not as a continuation of the prompt above it.
#[test]
fn every_built_in_fsm_state_renders_its_guidance() {
    for (state, heading) in [
        (FsmGuidance::TddWriteTests, "# Test Phase"),
        (FsmGuidance::TddImplement, "# Implementation Phase"),
        (FsmGuidance::TddVerify, "# Verification Phase"),
        (FsmGuidance::PlanFirstPlan, "# Planning Phase"),
        (FsmGuidance::PlanFirstImplement, "# Implement your plan"),
    ] {
        let guidance = render_fsm_guidance(state);
        assert!(guidance.starts_with(heading), "{guidance}");
    }
}
