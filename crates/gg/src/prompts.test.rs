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

/// A tool as the run's registry offers it and the sandbox binds it — a name, the real TypeScript
/// signature a program calls it by, and the SDK's own sentence about it.
fn bound(name: &str, signature: &str, doc: &str) -> ToolView {
    ToolView {
        name: name.to_string(),
        signature: signature.to_string(),
        doc: doc.to_string(),
    }
}

/// A tool the registry offers that the **sandbox does not bind** — a turn-level transition. It has
/// a name and nothing else, which is precisely what the code section must skip and the tool-calling
/// section must still list.
fn unbound(name: &str) -> ToolView {
    ToolView {
        name: name.to_string(),
        signature: String::new(),
        doc: String::new(),
    }
}

/// `finish` as the committed catalogue declares it — the one function the prompt shows every
/// code-mode run whatever it enables.
///
/// The signature and the sentence are the SDK's own, copied rather than paraphrased: the `never`
/// return is what tells a model at a glance that nothing after the call runs, and a fixture that
/// softened it would certify prompt text the sandbox does not back.
fn session_view() -> ToolView {
    ToolView {
        name: "finish".to_string(),
        signature: "finish(summary: string): void".to_string(),
        doc: "End this run. The `summary` is gg's final word on the task: what you did, in a \
              sentence or two."
            .to_string(),
    }
}

/// A context with every capability **on**, so the maximal prompt is exercised.
fn full_system() -> SystemContext {
    SystemContext {
        tools: vec![
            bound(
                "read_file",
                "readFile(path: string, options?: { offset?: number; limit?: number; }): FileRead",
                "Read a UTF-8 text file from the workspace.",
            ),
            bound(
                "list_dir",
                "listDir(path?: string): DirEntry[]",
                "List a workspace directory, sorted by name.",
            ),
            bound(
                "write_file",
                "writeFile(path: string, contents: string): number",
                "Write a file.",
            ),
        ],
        responses_as_code: false,
        // `session` is carried even here, where the mode is off: it is `Some` in code mode and
        // `None` in tool-calling mode in production, and pinning the tool-calling render with it
        // present is how `the_tool_calling_prompt_is_unchanged_by_the_code_mode_rewrite` proves the
        // `{{else}}` arm cannot reach it.
        session: Some(session_view()),
        delegated: false,
        fences_are_stripped: true,
        // The maximal run binds `list_dir` + `read_file` (and `shell` is not in this fixture's
        // toolset), so the composition example is the one it teaches.
        code: CodeTeachingView {
            example_compose: true,
            read_file: true,
            edit_file: true,
            shell: true,
            ..CodeTeachingView::default()
        },
        types: vec![
            TypeView {
                name: "ToolError".to_string(),
                declaration: "class ToolError extends Error { readonly tool: string; }".to_string(),
            },
            TypeView {
                name: "DirEntry".to_string(),
                declaration: "interface DirEntry { name: string; kind: \"file\" | \"directory\" | \
                              \"other\"; }"
                    .to_string(),
            },
        ],
        helpers: vec![bound(
            "readTextFile",
            "readTextFile(path: string): string",
            "Read a workspace text file and return its contents directly.",
        )],
        turn_level_tools: vec!["enter_plan_mode".to_string(), "submit_plan".to_string()],
        read_file: ReadFileView {
            offered: true,
            capped: true,
            hard_cap: true,
            line_cap: 250,
            images: true,
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
    for (name, _) in TEMPLATES.iter().chain(CAPABILITY_TEMPLATES) {
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
        "## Your reply is a program",
        "## Ending the run",
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
    assert!(flat.contains("`read_file`, `list_dir`, `write_file`"));
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
            offered: true,
            capped: true,
            hard_cap: false,
            line_cap: 40,
            images: true,
        },
        ..full_system()
    });
    assert!(flat(&default_cap).contains("**40 lines** by default"));
    assert!(flat(&default_cap).contains("not a ceiling"));
}

/// In responses-as-code mode the prompt teaches **TypeScript** and lists the real signatures the
/// sandbox binds — not a bespoke language, and not a hand-written paraphrase of the API.
#[test]
fn code_mode_teaches_typescript_and_lists_the_real_signatures() {
    let prompt = render_system(&SystemContext {
        responses_as_code: true,
        ..full_system()
    });
    let flat = flat(&prompt);
    assert!(prompt.contains("## Your reply is a program"));
    assert!(flat.contains("**Every reply you send is a TypeScript program**"));
    // A real signature, rendered verbatim from the catalogue, with the SDK's own sentence.
    assert!(
        flat.contains("`listDir(path?: string): DirEntry[]` — List a workspace directory"),
        "the code section must render the real signature:\n{prompt}"
    );
    // ...and the declaration of the type that signature returns, so the fields are not guessed at.
    assert!(flat.contains("interface DirEntry { name: string; kind:"));
    // The helper is offered alongside the tool it wraps.
    assert!(flat.contains("`readTextFile(path: string): string`"));
    // ...and `finish`, which is the one entry no toolset can withhold.
    assert!(flat.contains("`finish(summary: string): void` — End this run."));
    // The traditional listing, and every trace of the bespoke language this replaced, are gone: its
    // builtin list and the tool-calling heading. (The dialect's *name* is not spelled here — the
    // repo-wide grep that retires it would count this file as a live reference.)
    for absent in ["## Your tools", "Builtins"] {
        assert!(
            !prompt.contains(absent),
            "a code-mode prompt must not mention `{absent}`:\n{prompt}"
        );
    }
}

/// The turn-level transitions are named as *not composable* when the run offers them, and the note
/// is absent when it does not — and they never appear in the signature list, because they have no
/// signature to render.
#[test]
fn code_mode_names_the_turn_level_transitions_it_cannot_compose() {
    let mut context = full_system();
    context.responses_as_code = true;
    // The registry offers `enter_plan_mode`, but the sandbox does not bind it.
    context.tools.push(unbound("enter_plan_mode"));
    let prompt = render_system(&context);
    let flat = flat(&prompt);
    assert!(
        flat.contains(
            "`enter_plan_mode`, `submit_plan` are turn-level transitions, not values, so they are \
             not available inside a program at all — and every turn of this run is a program, so \
             this run cannot make them at any point. Do the work directly instead."
        ),
        "the note must name the transitions and say the run cannot make them at all:\n{prompt}"
    );
    // The unbound tool contributes no bullet: a signature-less entry is skipped rather than
    // rendered as an empty backtick pair.
    assert!(
        !prompt.contains("- `` —"),
        "a tool with no signature must not render a bullet:\n{prompt}"
    );

    let without = render_system(&SystemContext {
        responses_as_code: true,
        turn_level_tools: Vec::new(),
        ..full_system()
    });
    assert!(!without.contains("turn-level transitions"));
}

/// A code-mode run with no tools at all says so plainly: a program can still compute and return a
/// value, which is a real (if narrow) thing to be able to do.
#[test]
fn code_mode_without_tools_says_a_program_can_only_compute() {
    let toolless = render_system(&SystemContext {
        responses_as_code: true,
        tools: Vec::new(),
        helpers: Vec::new(),
        code: CodeTeachingView {
            example_pure: true,
            ..CodeTeachingView::default()
        },
        ..full_system()
    });
    assert!(toolless.contains("only compute, log what it computed, and `finish`"));
    assert!(!toolless.contains("Your tools this run"));
    // It still gets a worked example — a program that only computes is a real, if narrow, thing to
    // be able to write, and an example is how `return` and `console.log` are taught at all.
    assert!(
        toolless.contains("\n    const waves = [1, 2, 3, 4]"),
        "a toolless run still gets its indented worked example:\n{toolless}"
    );
    // ...and it is still told how to end the run, because `finish` is not a capability and nothing
    // withholds it. A toolset that produced a protocol with no exit would be the one bug this
    // section cannot recover from.
    assert!(toolless.contains("## Ending the run"), "{toolless}");
}

/// **The prompt never names a function the run withheld.**
///
/// The worked example is the one part of the prompt a model copies verbatim, so an example naming a
/// tool this run does not bind is a `ReferenceError` on turn one — and it would falsify the property
/// [toolset ablation](https://docs.testcabinet.ai/gg/toolset-ablation/) rests on, that a withheld
/// capability contributes no prompt text. Asserted over every reduced toolset the projection can
/// produce, including the empty one.
///
/// The ending section is the case worth calling out. It is the one part of the code arm that is
/// **ungated** — every run is shown `finish` — so its worked example is the one example that has to
/// type-check against a scope containing nothing but `finish` itself. The toolless render below is
/// what holds it to that.
#[test]
fn code_mode_teaching_never_names_a_tool_the_run_withheld() {
    /// Every function name the code section's prose can mention, so a case can assert the absence
    /// of all the ones its toolset does not bind.
    const NAMED: &[&str] = &[
        "listDir",
        "readTextFile",
        "readFile",
        "editFile",
        "writeFile",
        "shell",
    ];

    let shell_only = render_system(&SystemContext {
        responses_as_code: true,
        tools: vec![bound(
            "shell",
            "shell(command: string, options?: { timeoutSecs?: number; }): ShellOutput",
            "Run a shell command in the workspace.",
        )],
        helpers: Vec::new(),
        turn_level_tools: Vec::new(),
        code: CodeTeachingView {
            example_shell: true,
            shell: true,
            ..CodeTeachingView::default()
        },
        ..full_system()
    });
    assert!(
        shell_only.contains("\n    const build = shell(\"npm run build\");"),
        "a shell-only run still gets a worked example:\n{shell_only}"
    );
    for absent in NAMED.iter().filter(|name| **name != "shell") {
        assert!(
            !shell_only.contains(absent),
            "a shell-only run must not be taught `{absent}`:\n{shell_only}"
        );
    }

    let toolless = render_system(&SystemContext {
        responses_as_code: true,
        tools: Vec::new(),
        helpers: Vec::new(),
        turn_level_tools: Vec::new(),
        code: CodeTeachingView {
            example_pure: true,
            ..CodeTeachingView::default()
        },
        ..full_system()
    });
    assert!(
        toolless.contains("## Ending the run"),
        "the ungated ending section renders even here, which is what makes the absences below \
         cover it:\n{toolless}"
    );
    for absent in NAMED {
        assert!(
            !toolless.contains(absent),
            "a run with no tools must not be taught `{absent}`:\n{toolless}"
        );
    }
}

/// **The code-mode prompt contains no backtick fence anywhere.**
///
/// The contract it teaches is that the model's whole reply is the program, so a fenced example would
/// be the one place in the prompt that silently re-teaches the fenced protocol it replaced — and it
/// would do it in the part of the document models copy most literally. It would also corrupt the
/// measurement the capability exists to make: "how often does this model still wrap its program in a
/// fence" means nothing if gg showed it one.
///
/// Asserted over every render the code arm can produce — each of the four worked examples, both
/// arms of the fence rule, and both roles — because the examples are the only place a fence could
/// plausibly creep back in.
#[test]
fn the_code_prompt_never_shows_a_code_fence() {
    let examples = [
        CodeTeachingView {
            example_compose: true,
            read_file: true,
            ..CodeTeachingView::default()
        },
        CodeTeachingView {
            example_shell: true,
            shell: true,
            ..CodeTeachingView::default()
        },
        CodeTeachingView {
            example_write: true,
            edit_file: true,
            ..CodeTeachingView::default()
        },
        CodeTeachingView {
            example_pure: true,
            ..CodeTeachingView::default()
        },
    ];
    for code in examples {
        for stripped in [true, false] {
            for delegated in [true, false] {
                let prompt = render_system(&SystemContext {
                    responses_as_code: true,
                    code,
                    fences_are_stripped: stripped,
                    delegated,
                    ..full_system()
                });
                assert!(
                    !prompt.contains("```"),
                    "the code prompt must show no fence (example {code:?}, stripped {stripped}, \
                     delegated {delegated}):\n{prompt}"
                );
            }
        }
    }
}

/// **The prompt says, in the run's own words, that `finish` is the only ending.**
///
/// Nothing else terminates a responses-as-code session: prose does not, an empty reply does not, and
/// the loop has no implicit ending left to fall back on. So the section has to carry the whole
/// contract — the signature, the once-only rule, and the instruction to call it from a program that
/// has just *checked* the work rather than from a memory of an earlier turn.
#[test]
fn the_code_prompt_teaches_that_only_finish_ends_the_run() {
    let prompt = render_system(&SystemContext {
        responses_as_code: true,
        ..full_system()
    });
    let flat = flat(&prompt);
    for clause in [
        "`finish(summary: string): void` — End this run.",
        "**`finish` is the only thing that ends this run.** Prose does not end it.",
        "Saying \"done\", \"task complete\", or \"the file has been created\" does not end it",
        "Call it from inside a program that has just **checked** the work with the tools",
        "`finish` does **not** stop your program.",
        "So put it last.",
        "If that program then throws, the ending is cancelled and you get another turn",
        "Calling `finish` twice is not an error; the last summary is the one that counts.",
    ] {
        assert!(
            flat.contains(clause),
            "the ending section must state `{clause}`:\n{prompt}"
        );
    }
    // The reply rules that stop a model narrating a completion it has not seen.
    for clause in [
        "**Never write gg's side of the conversation.**",
        "do not report success",
        "a reply that is only comments is not a program.",
    ] {
        assert!(
            flat.contains(clause),
            "the reply rules must state `{clause}`:\n{prompt}"
        );
    }

    // The section is gated on the catalogue actually offering the function: a context with no
    // `session` renders no ending section at all, rather than a bullet with an empty signature.
    let without = render_system(&SystemContext {
        responses_as_code: true,
        session: None,
        ..full_system()
    });
    for absent in [
        "## Ending the run",
        "finish(summary: string): void",
        "the only thing that ends this run",
        "`finish` does **not** stop your program.",
    ] {
        assert!(
            !without.contains(absent),
            "a context with no `session` must not render `{absent}`:\n{without}"
        );
    }
}

/// **The reply rules redirect a second program into the first, instead of forbidding it again.**
///
/// The modal turn-1 mistake of the round-2 model set was a reply carrying two whole programs: an
/// exploratory draft ending in a top-level `return`, and the real program pasted below it — measured
/// twice for `openai/gpt-5.6-terra`, once for `openai/gpt-5.6-sol`, once for
/// `google/gemini-3.6-flash`. The prompt already prohibited it in as many words *and one session
/// repeated the prohibition in its task prompt*, so a third prohibition is not the fix. What the
/// models are doing is looking before they leap, in the one place they can — and the surface they
/// have (loops, conditionals, values) makes the look and the leap fit in **one** program, so the rule
/// points them there and names the cheap alternative for the case where it genuinely does not fit.
///
/// The prohibition survives, because the consequence is worth stating exactly once: two programs
/// declare the same top-level names twice, which one program cannot do, so **neither** of them runs.
/// What must not survive is the old instruction to *delete* half of what the model just wrote, which
/// is the one thing a model that wants to look first will not do.
#[test]
fn the_reply_rules_redirect_a_second_program_into_the_first() {
    let prompt = render_system(&SystemContext {
        responses_as_code: true,
        ..full_system()
    });
    let flat = flat(&prompt);
    for clause in [
        // The redirect: where the impulse to look first actually belongs.
        "**Look before you leap — inside the same program.** Call the tool, branch on what it \
         returned, and carry on: with loops, conditionals and variables one program can explore, \
         decide, act and check its own work in a single pass.",
        // ...and what to do when one program truly is not enough, which costs one turn rather than
        // the whole reply. It names the only channel there is, because a `return` would tell the
        // model nothing.
        "If you genuinely cannot choose without seeing gg's answer, `console.log` what you learned \
         and stop there; the turn ends when your program does, and you choose next turn.",
        // The redirect for the reply that is already drafted twice — and the consequence, stated
        // once: it is not that gg disapproves, it is that nothing runs.
        "**One program per reply — if you have drafted two, merge them.**",
        "A reply that offers gg two programs runs **neither**: the second declares the top-level \
         names the first already declared, which one program cannot do, so nothing in your reply \
         runs — not the exploration, not the work, not the `finish`.",
        // Merging is named as cheap, because a model that believes it is losing something will not
        // do it.
        "Merging costs you nothing you cannot express: the second draft's statements go after the \
         first's, using the values it computed, with an `if` where you would have waited for a turn.",
    ] {
        assert!(
            flat.contains(clause),
            "the reply rules must state `{clause}`:\n{prompt}"
        );
    }
    // The order that did not work, and that tells a model to throw away work it has just done, is
    // gone from the prompt entirely.
    for absent in [
        "choose one and delete the other",
        "Never paste a second program below the first.",
        "Send exactly one program.",
    ] {
        assert!(
            !flat.contains(absent),
            "the prompt must no longer order the model to delete half its reply (`{absent}`):\n\
             {prompt}"
        );
    }
}

/// **The worked example is the whole arc, in one program.**
///
/// Round 2's best single turn — `openai/gpt-5.6-terra`, one reply, every assertion green — explored
/// the workspace, computed from what it found, wrote the deliverable, checked it with a second tool
/// call, and called `finish`, all in one program. `openai/gpt-5.6-sol` and `anthropic/claude-opus-5`
/// wrote the same shape unprompted. Nothing in the prompt showed it: every worked example stopped at
/// a `return`, which is the shape of a turn that has to be followed by another one.
///
/// So each of the examples now ends the same way — do the work, check it with the tools, and
/// `finish` on the branch where the check came back clean — and the check is a property of every one
/// of them, because the example is the piece of the prompt a model copies verbatim. The richest one
/// shows the whole arc including the write and the re-read, which is the turn the capability exists
/// to make possible. It is also what makes the ending section's rule demonstrable rather than merely
/// stated: that section points at this example rather than carrying a second, tool-free one of its
/// own.
///
/// No example `return`s a value, and that is load-bearing rather than cosmetic. A returned value
/// goes nowhere, so an example that ended in one would teach the single mistake the feedback then
/// has to correct.
#[test]
fn the_worked_example_is_the_whole_arc_in_one_program() {
    let arcs = [
        (
            CodeTeachingView {
                example_build: true,
                read_file: true,
                ..CodeTeachingView::default()
            },
            "    const specs = listDir(\"specs\")",
            "const left = specs.filter((e) => !readTextFile(`specs/${e.name}`).includes(\"## Rules\"));",
            "if (left.length === 0) finish(`Added a rules section to ${missing.length} of \
             ${specs.length} spec files; every one documents its rules now.`);",
        ),
        (
            CodeTeachingView {
                example_compose: true,
                read_file: true,
                ..CodeTeachingView::default()
            },
            "    const specs = listDir(\"specs\")",
            "console.log(`checked ${specs.length} spec files; without a rules section: \
             ${missing.map((e) => e.name).join(\", \") || \"none\"}`);",
            "if (missing.length === 0) finish(`Checked all ${specs.length} spec files; every \
             one documents its rules.`);",
        ),
        (
            CodeTeachingView {
                example_shell: true,
                shell: true,
                ..CodeTeachingView::default()
            },
            "    const build = shell(\"npm run build\");",
            "console.log(tests.output.split(\"\\n\").slice(-20).join(\"\\n\"));",
            "if (tests.exitCode === 0) finish(\"Fixed the collision check, rebuilt, and ran \
             the suite: the build and every test pass.\");",
        ),
        (
            CodeTeachingView {
                example_write: true,
                ..CodeTeachingView::default()
            },
            "    const levels = [1, 2, 3].map((n) => ({ id: n, enemies: n * 4 }));",
            "console.log(`wrote ${levels.length} level files, ${bytes} bytes in all`);",
            "if (bytes > 0) finish(`Wrote ${levels.length} level files under levels/ \
             (${bytes} bytes).`);",
        ),
        (
            CodeTeachingView {
                example_pure: true,
                ..CodeTeachingView::default()
            },
            "    const waves = [1, 2, 3, 4].map((n) => ({ wave: n, enemies: n * 5 }));",
            "console.log(`planned ${waves.length} waves, ${total} enemies in all: \
             ${JSON.stringify(waves)}`);",
            "if (total <= 100) finish(`Planned ${waves.length} waves, ramping to \
             ${waves[waves.length - 1].enemies} enemies.`);",
        ),
    ];
    for (code, opens, checks, finishes) in arcs {
        let prompt = render_system(&SystemContext {
            responses_as_code: true,
            code,
            ..full_system()
        });
        let flat = flat(&prompt);
        assert!(
            prompt.contains(opens),
            "the {code:?} example must begin at its first `const`:\n{prompt}"
        );
        // It says what it found — with the only channel that carries anything — and only then
        // finishes. Both halves matter: an example that only finished would teach a model to
        // conclude on turn one.
        assert!(
            flat.contains(checks),
            "the {code:?} example must report what it found before it concludes:\n{prompt}"
        );
        assert!(
            flat.contains(finishes),
            "the {code:?} example must end the run on the checked-good branch:\n{prompt}"
        );
        // No example hands a value back through a channel that discards it.
        assert!(
            !prompt.contains("    return "),
            "no worked example may `return` a value — it would go nowhere:\n{prompt}"
        );
        // The framing says what shape is being shown, so a model reading the example knows the
        // `finish` at the end is the point rather than an accident of this task's size.
        assert!(
            flat.contains(
                "A whole reply looks like this — one program that looks, decides, acts, and checks \
                 what it did, ending the run only on the branch where the work is really done."
            ),
            "the example must be introduced as the whole arc:\n{prompt}"
        );
        assert!(!prompt.contains("\n\n\n"), "prompt has a blank-line run");
    }

    // A delegated worker is shown the same arc, ending the thing it can actually end.
    let child = render_system(&SystemContext {
        responses_as_code: true,
        delegated: true,
        ..full_system()
    });
    assert!(
        flat(&child)
            .contains("ending the session only on the branch where the work is really done."),
        "{child}"
    );
}

/// **The ending section's two rules about re-checking do not contradict each other.**
///
/// They used to. One line said to call `finish` from a program that has just *checked* the work
/// rather than from recollection; a later line said not to re-check work already verified. When the
/// check happened on the **previous** turn those are opposite instructions, and `anthropic/claude-opus-5`
/// split its behaviour across the seam in round 2: it computed the exact predicate `finish` needed,
/// returned it instead of branching on it, and then spent a third turn — a third of the run's cost —
/// re-reading the file it had already read back, to call `finish` from a program that had checked
/// something.
///
/// The fix is to scope the second rule to the **same program** as the first: a program that has
/// already checked the work finishes there, rather than deferring to a turn that checks nothing (or
/// re-checking what this one just verified). The two rules then say one thing.
#[test]
fn the_ending_section_scopes_the_no_re_check_rule_to_one_program() {
    let prompt = render_system(&SystemContext {
        responses_as_code: true,
        ..full_system()
    });
    let flat = flat(&prompt);
    assert!(
        flat.contains(
            "Call it from inside a program that has just **checked** the work with the tools — \
             read the file back, run the test, look at the exit code — rather than from your \
             recollection of an earlier turn. The worked example above ends exactly that way: it \
             does the work, checks what it did, and calls `finish` on the branch where the check \
             came back clean."
        ),
        "the section must point at the worked example as the shape it is asking for:\n{prompt}"
    );
    assert!(
        flat.contains(
            "That check belongs in the **same program** as the `finish`. If the program you are \
             writing has already verified the work, end the run right there — there is nothing to \
             gain from spending another turn re-reading what this program just read, and nothing \
             to gain from putting the `finish` off until a turn that has checked nothing."
        ),
        "the no-re-check rule must be scoped to the program that did the checking:\n{prompt}"
    );
    // The unscoped sentence — which, read on a turn whose check happened earlier, said the opposite
    // of the rule above it — is gone.
    assert!(
        !flat.contains("Re-checking work you have already verified"),
        "the unscoped re-check sentence must not survive:\n{prompt}"
    );
    // ...and the ending section no longer carries a worked example of its own, which was a program
    // that checked and did no work — the two-turn shape this section exists to discourage.
    assert!(
        !prompt.contains("const problems = []"),
        "the ending section must not model a program that only checks:\n{prompt}"
    );
}

/// **The ending section says what `finish` ends *for the model reading it*.**
///
/// A delegated agent renders this same prompt. Told that `finish` "ends the run", a subagent has a
/// strong reason not to call it — and a worker that never calls it never returns a summary, which is
/// exactly what leaves a Code Review unaccepted, a speculation judge without a winner, and a
/// subagent's worktree discarded unmerged.
#[test]
fn the_code_prompt_is_role_aware_about_what_finish_ends() {
    let root = render_system(&SystemContext {
        responses_as_code: true,
        delegated: false,
        ..full_system()
    });
    let child = render_system(&SystemContext {
        responses_as_code: true,
        delegated: true,
        ..full_system()
    });

    assert!(root.contains("## Ending the run"), "{root}");
    assert!(!root.contains("## Ending your session"), "{root}");
    assert!(child.contains("## Ending your session"), "{child}");
    assert!(!child.contains("## Ending the run"), "{child}");

    let flat_root = flat(&root);
    let flat_child = flat(&child);
    assert!(flat_root.contains("**`finish` is the only thing that ends this run.**"));
    assert!(flat_root.contains("`finish` ends the **run**, and its summary is your last word"));
    assert!(flat_child.contains("**`finish` is the only thing that ends your session.**"));
    assert!(
        flat_child.contains("`finish` ends the **session**, and its summary is your last word")
    );
    // The subagent is told what its summary is *for*: it is the whole of what its spawner sees.
    assert!(
        flat_child.contains(
            "The summary you pass to `finish` is what you return to the agent that asked you for \
             this work: it is your whole answer, and it is the only thing that agent sees, so put \
             the verdict or the result in it."
        ),
        "{child}"
    );
    assert!(
        !flat_root.contains("the agent that asked you for this work"),
        "{root}"
    );
}

/// **The fence rule tells the truth about this run's healing configuration.**
///
/// Both arms say "do not put your program in a code block"; what differs is the reason, and the
/// reason has to be true. With [`strip-fences`](crate::healing::HealingStrategy::StripFences) armed,
/// "a fence is a syntax error" is false — gg removes it and discloses that it did — and a model that
/// tests the claim learns that gg's rules are negotiable, contaminating the very
/// instruction-following signal this capability exists to collect.
#[test]
fn the_fence_rule_matches_the_healing_configuration() {
    let stripped = flat(&render_system(&SystemContext {
        responses_as_code: true,
        fences_are_stripped: true,
        ..full_system()
    }));
    let literal = flat(&render_system(&SystemContext {
        responses_as_code: true,
        fences_are_stripped: false,
        ..full_system()
    }));

    for rendered in [&stripped, &literal] {
        assert!(rendered.contains(
            "**Do not put your program in a code block.** No backtick fences, no `ts` tag."
        ));
    }
    assert!(stripped.contains(
        "Send the code alone. (gg will strip a fence and tell you it did — but that is a repair, \
         not the contract.)"
    ));
    assert!(!stripped.contains("a syntax error on line 1"), "{stripped}");
    assert!(literal.contains(
        "gg compiles your reply exactly as you send it, and a fence is not code — it is a syntax \
         error on line 1."
    ));
    assert!(!literal.contains("that is a repair"), "{literal}");
}

/// **The tool-calling prompt is byte-for-byte what it was before the code mode was rewritten.**
///
/// The two modes share one template and one context, and the code arm's rewrite touched the base
/// paragraph they both render — so the ending sentence is gated *inline* rather than as a standalone
/// block, which is the only way Handlebars leaves the surrounding whitespace alone. This pins the
/// exact result, including the line break that falls inside the gated sentence.
///
/// It also pins the inertness of the three fields the code arm added: a tool-calling context carries
/// `session`, `delegated` and `fences_are_stripped`, and the `{{else}}` arm references none of them.
#[test]
fn the_tool_calling_prompt_is_unchanged_by_the_code_mode_rewrite() {
    let prompt = render_system(&full_system());
    assert!(
        prompt.starts_with(
            "You are gg, The Test Cabinet's autonomous coding agent. You are building a game in \
             the\ncurrent workspace directory. Work incrementally: inspect the workspace, then \
             create and edit\nfiles to implement the game the user describes. When the game is \
             complete and the task is\ndone, stop calling tools and give a short final summary of \
             what you built.\n\n## Your tools\n"
        ),
        "the tool-calling base paragraph must render exactly as it always has:\n{prompt}"
    );
    // Not one word of the code arm leaks, including the three fields it added to the context.
    // (`finish` is matched as the function rather than as a substring: the tasks section says
    // "tasks must finish first", which is prose about the task DAG and not about ending anything.)
    for absent in [
        "## Your reply is a program",
        "## Ending the run",
        "`finish`",
        "finish(",
        "code block",
    ] {
        assert!(
            !prompt.contains(absent),
            "the tool-calling prompt must not mention `{absent}`:\n{prompt}"
        );
    }
}

/// The regression that would silently disable plan mode for the **non**-code execution mode: the
/// tool-calling arm lists every offered tool by name, including the turn-level transitions the
/// sandbox does not bind.
#[test]
fn tool_calling_mode_with_planning_still_names_enter_plan_mode() {
    let mut context = full_system();
    context.tools.push(unbound("enter_plan_mode"));
    let prompt = render_system(&context);
    assert!(flat(&prompt).contains("`write_file`, `enter_plan_mode`"));
    assert!(prompt.contains("## Planning"));
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
             it, end the run with `finish(\"...\")` from inside a program — nothing else ends it."
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
    assert!(flat(&threw).contains("call `finish(...)` again"), "{threw}");

    let stopped = render_code_sandbox_error(&CodeSandboxErrorContext {
        healing: Vec::new(),
        error: "the program exhausted its fuel ceiling of 200000000000".to_string(),
        finish_revoked: true,
        calls: 3,
        output_heavy: true,
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
         `finish(\"...\")`, called from inside a program, does.\n\nNothing ran, so nothing \
         changed. Fix the syntax and reply with a corrected program."
    );
}

/// A sandbox limit is framed as "too heavy", never as "wrong" — and only a *fuel* exhaustion earns
/// the advice about which direction of the membrane is expensive.
#[test]
fn the_sandbox_feedback_separates_a_limit_from_a_mistake() {
    let fuel = render_code_sandbox_error(&CodeSandboxErrorContext {
        healing: Vec::new(),
        error: "the program exhausted its fuel ceiling of 200000000000".to_string(),
        finish_revoked: false,
        calls: 12,
        output_heavy: true,
    });
    assert!(fuel.contains("This is a sandbox limit, not a tool failure"));
    assert!(fuel.contains("Writing is the expensive direction"));
    assert!(fuel.contains("The 12 tool call(s) it had already made stand."));

    let memory = render_code_sandbox_error(&CodeSandboxErrorContext {
        healing: Vec::new(),
        error: "the program exceeded its 4194304-byte memory cap".to_string(),
        finish_revoked: false,
        calls: 0,
        output_heavy: false,
    });
    assert!(!memory.contains("Writing is the expensive direction"));
    assert!(!memory.contains("already made stand"));
    assert!(memory.contains("Split the task across several smaller programs, one per turn."));
    assert_no_blank_run(&fuel);
    assert_no_blank_run(&memory);
}

/// **What healing repaired is disclosed, on every one of the four feedback paths.**
///
/// A repair the model is not told about teaches it nothing and corrupts the measurement: the point
/// of the capability is to observe how well models follow a code-only contract, and a model whose
/// fences are silently removed will keep sending them forever while the numbers say it complied.
/// The disclosure has to reach the model whatever became of the healed reply — it happened to the
/// *message*, not to the program — which is why all four templates carry the same partial, and why
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
        error: "the program exhausted its fuel ceiling".to_string(),
        finish_revoked: false,
        calls: 3,
        output_heavy: true,
    });
    let refused = render_code_not_a_program(&CodeNotAProgramContext {
        healing,
        reason: NotAProgramReason::CommentOnly.message(),
        delegated: false,
    });

    for rendered in [&ran, &transpile, &sandbox, &refused] {
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
                 `finish(…)`."
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
/// what settles the question: the result and the sandbox-limit turns ran a program (the limit turn's
/// landed calls stand, which is why it is not in the other group), while the transpile and
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
            error: "the program exhausted its fuel ceiling".to_string(),
            finish_revoked: false,
            calls: 3,
            output_heavy: true,
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
                 `finish` does, and you call it from inside a program:"
            ),
            "{rendered}"
        );
        assert!(
            rendered.ends_with("    finish(\"what you did, in a sentence or two\");"),
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
