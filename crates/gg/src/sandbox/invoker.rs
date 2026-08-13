//! The **native API surface** the typed membrane calls, and the records a run keeps of what a
//! program composed.
//!
//! Everything above this file is typed all the way to the model: a WIT function per tool, a
//! function per tool, typed arguments and a typed result. [`ToolApi`] is the near side
//! of that surface *inside* the host — **one standard, typed method per API function**, so a
//! program's `fs.readFile(path, { limit })` reaches [`ToolApi::read_file`] with its arguments still
//! typed, never lowered into a bag of JSON to be re-parsed. That is the whole of the inversion:
//! responses-as-code is the richer interface, so it calls these functions directly; the JSON
//! tool-calling path is the one that parses its arguments and calls the same standard functions
//! ([`Tool::invoke`](crate::tools::Tool)).
//!
//! The production implementation (the loop's `LoopToolApi`, in [`crate::agent`]) performs each call
//! against gg's real tools and does the loop servicing — the compaction gate, `ToolCall`/
//! `ToolResult` telemetry, session capture, agent-managed-context reclaim, skill pinning, and — for
//! the delegation family — routing through the subagent scheduler. Because it holds the agent's
//! loop state and the sandbox runs on a blocking thread, it drives the async parts (`shell`,
//! delegation) with a [`Handle`](tokio::runtime::Handle)`::block_on`. The in-memory `FakeToolApi`
//! stands in for it in the sandbox's own tests.

use std::time::Duration;

use test_cabinet_core::gg::GgToolFailure;

use crate::board::IssueStatus;
use crate::context::{OpenViewInfo, TurnRange, ViewKind};
use crate::docs::DocSearch;
use crate::memories::MemoryCode;
use crate::programs::{ProgramRefusal, ProgramSummary};
use crate::tasks::TaskStatus;
use crate::tools::{ToolFailure, ToolOutcome};

/// One function of a capability family, as
/// [`DocsRuntime::family`](crate::docs::DocsRuntime::family) reports it: the name a program calls it
/// by and its one-line brief.
///
/// It reaches no model directly and crosses no membrane. Its one reader is the
/// [built-in family skill](crate::skills)'s generated on-use script, which needs a name to write
/// into a program and a line to explain why it wrote it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FunctionSummary {
    /// The name a program calls the function by, in the arm's own spelling.
    pub name: String,
    /// A one-line description of what the function does.
    pub summary: String,
}

/// One call a program made that reached a **dispatch** — the composed-calls record the turn's
/// accounting counts and the operator's stream reads.
///
/// It deliberately does **not** carry the arguments. The loop already builds the call's
/// [dispatch record](crate::agent) with the same `Value` and hands it to the session recorder, so a
/// second full copy retained for the whole turn would be pure waste — a program that rewrites forty
/// 64 KiB files would hold ~2.5 MiB of dead clones, uncapped, for a field nothing renders.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SandboxToolCall {
    /// What the **model wrote**, as gg's own [operation id](super::operations::OperationId) for it —
    /// `files.read_text_file`, `views.open_file`. Never the name of whatever ran underneath: three
    /// operations share one internal read, and a roster keyed on the implementation would report
    /// two of them as the third.
    pub name: String,
    /// Whether the call succeeded.
    pub ok: bool,
    /// The short summary the dispatch recorded, when it recorded one.
    pub summary: Option<String>,
    /// The failure message, when it failed — so the feedback can say *how* a call failed even when
    /// the program caught the throw and carried on to return a value.
    pub error: Option<String>,
}

/// A call the membrane refused because this agent was not granted it: a call outside its allowlist,
/// one bought by a capability it does not hold, or an ending its role does not declare.
///
/// One roster for all of them, because they are one fact — **the model reached for something it was
/// not given** — and that fact is what a comparison of two configurations counts. What is *not* here is a
/// call the model was offered and got wrong: a blank argument, a second hand-over in one turn. Those
/// throw and say why, and putting them here would make the roster a count of mistakes rather than a
/// count of withheld capabilities.
///
/// Refusals are kept apart from [dispatched calls](SandboxToolCall) because nothing was dispatched:
/// no session-record entry was written and no work was done, so folding them into that roster would
/// make the `CodeExecution` event's dispatch count include calls that reached nothing.
///
/// The **API** record makes the opposite choice, and the contrast is what the two records are for:
/// the model wrote the call, so [`begin_api_call`](ToolApi::begin_api_call) brackets it and closes
/// it as a failure — an agent reaching for something it was not given is exactly what a comparison
/// of two configurations counts — while this roster stays a record of what a turn *ran*.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SandboxRefusal {
    /// What was refused, as gg's own [operation id](super::operations::OperationId) for it —
    /// `session.approve`, `programs.rerun`. Never a tool name: a tool is the other surface's
    /// vocabulary, and most of what can be refused here has none.
    pub name: String,
    /// Why — the same text the program's `ToolError` carried.
    pub message: String,
}

/// One view a program opened, as the turn's feedback reports it back to the model.
///
/// [`superseded`](Self::superseded) is what makes "opened" and "replaced" different facts. A program
/// that re-opens a selector in a loop must be able to read its own accounting correctly — one view,
/// re-stated — rather than believing it opened a second one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SandboxViewOpened {
    /// Whether it is a file view or a text view.
    pub kind: ViewKind,
    /// The view's selector: a file view's workspace path, or a text view's label.
    pub selector: String,
    /// Roughly what the newly opened view costs the window, in tokens.
    pub tokens: u64,
    /// Whether it replaced a view that was already open under the same selector.
    pub superseded: bool,
}

/// Why a `view.*` call was refused, in a shape the membrane lowers into a typed `tool-error`.
///
/// It carries a [`ToolFailure`] rather than the membrane's generated `error-code` for the reason
/// every type in this file is spelled out by hand: this trait must not depend on the `bindgen!`
/// types. The membrane maps the one onto the other with the conversion every failed
/// [`ToolOutcome`] already goes through, so a refused view is classified exactly as a failed tool
/// call is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ViewRefusal {
    /// The failure class — `invalid-argument` for a selector that could never be acted on,
    /// `limit-exceeded` for a cap.
    pub failure: ToolFailure,
    /// The model-facing guidance, which for a cap **names the cap** rather than truncating behind
    /// the model's back.
    pub message: String,
}

/// What a `docs.search` asks for, owned — the host counterpart of the guest's `search` arguments.
///
/// Owned `String`s rather than borrows for the reason [`ViewRefusal`] carries a [`ToolFailure`]:
/// the membrane lifts these out of the guest's linear memory and the trait must not depend on the
/// generated bindings, nor on how long the guest's copy lives.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DocSearchQuery {
    /// The words to look for, as the model typed them.
    pub query: String,
    /// Restrict to one module, by gg's id for it or by this language's spelling.
    pub module: Option<String>,
    /// Restrict to one type and what takes or returns it.
    pub declared_type: Option<String>,
    /// Restrict to `function` or `type`.
    pub kind: Option<String>,
    /// How many hits to skip.
    pub offset: Option<u32>,
    /// How many hits to return.
    pub limit: Option<u32>,
}

/// What one `docs.search` produced: the page the program gets back, and the view the host opened of
/// it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocSearchResult {
    /// The results, as the program's return value.
    pub page: DocSearch,
    /// The [search-results view](test_cabinet_core::gg::GgContextSource::SearchResults) this search
    /// placed, replacing whatever the previous one left.
    pub opened: SandboxViewOpened,
}

/// What one `view.openFile` produced: the read's own outcome, and — when a view was actually opened
/// — the record of it.
///
/// The two travel together because the call is one thing to the model and two things to gg: a
/// `read_file` that is dispatched, serviced, streamed and rostered exactly as any other, plus a
/// context item pushed from what it returned. A read that failed opens nothing, so `opened` is
/// `None`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ViewOpenOutcome {
    /// The read's outcome, which the membrane converts into the same `file-read` a bare
    /// `fs.readFile` returns.
    pub outcome: ToolOutcome,
    /// The view that was opened, or `None` when the read failed — in which case there was nothing to
    /// show, the failure is already a rostered, streamed `read_file` result, and the membrane throws
    /// it at the program. There is no half-open state to report.
    pub opened: Option<SandboxViewOpened>,
}

/// The prefix of the synthetic call id a program-composed tool call is recorded under:
/// `program:{ordinal}:{tool}`.
///
/// A program's call has no provider-assigned id, so the loop mints one. The **ordinal** is what
/// makes it unique within a turn: an id named only after the tool would collide whenever one
/// program called one tool twice, which is wrong for anything keyed by it. The prefix is also the
/// only thing distinguishing the two in the [session
/// record](test_cabinet_core::gg_session_record::GgSessionRecord), so it is what lets a reader
/// attribute a recorded `ToolResult` to the open turn's program rather than to a native tool call
/// the model never made.
pub const PROGRAM_CALL_ID_PREFIX: &str = "program:";

/// **What one model-facing call is recorded as** — the identity the API layer's own
/// [record](test_cabinet_core::gg::GgTelemetryKind::ApiCall) carries, and the argument both halves
/// of the bracket take.
///
/// One field, because there is one identity: the [operation](super::operations::OperationId) gg
/// files the call under, rendered (`files.read_file`). It is the cross-arm join — eleven language
/// arms legitimately spell one operation eleven ways, so it is the only key under which two arms'
/// calls can be counted together — and it is never a spelling: a program that wrote `readFile` is
/// recorded as `files.read_file`.
///
/// It used to carry a second `(object, function)` pair beside this, from the vocabulary that
/// preceded the module surface. That pair disagreed with the operation id on seven of twelve
/// groupings (`fs`/`files`, `view`/`views`, `harness`/`session`, `memory`/`memories`,
/// `agents`/`delegation`, `project`/`board`, `system`/`shell`), so nothing could be joined on it,
/// and a record carrying two names for one call is a record whose readers will pick different ones.
///
/// A struct rather than a bare string so that the opening and the closing half of a bracket cannot
/// describe two different calls: they are handed the same value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ApiIdentity<'a> {
    /// gg's [operation](super::operations::OperationId) id, rendered — `files.read_file`.
    pub operation: &'a str,
}

/// The native, typed surface the membrane calls — one standard method per gg API function, plus the
/// two the documentation family needs (a search, and one close that both documentation closes reach
/// through). No method takes a serde_json::Value: a program's typed call reaches
/// gg's tools without a round trip through JSON. `&mut self` because a call records what it composed.
pub trait ToolApi: Send + 'static {
    /// A program has begun a model-facing [call](ApiIdentity) — the **opening** half of the API
    /// layer's own record, taken whether or not a gg tool backs the call.
    ///
    /// Independent of the tool layer by construction: the membrane brackets every host function with
    /// this pair, and only *some* of those host functions go on to dispatch a tool. That is what
    /// makes `views.openFile` a `views.open_file` here and a `read_file` on the tool stream, and
    /// what gives `views.current` — which dispatches nothing at all — a count.
    ///
    /// Called **before** the work, so anything the call produces (a bridged `ToolCall`/`ToolResult`
    /// pair, a delegation's whole subtree of child events) lands inside the bracket, exactly as the
    /// tool layer's own [`ToolCall`](test_cabinet_core::gg::GgTelemetryKind::ToolCall) brackets what
    /// it dispatches.
    fn begin_api_call(&mut self, call: ApiIdentity<'_>);

    /// That call returned — the **closing** half, with the verdict the *program* saw.
    ///
    /// The verdict is settled after the outcome has been converted into what the program is handed,
    /// so it can legitimately disagree with the `ToolResult` beside it: a tool that answered `ok`
    /// with a payload the typed function could not use failed the program, and the API layer is the
    /// one the model experienced. There is no default body, deliberately — an api that forgot to
    /// record would report a model as having ignored its whole surface.
    ///
    /// `failure` is `None` when the call returned a value and `Some` when it threw, carrying the
    /// [class](GgToolFailure) of the `ToolError` the program was thrown — the same `code` a `catch`
    /// site branches on. It is the verdict *and* the reason in one argument rather than an `ok` flag
    /// beside an optional class, so a caller cannot record a failure with no reason or a reason on a
    /// call that succeeded. For the calls that never reach a tool — a carve-out no tool backs, and a
    /// call the membrane refused before dispatch — this is the **only** record of why they failed.
    fn end_api_call(&mut self, call: ApiIdentity<'_>, failure: Option<GgToolFailure>);

    fn shell(&mut self, command: String, timeout: Duration) -> ToolOutcome;
    fn read_file(
        &mut self,
        path: String,
        offset: Option<usize>,
        limit: Option<usize>,
    ) -> ToolOutcome;
    fn write_file(&mut self, path: String, contents: String) -> ToolOutcome;
    fn edit_file(&mut self, path: String, old_string: String, new_string: String) -> ToolOutcome;
    fn list_dir(&mut self, path: Option<String>) -> ToolOutcome;
    fn read_skill(&mut self, name: String) -> ToolOutcome;
    fn write_memory(
        &mut self,
        name: String,
        description: String,
        body: String,
        code: MemoryCode,
    ) -> ToolOutcome;
    fn update_memory(
        &mut self,
        name: String,
        description: String,
        body: String,
        code: MemoryCode,
    ) -> ToolOutcome;
    fn create_memory(
        &mut self,
        name: String,
        description: String,
        contents: String,
        code: MemoryCode,
    ) -> ToolOutcome;
    fn read_memory(&mut self, name: String) -> ToolOutcome;
    fn edit_memory(&mut self, name: String, search: String, replace: String) -> ToolOutcome;
    fn search_memories(&mut self, keywords: Vec<String>) -> ToolOutcome;
    fn delete_memory(&mut self, name: String) -> ToolOutcome;
    fn add_task(
        &mut self,
        id: String,
        title: String,
        description: Option<String>,
        blocked_by: Vec<String>,
    ) -> ToolOutcome;
    fn update_task(
        &mut self,
        id: String,
        title: Option<String>,
        description: Option<String>,
        status: Option<TaskStatus>,
    ) -> ToolOutcome;
    fn set_blocked_by(&mut self, id: String, blocked_by: Vec<String>) -> ToolOutcome;
    fn complete_task(&mut self, id: String) -> ToolOutcome;
    fn remove_task(&mut self, id: String) -> ToolOutcome;
    fn create_epic(&mut self, prefix: String, title: String, description: String) -> ToolOutcome;
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
    ) -> ToolOutcome;
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
    ) -> ToolOutcome;
    fn set_issue_blocked_by(&mut self, id: String, blocked_by: Vec<String>) -> ToolOutcome;
    fn remove_epic(&mut self, id: String) -> ToolOutcome;
    fn remove_issue(&mut self, id: String) -> ToolOutcome;
    /// Register a deferred wait on a board issue and return the acknowledgement. Unlike the
    /// delegation family, this does **not** block on the calling thread: it records the requested
    /// wait (validating the id) and returns at once, and the loop performs the actual suspension
    /// after the program ends. A composed program has no shape for a mid-execution control-flow
    /// wait, so the wait is deferred to a place that does — between turns.
    fn wait_for_issue(&mut self, id: String) -> ToolOutcome;
    fn evict_file_view(&mut self, path: Option<String>) -> ToolOutcome;
    fn archive_thread(&mut self, ranges: Vec<TurnRange>) -> ToolOutcome;
    fn search_archive(&mut self, query: String) -> ToolOutcome;
    /// Register a compaction of the agent's own window and return. Deferred exactly as
    /// [`wait_for_issue`](Self::wait_for_issue) is, and for the same reason: rewriting the context
    /// a program is running in would pull the window out from under the turn still using it, so the
    /// call validates and records the request and the loop performs the rewrite once the program
    /// has ended.
    fn compact(&mut self, summary: String, files: Vec<String>) -> ToolOutcome;
    /// Declare a move to another state of the [machine](crate::fsm) driving this agent, and return.
    /// Deferred exactly as [`compact`](Self::compact) is, and for a stronger version of the same
    /// reason: a transition replaces the agent — window and all — and doing that to a program still
    /// running inside it would pull every one of its remaining calls out from under it. The call
    /// validates the target against the state's declared edges, records the request, and the loop
    /// performs the succession once the program has ended. Unlike a compaction the **first**
    /// declaration stands, because a silently replaced successor identity is a change the model
    /// cannot see.
    fn transition_state(&mut self, state: String, note: Option<String>) -> ToolOutcome;
    /// Declare that this session continues as another agent, and return. Deferred on exactly the
    /// terms [`transition_state`](Self::transition_state) is — the two are the same succession, one
    /// chosen by a machine and one by the model — so the first declaration of either in a turn
    /// stands and a second is refused.
    fn exec(&mut self, agent: String, prompt: Option<String>) -> ToolOutcome;
    /// Register a copy of this agent for the loop to start when the turn ends, and return the
    /// copy's handle.
    ///
    /// Unlike the two above this does not replace anybody, so it is **additive**: a program may
    /// fork several times and every copy runs. It is still deferred, because the window a copy
    /// inherits has to be a complete conversation and mid-program it is not — which is why the
    /// handle it returns cannot be waited on until the next turn.
    fn fork(&mut self, prompt: String) -> ToolOutcome;
    fn spawn_subagent(
        &mut self,
        agent: String,
        prompt: Option<String>,
        issue_id: Option<String>,
    ) -> ToolOutcome;
    fn wait_for_subagents(&mut self, ids: Option<Vec<String>>) -> ToolOutcome;
    fn send_message(&mut self, agent_id: String, message: String) -> ToolOutcome;
    /// Search the documentation surface this agent binds, and **also** open the results as a view.
    ///
    /// Both, deliberately. A search is a value the program computes with — it will page, filter and
    /// pick out of it — and a program that had to open a text view to read its own results would
    /// pay a view for every page of a loop. But the results are also the one thing the *model*
    /// needs next turn, and a value a program did not choose to show reaches nobody. So the host
    /// opens exactly one, under a constant selector, replaced by the next search: the results view
    /// names what the agent is working from, which is why it supersedes where a documentation view
    /// does not.
    ///
    /// It answers with the view it opened as well as the page, so a turn's feedback can report what
    /// the window gained without inferring it from the call.
    fn search_docs(&mut self, query: DocSearchQuery) -> Result<DocSearchResult, ViewRefusal>;
    /// Open the documentation view for `name` — and, under this agent's type mode, the SDK types
    /// its signature mentions — reporting **every** view the call actually placed.
    ///
    /// A view rather than a return value, which is what makes documentation accountable: each one is
    /// keyed by the thing it documents, can be closed, and is charged to a band like everything else
    /// the model reads. A name this run did not bind is a [refusal](ViewRefusal), not an empty view.
    ///
    /// It answers with a **list**, and possibly an empty one, for two reasons that are the whole of
    /// the mechanism. One call can place several views — the function's own and one per type — and
    /// the turn's feedback has to report what the model's window actually gained, not a stand-in for
    /// it. And a key that is already open is a *total no-op*: nothing is moved, nothing is
    /// re-emitted, and nothing is reported, because nothing happened. A model that re-opened three
    /// functions it already had reads back an empty list, which is exactly true.
    fn open_docs_view(&mut self, name: String) -> Result<Vec<SandboxViewOpened>, ViewRefusal>;
    /// Close the documentation view keyed by `key` — or **every** one of them, when `key` is `None`
    /// — and report how many were closed. Closing a key that is not open closes `0`, which is not a
    /// failure.
    ///
    /// Its own call rather than a band of [`close_view`](Self::close_view), because it is its own
    /// decision: it is bought by a capability the rest of the view surface is not, and it is the one
    /// close that can invalidate a cached prompt prefix — the documentation band is otherwise
    /// append-only. A blank `key` is a [refusal](ViewRefusal): `None` is how a program says *all of
    /// them*, so a blank string is a typo rather than a way of saying it.
    fn close_docviews(&mut self, key: Option<String>) -> Result<u32, ViewRefusal>;
    /// Read a workspace file **and** open a file view of it — the one place the code path
    /// deliberately does push a [`FileView`](test_cabinet_core::gg::GgContextSource::FileView).
    ///
    /// The read is an ordinary serviced `read_file`: the same tool, the same telemetry, the same
    /// session-record entry, the same roster line. What differs is what happens to the result — it also
    /// becomes a context item keyed by `(path, region)`, and the picture a mockup returned rides in
    /// that item rather than out on the turn's feedback.
    fn open_file_view(
        &mut self,
        path: String,
        offset: Option<usize>,
        limit: Option<usize>,
    ) -> ViewOpenOutcome;
    /// Open (or replace) the text view keyed by `label`: material the program computed, pushed into
    /// the window as its own attributable item.
    ///
    /// Not a tool and not dispatched — it touches this agent's context window directly, which is
    /// why it is also where the [caps](crate::agent) on a view live.
    fn open_text_view(
        &mut self,
        label: String,
        body: String,
    ) -> Result<SandboxViewOpened, ViewRefusal>;
    /// Close every **file or text** view whose selector matches — for a file, every page of that
    /// path — and report how many were closed. A selector that is not open closes `0`, which is not
    /// a failure. Documentation is [closed by its own call](Self::close_docviews).
    fn close_view(&mut self, selector: String) -> Result<u32, ViewRefusal>;
    /// What is open in this agent's window right now, in the order it was opened. Charged against
    /// no cap: it opens nothing and reads nothing off disk.
    fn current_views(&mut self) -> Vec<OpenViewInfo>;
    /// Every program this agent has run that its [library](crate::programs::ProgramLibrary) still
    /// holds — the whole of `programs.history()`.
    ///
    /// Not a tool and not dispatched, on the same rule the documentation directory is not: it reads
    /// gg's own state rather than the workspace, and an agent whose library is empty gets an empty
    /// list rather than a failure. An agent without the capability never asks, because the object is
    /// not in its scope.
    fn program_history(&mut self) -> Vec<ProgramSummary>;
    /// The source of one program this agent ran — `None` being the most recent — or the
    /// [refusal](ProgramRefusal) naming the turns the library holds.
    fn program_source(&mut self, turn: Option<u64>) -> Result<String, ProgramRefusal>;
}
