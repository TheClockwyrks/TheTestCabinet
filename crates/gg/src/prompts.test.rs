use super::*;

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

/// A context with every capability **on**, so the maximal prompt is exercised.
fn full_system() -> SystemContext {
    SystemContext {
        tools: vec![
            ToolView {
                name: "read_file".to_string(),
                args: "path, offset, limit".to_string(),
                description: "Read a UTF-8 text file from the workspace.".to_string(),
            },
            ToolView {
                name: "write_file".to_string(),
                args: "path, contents".to_string(),
                description: "Write a file.".to_string(),
            },
        ],
        responses_as_code: false,
        read_file: ReadFileView {
            capped: true,
            hard_cap: true,
            line_cap: 250,
        },
        skills: vec![SkillView {
            name: "physics".to_string(),
            description: "How to tune the simulation.".to_string(),
        }],
        memories: Some(MemoriesView {
            max_count: 8,
            max_len_per_memory: 2_000,
            max_total_len: 8_000,
        }),
        tasks: Some(TasksView { max_tasks: 100 }),
        board: Some(BoardView {
            max_epics: 50,
            max_issues: 200,
        }),
        planning: true,
        fsm: Some(FsmView {
            machine: "tdd".to_string(),
        }),
        code_reviews: true,
        speculative: true,
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
    for (name, _) in TEMPLATES {
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

/// With every capability off, the prompt is the base framing and the "no tools" line — and
/// **none** of the capability sections. This is the ablation property: a disabled capability
/// contributes no prompt text at all.
#[test]
fn a_bare_run_renders_only_the_base_prompt() {
    let prompt = render_system(&bare_system());
    assert!(prompt.starts_with("You are gg, The Test Cabinet's autonomous coding agent."));
    assert!(prompt.contains("no tools available"));
    for absent in [
        "## Skills",
        "## Memories",
        "## Tasks",
        "## Epics and issues",
        "## Planning",
        "## Process",
        "## Code Reviews",
        "## Speculative execution",
        "## Responses as code",
        "read_file",
    ] {
        assert!(
            !prompt.contains(absent),
            "a bare run's prompt must not mention `{absent}`:\n{prompt}"
        );
    }
    // Skipped sections leave no run of blank lines behind.
    assert!(!prompt.contains("\n\n\n"), "prompt has a blank-line run");
}

/// With every capability on, each section renders once and states that run's configured limits
/// inline rather than a hardcoded default.
#[test]
fn a_full_run_renders_every_section_with_its_configuration() {
    let prompt = render_system(&full_system());
    for section in [
        "## Your tools",
        "## Skills",
        "## Memories",
        "## Tasks",
        "## Epics and issues",
        "## Planning",
        "## Process",
        "## Code Reviews",
        "## Speculative execution",
    ] {
        assert!(prompt.contains(section), "missing `{section}`:\n{prompt}");
    }
    // The tools are listed, and the skills catalog carries each description.
    let flat = flat(&prompt);
    assert!(flat.contains("`read_file`, `write_file`"));
    assert!(flat.contains("- physics: How to tune the simulation."));
    // Configuration is interpolated, not restated in prose.
    assert!(flat.contains("at most **250 lines**"));
    assert!(flat.contains("at most 8 memories, 2000 characters of body each"));
    assert!(flat.contains("8000 characters in total"));
    assert!(flat.contains("Hold at most 100 tasks."));
    assert!(flat.contains("at most 50 epics and 200 issues"));
    assert!(flat.contains("**tdd** process"));
    assert!(!prompt.contains("\n\n\n"), "prompt has a blank-line run");
}

/// The task section states how to *use* the task tools — the instructions the pinned block used
/// to repeat on every refresh — so the two never say the same thing twice.
#[test]
fn the_task_section_carries_the_tool_instructions() {
    let prompt = render_system(&full_system());
    for instruction in [
        "`add_task`",
        "`update_task`",
        "`set_blocked_by`",
        "`complete_task`",
        "`remove_task`",
        "DAG",
        "\"Your tasks\"",
    ] {
        assert!(
            flat(&prompt).contains(instruction),
            "the tasks section must state `{instruction}`:\n{prompt}"
        );
    }
}

/// A capped `read_file` states its cap up front; an uncapped one says nothing about reads, and a
/// default cap is described as a nudge rather than a ceiling.
#[test]
fn the_read_cap_is_stated_only_when_one_is_in_force() {
    let uncapped = render_system(&SystemContext {
        read_file: ReadFileView::default(),
        ..full_system()
    });
    assert!(!uncapped.contains("lines"), "no cap, no read guidance");

    let default_cap = render_system(&SystemContext {
        read_file: ReadFileView {
            capped: true,
            hard_cap: false,
            line_cap: 40,
        },
        ..full_system()
    });
    assert!(flat(&default_cap).contains("**40 lines** by default"));
    assert!(flat(&default_cap).contains("not a ceiling"));
}

/// In responses-as-code mode the tools are described as functions a program calls, and the
/// traditional tool-calling line is gone.
#[test]
fn code_mode_replaces_the_tool_listing_with_the_language() {
    let prompt = render_system(&SystemContext {
        responses_as_code: true,
        ..full_system()
    });
    assert!(prompt.contains("## Responses as code"));
    assert!(prompt.contains("The gg-script language:"));
    assert!(
        flat(&prompt).contains("`read_file({ path, offset, limit })` — Read a UTF-8 text file")
    );
    assert!(!prompt.contains("## Your tools"));

    // With no tools at all, the program can only compute with the builtins.
    let toolless = render_system(&SystemContext {
        responses_as_code: true,
        tools: Vec::new(),
        ..full_system()
    });
    assert!(toolless.contains("only compute with the builtins"));
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
            },
            TaskItemView {
                id: "movement".to_string(),
                title: "Player movement".to_string(),
                description: Some("arrow keys".to_string()),
                status: "pending".to_string(),
                marker: "[ ]".to_string(),
                ready: false,
                blocked_by: Some("`scaffold`".to_string()),
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
