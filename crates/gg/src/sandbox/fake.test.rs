//! The in-memory operation double the sandbox's tests drive the membrane with.
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

use std::collections::BTreeSet;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde_json::{Value, json};

use test_cabinet_core::gg::{
    CAPABILITY_DOCVIEW_CLOSE, CAPABILITY_PROGRAM_LIBRARY, GgCallFailure, GgProgramLanguage,
};

use super::invoker::{
    ApiIdentity, DocSearchQuery, DocSearchResult, SandboxViewOpened, ViewOpenOutcome, ViewRefusal,
};
use super::language::ProgramLanguage;
use super::membrane::{MembraneState, RunEnding};
use super::operations::{OperationId, capability_operations, gating_capabilities};
use super::{OperationApi, ProgramScope, SandboxLimits};
use crate::board::IssueStatus;
use crate::context::{FileRegion, OpenViewInfo, SEARCH_RESULTS_VIEW, ViewKind};
use crate::discovery::CallDiscovery;
use crate::docs::DocSearch;
use crate::ending::EndingRole;
use crate::memories::MemoryCode;
use crate::model::ImageContent;
use crate::programs::{ProgramLibrary, ProgramRefusal, ProgramSummary};
use crate::tasks::TaskStatus;
use crate::tools::{
    ApiData, ArchiveHitData, ArchiveSearchData, BoardNodeData, BoardUsageData, DirEntryData,
    DirEntryKind, FileImageData, FileTextData, MemoryHitData, MemoryUsageData, ReclaimData,
    ShellData, SubagentHandleData, SubagentResultData, ToolFailure, ToolOutcome, UsagePair,
};

/// The [program language](ProgramLanguage) the sandbox's own tests drive: **TypeScript**.
///
/// Named for the language rather than for gg's default, because that is what these tests are about.
/// Every program they run is TypeScript source, every spelling they assert on (`readFile`,
/// `requestChanges`) is TypeScript's, and the artifact they compile is TypeScript's prebuilt
/// component — so a helper called "the default language" would make them read as though the same
/// cases would hold for whatever gg defaulted to next, which is exactly what they do not claim.
///
/// It is still reached **through the registry** rather than by naming one language's module, so a
/// test exercises the same lookup production does. A case that must cover *every* registered
/// language iterates [`all_languages`](super::all_languages) instead; one that must cover more than
/// one implementation of the seam uses the [fixture language](super::fixture) beside it.
pub(crate) fn typescript() -> &'static dyn ProgramLanguage {
    super::language(GgProgramLanguage::TypeScript)
}

/// Whether this test has a process to itself — the guarantee the process-global compile counter in
/// [`engine`](super::engine) depends on.
///
/// The repo mandates `cargo nextest`, which runs one process per test and advertises that by setting
/// `NEXTEST` in the test's environment. Under the forbidden `cargo test` every test shares one
/// process, and at startup its threads *race* to compile the `OnceLock` component in parallel — the
/// compile is deliberately race-idempotent, so the loser threads each still bump [`compiles`] before
/// one `set` wins. The counter therefore reflects however many threads lost the race, not a per-turn
/// truth, and no assertion on its absolute value can hold. The engine and error tests read the
/// counter only when this is true, so they stay exact under the mandated runner and skip the
/// unprovable check under `cargo test` instead of failing spuriously.
///
/// [`compiles`]: super::engine::compiles
pub(crate) fn process_isolated() -> bool {
    std::env::var_os("NEXTEST").is_some()
}

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

    /// Record one call, in order — the recording half the typed [`FakeOperationApi`] shares with the
    /// [`FakeInvoker`].
    #[allow(dead_code)]
    pub(crate) fn push(&self, call: RecordedCall) {
        self.0
            .lock()
            .expect("the call log is never poisoned")
            .push(call);
    }

    /// The arguments of the first call to `tool`, or `None` if it was never called.
    pub(crate) fn args(&self, tool: &str) -> Option<Value> {
        self.calls()
            .into_iter()
            .find(|call| call.name == tool)
            .map(|call| call.args)
    }
}

/// How a [`FakeOperationApi`] answers one call: named so the boxed form stays readable, and so a test
/// can pass a plain function (the canned table) or a closure that fails a specific tool.
type Responder = dyn FnMut(&str, &Value) -> ToolOutcome + Send;

/// The typed operation double under test: the [`OperationApi`] the membrane calls after the stage-2
/// inversion.
///
/// Each method builds the *same* JSON the production [`LoopOperationApi`](crate::agent::LoopOperationApi)
/// records for that call, logs it, and answers with the canned outcome — so every `log.args("tool")`
/// assertion written against the old membrane keeps holding against the typed path.
pub(crate) struct FakeOperationApi {
    /// Where calls are recorded, shared with the test that built it.
    log: CallLog,
    /// How a call is answered. Boxed so a test can substitute a failing or asserting responder.
    responder: Box<Responder>,
    /// The views this double is holding open, in the order they were opened.
    ///
    /// The production api keeps these in the agent's real [`ContextModel`](crate::context), which
    /// the membrane's own tests have no reason to stand up. What they *do* need is that the four
    /// view calls behave like one another — that an open is visible to a `current`, that a close
    /// removes what it names and reports how many — so the double models exactly that and no more.
    /// The caps are not modelled at all: they live in `LoopOperationApi`, which is where the window is.
    views: Vec<OpenViewInfo>,
    /// The [program library](crate::programs) this double answers `programs.history` / `programs.get`
    /// from — a real one, because it is a small self-contained value with the retention already in
    /// it, and a second model of it here would be the thing that drifts.
    programs: ProgramLibrary,
    /// Every model-facing API call the membrane bracketed, in order, shared with the test that
    /// built this double.
    ///
    /// Kept apart from [`log`](Self::log) because they record different layers: `log` is what
    /// *ran* (a tool, with the exact JSON the membrane composed), this is what the *model wrote*
    /// (an operation, whether or not a tool backs it). A test that asserted the two together could
    /// not tell `views.open_file` from `files.read_file`, which is the whole distinction they exist
    /// to keep.
    api: ApiLog,
    /// Which operations this double reports the model as having **read the documentation of** on an
    /// earlier turn — the state the production api answers
    /// [`call_discovery`](OperationApi::call_discovery) from its window and its documentation
    /// runtime.
    ///
    /// `None`, the default, models **no documentation surface at all**: the double is not a
    /// [`DocsRuntime`](crate::docs::DocsRuntime) and has no pages to have opened, so it answers
    /// [`NotApplicable`](CallDiscovery::NotApplicable) to everything and leaves every test that is
    /// not about discovery reporting nothing. [`documenting`](FakeOperationApi::documenting) arms
    /// it: an operation in the set reads as `Documented`, one outside it as `Undocumented`.
    documented: Option<BTreeSet<String>>,
}

/// The API calls a [`FakeOperationApi`] was bracketed with, shared through an `Arc` for the reason
/// [`CallLog`] is: the api is moved into the store and cannot be borrowed back.
#[derive(Clone, Default)]
pub(crate) struct ApiLog(Arc<Mutex<Vec<RecordedApiCall>>>);

/// One bracketed API call, as [`ApiLog`] records it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RecordedApiCall {
    /// gg's [operation](crate::sandbox::operations::OperationId) id for the call, rendered —
    /// `files.read_file`. The whole identity; see
    /// [`ApiIdentity`](crate::sandbox::invoker::ApiIdentity).
    pub(crate) operation: String,
    /// `None` until the call closed; `Some(ok)` once it did. A call still open when the program
    /// ended — impossible today, since the bracket is synchronous — would be visible as `None`.
    pub(crate) ok: Option<bool>,
    /// The class the call threw with, on a call that threw — `None` on a success and on a call
    /// that never closed. Recorded because the class is the only thing that says *why* an API call
    /// the model made failed, and for the calls no tool backs it is the only record at all.
    pub(crate) failure: Option<GgCallFailure>,
}

#[allow(dead_code)]
impl ApiLog {
    /// Every call, in order.
    pub(crate) fn calls(&self) -> Vec<RecordedApiCall> {
        self.0
            .lock()
            .expect("the api log is never poisoned")
            .clone()
    }

    /// Every call under gg's own identity for it, in order — the assertion for "what operations did
    /// the model reach for?", which is the question that means the same thing in every arm.
    pub(crate) fn operations(&self) -> Vec<String> {
        self.calls()
            .into_iter()
            .map(|call| call.operation)
            .collect()
    }

    /// Open one call's record.
    fn begin(&self, call: ApiIdentity<'_>) {
        self.0
            .lock()
            .expect("the api log is never poisoned")
            .push(RecordedApiCall {
                operation: call.operation.to_string(),
                ok: None,
                failure: None,
            });
    }

    /// Close the most recent open record for `operation` — the innermost one, so a call nested
    /// inside another closes its own bracket rather than its parent's.
    fn end(&self, operation: &str, failure: Option<GgCallFailure>) {
        let mut calls = self.0.lock().expect("the api log is never poisoned");
        if let Some(call) = calls
            .iter_mut()
            .rev()
            .find(|call| call.ok.is_none() && call.operation == operation)
        {
            call.ok = Some(failure.is_none());
            call.failure = failure;
        }
    }
}

#[allow(dead_code)]
impl FakeOperationApi {
    /// An api answering every gg tool with a plausible, correctly typed outcome.
    pub(crate) fn new(log: &CallLog) -> Self {
        Self::with(log, canned_outcome)
    }

    /// An api answering with `responder`, for the tests that need a specific failure, a specific
    /// payload, or no payload at all.
    pub(crate) fn with(
        log: &CallLog,
        responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
    ) -> Self {
        Self {
            log: log.clone(),
            responder: Box::new(responder),
            views: Vec::new(),
            programs: ProgramLibrary::enabled(None),
            api: ApiLog::default(),
            documented: None,
        }
    }

    /// The API-call log this double writes, for a test that wants to assert what the model wrote
    /// rather than what ran.
    pub(crate) fn api_log(&self) -> ApiLog {
        self.api.clone()
    }

    /// Arm the [discovery](crate::discovery) check: this double now models an agent that opened a
    /// documentation view of exactly `operations` on an earlier turn, and of nothing else.
    ///
    /// Takes gg's own rendered [operation ids](crate::sandbox::OperationId) rather than docview
    /// keys, because the double has no catalogue to resolve one into the other. The production api
    /// resolves the two into each other once, as the turn opens, and answers the same question off
    /// the result.
    pub(crate) fn documenting(mut self, operations: &[OperationId]) -> Self {
        self.documented = Some(
            operations
                .iter()
                .map(|operation| operation.to_string())
                .collect(),
        );
        self
    }

    /// Seed the library with a program said to have run on `turn`, so a test can drive
    /// `programs.get` against something.
    pub(crate) fn with_program(mut self, turn: u64, source: &str) -> Self {
        self.programs.record(turn, source, true, None);
        self
    }

    /// Record `name`/`args` exactly as the membrane composed them, then answer.
    fn call(&mut self, name: &str, args: Value) -> ToolOutcome {
        self.log.push(RecordedCall {
            name: name.to_string(),
            args: args.clone(),
        });
        (self.responder)(name, &args)
    }

    /// Open a view of `kind` under `selector`, replacing any that already carried it — the
    /// supersede rule the real [`ContextModel`](crate::context::ContextModel) implements, modelled
    /// here because "did that call open a view or replace one?" is exactly what the membrane
    /// reports back.
    fn open_view(
        &mut self,
        kind: ViewKind,
        selector: String,
        tokens: u64,
        region: Option<FileRegion>,
    ) -> SandboxViewOpened {
        let existing = self
            .views
            .iter()
            .position(|view| view.kind == kind && view.selector == selector);
        let view = OpenViewInfo {
            kind,
            selector: selector.clone(),
            tokens,
            region,
        };
        match existing {
            Some(index) => self.views[index] = view,
            None => self.views.push(view),
        }
        SandboxViewOpened {
            kind,
            selector,
            tokens,
            superseded: existing.is_some(),
        }
    }
}

#[allow(dead_code)]
impl OperationApi for FakeOperationApi {
    fn begin_api_call(&mut self, call: ApiIdentity<'_>) {
        self.api.begin(call);
    }

    fn end_api_call(&mut self, call: ApiIdentity<'_>, failure: Option<GgCallFailure>) {
        self.api.end(call.operation, failure);
    }

    fn call_discovery(&mut self, call: ApiIdentity<'_>) -> CallDiscovery {
        match &self.documented {
            None => CallDiscovery::NotApplicable,
            Some(documented) if documented.contains(call.operation) => CallDiscovery::Documented,
            Some(_) => CallDiscovery::Undocumented,
        }
    }

    fn shell(&mut self, command: String, timeout: std::time::Duration) -> ToolOutcome {
        self.call(
            "shell",
            json!({ "command": command, "timeout_secs": timeout.as_secs_f64() }),
        )
    }
    fn read_file(
        &mut self,
        path: String,
        offset: Option<usize>,
        limit: Option<usize>,
    ) -> ToolOutcome {
        self.call(
            "read_file",
            json!({ "path": path, "offset": offset, "limit": limit }),
        )
    }
    fn write_file(&mut self, path: String, contents: String) -> ToolOutcome {
        self.call("write_file", json!({ "path": path, "contents": contents }))
    }
    fn edit_file(&mut self, path: String, old_string: String, new_string: String) -> ToolOutcome {
        self.call(
            "edit_file",
            json!({ "path": path, "old_string": old_string, "new_string": new_string }),
        )
    }
    fn list_dir(&mut self, path: Option<String>) -> ToolOutcome {
        self.call("list_dir", json!({ "path": path }))
    }
    fn read_skill(&mut self, name: String) -> ToolOutcome {
        self.call("read_skill", json!({ "name": name }))
    }
    fn write_memory(
        &mut self,
        name: String,
        description: String,
        body: String,
        code: MemoryCode,
    ) -> ToolOutcome {
        self.call(
            "write_memory",
            json!({
                "name": name,
                "description": description,
                "body": body,
                "code": code.code,
                "onUse": code.on_use,
            }),
        )
    }
    fn update_memory(
        &mut self,
        name: String,
        description: String,
        body: String,
        code: MemoryCode,
    ) -> ToolOutcome {
        self.call(
            "update_memory",
            json!({
                "name": name,
                "description": description,
                "body": body,
                "code": code.code,
                "onUse": code.on_use,
            }),
        )
    }
    fn create_memory(
        &mut self,
        name: String,
        description: String,
        contents: String,
        code: MemoryCode,
    ) -> ToolOutcome {
        self.call(
            "create_memory",
            json!({
                "name": name,
                "description": description,
                "contents": contents,
                "code": code.code,
                "onUse": code.on_use,
            }),
        )
    }
    fn read_memory(&mut self, name: String) -> ToolOutcome {
        self.call("read_memory", json!({ "name": name }))
    }
    fn edit_memory(&mut self, name: String, search: String, replace: String) -> ToolOutcome {
        self.call(
            "edit_memory",
            json!({ "name": name, "old_string": search, "new_string": replace }),
        )
    }
    fn search_memories(&mut self, keywords: Vec<String>) -> ToolOutcome {
        self.call("search_memories", json!({ "keywords": keywords }))
    }
    fn delete_memory(&mut self, name: String) -> ToolOutcome {
        self.call("delete_memory", json!({ "name": name }))
    }
    fn add_task(
        &mut self,
        id: String,
        title: String,
        description: Option<String>,
        blocked_by: Vec<String>,
    ) -> ToolOutcome {
        self.call(
            "add_task",
            json!({ "id": id, "title": title, "description": description, "blockedBy": blocked_by }),
        )
    }
    fn update_task(
        &mut self,
        id: String,
        title: Option<String>,
        description: Option<String>,
        status: Option<TaskStatus>,
    ) -> ToolOutcome {
        // The `description` sentinel matches gg's schema: `keep` omits the key, `clear`/`set` include
        // it — the same shape the pre-inversion membrane's `insert_text_edit` produced.
        let mut args = json!({ "id": id, "title": title, "status": status.map(task_status_word) });
        if let Some(description) = description {
            args["description"] = json!(description);
        }
        self.call("update_task", args)
    }
    fn set_blocked_by(&mut self, id: String, blocked_by: Vec<String>) -> ToolOutcome {
        self.call(
            "set_blocked_by",
            json!({ "id": id, "blockedBy": blocked_by }),
        )
    }
    fn complete_task(&mut self, id: String) -> ToolOutcome {
        self.call("complete_task", json!({ "id": id }))
    }
    fn remove_task(&mut self, id: String) -> ToolOutcome {
        self.call("remove_task", json!({ "id": id }))
    }
    fn create_epic(&mut self, prefix: String, title: String, description: String) -> ToolOutcome {
        self.call(
            "create_epic",
            json!({ "prefix": prefix, "title": title, "description": description }),
        )
    }
    #[allow(clippy::too_many_arguments)]
    fn create_issue(
        &mut self,
        title: String,
        description: Option<String>,
        in_scope: String,
        out_of_scope: String,
        completion_criteria: String,
        blocked_by: Vec<String>,
        epic_id: Option<String>,
        agent: String,
        reviewers: Vec<String>,
    ) -> ToolOutcome {
        self.call(
            "create_issue",
            json!({ "title": title, "description": description, "inScope": in_scope, "outOfScope": out_of_scope, "completionCriteria": completion_criteria, "blockedBy": blocked_by, "epicId": epic_id, "agent": agent, "reviewers": reviewers }),
        )
    }
    #[allow(clippy::too_many_arguments)]
    fn update_issue(
        &mut self,
        id: String,
        title: Option<String>,
        description: Option<String>,
        in_scope: Option<String>,
        out_of_scope: Option<String>,
        completion_criteria: Option<String>,
        status: Option<IssueStatus>,
        epic_id: Option<String>,
    ) -> ToolOutcome {
        // `description` (text-edit) and `epicId` (epic-assignment) use gg's omit-to-keep sentinel:
        // a `None` here means "leave it alone", spelled as an absent key — matching the membrane's
        // former `insert_text_edit`/`insert_epic_assignment`.
        let mut args = json!({ "id": id, "title": title, "inScope": in_scope, "outOfScope": out_of_scope, "completionCriteria": completion_criteria, "status": status.map(issue_status_word) });
        if let Some(description) = description {
            args["description"] = json!(description);
        }
        if let Some(epic_id) = epic_id {
            args["epicId"] = json!(epic_id);
        }
        self.call("update_issue", args)
    }
    fn set_issue_blocked_by(&mut self, id: String, blocked_by: Vec<String>) -> ToolOutcome {
        self.call(
            "set_issue_blocked_by",
            json!({ "id": id, "blockedBy": blocked_by }),
        )
    }
    fn remove_epic(&mut self, id: String) -> ToolOutcome {
        self.call("remove_epic", json!({ "id": id }))
    }
    fn remove_issue(&mut self, id: String) -> ToolOutcome {
        self.call("remove_issue", json!({ "id": id }))
    }
    fn wait_for_issue(&mut self, id: String) -> ToolOutcome {
        self.call("wait_for_issue", json!({ "issueId": id }))
    }
    fn evict_file_view(&mut self, path: Option<String>) -> ToolOutcome {
        self.call("evict_file_view", json!({ "path": path }))
    }
    fn archive_thread(&mut self, ranges: Vec<crate::context::TurnRange>) -> ToolOutcome {
        let pairs: Vec<serde_json::Value> = ranges
            .iter()
            .map(|range| json!([range.from, range.to]))
            .collect();
        self.call("archive_thread", json!({ "ranges": pairs }))
    }
    fn search_archive(&mut self, query: String) -> ToolOutcome {
        self.call("search_archive", json!({ "query": query }))
    }
    fn compact(&mut self, summary: String, files: Vec<String>) -> ToolOutcome {
        self.call("compact", json!({ "summary": summary, "files": files }))
    }
    fn transition_state(&mut self, state: String, note: Option<String>) -> ToolOutcome {
        self.call("transition_state", json!({ "state": state, "note": note }))
    }
    fn exec(&mut self, agent: String, prompt: Option<String>) -> ToolOutcome {
        self.call("exec", json!({ "agent": agent, "prompt": prompt }))
    }
    fn fork(&mut self, prompt: String) -> ToolOutcome {
        self.call("fork", json!({ "prompt": prompt }))
    }
    fn spawn_subagent(
        &mut self,
        agent: String,
        prompt: Option<String>,
        issue_id: Option<String>,
    ) -> ToolOutcome {
        self.call(
            "spawn_subagent",
            json!({ "agent": agent, "prompt": prompt, "issueId": issue_id }),
        )
    }
    fn wait_for_subagents(&mut self, ids: Option<Vec<String>>) -> ToolOutcome {
        self.call("wait_for_subagents", json!({ "ids": ids }))
    }
    fn send_message(&mut self, agent_id: String, message: String) -> ToolOutcome {
        self.call(
            "send_message",
            json!({ "agentId": agent_id, "message": message }),
        )
    }

    /// Opens a docs view for every name, so a program that asks for documentation gets a view rather
    /// than a `not-found`. Recorded as a view, not as a call: a documentation lookup is not a tool.
    ///
    /// One view per call, never the several the production api can place: the double does not model
    /// a catalogue, so it has no types to open beside a function and nothing to be right about if it
    /// invented some. What it does model is the *shape* — a list, so the membrane's recording of
    /// several views from one call is exercised by the tests that drive the real api.
    fn open_docs_view(&mut self, name: String) -> Result<Vec<SandboxViewOpened>, ViewRefusal> {
        Ok(vec![SandboxViewOpened {
            kind: ViewKind::Docs,
            selector: name,
            tokens: 0,
            superseded: false,
        }])
    }

    /// Answers every search with an empty page, and reports the one view a real search would have
    /// opened.
    ///
    /// The double models no catalogue, so it has nothing to find and nothing to be right about if it
    /// invented hits — and the ranking is `DocsRuntime`'s to be tested, over a real committed
    /// catalogue, which is where `docs.search.test.rs` tests it. What the double *does* model is the
    /// shape the membrane bridges: a page plus a view, so the recording of a search's view is
    /// exercised without a window to open one in.
    fn search_docs(&mut self, _query: DocSearchQuery) -> Result<DocSearchResult, ViewRefusal> {
        Ok(DocSearchResult {
            page: DocSearch {
                total: 0,
                offset: 0,
                hits: Vec::new(),
            },
            opened: SandboxViewOpened {
                kind: ViewKind::Search,
                selector: SEARCH_RESULTS_VIEW.to_string(),
                tokens: 0,
                superseded: false,
            },
        })
    }

    /// Closes nothing and says so: the double holds no window, so there is nothing to remove and the
    /// honest answer is `0` — which is a successful call, exactly as it is in production. The
    /// **capability** gate is the membrane's rather than the api's, so it is exercised without this.
    fn close_docviews(&mut self, _key: Option<String>) -> Result<u32, ViewRefusal> {
        Ok(0)
    }

    /// The read, recorded as the `read_file` it really is, plus the view it opens.
    ///
    /// It is logged under the **tool name** rather than under the function the program called,
    /// because that is what production records: `view.openFile` dispatches a `read_file`, and a test
    /// asserting on the composed-call roster should see the same call the loop streamed.
    ///
    /// The pictures are taken out of the outcome exactly as the production api takes them: they
    /// belong to the view item now, and leaving them behind would have the membrane mistake this
    /// for a bare read and rewrite the descriptor to say the model is not being shown it. The
    /// double never models the open-image-view cap — that is the production api's, decided against
    /// the real window, and every test of it drives that api.
    fn open_file_view(
        &mut self,
        path: String,
        offset: Option<usize>,
        limit: Option<usize>,
    ) -> ViewOpenOutcome {
        let mut outcome = self.call(
            "read_file",
            json!({ "path": path, "offset": offset, "limit": limit }),
        );
        if !outcome.ok {
            return ViewOpenOutcome {
                outcome,
                opened: None,
            };
        }
        let region = match &outcome.data {
            Some(ApiData::FileText(text)) => FileRegion::covered(
                text.first_line.into(),
                text.last_line.into(),
                text.total_lines.into(),
            ),
            _ => None,
        };
        outcome.images.clear();
        let opened = self.open_view(
            ViewKind::File,
            path,
            outcome.output.len() as u64 / 4,
            region,
        );
        ViewOpenOutcome {
            outcome,
            opened: Some(opened),
        }
    }

    /// Opens the text view, modelling only the one rule the membrane can observe: an empty label is
    /// refused. The size caps are the production api's, and are exercised where they live.
    fn open_text_view(
        &mut self,
        label: String,
        body: String,
    ) -> Result<SandboxViewOpened, ViewRefusal> {
        if label.trim().is_empty() {
            return Err(ViewRefusal {
                failure: ToolFailure::InvalidArgument,
                message: "a view needs a non-empty label".to_string(),
            });
        }
        let tokens = body.len() as u64 / 4;
        Ok(self.open_view(ViewKind::Text, label, tokens, None))
    }

    fn close_view(&mut self, selector: String) -> Result<u32, ViewRefusal> {
        if selector.trim().is_empty() {
            return Err(ViewRefusal {
                failure: ToolFailure::InvalidArgument,
                message: "`view.close` needs a non-empty selector".to_string(),
            });
        }
        let before = self.views.len();
        self.views.retain(|view| view.selector != selector);
        Ok((before - self.views.len()) as u32)
    }

    fn current_views(&mut self) -> Vec<OpenViewInfo> {
        self.views.clone()
    }

    fn program_history(&mut self) -> Vec<ProgramSummary> {
        self.programs.summaries()
    }

    fn program_source(&mut self, turn: Option<u64>) -> Result<String, ProgramRefusal> {
        self.programs.source(turn).map(str::to_string)
    }
}

/// A `TaskStatus` in the spelling gg's schema declares, for the recorded telemetry `args` value.
fn task_status_word(status: TaskStatus) -> &'static str {
    match status {
        TaskStatus::Pending => "pending",
        TaskStatus::InProgress => "in_progress",
        TaskStatus::Done => "done",
    }
}

/// An `IssueStatus` in the spelling gg's schema declares, for the recorded telemetry `args` value.
fn issue_status_word(status: IssueStatus) -> &'static str {
    match status {
        IssueStatus::Open => "open",
        IssueStatus::InProgress => "in_progress",
        IssueStatus::InReview => "in_review",
        IssueStatus::Done => "done",
        IssueStatus::Failed => "failed",
    }
}

/// A plausible outcome for every gg tool the sandbox binds, carrying the same
/// [structured sidecar](ApiData) the real tool emits.
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
            .with_data(ApiData::BytesWritten(string("contents").len() as u64)),
        "edit_file" => ToolOutcome::ok("edited the file", "edited"),
        "list_dir" => ToolOutcome::ok("a.ts\nb.test.ts\nsub/", "3 entries").with_data(
            ApiData::DirEntries(vec![
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
        "write_memory" | "update_memory" | "create_memory" | "edit_memory" | "delete_memory" => {
            ToolOutcome::ok("noted", "memory").with_data(ApiData::MemoryUsage(MemoryUsageData {
                count: 1,
                max_count: Some(8),
                total_chars: 12,
                max_total_chars: Some(4_000),
                index_chars: None,
                max_index_chars: None,
            }))
        }
        "read_memory" => ToolOutcome::ok("the memory contents", "read a memory"),
        "search_memories" => ToolOutcome::ok("1 of 1 memories match", "searched memories")
            .with_data(ApiData::MemoryHits(vec![MemoryHitData {
                name: "build-commands".to_string(),
                description: "How to build".to_string(),
                matched: 2,
                occurrences: 3,
                excerpt: "…cargo nextest run --workspace…".to_string(),
            }])),
        "add_task" | "remove_task" => ToolOutcome::ok("noted", "task")
            .with_data(ApiData::TaskUsage(UsagePair { count: 2, max: 20 })),
        "update_task" | "set_blocked_by" | "complete_task" => ToolOutcome::ok("noted", "task"),
        // The two creations report the id gg assigned as well as the budget; the removals report
        // the budget alone.
        "create_epic" => {
            ToolOutcome::ok("noted", "board").with_data(ApiData::BoardNode(BoardNodeData {
                id: "EPIC".to_string(),
                board: fake_board_usage(),
            }))
        }
        "create_issue" => {
            ToolOutcome::ok("noted", "board").with_data(ApiData::BoardNode(BoardNodeData {
                id: "EPIC-1".to_string(),
                board: fake_board_usage(),
            }))
        }
        "remove_epic" | "remove_issue" => {
            ToolOutcome::ok("noted", "board").with_data(ApiData::BoardUsage(fake_board_usage()))
        }
        "update_issue" | "set_issue_blocked_by" => ToolOutcome::ok("noted", "board"),
        "wait_for_issue" => ToolOutcome::ok("wait registered", "wait registered"),
        "evict_file_view" | "archive_thread" => ToolOutcome::ok("reclaimed", "reclaimed")
            .with_data(ApiData::Reclaim(ReclaimData {
                items: 2,
                reclaimed_tokens: 300,
                paths: vec!["src/a.ts".to_string()],
                detail: "dropped 2 items".to_string(),
            })),
        // A compaction is registered, not performed: the loop rewrites the window once the program
        // has ended, so there is nothing for a successful call to report back.
        "compact" => ToolOutcome::ok("compacting the context window", "compact context"),
        // A transition is likewise registered rather than performed: the loop stands the next
        // state's agent up once the program has ended, so a successful call reports only that it
        // was accepted.
        "transition_state" => ToolOutcome::ok("moving on once this turn ends", "transition"),
        // An `exec` is the same registered succession a transition is, declared by the model
        // instead of by a machine, so it reports the same way.
        "exec" => ToolOutcome::ok("continuing as another agent once this turn ends", "exec"),
        // A fork's dispatch waits for the end of the turn, but its handle does not: the id is
        // minted at the call so the program can name the copy, which is why this carries the same
        // sidecar a spawn does.
        "fork" => ToolOutcome::ok("forked", "forked").with_data(ApiData::SubagentSpawned(
            SubagentHandleData {
                id: "agent-2".to_string(),
                slot: "primary".to_string(),
                model_id: "test/model".to_string(),
            },
        )),
        "search_archive" => ToolOutcome::ok("1 hit", "searched").with_data(ApiData::ArchiveSearch(
            ArchiveSearchData {
                archive_empty: false,
                hits: vec![ArchiveHitData {
                    seq: 3,
                    role: crate::model::Role::Assistant,
                    text: "the earlier answer".to_string(),
                }],
            },
        )),
        "spawn_subagent" => ToolOutcome::ok("spawned", "spawned").with_data(
            ApiData::SubagentSpawned(SubagentHandleData {
                id: "agent-1".to_string(),
                slot: "primary".to_string(),
                model_id: "test/model".to_string(),
            }),
        ),
        "wait_for_subagents" => {
            ToolOutcome::ok("collected", "collected").with_data(ApiData::SubagentResults(vec![
                SubagentResultData {
                    id: "agent-1".to_string(),
                    status: Some(crate::tools::AgentStatusData::Completed),
                    summary: "did the work".to_string(),
                },
            ]))
        }
        "send_message" => ToolOutcome::ok("delivered", "messaged"),
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
        data: Some(ApiData::Shell(ShellData {
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
            .with_data(ApiData::FileImage(FileImageData {
                media_type: "image/png".to_string(),
                label: "PNG".to_string(),
                bytes: 1_234,
                shown: true,
                not_shown_reason: None,
            }));
    }
    let contents = format!("contents of {path}\nline two\n");
    ToolOutcome::ok(contents.clone(), "read 2 lines").with_data(ApiData::FileText(FileTextData {
        contents,
        first_line: 1,
        last_line: 2,
        total_lines: 2,
        byte_truncated: false,
    }))
}

/// A membrane state offering every tool the sandbox binds, with no deadline, answering with the
/// canned outcomes above.
///
/// The membrane's whole surface is tested this way — no store, no component, no wasm — which is
/// what makes covering thirty-two functions affordable.
pub(crate) fn membrane(log: &CallLog) -> MembraneState<FakeOperationApi> {
    membrane_as(log, EndingRole::Standard)
}

/// A membrane state as [`membrane`], in `role`'s [ending group](EndingRole) — what a reviewer's
/// program is answered by.
///
/// The role crosses into the host: the membrane refuses an ending call outside the group, because a
/// guest that links its SDK as a library has no scope to withhold one from. So this parameter is the
/// subject of the tests that pass it, not decoration on them.
pub(crate) fn membrane_as(log: &CallLog, role: EndingRole) -> MembraneState<FakeOperationApi> {
    membrane_in(typescript(), log, role)
}

/// A membrane state as [`membrane_as`], written in `language` — what a test asserting on a
/// **spelling** needs, since a refusal that names a call names it the way that language writes it.
pub(crate) fn membrane_in(
    language: &'static dyn ProgramLanguage,
    log: &CallLog,
    role: EndingRole,
) -> MembraneState<FakeOperationApi> {
    MembraneState::new(
        FakeOperationApi::new(log),
        language,
        scope_of(
            &all_capabilities(),
            &all_operations(),
            RunEnding::Role(role),
        ),
        SandboxLimits::AMPLE,
        None,
    )
}

/// A membrane state as [`membrane`], run under `ending` — the [`None`](RunEnding::None) arm being
/// the one an on-use script gets, which may declare no ending at all.
pub(crate) fn membrane_ending(log: &CallLog, ending: RunEnding) -> MembraneState<FakeOperationApi> {
    MembraneState::new(
        FakeOperationApi::new(log),
        typescript(),
        scope_of(&all_capabilities(), &all_operations(), ending),
        SandboxLimits::AMPLE,
        None,
    )
}

/// A membrane state granting `operations` alone, expiring at `deadline`, answering with `responder`.
///
/// Every capability is held, so what the grant turns on is the allowlist — which is the axis a test
/// asserting on a refusal wants: an agent with the memories capability and no `memories.update_memory`
/// in its list is a configuration a run can really have.
pub(crate) fn membrane_with(
    log: &CallLog,
    operations: &[OperationId],
    deadline: Option<Instant>,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> MembraneState<FakeOperationApi> {
    MembraneState::new(
        FakeOperationApi::with(log, responder),
        typescript(),
        scope_of(
            &all_capabilities(),
            operations,
            RunEnding::Role(EndingRole::Standard),
        ),
        SandboxLimits::AMPLE,
        deadline,
    )
}

/// A membrane state over an already-prepared `api` — the one the program-library tests need, since
/// what they vary is the api's own state (which programs it holds) rather than how it answers a call.
pub(crate) fn membrane_from(api: FakeOperationApi) -> MembraneState<FakeOperationApi> {
    membrane_from_scope(api, true)
}

/// [`membrane_from`], with the [program library](crate::programs) bound or withheld — the one scope
/// variation the library's own tests turn on.
pub(crate) fn membrane_from_scope(
    api: FakeOperationApi,
    library: bool,
) -> MembraneState<FakeOperationApi> {
    membrane_from_scope_in(typescript(), api, library)
}

/// [`membrane_from_scope`], written in `language` — the spelling seam the library refusals are
/// asserted through.
pub(crate) fn membrane_from_scope_in(
    language: &'static dyn ProgramLanguage,
    api: FakeOperationApi,
    library: bool,
) -> MembraneState<FakeOperationApi> {
    let capabilities: Vec<String> = all_capabilities()
        .into_iter()
        .filter(|id| library || id != CAPABILITY_PROGRAM_LIBRARY)
        .collect();
    MembraneState::new(
        api,
        language,
        scope_of(
            &capabilities,
            &all_operations(),
            RunEnding::Role(EndingRole::Standard),
        ),
        SandboxLimits::AMPLE,
        None,
    )
}

/// A membrane state for an agent whose
/// [`docview-close`](test_cabinet_core::gg::CAPABILITY_DOCVIEW_CLOSE) capability is `docview_close`
/// — the one scope variation the documentation-close tests turn on, as the library flag is the one
/// the program-library tests turn on.
pub(crate) fn membrane_closing_docs(
    log: &CallLog,
    docview_close: bool,
) -> MembraneState<FakeOperationApi> {
    let capabilities: Vec<String> = all_capabilities()
        .into_iter()
        .filter(|id| docview_close || id != CAPABILITY_DOCVIEW_CLOSE)
        .collect();
    MembraneState::new(
        FakeOperationApi::new(log),
        typescript(),
        scope_of(
            &capabilities,
            &all_operations(),
            RunEnding::Role(EndingRole::Standard),
        ),
        SandboxLimits::AMPLE,
        None,
    )
}

/// The scope a test's membrane is built from. Modules are always empty: what a program has loaded is
/// the guest's business, and no host function reads it.
///
/// The two halves of a grant are both parameters, because they are the two axes a refusal test turns
/// on: a capability the agent does not hold, and a call its allowlist does not name. The helpers
/// above vary one each.
fn scope_of<'a>(
    capabilities: &'a [String],
    operations: &'a [OperationId],
    ending: RunEnding,
) -> ProgramScope<'a> {
    ProgramScope {
        capabilities,
        operations,
        modules: &[],
        ending,
    }
}

/// The board budget the fake reports on every board mutation.
fn fake_board_usage() -> BoardUsageData {
    BoardUsageData {
        epics: 1,
        max_epics: 4,
        issues: 3,
        max_issues: 20,
    }
}

/// Every gg capability that buys part of the model-facing surface — a fully-capable agent's set.
pub(crate) fn all_capabilities() -> Vec<String> {
    gating_capabilities()
        .into_iter()
        .map(str::to_string)
        .collect()
}

/// Every operation a maximal agent holds — what those capabilities offer, plus what a position
/// buys.
///
/// The capability half is derived through the one helper the console's editor seeds a grant with, so
/// a fixture and a real configuration are the same set arrived at the same way. The positional half
/// is joined on because no capability can be switched on to reach it: a fixture assembled from
/// capabilities alone would withhold `delegation.transition_state` from an agent that is supposed to
/// hold everything, and every arm's surface test would find one call missing.
pub(crate) fn all_operations() -> Vec<OperationId> {
    let mut operations = capability_operations(gating_capabilities());
    operations.extend(super::operations::instance_operations());
    operations
}

/// The allowlist a per-arm fixture's `operations` and its `library` flag together name.
///
/// The `library` flag is a *scope* flag — it decides whether the guest binds the program-library
/// object at all — and a run that keeps a library is a run whose agent was granted its calls: the
/// capability and the allowlist are not two settings an operator turns on separately, they are the
/// capability being switched on and the editor seeding what it offers. Folding the two together
/// here rather than at eleven call sites keeps `&[]` meaning the same thing on every arm: nothing
/// but what nothing gates.
pub(crate) fn granted_operations(operations: &[OperationId], library: bool) -> Vec<OperationId> {
    let mut granted = operations.to_vec();
    if library {
        for id in capability_operations([test_cabinet_core::gg::CAPABILITY_PROGRAM_LIBRARY]) {
            if !granted.contains(&id) {
                granted.push(id);
            }
        }
    }
    granted
}

/// [`all_operations`] less everything `capability` buys — the allowlist of an agent granted the
/// whole surface *except* one family.
///
/// The arms' surface cases need exactly this and cannot get it any other way: they drive one
/// program through the whole SDK and assert that the one part of it a run *buys* separately comes
/// back refused, so a fixture that granted everything would prove the opposite of what the case is
/// about. It is expressed as a subtraction rather than as a list, because the list is the surface
/// and the surface grows.
pub(crate) fn all_operations_without(capability: &str) -> Vec<OperationId> {
    let withheld = capability_operations([capability]);
    all_operations()
        .into_iter()
        .filter(|id| !withheld.contains(id))
        .collect()
}
