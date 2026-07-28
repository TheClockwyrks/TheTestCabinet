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
            max_issues: 200,
            max_retries: 1,
        }),
        planning: true,
        fsm: Some(FsmView {
            machine: "tdd".to_string(),
        }),
        code_reviews: true,
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
            spawnable_agents: vec![SpawnableAgentView {
                name: "reviewer".to_string(),
                description: "review the work".to_string(),
            }],
            board: Some(BoardView {
                max_epics: 50,
                max_issues: 200,
                max_retries: 1,
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

/// The clean-run branch: what the program logged is shown, the roster is shown, and — always — how
/// to continue and how to finish. That closing sentence is the only place the termination rule is
/// discoverable, so it is asserted on the plainest possible outcome.
#[test]
fn the_result_feedback_shows_the_output_the_roster_and_how_to_finish() {
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
    assert!(rendered.contains("It made 2 tool call(s):"));
    assert!(rendered.contains("- list_dir → ok"));
    // A failure the program CAUGHT is still reported, or it would be invisible.
    assert!(rendered.contains("- edit_file → failed: `foo` appears 3 times"));
    assert!(
        flat(&rendered).ends_with(
            "Continue by emitting your next program. When the work is done and you have checked \
             it, end the run with `harness.finish(\"...\")` from inside a program — nothing else ends it."
        ),
        "the termination rule must close every result:\n{rendered}"
    );
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
    assert!(bare.contains("It made no tool calls."));
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
    assert!(rendered.contains("(2 image(s) were not attached: a program may show at most 4.)"));
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
    assert!(rendered.contains("It made 738 tool call(s):"));
    assert!(
        rendered.contains("(737 further call(s) were made but not listed"),
        "a truncated roster must say so:\n{rendered}"
    );
    assert!(
        rendered.contains("return values are discarded, gg never sees them"),
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
    assert!(rendered.contains("your program logged nothing, so it told you nothing"));
    assert!(rendered.contains("It made no tool calls."));
    // ...and a program that said something is not nagged.
    let spoke = render_code_result(&CodeResultContext {
        logs: vec!["12 files".to_string()],
        silent: false,
        ..quiet_result()
    });
    assert!(!spoke.contains("told you nothing"));
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
        flat(&threw).contains("a program that fails has not finished: the run is still going"),
        "{threw}"
    );
    assert!(
        flat(&threw).contains("call `harness.finish(...)` again"),
        "{threw}"
    );

    let stopped = render_code_sandbox_error(&CodeSandboxErrorContext {
        healing: Vec::new(),
        error: "the program exceeded its 268435456-byte memory cap".to_string(),
        finish_revoked: true,
        calls: 3,
    });
    assert!(
        flat(&stopped)
            .contains("a program the sandbox stopped has not finished: the run is still going"),
        "{stopped}"
    );

    // And a turn that declared no ending is told nothing about one.
    let ordinary = render_code_result(&CodeResultContext {
        logs: vec!["ok".to_string()],
        silent: false,
        ..quiet_result()
    });
    assert!(!ordinary.contains("has not finished"));
    assert_no_blank_run(&threw);
    assert_no_blank_run(&ordinary);
}

/// A transpile failure says the thing that distinguishes it from every other failure: **nothing
/// ran**, so the workspace is untouched and there is nothing to re-check. It also restates the two
/// rules a failure to compile most often means the model broke — that the *entire reply* is
/// compiled, and that saying the task is done is not how a run ends.
///
/// The diagnostic in the fixture is the shape the real pipeline produces — `line L, column C:` plus
/// the quoted source line — and it is the real round-1 failure: a model glued prose to its closing
/// fence, the prose was compiled as program text, and a locationless diagnostic left it unable to
/// see what had happened. An earlier version of this test asserted against a located-*looking*
/// string the transpiler never emitted, which certified a location the model was in fact never
/// given.
#[test]
fn the_transpile_feedback_says_nothing_ran() {
    let rendered = render_code_transpile_error(&CodeTranspileErrorContext {
        healing: Vec::new(),
        error: "line 4, column 1: Expected a semicolon or an implicit semicolon after a \
                statement, but found none | ```Consumed fuel: 24,000 / 1,000,000 budget."
            .to_string(),
        delegated: false,
    });
    assert_eq!(
        rendered,
        "Your program did not compile: line 4, column 1: Expected a semicolon or an implicit \
         semicolon after a statement, but found none | ```Consumed fuel: 24,000 / 1,000,000 \
         budget.\n\nRemember that gg compiles your **entire reply**: anything in it that is not \
         TypeScript — a code fence, a\nsentence, a heading — is a syntax error in your program. \
         And if you meant to say the task is finished,\nsaying so does not end the run: only \
         `harness.finish(\"...\")`, called from inside a program, does.\n\nNothing ran, so nothing \
         changed. Fix the syntax and reply with a corrected program."
    );
}

/// A sandbox limit is framed as "too heavy", never as "wrong" — while a **timeout** gets its own,
/// opposite advice: the ceiling is far larger than any program needs, so a timeout means a program
/// that did not terminate, not one that was too heavy.
#[test]
fn the_sandbox_feedback_separates_a_limit_a_timeout_and_a_mistake() {
    let memory = render_code_sandbox_error(&CodeSandboxErrorContext {
        healing: Vec::new(),
        error: "the program exceeded its 4194304-byte memory cap".to_string(),
        finish_revoked: false,
        calls: 12,
    });
    assert!(memory.contains("This is a sandbox limit, not a tool failure"));
    assert!(memory.contains("Split the task across several smaller programs, one per turn."));
    assert!(memory.contains("The 12 tool call(s) it had already made stand."));
    // A memory cap is "too heavy", not "you looped": it must not carry the timeout's runaway advice.
    assert!(!memory.contains("did not terminate"));

    let timeout = render_code_timeout(&CodeTimeoutContext {
        healing: Vec::new(),
        error: "the program ran longer than its 30s execution timeout and was stopped".to_string(),
        finish_revoked: false,
        calls: 0,
    });
    assert!(timeout.contains("did not terminate"));
    assert!(timeout.contains("far longer than any program needs"));
    // A timeout is not a "do less" problem, so it does not carry the "too heavy" framing.
    assert!(!timeout.contains("too heavy for one program"));
    assert!(!timeout.contains("already made stand"));
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

/// **A delegated worker is never told that `finish` would end the run.**
///
/// The system prompt is role-aware for a reason: a model reading "this ends the run" while it is a
/// subagent has the strongest available reason not to call it, and a subagent that never calls it
/// never returns a verdict — which leaves a Code Review unaccepted, a speculation judge without a
/// winner, and every worktree discarded unmerged. The per-turn feedback repeats that rule on **every
/// turn**, far later in the context than the system prompt, so it is the louder of the two channels
/// and has to say the same thing.
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
        assert!(
            flat(rendered).contains("your session"),
            "the feedback must name what `finish` really ends for this reader:\n{rendered}"
        );
        assert_no_blank_run(rendered);
    }

    // The root agent's wording is unchanged, and the branch is the only difference between the two.
    let root = render_code_result(&CodeResultContext {
        logs: vec!["1".to_string()],
        silent: false,
        ..quiet_result()
    });
    assert_eq!(
        root,
        ran.replace("end your session with", "end the run with"),
        "the two renders differ by more than what `finish` ends"
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
                "Every turn of this run is a program: gg compiles and runs your **entire reply** \
                 as TypeScript. A reply that is not code is not a turn — it does nothing, it \
                 changes nothing, and it counts as a failed turn."
            ),
            "{rendered}"
        );
        assert!(
            flat(&rendered).contains(
                "Reply with a program. Just the code: no code fence, no explanation before or \
                 after it, nothing but the statements you want run."
            ),
            "{rendered}"
        );
        assert!(
            flat(&rendered).contains(
                "If you believe the task is complete, saying so does not end the run — only \
                 `harness.finish` does, and you call it from inside a program:"
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
         \x20 - done when: the grid draws"
    );
    assert!(!block.contains("create_issue"));
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
    assert!(guidance.starts_with("# Plan mode (read-only)"));
    assert!(guidance.contains("submit_plan"));

    let framed = render_plan_framing("  Build the grid first.  ");
    assert!(framed.starts_with("# Implementation plan"));
    assert!(framed.ends_with("Build the grid first."));
}
