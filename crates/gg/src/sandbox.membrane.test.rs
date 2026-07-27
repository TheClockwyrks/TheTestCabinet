//! **HR1: one typed function per gg tool, all the way to the model.**
//!
//! Every bound tool is driven by a one-line program written the way the system prompt tells a model
//! to write it, and the **exact JSON** that reached gg's tool dispatch is asserted. That is what
//! makes the typed surface a checked property rather than a claim: a WIT signature is worth nothing
//! if the arguments it carries arrive under the wrong key, in the wrong case, or not at all.
//!
//! The table is exhaustive by construction — a tool with no row fails the coverage assertion at the
//! end — so adding a tool to gg without a working typed call is a test failure here, not a
//! discovery in production.
//!
//! One process, one component compile, twenty-nine instantiations at ~30 µs each.

use super::*;

/// One tool, the program a model would write to call it, and the arguments gg must receive.
struct Crossing {
    /// The gg tool name the call must arrive as.
    tool: &'static str,
    /// The program, exactly as a model would write it.
    program: &'static str,
    /// The JSON the invoker must have seen.
    expected: fn() -> Value,
}

/// Every bound tool, called through its typed function.
fn crossings() -> Vec<Crossing> {
    vec![
        Crossing {
            tool: "shell",
            program: "system.shell(\"npm test\", { timeoutSecs: 30 });",
            expected: || json!({ "command": "npm test", "timeout_secs": 30.0 }),
        },
        Crossing {
            tool: "read_file",
            program: "fs.readFile(\"src/a.ts\", { offset: 2, limit: 5 });",
            expected: || json!({ "path": "src/a.ts", "offset": 2, "limit": 5 }),
        },
        Crossing {
            tool: "write_file",
            program: "fs.writeFile(\"out.txt\", \"hello\");",
            expected: || json!({ "path": "out.txt", "contents": "hello" }),
        },
        Crossing {
            tool: "edit_file",
            program: "fs.editFile(\"src/a.ts\", \"alpha\", \"beta\");",
            expected: || json!({ "path": "src/a.ts", "old_string": "alpha", "new_string": "beta" }),
        },
        Crossing {
            tool: "list_dir",
            program: "fs.listDir(\"src\");",
            expected: || json!({ "path": "src" }),
        },
        Crossing {
            tool: "read_skill",
            program: "skills.readSkill(\"testing\");",
            expected: || json!({ "name": "testing" }),
        },
        Crossing {
            tool: "write_memory",
            program: "memory.writeMemory({ name: \"layout\", description: \"d\", body: \"b\" });",
            expected: || json!({ "name": "layout", "description": "d", "body": "b" }),
        },
        Crossing {
            tool: "update_memory",
            program: "memory.updateMemory({ name: \"layout\", description: \"d2\", body: \"b2\" });",
            expected: || json!({ "name": "layout", "description": "d2", "body": "b2" }),
        },
        Crossing {
            tool: "delete_memory",
            program: "memory.deleteMemory(\"layout\");",
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "add_task",
            program: "tasks.addTask({ id: \"t1\", title: \"T\", description: \"D\", blockedBy: [\"t0\"] });",
            expected: || json!({ "id": "t1", "title": "T", "description": "D", "blockedBy": ["t0"] }),
        },
        Crossing {
            tool: "update_task",
            program: "tasks.updateTask(\"t1\", { title: \"T2\", description: null, status: \"in_progress\" });",
            expected: || {
                // `description: null` is the sentinel that CLEARS it, and `in_progress` is gg's own
                // spelling — the membrane's `in-progress` never reaches a model or a tool.
                json!({ "id": "t1", "title": "T2", "status": "in_progress", "description": "" })
            },
        },
        Crossing {
            tool: "set_blocked_by",
            program: "tasks.setBlockedBy(\"t1\", []);",
            expected: || json!({ "id": "t1", "blockedBy": [] }),
        },
        Crossing {
            tool: "complete_task",
            program: "tasks.completeTask(\"t1\");",
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "remove_task",
            program: "tasks.removeTask(\"t1\");",
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "create_epic",
            program: "project.createEpic({ id: \"e1\", title: \"E\", description: \"D\" });",
            expected: || json!({ "id": "e1", "title": "E", "description": "D" }),
        },
        Crossing {
            tool: "create_issue",
            program: concat!(
                "project.createIssue({ id: \"i1\", title: \"I\", inScope: \"s\", outOfScope: \"o\", ",
                "completionCriteria: \"c\" });",
            ),
            expected: || {
                json!({
                    "id": "i1",
                    "title": "I",
                    "description": null,
                    "inScope": "s",
                    "outOfScope": "o",
                    "completionCriteria": "c",
                    "blockedBy": [],
                    "epicId": null,
                })
            },
        },
        Crossing {
            tool: "update_issue",
            program: "project.updateIssue(\"i1\", { status: \"done\", epicId: null });",
            expected: || {
                // `epicId: null` ungroups the issue, which gg's schema spells as the empty string;
                // an omitted `description` leaves it alone, so its key is absent entirely.
                json!({
                    "id": "i1",
                    "title": null,
                    "inScope": null,
                    "outOfScope": null,
                    "completionCriteria": null,
                    "status": "done",
                    "epicId": "",
                })
            },
        },
        Crossing {
            tool: "set_issue_blocked_by",
            program: "project.setIssueBlockedBy(\"i1\", [\"i0\"]);",
            expected: || json!({ "id": "i1", "blockedBy": ["i0"] }),
        },
        Crossing {
            tool: "complete_issue",
            program: "project.completeIssue(\"i1\");",
            expected: || json!({ "id": "i1" }),
        },
        Crossing {
            tool: "remove_epic",
            program: "project.removeEpic(\"e1\");",
            expected: || json!({ "id": "e1" }),
        },
        Crossing {
            tool: "remove_issue",
            program: "project.removeIssue(\"i1\");",
            expected: || json!({ "id": "i1" }),
        },
        Crossing {
            tool: "evict_file_view",
            program: "context.evictFileView(\"src/a.ts\");",
            expected: || json!({ "path": "src/a.ts" }),
        },
        Crossing {
            tool: "archive_thread",
            program: "context.archiveThread(3);",
            expected: || json!({ "keep_recent_turns": 3 }),
        },
        Crossing {
            tool: "search_archive",
            program: "context.searchArchive(\"the parser\");",
            expected: || json!({ "query": "the parser" }),
        },
        Crossing {
            tool: "spawn_subagent",
            program: "agents.spawnSubagent({ agent: \"subagent\", prompt: \"write the lexer\", worktree: true });",
            expected: || {
                json!({
                    "agent": "subagent",
                    "prompt": "write the lexer",
                    "issueId": null,
                    "worktree": true,
                })
            },
        },
        Crossing {
            tool: "wait_for_subagents",
            program: "agents.waitForSubagents([\"agent-1\"]);",
            expected: || json!({ "ids": ["agent-1"] }),
        },
        Crossing {
            tool: "send_message",
            program: "agents.sendMessage(\"agent-1\", \"prefer the simpler parser\");",
            expected: || json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }),
        },
        Crossing {
            tool: "run_workflow",
            program: "agents.runWorkflow([{ prompt: \"look at {{item}}\", agent: \"subagent\", items: [\"a.ts\"] }]);",
            expected: || {
                json!({
                    "stages": [{
                        "name": null,
                        "prompt": "look at {{item}}",
                        "items": ["a.ts"],
                        "agent": "subagent",
                        "worktree": null,
                    }],
                })
            },
        },
        Crossing {
            tool: "speculate",
            program: "agents.speculate({ agent: \"attempt\", issueId: \"i1\", attempts: 3, approaches: [\"be bold\"] });",
            expected: || {
                json!({
                    "agent": "attempt",
                    "prompt": null,
                    "issueId": "i1",
                    "attempts": 3,
                    "approaches": ["be bold"],
                })
            },
        },
    ]
}

/// **HR1.** Every gg tool is reachable as a typed TypeScript function, and the arguments it carries
/// arrive at gg's dispatch under the tool's own schema key names.
#[test]
fn every_tool_crosses_the_membrane_with_its_typed_arguments() {
    let crossings = crossings();

    for crossing in &crossings {
        let (outcome, log) = run(crossing.program);
        assert!(
            matches!(&outcome.result, Ok(result) if result.error.is_none()),
            "`{}` did not run cleanly: {:?}",
            crossing.tool,
            outcome.result
        );
        assert_eq!(
            log.names(),
            [crossing.tool],
            "`{}` did not reach gg's dispatch under its own name",
            crossing.program
        );
        assert_eq!(
            log.args(crossing.tool),
            Some((crossing.expected)()),
            "`{}` carried the wrong arguments",
            crossing.program
        );
    }

    // Exhaustive by construction: a tool added to gg with no row here fails now, rather than
    // shipping as a typed function nobody ever called.
    let mut covered: Vec<&str> = crossings.iter().map(|crossing| crossing.tool).collect();
    covered.sort_unstable();
    let mut expected = crate::sandbox::signatures::sandbox_tool_names();
    expected.sort_unstable();
    assert_eq!(
        covered, expected,
        "every bound tool needs a crossing, and only bound tools may have one"
    );

    // Every enabled name is bound as a **function** — the capability model in one assertion. A name
    // that is merely defined, or defined as something other than a function, would fail a model in a
    // way no error message could explain.
    let catalogue = crate::sandbox::signatures::catalogue();
    // Each tool is bound as `object.js` now, not as a bare identifier — so the check references the
    // functions the way a program actually reaches them.
    let names: Vec<String> = catalogue
        .tools
        .iter()
        .map(|entry| format!("{}.{}", entry.object, entry.js))
        .chain(
            catalogue
                .helpers
                .iter()
                .map(|helper| format!("{}.{}", helper.object, helper.js)),
        )
        .collect();

    let program = format!(
        "console.log([{}].map((f) => typeof f).join(\",\"));",
        names.join(", ")
    );
    let (outcome, _) = run(&program);
    assert_eq!(
        logs(&outcome)
            .first()
            .map(String::as_str)
            .unwrap_or_default(),
        vec!["function"; names.len()].join(","),
        "not every enabled name is bound as a function"
    );

    // And the error type a program is told to catch is in scope too, or `catch (e) { e instanceof
    // ToolError }` — the shape the system prompt teaches — would be a ReferenceError.
    let (outcome, _) = run("console.log(typeof ToolError);");
    assert_eq!(logs(&outcome), ["function"]);
}
