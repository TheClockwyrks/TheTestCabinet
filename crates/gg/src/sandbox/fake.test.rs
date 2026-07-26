//! The in-memory tool double the sandbox's tests drive the membrane with.
//!
//! It exists so the membrane's thirty-two functions can be exercised without a workspace, a tokio
//! runtime, or the loop — and, in the end-to-end tests, so a program's real behaviour can be
//! asserted against the **exact JSON** each typed call produced. That assertion is what pins the
//! typed-surface guarantee: a WIT signature is only worth something if the arguments it carries
//! arrive at gg's tools under the key names those tools declare.
//!
//! The log is shared through an `Arc` because the invoker is *moved into the store* — a test cannot
//! hold a reference to it and read it back afterwards, which is exactly the ownership property that
//! removed the old host's lifetime-erased pointer.

use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde_json::Value;

use super::membrane::MembraneState;
use super::{SandboxLimits, ToolInvoker};
use crate::model::ImageContent;
use crate::tools::{
    ArchiveHitData, ArchiveSearchData, BoardUsageData, CompletionData, DirEntryData, DirEntryKind,
    FileImageData, FileTextData, MemoryUsageData, ReclaimData, ShellData, SpeculationData,
    SubagentHandleData, SubagentResultData, ToolData, ToolFailure, ToolOutcome, UsagePair,
    WorkflowData,
};

/// One call the double received, as the membrane made it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RecordedCall {
    /// The gg tool name.
    pub name: String,
    /// The JSON arguments, exactly as the membrane built them.
    pub args: Value,
}

/// A shared, cloneable view of what a [`FakeInvoker`] saw.
#[derive(Clone, Default)]
pub(crate) struct CallLog(Arc<Mutex<Vec<RecordedCall>>>);

impl CallLog {
    /// Every call, in order.
    pub(crate) fn calls(&self) -> Vec<RecordedCall> {
        self.0
            .lock()
            .expect("the call log is never poisoned")
            .clone()
    }

    /// The tool names, in call order — the cheapest assertion for "what did the program compose?".
    pub(crate) fn names(&self) -> Vec<String> {
        self.calls().into_iter().map(|call| call.name).collect()
    }

    /// The arguments of the first call to `tool`, or `None` if it was never called.
    pub(crate) fn args(&self, tool: &str) -> Option<Value> {
        self.calls()
            .into_iter()
            .find(|call| call.name == tool)
            .map(|call| call.args)
    }
}

/// How a [`FakeInvoker`] answers one call: named so the boxed form stays readable, and so a test
/// can pass a plain function (the canned table) or a closure that fails a specific tool.
type Responder = dyn FnMut(&str, &Value) -> ToolOutcome + Send;

/// The tool bridge under test: it records every call and answers with a canned outcome.
pub(crate) struct FakeInvoker {
    /// Where calls are recorded, shared with the test that built it.
    log: CallLog,
    /// How a call is answered. Boxed so a test can substitute a failing or asserting responder.
    responder: Box<Responder>,
}

impl FakeInvoker {
    /// An invoker answering every gg tool with a plausible, correctly typed outcome.
    pub(crate) fn new(log: &CallLog) -> Self {
        Self::with(log, canned_outcome)
    }

    /// An invoker answering with `responder`, for the tests that need a specific failure, a
    /// specific payload, or no payload at all.
    pub(crate) fn with(
        log: &CallLog,
        responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
    ) -> Self {
        Self {
            log: log.clone(),
            responder: Box::new(responder),
        }
    }
}

impl ToolInvoker for FakeInvoker {
    fn invoke(&mut self, name: &str, args: Value) -> ToolOutcome {
        self.log
            .0
            .lock()
            .expect("the call log is never poisoned")
            .push(RecordedCall {
                name: name.to_string(),
                args: args.clone(),
            });
        (self.responder)(name, &args)
    }
}

/// A plausible outcome for every gg tool the sandbox binds, carrying the same
/// [structured sidecar](ToolData) the real tool emits.
///
/// The payloads are deliberately *specific* (an `a.ts` file, a `sub` directory, an exit code of
/// zero unless the command says otherwise) so a test can assert on them without arranging anything,
/// and an unknown name answers exactly as [`ToolRegistry::dispatch`](crate::tools::ToolRegistry)
/// does — which is what lets the "a tool this run does not offer" paths be exercised honestly.
pub(crate) fn canned_outcome(name: &str, args: &Value) -> ToolOutcome {
    let string = |key: &str| {
        args.get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    match name {
        "shell" => shell_outcome(&string("command")),
        "read_file" => read_outcome(&string("path")),
        "write_file" => ToolOutcome::ok("wrote the file", "wrote")
            .with_data(ToolData::BytesWritten(string("contents").len() as u64)),
        "edit_file" => ToolOutcome::ok("edited the file", "edited"),
        "list_dir" => ToolOutcome::ok("a.ts\nb.test.ts\nsub/", "3 entries").with_data(
            ToolData::DirEntries(vec![
                DirEntryData {
                    name: "a.ts".to_string(),
                    kind: DirEntryKind::File,
                },
                DirEntryData {
                    name: "b.test.ts".to_string(),
                    kind: DirEntryKind::File,
                },
                DirEntryData {
                    name: "sub".to_string(),
                    kind: DirEntryKind::Directory,
                },
            ]),
        ),
        "read_skill" => ToolOutcome::ok("the skill body", "read a skill"),
        "write_memory" | "update_memory" | "delete_memory" => ToolOutcome::ok("noted", "memory")
            .with_data(ToolData::MemoryUsage(MemoryUsageData {
                count: 1,
                max_count: 8,
                total_chars: 12,
                max_total_chars: 4_000,
            })),
        "add_task" | "remove_task" => ToolOutcome::ok("noted", "task")
            .with_data(ToolData::TaskUsage(UsagePair { count: 2, max: 20 })),
        "update_task" | "set_blocked_by" | "complete_task" => ToolOutcome::ok("noted", "task"),
        "create_epic" | "create_issue" | "remove_epic" | "remove_issue" => {
            ToolOutcome::ok("noted", "board").with_data(ToolData::BoardUsage(BoardUsageData {
                epics: 1,
                max_epics: 4,
                issues: 3,
                max_issues: 20,
            }))
        }
        "update_issue" | "set_issue_blocked_by" => ToolOutcome::ok("noted", "board"),
        "complete_issue" => ToolOutcome::ok("accepted", "issue done").with_data(
            ToolData::Completion(CompletionData {
                code_reviewed: true,
                detail: "the reviewer approved it".to_string(),
            }),
        ),
        "evict_file_view" | "archive_thread" => ToolOutcome::ok("reclaimed", "reclaimed")
            .with_data(ToolData::Reclaim(ReclaimData {
                items: 2,
                reclaimed_tokens: 300,
                paths: vec!["src/a.ts".to_string()],
                detail: "dropped 2 items".to_string(),
            })),
        "search_archive" => ToolOutcome::ok("1 hit", "searched").with_data(
            ToolData::ArchiveSearch(ArchiveSearchData {
                archive_empty: false,
                hits: vec![ArchiveHitData {
                    seq: 3,
                    role: crate::model::Role::Assistant,
                    text: "the earlier answer".to_string(),
                }],
            }),
        ),
        "spawn_subagent" => ToolOutcome::ok("spawned", "spawned").with_data(
            ToolData::SubagentSpawned(SubagentHandleData {
                id: "agent-1".to_string(),
                slot: "primary".to_string(),
                model_id: "test/model".to_string(),
                worktree_branch: None,
            }),
        ),
        "wait_for_subagents" => {
            ToolOutcome::ok("collected", "collected").with_data(ToolData::SubagentResults(vec![
                SubagentResultData {
                    id: "agent-1".to_string(),
                    status: Some(crate::tools::AgentStatusData::Completed),
                    summary: "did the work".to_string(),
                },
            ]))
        }
        "send_message" => ToolOutcome::ok("delivered", "messaged"),
        "run_workflow" => {
            ToolOutcome::ok("ran", "workflow").with_data(ToolData::Workflow(WorkflowData {
                workflow_id: "wf-1".to_string(),
                stages: 2,
                results: vec!["first".to_string(), "second".to_string()],
            }))
        }
        "speculate" => ToolOutcome::ok("merged", "speculated").with_data(ToolData::Speculation(
            SpeculationData {
                winner_id: "agent-2".to_string(),
                attempts: 2,
                rationale: Some("it was tidier".to_string()),
                summary: "merged the winner".to_string(),
            },
        )),
        other => ToolOutcome::failed(
            ToolFailure::Unavailable,
            format!("unknown tool `{other}`; it is not offered by this run's capability set"),
        ),
    }
}

/// A `shell` outcome: the process ran, and exited non-zero exactly when the command says `fail`.
///
/// The non-zero case is `ok: false` with **no** failure classification and a full sidecar, which is
/// precisely what the real tool produces — and is what the membrane has to turn back into a value
/// rather than a throw.
fn shell_outcome(command: &str) -> ToolOutcome {
    let code = i32::from(command.contains("fail"));
    ToolOutcome {
        ok: code == 0,
        output: format!("exit code: {code}\nran `{command}`"),
        summary: Some(format!("exited {code}")),
        images: Vec::new(),
        data: Some(ToolData::Shell(ShellData {
            exit_code: Some(code),
            body: format!("ran `{command}`"),
            truncated: false,
        })),
        failure: None,
    }
}

/// A `read_file` outcome: a picture for a `.png` path, text for anything else.
fn read_outcome(path: &str) -> ToolOutcome {
    if path.ends_with(".png") {
        return ToolOutcome::ok("[PNG image]", "read an image")
            .with_images(vec![ImageContent::new("image/png", "aGk=", 1_234)])
            .with_data(ToolData::FileImage(FileImageData {
                media_type: "image/png".to_string(),
                label: "PNG".to_string(),
                bytes: 1_234,
                shown: true,
                not_shown_reason: None,
            }));
    }
    let contents = format!("contents of {path}\nline two\n");
    ToolOutcome::ok(contents.clone(), "read 2 lines").with_data(ToolData::FileText(FileTextData {
        contents,
        first_line: 1,
        last_line: 2,
        total_lines: 2,
        byte_truncated: false,
        limit_reduced: false,
    }))
}

/// A membrane state offering every tool the sandbox binds, with no deadline, answering with the
/// canned outcomes above.
///
/// The membrane's whole surface is tested this way — no store, no component, no wasm — which is
/// what makes covering thirty-two functions affordable.
pub(crate) fn membrane(log: &CallLog) -> MembraneState {
    MembraneState::new(
        Box::new(FakeInvoker::new(log)),
        &all_tools(),
        SandboxLimits::default(),
        None,
    )
}

/// A membrane state offering `enabled`'s tools, expiring at `deadline`, answering with `responder`.
pub(crate) fn membrane_with(
    log: &CallLog,
    enabled: &[String],
    deadline: Option<Instant>,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> MembraneState {
    MembraneState::new(
        Box::new(FakeInvoker::with(log, responder)),
        enabled,
        SandboxLimits::default(),
        deadline,
    )
}

/// The tool names a fully-capable run binds into a program's scope.
pub(crate) fn all_tools() -> Vec<String> {
    super::signatures::sandbox_tool_names()
        .into_iter()
        .map(str::to_string)
        .collect()
}
