use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde_json::json;
use tempfile::TempDir;

use std::collections::{BTreeMap, BTreeSet, HashMap};

use super::*;
use crate::archive::ArchiveRuntime;
use crate::board::BoardRuntime;
use crate::client::MockClient;
use crate::client::{
    ClientFactory, DEFAULT_MOCK_MEMORY, DEFAULT_MOCK_SKILL, DEFAULT_MOCK_TASK_MOVEMENT,
    DEFAULT_MOCK_TASK_SCAFFOLD, MOCK_CODE_LEVEL_FILES, MOCK_ISSUE_REVIEW_PREFIX, MOCK_MEMORY_CHILD,
    MOCK_MEMORY_PARENT, MOCK_REVIEW_FIX_FILE, MOCK_REVIEW_FIX_SENTINEL, MOCK_REVIEW_WORKER_FILE,
    MOCK_SUBAGENT_FILE, MOCK_SUBAGENT_RETURN,
};
use crate::compaction::{CompactionSetup, CompactionStrategy};
use crate::config::GgInvocation;
use crate::context::HeuristicTokenEstimator;
use crate::memories::MemoriesRuntime;
use crate::model::{
    FinishReason, Message, ModelClient, ModelError, ModelResponse, ToolCall, ToolDefinition,
};
use crate::modules::{HistorySetup, ModuleHandle, ModuleSet};
use crate::skills::{SkillLibrary, SkillsRuntime};

/// [`super::system_prompt`] for the tests, which build their own [`SystemContext`] and expect it to
/// render.
///
/// It shadows the glob-imported production function deliberately, so the ~20 assertions below stay
/// about *what the prompt says* rather than each unwrapping the same `Result`. The failures it
/// panics on are both gg's own — a template override that will not render and a code-mode context
/// with no program language — and a test that provoked one has found a defect either way. The
/// production disposition (the agent's loop ends, and the run with it) is asserted where the loop is.
fn system_prompt(inputs: PromptInputs<'_>) -> String {
    super::system_prompt(inputs).expect("this agent's system prompt renders")
}
use crate::tasks::TasksRuntime;
use crate::telemetry::{CollectingSink, Emitter};
use crate::tools::{ToolContext, ToolRegistry, VisionContext};
use test_cabinet_core::gg::{
    ALL_SUBAGENT_SCOPES, CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_COMPACTION,
    CAPABILITY_CONTEXT_WINDOW_OVERRIDE, CAPABILITY_FSM, CAPABILITY_MEMORIES,
    CAPABILITY_PROJECT_MANAGEMENT, CAPABILITY_READ_FILE, CAPABILITY_RESPONSES_AS_CODE,
    CAPABILITY_SHELL, CAPABILITY_SKILLS, CAPABILITY_SUBAGENTS, CAPABILITY_TASKS, FSM_PARAM_STATES,
    GgAgentConfig, GgAgentStatus, GgCapabilityConfig, GgCapabilitySet, GgContextAction,
    GgContextSource, GgHook, GgHookAction, GgHookEvent, GgIssueReviewPhase, GgIssueStatus,
    GgProgramLanguage, GgPromptCacheTtl, GgRosterEntry, GgSessionSummary, GgSlotBinding,
    GgSubagentRef, GgSubagentScope, GgTelemetryEvent, GgTelemetryKind, GgTurnErrorType,
    PROJECT_MANAGEMENT_PARAM_MERGE_AGENT, ROOT_AGENT, ROOT_PROFILE_ID,
};
use test_cabinet_core::gg_session_journal::{GG_SESSION_JOURNAL_PATH, GgJournalLine};
use test_cabinet_core::gg_session_record::{
    GgClientRole, GgSessionAgent, GgSessionAgentOrigin, GgSessionEntry, GgSessionEntryKind,
    GgSessionModelErrorKind, GgSessionPromptSlot, GgSessionRetention, GgSessionSeed,
};
use test_cabinet_core::metrics::{Cost, TokenCounts};

/// Rendered prose with every run of whitespace collapsed to one space.
///
/// The templates hard-wrap their prose — that is what makes them editable — so where a sentence
/// happens to break is not something it *says*, and an assertion that spans a line break fires on
/// a re-wrap that changed no word. A phrase check runs against this. (`crate::prompts`'s own tests
/// keep a sibling helper of the same name for the same reason; each module has its own because a
/// `#[path]` test file cannot see another's.)
fn flat(rendered: &str) -> String {
    rendered.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The context window these tests run every scripted model against. gg has no fallback —
/// a run whose window cannot be resolved does not start — so a test must supply the same
/// thing a launch would: a window per bound model. The scripted models are not real, so
/// the figure is nominal; what matters is that it is *stated*, exactly as the backend
/// states a real model's.
const TEST_CONTEXT_WINDOW: u64 = 200_000;

/// An invocation over `dir` configured with `set`, carrying the per-model context windows
/// a launch would have pushed in — one for every model the set binds.
fn invocation(dir: &Path, set: GgCapabilitySet) -> GgInvocation {
    let model_windows = test_windows(&set);
    let model_providers = test_providers(&set);
    GgInvocation {
        session_id: "run-test".to_string(),
        workspace_dir: dir.to_path_buf(),
        prompt: "Build a tiny game.".to_string(),
        capability_set: set,
        model_windows,
        model_providers,
        // No declared modalities: the offline default, under which every model is
        // treated optimistically about image input (see `crate::vision`).
        model_modalities: BTreeMap::new(),
        // No provided files by default; the autoload-specifications tests set this.
        provided_files: Vec::new(),
        // Nothing cancels a test run: the loop is driven to its own ending.
        cancel_file: None,
    }
}

/// The pin map a launch would push for `set`: the author segment of every bound model id.
fn test_providers(set: &GgCapabilitySet) -> BTreeMap<String, String> {
    set.bound_model_ids()
        .into_iter()
        .map(|id| {
            let provider = id.split(['/', ':']).next().unwrap_or(id).to_string();
            (id.to_string(), provider)
        })
        .collect()
}

/// The window map a launch would push for `set`: [`TEST_CONTEXT_WINDOW`] for every model it
/// binds.
fn test_windows(set: &GgCapabilitySet) -> BTreeMap<String, u64> {
    set.bound_model_ids()
        .into_iter()
        .map(|id| (id.to_string(), TEST_CONTEXT_WINDOW))
        .collect()
}

/// The catalog-pushed window map for one model, as a launch supplies it.
fn windows(model_id: &str, window: u64) -> BTreeMap<String, u64> {
    BTreeMap::from([(model_id.to_string(), window)])
}

/// Seed the default-skills directory (`.gg/skills`) in `dir` with the skill the default
/// mock script reads, so an offline run exercises the skills capability end to end.
fn seed_default_skill(dir: &Path) {
    let skills_dir = dir.join(".gg").join("skills");
    std::fs::create_dir_all(&skills_dir).unwrap();
    std::fs::write(
        skills_dir.join(format!("{DEFAULT_MOCK_SKILL}.md")),
        format!(
            "---\nname: {DEFAULT_MOCK_SKILL}\ndescription: How to get started building the game.\n---\n\nStart by scaffolding an index.html with a canvas and a game loop.\n"
        ),
    )
    .unwrap();
}

/// A [`ContextSetup`] for the `drive` unit tests: the cheap heuristic estimator (so the
/// tests never build the BPE vocab) and a fixed window. The per-turn breakdown and message
/// log are always emitted — context visibility is intrinsic, not a toggle.
fn test_context_setup() -> ContextSetup {
    ContextSetup {
        estimator: Arc::new(HeuristicTokenEstimator::new()),
        window_limit: Some(128_000),
    }
}

/// A [`ContextSetup`] with a chosen window limit, so a `drive` test can make a short mock
/// run cross a compaction boundary by shrinking the window.
fn test_context_setup_with_window(window_limit: u64) -> ContextSetup {
    ContextSetup {
        estimator: Arc::new(HeuristicTokenEstimator::new()),
        window_limit: Some(window_limit),
    }
}

/// A [`LimitsSetup`] bounding a `drive` test by `max_turns` and nothing else: no wall-clock budget,
/// none of the three configurable [ceilings](crate::limits::RunLimits), and its own unshared
/// [spend](crate::limits::RunSpend).
///
/// This is what every test in this file that is *not* about a ceiling wants: a plainly turn-bounded
/// loop with no error or cost ceiling to complicate it. It builds [`RunLimits`] directly rather than
/// through the resolver, so it is deliberately free of the error ceilings a real run arms by default
/// — those are driven, through the resolver, in `agent.limits.test.rs`.
fn no_limits(max_turns: usize) -> LimitsSetup {
    LimitsSetup {
        limits: RunLimits {
            max_turns: Some(max_turns),
            max_runtime: None,
            model_call_timeout: crate::client::DEFAULT_MODEL_CALL_TIMEOUT,
            max_consecutive_errors: None,
            error_rate: None,
            max_cost: None,
            replay_max_bytes: None,
            retry_policy: crate::client::RetryPolicy::default(),
        },
        deadline: None,
        cancel: CancelWatch::disabled(),
        fault: FaultLatch::default(),
        ceiling: CeilingLatch::default(),
        spend: Arc::new(RunSpend::default()),
    }
}

/// [`no_limits`] with a wall-clock `deadline`, for the tests that end on one.
///
/// The budget is stated as well as the instant, because the breach the loop records reports the
/// budget as its threshold — a deadline with no declared budget would record a ceiling of zero.
fn no_limits_until(max_turns: usize, deadline: Instant) -> LimitsSetup {
    let mut limits = no_limits(max_turns);
    limits.limits.max_runtime = Some(std::time::Duration::from_secs(1));
    limits.deadline = Some(deadline);
    limits
}

/// A [`CodeSetup`] with responses-as-code **off** — the mode every `drive` test in this file runs
/// in. The code-shaped path is driven in `agent.sandbox.test.rs`, which pays a component compile
/// per test and therefore lives apart.
fn no_code() -> CodeSetup {
    CodeSetup {
        enabled: false,
        language: GgProgramLanguage::TypeScript,
        limits: SandboxLimits::AMPLE,
        doc_view_types: crate::docs::DocViewTypes::RETURN_AND_ERRORS,
    }
}

/// A run with **no hooks** — what almost every test drives, since a hook is an operator's addition
/// and the loop's behavior without one is the control every other case is read against.
fn no_hooks() -> HooksSetup {
    HooksSetup {
        runtime: Arc::new(HookRuntime::undeclared()),
        session: Arc::new(HookRuntime::undeclared()),
        agent: HookAgent::new(ROOT_AGENT_ID, ROOT_AGENT),
    }
}

/// A run whose only hook runs `command` when an agent tries to end its session — an
/// [agent-stop](GgHookEvent::AgentStop) gate on the ending.
fn stop_hook(command: &str) -> HooksSetup {
    // On the agent, not on the run: `agent-stop` is one of the eight events that fire because a
    // particular agent did something, so an agent is the only place it can be declared.
    let mut profile = GgAgentConfig::root();
    profile.hooks = vec![GgHook {
        event: GgHookEvent::AgentStop,
        action: GgHookAction::Command {
            command: command.to_string(),
            cwd: None,
            // A ceiling every gate in these fixtures passes under, stated because a command hook
            // states one: gg runs no hook under a ceiling nobody wrote.
            timeout_secs: Some(30.0),
            output: None,
        },
        name: "the gate".to_string(),
    }];
    HooksSetup {
        runtime: Arc::new(HookRuntime::resolve_agent(&profile, Path::new(".")).unwrap()),
        session: Arc::new(HookRuntime::undeclared()),
        agent: HookAgent::new(ROOT_AGENT_ID, ROOT_AGENT),
    }
}

/// A run in `dir` whose only hook is a **script** that runs when an agent opens its session — an
/// [agent-start](GgHookEvent::AgentStart) hook — and exits non-zero.
///
/// The counterpart of [`stop_hook`] at the other end of the loop, and the cheapest way to drive a
/// hook that *broke* rather than one that refused. Both halves of that sentence are load-bearing.
/// It is a script because a **command** hook's non-zero exit is a block, and only a script's is a
/// [failure](HookFailure) — a block on an event that cannot be blocked is a warning the run carries
/// on past. And it is the opening event because that one fires before the first turn is taken, so
/// the agent ends without a model call having happened at all.
fn broken_start_hook(dir: &Path) -> HooksSetup {
    let mut profile = GgAgentConfig::root();
    profile.hooks = vec![GgHook {
        event: GgHookEvent::AgentStart,
        action: GgHookAction::Custom {
            source: "#!/bin/sh\nexit 1\n".to_string(),
        },
        name: "the opening".to_string(),
    }];
    HooksSetup {
        runtime: Arc::new(HookRuntime::resolve_agent(&profile, dir).unwrap()),
        session: Arc::new(HookRuntime::undeclared()),
        agent: HookAgent::new(ROOT_AGENT_ID, ROOT_AGENT),
    }
}

/// A newtype letting a [`ScriptedFactory`] hand out clones of **one** shared [`MockClient`], so a
/// test can read its [`turns_taken`](MockClient::turns_taken) after the run.
///
/// The factory takes a closure returning a fresh boxed client per agent — deliberately, because a
/// real client owns per-agent state — so this is how a test keeps a handle on the one it scripted.
/// It is the only way to prove a loop *stopped*: the telemetry of a run that ended on a ceiling and
/// one that ran on and reported the ceiling afterwards are identical, and the number of times the
/// model was actually called is not.
struct SharedMockClient(Arc<MockClient>);

#[async_trait::async_trait]
impl ModelClient for SharedMockClient {
    async fn complete(
        &self,
        messages: &[Message],
        tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        self.0.complete(messages, tools).await
    }

    fn model_id(&self) -> &str {
        self.0.model_id()
    }
}

/// One model turn that submits `text` as its program — the shape a
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) turn takes: a `submit_program` tool call
/// whose `program` string is the program, with no assistant text beside it.
///
/// The call ids are minted from a process-wide counter so every scripted call is unique: the loop
/// answers each id with a tool result, and two calls sharing an id would make the recorded
/// conversation ambiguous about which result answers which call.
fn code_reply(text: &str) -> ModelResponse {
    static CALL_IDS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let id = CALL_IDS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    ModelResponse {
        text: None,
        tool_calls: vec![ToolCall {
            id: format!("submit-{id}"),
            name: crate::completion::SUBMIT_PROGRAM_TOOL.to_string(),
            arguments: serde_json::json!({ "program": text }),
        }],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts::default(),
        cost: None,
        provider: None,
        loop_aborts: LoopAborts::none(),
    }
}

/// Drive one root agent against `client` with every capability runtime disabled, so a test varies
/// only the two things it is about: the [ceilings](LimitsSetup) and the [execution mode](CodeSetup).
///
/// Calling [`Agent::drive`] rather than [`run_with_factory`] is deliberate where a test does not need
/// a whole session: it returns the [`LoopEnd`] (so the turn count and the breach are directly
/// observable rather than inferred from telemetry) and it skips the session-start sandbox warm-up,
/// which a test driving prose replies would otherwise pay a component compile for and never use.
async fn drive_root(
    client: &dyn ModelClient,
    dir: &Path,
    registry: &ToolRegistry,
    emitter: &Emitter,
    limits: LimitsSetup,
    code: CodeSetup,
) -> LoopEnd {
    let ctx = ToolContext::new(dir);
    Agent::root(ROOT_PROFILE_ID)
        .drive(
            client,
            "go",
            registry,
            &ctx,
            emitter,
            &mut test_modules(test_context_setup(), code.enabled)
                .with(ModuleHandle::Skills(SkillsRuntime::disabled()))
                .with(ModuleHandle::Memories(MemoriesRuntime::disabled()))
                .with(ModuleHandle::Tasks(TasksRuntime::disabled()))
                .with(ModuleHandle::Board(BoardRuntime::disabled())),
            DriveSetup {
                limits,
                compaction: no_compaction(),
                amc: no_amc(),
                autoload: no_autoload(),
                persistence: no_persistence(),
                read_policy: Some(ReadPolicy::Unlimited),
                shell_offload: OffloadPolicy::ample(),
                code,
                discovery: DiscoveryWarning::default(),
                hooks: no_hooks(),
                ending_role: EndingRole::Standard,
                opening: Opening::Fresh,
                carried_programs: None,
                turn_base: 0,
                replay: None,
            },
            &[],
            &GgAgentConfig::root(),
            &GgCapabilitySet::default(),
            &mut None,
            None,
        )
        .await
}

/// The [module set](ModuleSet) a `drive` call in these tests is given: an empty window measured by
/// `setup` (in `code_mode` when the test drives programs), and five disabled capability modules the
/// caller replaces with `.with(…)` for whichever ones its test is actually about.
///
/// It is the test-side counterpart of [`ModuleSet::resolve`]: the loop builds an agent's modules
/// from its profile, and a test that is about the loop rather than about a capability builds them
/// from nothing.
fn test_modules(setup: ContextSetup, code_mode: bool) -> ModuleSet {
    ModuleSet::inert(&HistorySetup {
        estimator: setup.estimator,
        window_limit: setup.window_limit,
        program_language: code_mode.then_some(GgProgramLanguage::TypeScript),
    })
}

/// The capability modules binding only the skill `library`, for a registry that must offer
/// `read_skill`.
fn skills_modules(library: &Arc<SkillLibrary>) -> CapabilityModules {
    CapabilityModules::inert().with(ModuleHandle::Skills(SkillsRuntime::new(Arc::clone(
        library,
    ))))
}

/// Every [`LimitExceeded`](GgTelemetryKind::LimitExceeded) breach in the stream, in order.
fn limit_breaches(events: &[GgTelemetryEvent]) -> Vec<GgLimitBreach> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::LimitExceeded { breach } => Some(breach.clone()),
            _ => None,
        })
        .collect()
}

/// Every `error`-level log message in the stream, in order — where a
/// [launch refusal](crate::validate) lands, and where every other defect only an operator can act
/// on is reported.
fn error_messages(events: &[GgTelemetryEvent]) -> Vec<String> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::Log { level, message } if level == "error" => Some(message.clone()),
            _ => None,
        })
        .collect()
}

/// Every `warn`-level log message in the stream, in order.
fn warn_messages(events: &[GgTelemetryEvent]) -> Vec<String> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::Log { level, message } if level == "warn" => Some(message.clone()),
            _ => None,
        })
        .collect()
}

/// A capability set with responses-as-code enabled on top of the minimal defaults, optionally with
/// the given params (for example a low `timeoutSecs` ceiling), bound to `model_id`.
///
/// The [language](crate::sandbox::PARAM_LANGUAGE) `params` does not name is filled in with
/// TypeScript by [`grant_configured`](crate::tools::grant_configured), which is where every fixture's
/// code agent gets it.
fn code_set(model_id: &str, params: serde_json::Value) -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal(model_id);
    crate::tools::grant_configured(
        &mut set.agents[0],
        crate::tools::configured(CAPABILITY_RESPONSES_AS_CODE, params),
    );
    set
}

/// The program every scripted code-mode run ends with, and the summary it ends with.
///
/// There is no prose turn that could end one and there cannot be: under this protocol every reply is
/// a program, so a reply that is not code is a failed turn rather than a conclusion.
const FINISHING_PROGRAM: &str = "import * as gg from \"gg\";\ngg.session.finish(\"done\");";
const FINISHING_SUMMARY: &str = "done";

/// An execution timeout short enough that a runaway loop trips it in a couple of seconds — so a
/// test exercising the ceiling costs that rather than the thirty the real default would take. It is
/// a wall-clock time in seconds, the unit the `timeoutSecs` param takes.
///
/// It has to leave room for one honest program as well as trip a dishonest one, because a code-mode
/// session's first program is gg's own: the [bootstrap](crate::bootstrap) runs under the agent's
/// configured [limits](crate::sandbox::SandboxLimits) like every other program, and a value that
/// stops it refuses the run before the test's own script is reached. What it measures is guest CPU
/// with time parked in a host call excluded, and the bootstrap's guest half is a loop over a dozen
/// calls, so the margin here is very wide and the ceiling still trips on the first `while (true)`.
const RUNAWAY_TIMEOUT_SECS: f64 = 2.0;

/// A client that plays a fixed script and **records the messages it was handed**, in order.
///
/// [`MockClient`] discards its input, which is exactly why the defect this exists to guard was
/// invisible to every other scenario here: a conversation gg builds can be *structurally invalid*
/// — a `tool`-role message answering a call no assistant turn made — and no assertion about
/// telemetry or workspace state can see it. A provider can, and rejects the whole request.
struct RecordingClient {
    /// The model this client is bound to.
    model_id: String,
    /// Which turn is next.
    turn: AtomicUsize,
    /// The scripted responses, one per turn.
    script: Vec<ModelResponse>,
    /// Every request's messages, in turn order.
    seen: Mutex<Vec<Vec<Message>>>,
}

impl RecordingClient {
    fn new(model_id: &str, script: Vec<ModelResponse>) -> Arc<Self> {
        Arc::new(Self {
            model_id: model_id.to_string(),
            turn: AtomicUsize::new(0),
            script,
            seen: Mutex::new(Vec::new()),
        })
    }

    /// The messages handed to the model on each turn, in order.
    fn requests(&self) -> Vec<Vec<Message>> {
        self.seen.lock().unwrap().clone()
    }
}

#[async_trait::async_trait]
impl ModelClient for RecordingClient {
    async fn complete(
        &self,
        messages: &[Message],
        _tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        self.seen.lock().unwrap().push(messages.to_vec());
        let turn = self.turn.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .script
            .get(turn)
            .cloned()
            .unwrap_or_else(|| code_reply(FINISHING_PROGRAM)))
    }

    fn model_id(&self) -> &str {
        &self.model_id
    }
}

/// A newtype letting the factory hand out clones of one [`RecordingClient`].
struct SharedRecordingClient(Arc<RecordingClient>);

#[async_trait::async_trait]
impl ModelClient for SharedRecordingClient {
    async fn complete(
        &self,
        messages: &[Message],
        tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        self.0.complete(messages, tools).await
    }

    fn model_id(&self) -> &str {
        self.0.model_id()
    }
}

/// Run `script` under `set` through a [`RecordingClient`], returning the outcome, the stream, and
/// the messages gg handed the model on each turn.
async fn drive_recorded_code_run(
    dir: &TempDir,
    set: GgCapabilitySet,
    script: Vec<ModelResponse>,
) -> (SessionOutcome, Vec<GgTelemetryEvent>, Vec<Vec<Message>>) {
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-code".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), set);
    let client = RecordingClient::new("mock/primary", script);
    let shared = Arc::clone(&client);
    let factory = ScriptedFactory::new().slot(ROOT_PROFILE_ID, move |_| {
        Box::new(SharedRecordingClient(Arc::clone(&shared)))
    });
    let outcome = run_with_factory(&inv, &emitter, Arc::new(factory)).await;
    (outcome, sink.events(), client.requests())
}

/// A disabled compaction setup — the `drive` tests that are not about compaction never
/// compact (matching a run without the opt-in capability).
fn no_compaction() -> CompactionSetup {
    compaction_setup(false, CompactionStrategy::HandoffSummarization, 1.0)
}

/// An enabled compaction setup whose trigger is `trigger_fullness`, condensing **out of band** on
/// the (mock-backed) summarizer — so a `drive` test that is not about an in-loop strategy crosses a
/// boundary without the compaction taking a turn from the agent. The trigger is not a standalone
/// knob — it is `1 - summaryHeadroom` — so this sets the headroom that yields the requested trigger.
fn compaction_at(trigger_fullness: f64) -> CompactionSetup {
    compaction_setup(
        true,
        CompactionStrategy::HandoffSummarization,
        trigger_fullness,
    )
}

/// An enabled compaction setup running `strategy`, for the `drive` e2es that exercise one of the
/// [in-loop](PendingCompaction) strategies end to end through the loop.
fn compaction_with(strategy: CompactionStrategy, trigger_fullness: f64) -> CompactionSetup {
    compaction_setup(true, strategy, trigger_fullness)
}

/// [`compaction_with`] carrying a retry allowance, for the `drive` e2es whose subject is a
/// compaction that cannot get the window back under its trigger.
fn compaction_retrying(
    strategy: CompactionStrategy,
    trigger_fullness: f64,
    max_retries: u64,
) -> CompactionSetup {
    let mut setup = compaction_setup(true, strategy, trigger_fullness);
    setup.policy.max_retries = max_retries;
    setup
}

/// The shared constructor behind the three above: a setup with no handoff client, so an out-of-band
/// condensation runs on the agent's own (mock) client.
fn compaction_setup(
    enabled: bool,
    strategy: CompactionStrategy,
    trigger_fullness: f64,
) -> CompactionSetup {
    CompactionSetup {
        enabled,
        policy: crate::compaction::CompactionPolicy {
            summary_headroom: 1.0 - trigger_fullness,
            // No retry allowance, which is what an absent `maxRetries` gives a real run: a
            // compaction that leaves the window over the threshold fails the agent, and a fixture
            // that trips this is a fixture whose window was never wide enough to work in.
            max_retries: 0,
        },
        strategy,
        summarizer: crate::compaction::resolve_summarizer(strategy),
        handoff_client: None,
    }
}

/// A disabled agent-managed-context setup — the `drive` tests that are not about
/// agent-managed context inject no usage signal and apply no reclaim tools.
fn no_amc() -> AmcSetup {
    AmcSetup {
        enabled: false,
        archive: Arc::new(Mutex::new(ArchiveStore::new())),
        archive_id: "archive-0".to_string(),
        can_evict: false,
        program_language: None,
        can_close_views: false,
        can_archive: false,
        top_file_views: 0,
        signal_threshold_percent: 0,
    }
}

/// The autoload-specifications setup with the capability **off** — every `drive` e2e that is not
/// exercising autoload passes this (paired with an empty provided-files slice).
fn no_autoload() -> AutoloadSetup {
    AutoloadSetup {
        enabled: false,
        locked: false,
        images: false,
    }
}

/// The agent-persistence setup with the capability **off** — every `drive` e2e that is not exercising
/// persistence passes this, so nothing is carried into the opening window or recorded out of it.
fn no_persistence() -> PersistenceSetup {
    PersistenceSetup::disabled()
}

/// An enabled agent-managed-context setup sharing `archive` with a registry's `search_archive`
/// tool, so a `drive` e2e can archive and then recover.
fn amc_with(archive: Arc<Mutex<ArchiveStore>>) -> AmcSetup {
    AmcSetup {
        enabled: true,
        archive,
        archive_id: "archive-0".to_string(),
        can_evict: true,
        // These `drive` e2es are tool-calling agents, so there is no `view` object to point at.
        program_language: None,
        can_close_views: false,
        can_archive: true,
        // The block on every turn: an e2e that archives and then reads the band fall would
        // otherwise have to fill three quarters of a window first.
        signal_threshold_percent: 0,
        top_file_views: 5,
    }
}

/// A model response that keeps asking for a harmless tool call, so a loop driving it
/// only ends by hitting a bound.
fn looping_response() -> ModelResponse {
    ModelResponse {
        text: Some("still working".to_string()),
        tool_calls: vec![ToolCall {
            id: "call_ls".to_string(),
            name: "list_dir".to_string(),
            arguments: json!({ "path": "." }),
        }],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts::default(),
        cost: None,
        provider: None,
        loop_aborts: LoopAborts::none(),
    }
}

/// How a [`FailingClient`] fails — one per class the loop distinguishes.
#[derive(Debug, Clone, Copy)]
enum FailureMode {
    /// A transient failure the client already retried to exhaustion.
    Retryable,
    /// A non-auth fatal status: the model was reached, the request was refused.
    Fatal,
    /// A refused credential — the class that must not be scored against the model.
    Auth,
    /// Every attempt degenerated into a [generation loop](crate::loopguard) and was discarded, so
    /// the client ran out of attempts with nothing to show for them. Retryable-exhausted like
    /// [`Retryable`](Self::Retryable), and deliberately reported under its own name: "retries
    /// exhausted" would send an operator looking for a provider outage that never happened.
    Looping,
    /// The gateway answered from a provider other than the pin.
    ProviderMismatch,
}

/// A [`ModelClient`] whose every turn fails, for asserting the loop surfaces model
/// errors loudly rather than discarding the run.
struct FailingClient {
    mode: FailureMode,
}

#[async_trait::async_trait]
impl ModelClient for FailingClient {
    async fn complete(
        &self,
        _messages: &[Message],
        _tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        match self.mode {
            FailureMode::Retryable => Err(ModelError::RetryExhausted {
                attempts: 4,
                last: "429 too many requests".to_string(),
            }),
            FailureMode::Fatal => Err(ModelError::Fatal {
                status: 400,
                message: "not a valid model id".to_string(),
            }),
            FailureMode::Auth => Err(ModelError::Fatal {
                status: 401,
                message: r#"{"error":{"message":"User not found.","code":401}}"#.to_string(),
            }),
            FailureMode::Looping => Err(ModelError::ResponseLoop {
                discarded: LoopAborts {
                    attempts: 3,
                    words: 9_195,
                    chars: 58_400,
                },
                detail: "2 words repeated across 3000 consecutive words, 3065 words into the reply"
                    .to_string(),
            }),
            FailureMode::ProviderMismatch => Err(ModelError::ProviderMismatch {
                pinned: "OpenAI".to_string(),
                served: "Azure".to_string(),
            }),
        }
    }

    fn model_id(&self) -> &str {
        "mock/failing"
    }
}

/// A [`ModelClient`] that returns a single `write_file` tool call on its first turn, then fails
/// every subsequent turn with a fatal model error — so an agent driving it writes one file and then
/// ends in `model_error` (a non-clean completion).
struct WriteThenFailClient {
    path: String,
    contents: String,
    cursor: std::sync::atomic::AtomicUsize,
}

impl WriteThenFailClient {
    fn new(path: &str, contents: &str) -> Self {
        Self {
            path: path.to_string(),
            contents: contents.to_string(),
            cursor: std::sync::atomic::AtomicUsize::new(0),
        }
    }
}

#[async_trait::async_trait]
impl ModelClient for WriteThenFailClient {
    async fn complete(
        &self,
        _messages: &[Message],
        _tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        let turn = self
            .cursor
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if turn == 0 {
            Ok(ModelResponse {
                text: Some("Writing throwaway work.".to_string()),
                tool_calls: vec![ToolCall {
                    id: "call_child_write".to_string(),
                    name: "write_file".to_string(),
                    arguments: json!({ "path": self.path, "contents": self.contents }),
                }],
                finish_reason: FinishReason::ToolCalls,
                usage: TokenCounts::default(),
                cost: None,
                provider: None,
                loop_aborts: LoopAborts::none(),
            })
        } else {
            Err(ModelError::Fatal {
                status: 500,
                message: "the subagent's model failed mid-task".to_string(),
            })
        }
    }

    fn model_id(&self) -> &str {
        "mock/subagent"
    }
}

// ---------------------------------------------------------------------------
// The full loop, end to end against the scripted mock
// ---------------------------------------------------------------------------

/// Driving the default mock through `run` writes `index.html` to the real workspace
/// and emits a well-formed, ordered telemetry stream that terminates.
#[tokio::test]
async fn run_drives_the_mock_end_to_end_and_writes_the_file() {
    let dir = TempDir::new().unwrap();
    // Seed the skill the default mock script reads so the run exercises the skills
    // capability (a pinned skill read + its telemetry) alongside the file write.
    seed_default_skill(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-e2e".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/echo"));

    let outcome = run(&inv, &emitter).await;
    assert_eq!(outcome, SessionOutcome::Ran);

    // (a) the scripted write_file call actually created the file on disk.
    assert!(
        dir.path().join("index.html").exists(),
        "the mock's write_file call should have created index.html"
    );

    let events = sink.events();

    // (b) the stream is well-formed and ordered: SessionStarted first, a
    // write_file ToolCall before its successful ToolResult, and SessionEnded last.
    // gg announces its capability set on the very first event, so a console watching
    // the stream can shape itself to the run before anything else arrives.
    assert!(matches!(
        &events.first().unwrap().kind,
        GgTelemetryKind::SessionStarted {
            capability_set: set,
            ..
        } if **set == inv.capability_set
    ));
    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));

    let first_turn = events
        .iter()
        .position(|e| matches!(e.kind, GgTelemetryKind::TurnStarted {}))
        .expect("a turn started");
    let call = events
        .iter()
        .position(
            |e| matches!(&e.kind, GgTelemetryKind::ToolCall { name, .. } if name == "write_file"),
        )
        .expect("a write_file tool call");
    let result = events
        .iter()
        .position(|e| {
            matches!(&e.kind, GgTelemetryKind::ToolResult { name, ok, .. } if name == "write_file" && *ok)
        })
        .expect("a successful write_file result");
    assert!(first_turn < call, "the turn starts before the tool call");
    assert!(call < result, "the tool call precedes its result");

    // Usage was reported and every event is stamped with the session id.
    assert!(
        events
            .iter()
            .any(|e| matches!(e.kind, GgTelemetryKind::Usage { .. }))
    );
    assert!(
        events
            .iter()
            .all(|e| e.session_id.as_deref() == Some("run-e2e"))
    );

    // (c) the loop terminated: exactly one SessionEnded, and it is the final event.
    assert_eq!(
        events
            .iter()
            .filter(|e| matches!(e.kind, GgTelemetryKind::SessionEnded { .. }))
            .count(),
        1
    );

    // (d) the skills capability fired: the seeded skill was read successfully, and a
    // SkillsState event reports it read.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok, .. } if name == "read_skill" && *ok
        )),
        "the seeded skill should have been read successfully"
    );
    let read_states: Vec<_> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::SkillsState { skills, .. } => Some(skills),
            _ => None,
        })
        .collect();
    assert!(!read_states.is_empty(), "a SkillsState should be emitted");
    assert!(
        read_states
            .last()
            .unwrap()
            .iter()
            .any(|s| { s.name == DEFAULT_MOCK_SKILL && s.read }),
        "the read skill should be marked read in the latest SkillsState"
    );

    // (e) the read skill's body is pinned into the window: a later ContextBreakdown
    // attributes tokens to the Skill source.
    let last_breakdown_skill_tokens = events
        .iter()
        .rev()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } => Some(
                by_source
                    .iter()
                    .find(|b| b.source == GgContextSource::Skill)
                    .map(|b| b.tokens)
                    .unwrap_or(0),
            ),
            _ => None,
        })
        .expect("a context breakdown was emitted");
    assert!(
        last_breakdown_skill_tokens > 0,
        "the pinned skill body should be accounted to the Skill source"
    );

    // (f) the memories capability fired: the scripted memory was written, a MemoryState
    // reports it, and a later ContextBreakdown attributes tokens to the Memory source.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok, .. } if name == "write_memory" && *ok
        )),
        "the scripted memory should have been written successfully"
    );
    let memory_states: Vec<_> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::MemoryState { memories, .. } => Some(memories),
            _ => None,
        })
        .collect();
    assert!(!memory_states.is_empty(), "a MemoryState should be emitted");
    assert!(
        memory_states
            .last()
            .unwrap()
            .iter()
            .any(|m| m.name == DEFAULT_MOCK_MEMORY),
        "the written memory should appear in the latest MemoryState"
    );
    // The write is also recorded as a revision — the append-only half of the record,
    // which is what survives the memory later being deleted.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::MemoryRevision { name, revision, .. }
                if name == DEFAULT_MOCK_MEMORY && *revision == 1
        )),
        "the write should be recorded as revision 1"
    );
    // Nothing is charged to the Memory band: this run never compacts, so the pinned
    // block was never rebuilt, and the model read its own write out of the thread.
    assert_eq!(
        memory_band_tokens(&events),
        0,
        "the memory block is rebuilt at a compaction boundary, and this run has none"
    );

    // (g) the tasks capability fired: both tasks were added, the cycle-inducing edge was
    // refused (the DAG guard), and a later TasksState reflects the DAG.
    let add_task_oks: Vec<bool> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::ToolResult { name, ok, .. } if name == "add_task" => Some(*ok),
            _ => None,
        })
        .collect();
    assert_eq!(
        add_task_oks,
        vec![true, true],
        "both scripted tasks should be added"
    );
    // The intentional cycle (set_blocked_by scaffold <- movement) is refused.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok: false, summary: Some(s), .. }
                if name == "set_blocked_by" && s.contains("cycle")
        )),
        "the cycle-inducing edge must be refused with a cycle explanation"
    );
    // The final TasksState carries both tasks, with the movement task blocked by the
    // scaffold task and the scaffold task marked done.
    let last_tasks = events
        .iter()
        .rev()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::TasksState { tasks, .. } => Some(tasks.clone()),
            _ => None,
        })
        .expect("a TasksState was emitted");
    let scaffold = last_tasks
        .iter()
        .find(|t| t.id == DEFAULT_MOCK_TASK_SCAFFOLD)
        .expect("the scaffold task is present");
    let movement = last_tasks
        .iter()
        .find(|t| t.id == DEFAULT_MOCK_TASK_MOVEMENT)
        .expect("the movement task is present");
    assert_eq!(
        movement.blocked_by,
        vec![DEFAULT_MOCK_TASK_SCAFFOLD.to_string()],
        "movement stays blocked by scaffold; the cycle edge never applied"
    );
    assert_eq!(
        scaffold.status,
        test_cabinet_core::gg::GgTaskStatus::Done,
        "the scaffold task was completed"
    );
    // The pinned task list is accounted to the TaskList source.
    let last_breakdown_task_tokens = events
        .iter()
        .rev()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } => Some(
                by_source
                    .iter()
                    .find(|b| b.source == GgContextSource::TaskList)
                    .map(|b| b.tokens)
                    .unwrap_or(0),
            ),
            _ => None,
        })
        .expect("a context breakdown was emitted");
    assert!(
        last_breakdown_task_tokens > 0,
        "the pinned task list should be accounted to the TaskList source"
    );
}

// ---------------------------------------------------------------------------
// Launch failures (exit non-zero)
// ---------------------------------------------------------------------------

/// With no `primary` slot bound there is no model to run: the session ends with
/// `error` and reports a launch failure.
#[tokio::test]
async fn run_reports_launch_failure_when_no_slot_is_bound() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-x".to_string()), Box::new(sink.clone()));
    // The default set carries the Phase 0 capabilities but binds no slot.
    let inv = invocation(dir.path(), GgCapabilitySet::default());

    let outcome = run(&inv, &emitter).await;
    assert_eq!(outcome, SessionOutcome::HarnessError);

    let events = sink.events();
    // gg announces its capability set on the very first event, so a console watching
    // the stream can shape itself to the run before anything else arrives.
    assert!(matches!(
        &events.first().unwrap().kind,
        GgTelemetryKind::SessionStarted {
            capability_set: set,
            ..
        } if **set == inv.capability_set
    ));
    assert!(
        events
            .iter()
            .any(|e| matches!(&e.kind, GgTelemetryKind::Log { level, .. } if level == "error"))
    );
    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "error"
    ));
}

/// A bound model the launch pushed no context window for is a launch failure, not a run
/// against a guessed window: the session ends `error` before a single turn, naming the
/// model. This is what makes gg's absence of a fallback safe.
#[tokio::test]
async fn run_reports_launch_failure_when_a_model_has_no_context_window() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-x".to_string()), Box::new(sink.clone()));
    let mut inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/echo"));
    inv.model_windows.clear();

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::HarnessError);

    let events = sink.events();
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::Log { level, message } if level == "error" && message.contains("mock/echo")
        )),
        "the failure names the model with no window"
    );
    assert!(
        !events
            .iter()
            .any(|e| matches!(e.kind, GgTelemetryKind::TurnStarted {})),
        "no turn runs against a window gg had to invent"
    );
    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "error"
    ));
}

// ---------------------------------------------------------------------------
// Termination conditions of the driven loop
// ---------------------------------------------------------------------------

/// A model that never stops calling tools ends by hitting the turn ceiling.
#[tokio::test]
async fn drive_exhausts_the_turn_ceiling_when_the_model_never_stops() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/loop").root());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));

    let never_stops = MockClient::new("mock/loop", vec![looping_response(); 5]);
    let agent = Agent::root(ROOT_PROFILE_ID);
    let end = agent
        .drive(
            &never_stops,
            "go",
            &registry,
            &ctx,
            &emitter,
            &mut test_modules(test_context_setup(), no_code().enabled)
                .with(ModuleHandle::Skills(SkillsRuntime::disabled()))
                .with(ModuleHandle::Memories(MemoriesRuntime::disabled()))
                .with(ModuleHandle::Tasks(TasksRuntime::disabled()))
                .with(ModuleHandle::Board(BoardRuntime::disabled())),
            DriveSetup {
                limits: no_limits(2),
                compaction: no_compaction(),
                amc: no_amc(),
                autoload: no_autoload(),
                persistence: no_persistence(),
                read_policy: Some(ReadPolicy::Unlimited),
                shell_offload: OffloadPolicy::ample(),
                code: no_code(),
                discovery: DiscoveryWarning::default(),
                hooks: no_hooks(),
                ending_role: EndingRole::Standard,
                opening: Opening::Fresh,
                carried_programs: None,
                turn_base: 0,
                replay: None,
            },
            &[],
            &GgAgentConfig::root(),
            &GgCapabilitySet::default(),
            &mut None,
            None,
        )
        .await;

    assert_eq!(end.status, "exhausted");
    assert_eq!(end.turns, 2);
    // Two turns were actually run.
    assert_eq!(
        sink.events()
            .iter()
            .filter(|e| matches!(e.kind, GgTelemetryKind::TurnStarted {}))
            .count(),
        2
    );
}

/// A deadline already in the past ends the loop with `timed_out` before any model
/// call is made.
#[tokio::test]
async fn drive_times_out_at_a_passed_deadline() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/loop").root());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));

    let client = MockClient::with_default_script("mock/echo");
    let agent = Agent::root(ROOT_PROFILE_ID);
    let end = agent
        .drive(
            &client,
            "go",
            &registry,
            &ctx,
            &emitter,
            &mut test_modules(test_context_setup(), no_code().enabled)
                .with(ModuleHandle::Skills(SkillsRuntime::disabled()))
                .with(ModuleHandle::Memories(MemoriesRuntime::disabled()))
                .with(ModuleHandle::Tasks(TasksRuntime::disabled()))
                .with(ModuleHandle::Board(BoardRuntime::disabled())),
            DriveSetup {
                limits: no_limits_until(50, Instant::now()),
                compaction: no_compaction(),
                amc: no_amc(),
                autoload: no_autoload(),
                persistence: no_persistence(),
                read_policy: Some(ReadPolicy::Unlimited),
                shell_offload: OffloadPolicy::ample(),
                code: no_code(),
                discovery: DiscoveryWarning::default(),
                hooks: no_hooks(),
                ending_role: EndingRole::Standard,
                opening: Opening::Fresh,
                carried_programs: None,
                turn_base: 0,
                replay: None,
            },
            &[],
            &GgAgentConfig::root(),
            &GgCapabilitySet::default(),
            &mut None,
            None,
        )
        .await;

    assert_eq!(end.status, "timed_out");
    assert_eq!(end.turns, 0);
    // No model turn ran.
    assert!(
        !sink
            .events()
            .iter()
            .any(|e| matches!(e.kind, GgTelemetryKind::TurnStarted {}))
    );
}

/// A fatal model turn ends the session loudly — an `error` log plus a `model_error`
/// status — not silently.
#[tokio::test]
async fn drive_ends_model_error_loudly_on_a_fatal_turn() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/x").root());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));

    let client = FailingClient {
        mode: FailureMode::Fatal,
    };
    let agent = Agent::root(ROOT_PROFILE_ID);
    let end = agent
        .drive(
            &client,
            "go",
            &registry,
            &ctx,
            &emitter,
            &mut test_modules(test_context_setup(), no_code().enabled)
                .with(ModuleHandle::Skills(SkillsRuntime::disabled()))
                .with(ModuleHandle::Memories(MemoriesRuntime::disabled()))
                .with(ModuleHandle::Tasks(TasksRuntime::disabled()))
                .with(ModuleHandle::Board(BoardRuntime::disabled())),
            DriveSetup {
                limits: no_limits(5),
                compaction: no_compaction(),
                amc: no_amc(),
                autoload: no_autoload(),
                persistence: no_persistence(),
                read_policy: Some(ReadPolicy::Unlimited),
                shell_offload: OffloadPolicy::ample(),
                code: no_code(),
                discovery: DiscoveryWarning::default(),
                hooks: no_hooks(),
                ending_role: EndingRole::Standard,
                opening: Opening::Fresh,
                carried_programs: None,
                turn_base: 0,
                replay: None,
            },
            &[],
            &GgAgentConfig::root(),
            &GgCapabilitySet::default(),
            &mut None,
            None,
        )
        .await;

    assert_eq!(end.status, "model_error");
    // The failed turn is counted: it was a model call the run made and paid for, and the loop's
    // accounting records exactly one outcome per model call however that call went.
    assert_eq!(end.turns, 1);
    assert!(
        sink.events()
            .iter()
            .any(|e| matches!(&e.kind, GgTelemetryKind::Log { level, .. } if level == "error")),
        "a fatal turn must be logged at error level, not swallowed"
    );
}

// ---------------------------------------------------------------------------------------------
// Completion strategies (tool-calling): the signal (plain-text vs explicit `finish`) and the
// optional validation gate. The responses-as-code side of the same machinery lives in
// `agent.sandbox.test.rs`.
// ---------------------------------------------------------------------------------------------

/// A model turn that calls one of the [ending](EndingRole) tools with `arguments`.
fn ending_call(id: &str, name: &str, arguments: serde_json::Value) -> ModelResponse {
    ModelResponse {
        text: Some("ending".to_string()),
        tool_calls: vec![ToolCall {
            id: id.to_string(),
            name: name.to_string(),
            arguments,
        }],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts::default(),
        cost: None,
        provider: None,
        loop_aborts: LoopAborts::none(),
    }
}

/// A turn that calls `finish` with `summary`.
fn finish_call(id: &str, summary: &str) -> ModelResponse {
    ending_call(id, "finish", json!({ "summary": summary }))
}

/// [`drive_root`] with a caller-chosen [`CompletionSetup`] and [`EndingRole`], so a test can drive a
/// validated ending or a role that ends with something other than `finish`. The profile stays a bare
/// Root — how an agent ends is its dispatched role's business, never its profile's.
#[allow(clippy::too_many_arguments)]
async fn drive_hooked(
    client: &dyn ModelClient,
    dir: &Path,
    registry: &ToolRegistry,
    emitter: &Emitter,
    limits: LimitsSetup,
    hooks: HooksSetup,
    ending_role: EndingRole,
) -> LoopEnd {
    let ctx = ToolContext::new(dir);
    Agent::root(ROOT_PROFILE_ID)
        .drive(
            client,
            "go",
            registry,
            &ctx,
            emitter,
            &mut test_modules(test_context_setup(), no_code().enabled)
                .with(ModuleHandle::Skills(SkillsRuntime::disabled()))
                .with(ModuleHandle::Memories(MemoriesRuntime::disabled()))
                .with(ModuleHandle::Tasks(TasksRuntime::disabled()))
                .with(ModuleHandle::Board(BoardRuntime::disabled())),
            DriveSetup {
                limits,
                compaction: no_compaction(),
                amc: no_amc(),
                autoload: no_autoload(),
                persistence: no_persistence(),
                read_policy: Some(ReadPolicy::Unlimited),
                shell_offload: OffloadPolicy::ample(),
                code: no_code(),
                discovery: DiscoveryWarning::default(),
                hooks,
                ending_role,
                opening: Opening::Fresh,
                carried_programs: None,
                turn_base: 0,
                replay: None,
            },
            &[],
            &GgAgentConfig::root(),
            &GgCapabilitySet::default(),
            &mut None,
            None,
        )
        .await
}

/// A text-only reply does NOT end a session — it is an error turn. The session ends only when the
/// model makes its ending call, and that call's declaration is the session's final text.
#[tokio::test]
async fn a_session_ends_on_an_ending_call_and_not_on_text() {
    let dir = TempDir::new().unwrap();
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/x").root());
    let emitter = Emitter::with_sink(None, Box::new(CollectingSink::new()));

    // Turn 1 is text-only (an error, not a conclusion); turn 2 calls `finish`.
    let client = MockClient::new(
        "mock/x",
        vec![text_only_response(), finish_call("f1", "all done")],
    );
    let end = drive_hooked(
        &client,
        dir.path(),
        &registry,
        &emitter,
        no_limits(5),
        no_hooks(),
        EndingRole::Standard,
    )
    .await;

    assert_eq!(end.status, "completed");
    assert_eq!(end.turns, 2, "the text-only turn did not end the session");
    assert_eq!(end.final_text.as_deref(), Some("all done"));
    assert_eq!(
        end.ending,
        Some(Ending::Finished {
            summary: "all done".to_string(),
        })
    );
}

/// Repeated text-only replies are counted as errors, so a consecutive-error ceiling stops the run
/// early rather than letting it loop to its turn budget.
#[tokio::test]
async fn repeated_text_only_replies_trip_the_error_ceiling() {
    let dir = TempDir::new().unwrap();
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/x").root());
    let emitter = Emitter::with_sink(None, Box::new(CollectingSink::new()));

    let mut limits = no_limits(20);
    limits.limits.max_consecutive_errors = Some(2);
    let client = MockClient::new(
        "mock/x",
        vec![
            text_only_response(),
            text_only_response(),
            text_only_response(),
        ],
    );
    let end = drive_hooked(
        &client,
        dir.path(),
        &registry,
        &emitter,
        limits,
        no_hooks(),
        EndingRole::Standard,
    )
    .await;

    assert_eq!(
        end.status, "limit_exceeded",
        "two text-only errors breach the ceiling"
    );
    assert_eq!(end.turns, 2);
    assert_eq!(
        client.turns_taken(),
        2,
        "the run stopped after two turns rather than looping to its turn budget",
    );
}

/// A reviewer is offered `approve`/`request_changes` and **not** `finish`, and its approval comes
/// back as a structured verdict rather than as text somebody has to read a marker out of.
#[tokio::test]
async fn a_reviewer_ends_with_a_verdict_and_has_no_finish() {
    let dir = TempDir::new().unwrap();
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/x").root());
    let emitter = Emitter::with_sink(None, Box::new(CollectingSink::new()));

    let client = MockClient::new("mock/x", vec![ending_call("a1", "approve", json!({}))]);
    let end = drive_hooked(
        &client,
        dir.path(),
        &registry,
        &emitter,
        no_limits(5),
        no_hooks(),
        EndingRole::Review,
    )
    .await;

    assert_eq!(end.status, "completed");
    assert_eq!(end.ending, Some(Ending::Approved));
    let offered = client.last_tool_names();
    assert!(
        offered.contains(&"approve".to_string())
            && offered.contains(&"request_changes".to_string()),
        "a reviewer is offered both verdicts: {offered:?}"
    );
    assert!(
        !offered.contains(&"finish".to_string()),
        "a reviewer has no `finish` — \"the work is complete\" is not a verdict: {offered:?}",
    );
}

/// A reviewer that requests changes without naming any is **refused**, and the session continues so
/// it can answer properly. This is the defect the typed verdict exists to remove: the old contract
/// let a reviewer reject work and list nothing, and the fixing agent was then dispatched with a
/// synthesized "re-check the criteria" item that told it nothing.
#[tokio::test]
async fn a_reviewer_cannot_request_changes_without_naming_any() {
    let dir = TempDir::new().unwrap();
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/x").root());
    let emitter = Emitter::with_sink(None, Box::new(CollectingSink::new()));

    let client = MockClient::new(
        "mock/x",
        vec![
            ending_call("r1", "request_changes", json!({ "items": [] })),
            ending_call(
                "r2",
                "request_changes",
                json!({ "items": ["`step()` is off by one"] }),
            ),
        ],
    );
    let end = drive_hooked(
        &client,
        dir.path(),
        &registry,
        &emitter,
        no_limits(5),
        no_hooks(),
        EndingRole::Review,
    )
    .await;

    assert_eq!(end.turns, 2, "the empty verdict did not end the session");
    assert_eq!(
        end.ending,
        Some(Ending::ChangesRequested {
            items: vec!["`step()` is off by one".to_string()],
        })
    );
}

/// An ending whose [agent-stop](GgHookEvent::AgentStop) hook passes ends the session — the
/// unchanged control the blocking case below is read against.
#[tokio::test]
async fn an_ending_passes_its_stop_hook() {
    let dir = TempDir::new().unwrap();
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/x").root());
    let emitter = Emitter::with_sink(None, Box::new(CollectingSink::new()));

    let client = MockClient::new("mock/x", vec![finish_call("f1", "all done")]);
    let end = drive_hooked(
        &client,
        dir.path(),
        &registry,
        &emitter,
        no_limits(5),
        stop_hook("true"),
        EndingRole::Standard,
    )
    .await;

    assert_eq!(end.status, "completed");
    assert_eq!(end.turns, 1);
}

/// An ending a hook blocks does NOT end the session: the refusal is fed back and the run continues,
/// so a run that can never satisfy the gate stops on its turn ceiling instead.
///
/// The gate's whole point is that it is *survivable*: a blocked ending must be a message the model
/// can act on, never a run-ending failure.
#[tokio::test]
async fn an_ending_is_blocked_by_a_failing_stop_hook() {
    let dir = TempDir::new().unwrap();
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/x").root());
    let emitter = Emitter::with_sink(None, Box::new(CollectingSink::new()));

    let client = MockClient::new(
        "mock/x",
        vec![finish_call("f1", "all done"), finish_call("f2", "all done")],
    );
    let end = drive_hooked(
        &client,
        dir.path(),
        &registry,
        &emitter,
        no_limits(2),
        stop_hook("false"),
        EndingRole::Standard,
    )
    .await;

    assert_eq!(
        end.status, "exhausted",
        "a blocking stop hook never lets the session end"
    );
    assert_eq!(end.turns, 2);
    assert_eq!(
        client.turns_taken(),
        2,
        "the ending was rejected and the run continued to the next turn",
    );
}

/// A retry-exhausted transient failure ends the same way — the client already
/// exhausted its own retries, so the loop ends the session rather than discarding it.
#[tokio::test]
async fn drive_ends_model_error_on_exhausted_retries() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/x").root());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));

    let client = FailingClient {
        mode: FailureMode::Retryable,
    };
    let agent = Agent::root(ROOT_PROFILE_ID);
    let end = agent
        .drive(
            &client,
            "go",
            &registry,
            &ctx,
            &emitter,
            &mut test_modules(test_context_setup(), no_code().enabled)
                .with(ModuleHandle::Skills(SkillsRuntime::disabled()))
                .with(ModuleHandle::Memories(MemoriesRuntime::disabled()))
                .with(ModuleHandle::Tasks(TasksRuntime::disabled()))
                .with(ModuleHandle::Board(BoardRuntime::disabled())),
            DriveSetup {
                limits: no_limits(5),
                compaction: no_compaction(),
                amc: no_amc(),
                autoload: no_autoload(),
                persistence: no_persistence(),
                read_policy: Some(ReadPolicy::Unlimited),
                shell_offload: OffloadPolicy::ample(),
                code: no_code(),
                discovery: DiscoveryWarning::default(),
                hooks: no_hooks(),
                ending_role: EndingRole::Standard,
                opening: Opening::Fresh,
                carried_programs: None,
                turn_base: 0,
                replay: None,
            },
            &[],
            &GgAgentConfig::root(),
            &GgCapabilitySet::default(),
            &mut None,
            None,
        )
        .await;

    assert_eq!(end.status, "model_error");
    assert!(
        sink.events()
            .iter()
            .any(|e| matches!(&e.kind, GgTelemetryKind::Log { level, .. } if level == "error"))
    );
}

/// A refused credential ends the session under its **own** status, not `model_error`:
/// nothing about the model was exercised, so the run must not be scored against it.
#[tokio::test]
async fn drive_ends_auth_error_when_the_credential_is_refused() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/x").root());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));

    let client = FailingClient {
        mode: FailureMode::Auth,
    };
    let agent = Agent::root(ROOT_PROFILE_ID);
    let end = agent
        .drive(
            &client,
            "go",
            &registry,
            &ctx,
            &emitter,
            &mut test_modules(test_context_setup(), no_code().enabled)
                .with(ModuleHandle::Skills(SkillsRuntime::disabled()))
                .with(ModuleHandle::Memories(MemoriesRuntime::disabled()))
                .with(ModuleHandle::Tasks(TasksRuntime::disabled()))
                .with(ModuleHandle::Board(BoardRuntime::disabled())),
            DriveSetup {
                limits: no_limits(5),
                compaction: no_compaction(),
                amc: no_amc(),
                autoload: no_autoload(),
                persistence: no_persistence(),
                read_policy: Some(ReadPolicy::Unlimited),
                shell_offload: OffloadPolicy::ample(),
                code: no_code(),
                discovery: DiscoveryWarning::default(),
                hooks: no_hooks(),
                ending_role: EndingRole::Standard,
                opening: Opening::Fresh,
                carried_programs: None,
                turn_base: 0,
                replay: None,
            },
            &[],
            &GgAgentConfig::root(),
            &GgCapabilitySet::default(),
            &mut None,
            None,
        )
        .await;

    assert_eq!(end.status, "auth_error");
    // Counted for the same reason a fatal turn is: one recorded outcome per model call made.
    assert_eq!(end.turns, 1);
    // Still surfaced loudly, and named for what it is — in the words of the turn error type it is
    // recorded as, so the sentence in the log and the row in the console cannot describe one
    // failure differently.
    let named = GgTurnErrorType::ModelAuth.label();
    assert!(
        sink.events().iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::Log { level, message } if level == "error"
                && message.contains(named)
        )),
        "an auth failure must be logged at error level and named"
    );
}

// ---------------------------------------------------------------------------
// Prompt and accounting helpers
// ---------------------------------------------------------------------------

/// Under responses-as-code the system prompt names the **modules** a program's surface is divided
/// into — one per module with a bound function — and no function at all. The module list is the only
/// vocabulary the prompt supplies, and the model finds a call by searching from it. The session
/// module is always named, since it carries the ending whatever a run enables. (What each
/// capability's section *says* is covered by the [prompt template tests](crate::prompts); this
/// covers the wiring from a run's registry into the rendering context.)
#[test]
fn system_prompt_names_the_modules_in_code_mode() {
    let runtimes = DisabledRuntimes::new();
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/x").root());
    let full = system_prompt(PromptInputs {
        program_language: Some(GgProgramLanguage::TypeScript),
        ..runtimes.inputs(&registry)
    });
    // The file and shell modules are present (the minimal set binds their tools); the session module
    // always is. The prompt teaches discovery, not a tool list.
    assert!(full.contains("`gg.files`"), "{full}");
    assert!(full.contains("`gg.shell`"), "{full}");
    assert!(full.contains("`gg.session`"), "{full}");
    assert!(full.contains("searching"), "{full}");
    assert!(full.contains("documentation view"), "{full}");
    // No function is spelled out in the prompt — not the one this run binds, and not the one that
    // reads documentation either.
    assert!(!full.contains("writeFile"), "{full}");
    assert!(!full.contains("write_file"), "{full}");
    assert!(!full.contains("openDocsView"), "{full}");

    // A run that enables nothing still has the session module (and so its ending), and no workspace
    // modules. It is the **profile** that is emptied rather than the registry: a program is offered
    // no tools at all, so what its module list is derived from is the agent's grant.
    let nothing = DisabledRuntimes::new().with_profile(GgAgentConfig {
        capabilities: Vec::new(),
        tools: Vec::new(),
        operations: Vec::new(),
        ..GgAgentConfig::root()
    });
    let empty_registry = ToolRegistry::from_capabilities(&nothing.profile);
    let empty = system_prompt(PromptInputs {
        program_language: Some(GgProgramLanguage::TypeScript),
        ..nothing.inputs(&empty_registry)
    });
    assert!(empty.contains("`gg.session`"), "{empty}");
    assert!(!empty.contains("`gg.files`"), "{empty}");
    assert!(!empty.contains("`gg.shell`"), "{empty}");
}

/// **A held module explains itself in the system prompt.**
///
/// The task list and the memories each contribute the capability's own section — the paragraphs
/// explaining what its store is for and what its ceilings are. What a
/// [strategy](crate::memories::MemoryStrategy) puts in the window *is* what having memories means
/// under it, and `keyword-search` is the arm that pins nothing. The property this asserts is that
/// a capability an agent has is a capability it is told it has.
#[test]
fn every_held_module_contributes_its_prompt_section() {
    let registry = ToolRegistry::from_capabilities(&GgAgentConfig::root());

    let held = DisabledRuntimes {
        tasks: Some(TasksRuntime::new(7)),
        memories: Some(MemoriesRuntime::new(
            crate::memories::MemoryStrategy::Scratchpad,
            crate::memories::MemoryCaps::UNBOUNDED,
        )),
        ..DisabledRuntimes::new()
    };
    let prompt = system_prompt(held.inputs(&registry));
    assert!(
        prompt.contains("add_task"),
        "the task list is explained: {prompt}"
    );
    assert!(
        prompt.contains("memor"),
        "and so are its memories: {prompt}"
    );
}

/// The system prompt states the run's `read_file` line cap — a per-run configuration value the
/// prompt interpolates rather than restating a default — and says nothing about reads when the
/// mode is uncapped.
#[test]
fn system_prompt_states_the_configured_read_cap() {
    let mut set = GgCapabilitySet::minimal("mock/x");
    let read_file = set.agents[0]
        .capabilities
        .iter_mut()
        .find(|cap| cap.id == CAPABILITY_READ_FILE)
        .expect("the minimal set offers read_file");
    read_file.implementation = Some("default-cap".to_string());
    read_file.params =
        crate::tools::configured(CAPABILITY_READ_FILE, json!({ "lineCap": 42 })).params;

    let library = Arc::new(SkillLibrary::empty());
    let registry = ToolRegistry::from_run(
        set.root(),
        &skills_modules(&library),
        &AgentFacts::default(),
    );
    let runtimes = DisabledRuntimes::new();
    let capped = system_prompt(PromptInputs {
        read_policy: read_policy(set.root()),
        ..runtimes.inputs(&registry)
    });
    assert!(
        capped.contains("42 lines per call unless you ask for more"),
        "{capped}"
    );

    // The default (unlimited) mode says nothing about a cap.
    let uncapped = system_prompt(runtimes.inputs(&registry));
    assert!(!uncapped.contains("42 lines"));
}

/// The four PNG magic bytes plus a little payload, so `sniff_image` recognizes it as a picture.
const FAKE_PNG: &[u8] = b"\x89PNG\r\n\x1a\nrest-of-the-file";

/// Autoloading seeds the provided files as `read_file` pairs the model did not have to
/// request: a synthesized assistant call per file, immediately answered by its contents (a
/// text spec as text, a reference mockup as an attached image), in the order provided.
#[tokio::test]
async fn autoload_seeds_the_provided_files_as_read_pairs() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("SPEC.md"), "# The spec\n\nBuild a game.\n").unwrap();
    std::fs::create_dir_all(dir.path().join("reference")).unwrap();
    std::fs::write(dir.path().join("reference").join("title.png"), FAKE_PNG).unwrap();

    let ctx = ToolContext::new(dir.path());

    let mut context = ContextModel::new(
        Arc::new(HeuristicTokenEstimator::new()),
        Some(100_000),
        false,
    );

    let provided = vec![
        PathBuf::from("SPEC.md"),
        PathBuf::from("reference/title.png"),
    ];
    autoload_specifications(
        &mut context,
        &mut crate::programs::ProgramLibrary::disabled(),
        &provided,
        &ctx,
        GgProgramLanguage::TypeScript,
        false,
        true,
    )
    .await
    .expect("every provided file is readable");

    // Two file views, in the order provided, tagged with their paths — ephemeral (not locked).
    let views: Vec<_> = context
        .items()
        .iter()
        .filter(|item| item.source() == GgContextSource::FileView)
        .collect();
    assert_eq!(views.len(), 2);
    assert!(views.iter().all(|v| v.retention() == Retention::Ephemeral));

    // The spec's full text is in the window, and the mockup is attached as a real image (the
    // offline default treats an unknown model as able to see one).
    let messages = context.messages();
    assert!(
        messages.iter().any(|m| m
            .content
            .as_deref()
            .is_some_and(|c| c.contains("Build a game."))),
        "the spec's contents are loaded"
    );
    assert!(
        messages.iter().any(|m| !m.images.is_empty()),
        "the reference mockup is attached as an image"
    );

    // Every synthesized `read_file` call is answered by a matching tool result — a well-formed
    // opening conversation, exactly as a real read would produce.
    let assistant_calls = context
        .items()
        .iter()
        .filter(|item| item.source() == GgContextSource::Assistant)
        .count();
    assert_eq!(assistant_calls, 2, "one read_file call per provided file");
}

/// **In code mode, autoload seeds through a program the model could have written.**
///
/// The counterpart of the test above, and the whole reason the two paths differ. A code turn's
/// assistant message is a *program* — it carries no `tool_calls`, and there is no `read_file`
/// function for a program to call — so a synthesized `tool_use` naming one would put a call in the
/// model's own mouth that it cannot make, quoting an id its assistant messages never carry. What it
/// gets instead is one program calling `view.openFile` per spec, and the file views that program
/// opened, arriving headed exactly as a real `view.openFile` would deliver them.
#[tokio::test]
async fn autoload_seeds_a_code_agent_with_a_submitted_program() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("SPEC.md"), "# The spec\n\nBuild a game.\n").unwrap();
    std::fs::create_dir_all(dir.path().join("reference")).unwrap();
    std::fs::write(dir.path().join("reference").join("title.png"), FAKE_PNG).unwrap();

    let ctx = ToolContext::new(dir.path());

    let mut context = ContextModel::new(
        Arc::new(HeuristicTokenEstimator::new()),
        Some(100_000),
        // The one difference from the test above.
        true,
    );

    let provided = vec![
        PathBuf::from("SPEC.md"),
        PathBuf::from("reference/title.png"),
    ];
    autoload_specifications(
        &mut context,
        &mut crate::programs::ProgramLibrary::disabled(),
        &provided,
        &ctx,
        GgProgramLanguage::TypeScript,
        false,
        true,
    )
    .await
    .expect("every provided file is readable");

    // One assistant turn, shaped exactly as the model's own turns must be: no text, one
    // `submit_program` call whose `program` string opens both files in seeding order.
    let assistant: Vec<&crate::model::Message> = context
        .items()
        .iter()
        .filter(|item| item.source() == GgContextSource::Assistant)
        .map(|item| item.message())
        .collect();
    assert_eq!(assistant.len(), 1, "one synthesized turn seeds every spec");
    assert_eq!(assistant[0].content, None);
    assert_eq!(assistant[0].tool_calls.len(), 1);
    let call = &assistant[0].tool_calls[0];
    assert_eq!(call.name, crate::completion::SUBMIT_PROGRAM_TOOL);
    assert_eq!(
        call.arguments.get("program").and_then(|v| v.as_str()),
        Some(
            "import { views } from \"gg\";\n\nviews.openFile(\"SPEC.md\");\nviews.openFile(\"reference/title.png\");\n"
        ),
        "one program opens every spec, in order"
    );

    // The call is answered by the fixed acknowledgement, directly after the assistant turn, so
    // the seeded transcript is a conversation every provider accepts.
    let acks: Vec<&crate::model::Message> = context
        .items()
        .iter()
        .map(|item| item.message())
        .filter(|message| message.role == crate::model::Role::Tool)
        .collect();
    assert_eq!(acks.len(), 1);
    assert_eq!(acks[0].tool_call_id.as_deref(), Some(call.id.as_str()));
    assert_eq!(
        acks[0].content.as_deref(),
        Some(crate::completion::SUBMIT_PROGRAM_ACK)
    );

    // The views arrive as headed `user` messages — what `view.openFile` pushes.
    let views: Vec<&crate::context::ContextItem> = context
        .items()
        .iter()
        .filter(|item| item.source() == GgContextSource::FileView)
        .collect();
    assert_eq!(views.len(), 2);
    assert!(
        views
            .iter()
            .all(|v| v.message().role == crate::model::Role::User),
        "a seeded view uses the same envelope a program's own view does"
    );
    // Headed like one: the workspace-relative path the case provided, and the lines shown — the
    // whole spec for a text file, the path alone for the mockup (a picture shows no lines).
    assert!(
        views[0]
            .message()
            .content
            .as_deref()
            .unwrap_or("")
            .starts_with("File: SPEC.md:1-3 of 3 lines\n----\n# The spec\n"),
        "{:?}",
        views[0].message().content
    );
    assert!(
        views[1]
            .message()
            .content
            .as_deref()
            .unwrap_or("")
            .starts_with("File: reference/title.png\n----\n"),
        "{:?}",
        views[1].message().content
    );
    assert_eq!(
        views.iter().filter_map(|v| v.label()).collect::<Vec<_>>(),
        vec!["SPEC.md", "reference/title.png"],
        "each keyed by its path, so `view.close` can name it"
    );
    // The specs are still read in full, and the mockup is still a picture.
    let messages = context.messages();
    assert!(
        messages.iter().any(|m| m
            .content
            .as_deref()
            .is_some_and(|c| c.contains("Build a game."))),
        "the spec's contents are loaded"
    );
    assert!(
        messages.iter().any(|m| !m.images.is_empty()),
        "the reference mockup is attached as an image"
    );
}

/// The default seeds a mockup as its description rather than its picture.
///
/// A picture is charged by its dimensions and charged again on every request the view survives, so
/// the file arriving without one is what keeps the seeding's cost proportional to the brief. The
/// view still arrives: the model has to know the mockup is there to read it.
#[tokio::test]
async fn autoload_seeds_a_mockup_without_its_picture_by_default() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("SPEC.md"), "# The spec\n\nBuild a game.\n").unwrap();
    std::fs::create_dir_all(dir.path().join("reference")).unwrap();
    std::fs::write(dir.path().join("reference").join("title.png"), FAKE_PNG).unwrap();

    let ctx = ToolContext::new(dir.path());
    let mut context = ContextModel::new(
        Arc::new(HeuristicTokenEstimator::new()),
        Some(100_000),
        false,
    );

    autoload_specifications(
        &mut context,
        &mut crate::programs::ProgramLibrary::disabled(),
        &[
            PathBuf::from("SPEC.md"),
            PathBuf::from("reference/title.png"),
        ],
        &ctx,
        GgProgramLanguage::TypeScript,
        false,
        false,
    )
    .await
    .expect("every provided file is readable");

    let messages = context.messages();
    assert!(
        messages.iter().all(|m| m.images.is_empty()),
        "no picture is attached when the capability does not ask for one"
    );
    // Both files still arrive, in the order provided, so the model knows the mockup exists.
    assert_eq!(
        context
            .items()
            .iter()
            .filter(|item| item.source() == GgContextSource::FileView)
            .map(|item| item.label())
            .collect::<Vec<_>>(),
        vec![Some("SPEC.md"), Some("reference/title.png")],
    );
    assert!(
        messages.iter().any(|m| m
            .content
            .as_deref()
            .is_some_and(|c| c.contains("Build a game."))),
        "the spec's contents are loaded either way"
    );
}

/// Asking for pictures on a model the catalog declared text-only seeds the description instead.
///
/// The param decides what gg offers; the model decides what it can be shown. Detected up front
/// from the declared modalities, so a text-only run wastes no request discovering it.
#[tokio::test]
async fn a_text_only_model_is_never_seeded_a_picture_even_when_images_are_asked_for() {
    let dir = TempDir::new().unwrap();
    std::fs::create_dir_all(dir.path().join("reference")).unwrap();
    std::fs::write(dir.path().join("reference").join("title.png"), FAKE_PNG).unwrap();

    let support = Arc::new(crate::vision::VisionSupport::new(BTreeMap::from([(
        "text-only-model".to_string(),
        vec!["text".to_string()],
    )])));
    let ctx = ToolContext::new(dir.path()).with_vision("text-only-model", support);

    let mut context = ContextModel::new(
        Arc::new(HeuristicTokenEstimator::new()),
        Some(100_000),
        false,
    );

    autoload_specifications(
        &mut context,
        &mut crate::programs::ProgramLibrary::disabled(),
        &[PathBuf::from("reference/title.png")],
        &ctx,
        GgProgramLanguage::TypeScript,
        false,
        true,
    )
    .await
    .expect("a mockup a model cannot see is described, not a failure to read");

    let messages = context.messages();
    assert!(
        messages.iter().all(|m| m.images.is_empty()),
        "a model declared without image input is never sent one"
    );
    assert_eq!(
        context
            .items()
            .iter()
            .filter(|item| item.source() == GgContextSource::FileView)
            .count(),
        1,
        "the mockup still takes its place in the seeded order"
    );
}

/// A **locked** code-mode seed is still pinned, which is the one thing `seed_file_view` adds over
/// the `view.openFile` path it otherwise reuses — that path hardcodes ephemeral, and `locked` is
/// exactly the setting that must not be.
#[tokio::test]
async fn a_locked_code_mode_seed_is_pinned() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("SPEC.md"), "the whole specification").unwrap();
    let ctx = ToolContext::new(dir.path());

    let mut context = ContextModel::new(Arc::new(HeuristicTokenEstimator::new()), None, true);

    autoload_specifications(
        &mut context,
        &mut crate::programs::ProgramLibrary::disabled(),
        &[PathBuf::from("SPEC.md")],
        &ctx,
        GgProgramLanguage::TypeScript,
        true,
        false,
    )
    .await
    .expect("every provided file is readable");

    assert!(
        context
            .items()
            .iter()
            .filter(|item| item.source() == GgContextSource::FileView)
            .all(|item| item.retention() == Retention::Pinned),
        "a locked spec is pinned on the code path too"
    );
}

/// Locked autoload pins the injected views, so they survive a compaction verbatim while an
/// unlocked one is summarized away.
#[tokio::test]
async fn locked_autoload_survives_compaction() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("SPEC.md"), "the whole specification").unwrap();
    let ctx = ToolContext::new(dir.path());

    let provided = vec![PathBuf::from("SPEC.md")];

    // Unlocked: the view is ephemeral, so a compaction drops it.
    let mut unlocked = ContextModel::new(
        Arc::new(HeuristicTokenEstimator::new()),
        Some(100_000),
        false,
    );
    unlocked.set_system("system");
    unlocked.push_user_prompt("build");
    autoload_specifications(
        &mut unlocked,
        &mut crate::programs::ProgramLibrary::disabled(),
        &provided,
        &ctx,
        GgProgramLanguage::TypeScript,
        false,
        false,
    )
    .await
    .expect("every provided file is readable");
    unlocked.clear_ephemeral();
    assert!(
        !unlocked
            .messages()
            .iter()
            .any(|m| m.content.as_deref() == Some("the whole specification")),
        "an unlocked spec is summarized away"
    );

    // Locked: the view is pinned, so it stays verbatim across the same compaction.
    let mut locked = ContextModel::new(
        Arc::new(HeuristicTokenEstimator::new()),
        Some(100_000),
        false,
    );
    locked.set_system("system");
    locked.push_user_prompt("build");
    autoload_specifications(
        &mut locked,
        &mut crate::programs::ProgramLibrary::disabled(),
        &provided,
        &ctx,
        GgProgramLanguage::TypeScript,
        true,
        false,
    )
    .await
    .expect("every provided file is readable");
    assert!(
        context_has_pinned_file_view(&locked),
        "a locked spec is pinned before compaction"
    );
    locked.clear_ephemeral();
    assert!(
        locked
            .messages()
            .iter()
            .any(|m| m.content.as_deref() == Some("the whole specification")),
        "a locked spec is kept across compaction"
    );
    // …and it is still attributable to the file it came from. Compaction re-frames the
    // retained `tool` message as a `user` one, which discards the `tool_call_id` pairing the
    // synthesized read was answered under; the item's path tag is what survives, so the
    // message log can still say which file this agent's biggest context band is.
    assert_eq!(
        locked
            .prompt_items()
            .filter(|item| item.source == GgContextSource::FileView)
            .map(|item| item.label)
            .collect::<Vec<_>>(),
        vec![Some("SPEC.md")],
    );
}

/// Whether `ctx` holds a pinned file view — a locked autoloaded spec.
fn context_has_pinned_file_view(ctx: &ContextModel) -> bool {
    ctx.items().iter().any(|item| {
        item.source() == GgContextSource::FileView && item.retention() == Retention::Pinned
    })
}

/// The system prompt states, up front, whether this run's model can be shown an image.
///
/// A test case's specs point at reference mockups, so the model *will* try to read one.
/// Telling it which world it is in is what keeps a text-only run from spending turns
/// re-reading a `.png` hoping for a different answer.
#[test]
fn system_prompt_states_whether_images_can_be_seen() {
    let set = GgCapabilitySet::minimal("mock/x");
    let library = Arc::new(SkillLibrary::empty());
    let registry = ToolRegistry::from_run(
        set.root(),
        &skills_modules(&library),
        &AgentFacts::default(),
    );

    let seeing = DisabledRuntimes::new();
    let prompt = system_prompt(seeing.inputs(&registry));
    assert!(prompt.contains("Reading images is supported."), "{prompt}");

    // A model the catalog declared text-only is told so, plainly — a fact about the run, stated
    // without narration about "the model you are running on".
    let blind = DisabledRuntimes::text_only("mock/x");
    let prompt = system_prompt(blind.inputs(&registry));
    assert!(
        prompt.contains("Reading images is not supported."),
        "{prompt}"
    );
}

/// With `read_file` withheld entirely, the prompt says nothing about images either way —
/// there is no tool that could show or describe one, so a claim about them would be noise.
#[test]
fn system_prompt_omits_image_guidance_without_read_file() {
    let mut set = GgCapabilitySet::minimal("mock/x");
    set.agents[0].tools.retain(|name| name != READ_FILE_TOOL);
    let library = Arc::new(SkillLibrary::empty());
    let registry = ToolRegistry::from_run(
        set.root(),
        &skills_modules(&library),
        &AgentFacts::default(),
    );

    let prompt = system_prompt(DisabledRuntimes::new().inputs(&registry));
    assert!(!prompt.contains("Reading images"), "{prompt}");
}

/// **The system prompt never describes the board, whoever holds the capability.**
///
/// The board is reachable through the board tools alone: what documents them is their own
/// schemas, delivered with the tools, and the prompt renders no project-management section and
/// no pinned board block for any profile. A prompt that taught the board would be a text gg
/// would have to keep agreeing with the toolset — and for an agent without the capability it
/// would name tools the model does not have.
#[test]
fn the_prompt_never_describes_the_board() {
    let library = Arc::new(SkillLibrary::empty());

    // An agent that may not author the board.
    let runtimes = DisabledRuntimes::new();
    let registry = ToolRegistry::from_run(
        &runtimes.profile,
        &skills_modules(&library).with(ModuleHandle::Board(BoardRuntime::new(
            BoardCaps::detached(),
        ))),
        &AgentFacts::default(),
    );
    let prompt = system_prompt(runtimes.inputs(&registry));
    assert!(
        !prompt.contains("create_issue") && !prompt.contains("Project management"),
        "an agent with no board capability reads nothing about the board:
{prompt}"
    );

    // The same run, for a profile that holds the capability: still no board section — the
    // tools are offered, and their schemas are the whole of what documents them.
    let mut authoring = DisabledRuntimes::new();
    crate::tools::grant(&mut authoring.profile, CAPABILITY_PROJECT_MANAGEMENT);
    let authoring_profile = authoring.profile.clone();
    let authoring = authoring.with_profile(authoring_profile);
    let registry = ToolRegistry::from_run(
        &authoring.profile,
        &skills_modules(&library).with(ModuleHandle::Board(BoardRuntime::new(
            BoardCaps::detached(),
        ))),
        &AgentFacts::default(),
    );
    let prompt = system_prompt(authoring.inputs(&registry));
    assert!(
        !prompt.contains("create_issue") && !prompt.contains("Project management"),
        "the capability's holder reads nothing about the board either:
{prompt}"
    );
}

/// An agent dispatched for a board issue is told, in its system prompt, which issue it is working
/// and where — even though (as an implementer) it may not author the board.
#[test]
fn the_assigned_issue_section_is_rendered_for_a_dispatched_agent() {
    let library = Arc::new(SkillLibrary::empty());
    let runtimes = DisabledRuntimes::new();
    let registry = ToolRegistry::from_run(
        &runtimes.profile,
        &skills_modules(&library),
        &AgentFacts::default(),
    );

    let mut inputs = runtimes.inputs(&registry);
    inputs.assigned_issue = Some("feat-7");
    let prompt = system_prompt(inputs);
    assert!(
        prompt.contains("You have been assigned issue `feat-7`."),
        "the prompt names the issue this agent is working:\n{prompt}"
    );
    assert!(
        flat(&prompt).contains("Implement it in the current worktree"),
        "and where the work is done:\n{prompt}"
    );

    // The same agent, undispatched: no such section.
    let plain = system_prompt(runtimes.inputs(&registry));
    assert!(
        !plain.contains("Your assigned issue"),
        "an agent with no assignment reads nothing about one:\n{plain}"
    );
}

/// Every capability runtime, disabled — owned by the caller so a prompt test can borrow
/// [`PromptInputs`] from it without binding four locals of its own.
struct DisabledRuntimes {
    skills: Option<SkillsRuntime>,
    memories: Option<MemoriesRuntime>,
    tasks: Option<TasksRuntime>,
    /// The vision context the prompt reads to decide whether to promise images. Owned here
    /// for the same reason as the runtimes: `PromptInputs` borrows it.
    vision: VisionContext,
    /// The agent profile the prompt renders for — a bare Root, since these prompt tests do not
    /// vary custom instructions or the delegation allowlist. Owned here so `PromptInputs` can
    /// borrow it.
    profile: GgAgentConfig,
    /// The API grant the prompt's module list is rendered from, resolved from
    /// [`profile`](Self::profile) exactly as the loop resolves it. Owned here for the same reason
    /// everything else is, and derived rather than written out so a test that changes the profile
    /// changes the surface with it — see [`with_profile`](Self::with_profile).
    granted_capabilities: Vec<String>,
    granted_operations: Vec<crate::sandbox::OperationId>,
    /// The set [`profile`](Self::profile) belongs to, so a roster entry can be resolved to the
    /// display name its menu reads with. Derived from the profile alongside the grant, for the
    /// same reason: a prompt rendered against a set that does not declare its own agent would
    /// describe a run that could not launch.
    set: GgCapabilitySet,
    // No `shell` output policy: the prompt describes nothing about a command's output any more, in
    // either mode, so `PromptInputs` has nothing to borrow one for.
}

impl DisabledRuntimes {
    /// Build every runtime in its disabled form.
    fn new() -> Self {
        Self {
            skills: Some(SkillsRuntime::disabled()),
            memories: Some(MemoriesRuntime::disabled()),
            tasks: Some(TasksRuntime::disabled()),
            // Nothing declared: the optimistic default, under which the prompt promises
            // the model it can see images.
            vision: VisionContext::unknown(),
            profile: GgAgentConfig::root(),
            granted_capabilities: Vec::new(),
            granted_operations: Vec::new(),
            set: GgCapabilitySet::default(),
        }
        .with_profile(GgAgentConfig::root())
    }

    /// The same base rendering for `profile`, with the API grant re-resolved from it.
    ///
    /// The two travel together because the loop resolves them together: a prompt reads what the
    /// agent was *granted*, not what its document says, so a fixture that set one without the other
    /// would render a surface no run could produce.
    fn with_profile(mut self, profile: GgAgentConfig) -> Self {
        let (operations, _) = crate::sandbox::granted_operations(
            &profile,
            &crate::modules::CapabilityModules::inert(),
            &crate::tools::AgentFacts::default(),
        );
        self.granted_capabilities = profile
            .capabilities
            .iter()
            .filter(|capability| capability.enabled)
            .map(|capability| capability.id.clone())
            .collect();
        self.granted_operations = operations;
        self.set = GgCapabilitySet {
            agents: vec![profile.clone()],
            ..GgCapabilitySet::default()
        };
        self.profile = profile;
        self
    }

    /// The same base, but with the model declared **text-only** — the arm in which the
    /// prompt must tell the model it cannot see images.
    fn text_only(model_id: &str) -> Self {
        let declared = BTreeMap::from([(model_id.to_string(), vec!["text".to_string()])]);
        Self {
            vision: VisionContext {
                model_id: model_id.to_string(),
                support: Arc::new(crate::vision::VisionSupport::new(declared)),
            },
            ..Self::new()
        }
    }

    /// [`PromptInputs`] over `registry` with every capability off — the base a prompt test
    /// varies one field of.
    fn inputs<'a>(&'a self, registry: &'a ToolRegistry) -> PromptInputs<'a> {
        PromptInputs {
            registry,
            skills: self.skills.as_ref().expect("built"),
            memories: self.memories.as_ref().expect("built"),
            tasks: self.tasks.as_ref().expect("built"),
            read_policy: Some(ReadPolicy::Unlimited),
            vision: &self.vision,
            program_language: None,
            granted_capabilities: &self.granted_capabilities,
            granted_operations: &self.granted_operations,
            program_library: false,
            autoload_specs: None,
            persistence: false,
            profile: &self.profile,
            set: &self.set,
            ending_role: EndingRole::Standard,
            assigned_issue: None,
        }
    }
}

/// Running totals sum reported classes and keep a class unknown only when neither
/// side reported it.
#[test]
fn add_counts_sums_reported_classes() {
    let a = TokenCounts {
        uncached_input: Some(10),
        cached_input: None,
        output: Some(5),
        reasoning: None,
    };
    let b = TokenCounts {
        uncached_input: Some(3),
        cached_input: Some(2),
        output: None,
        reasoning: None,
    };
    let sum = add_counts(a, b);
    assert_eq!(sum.uncached_input, Some(13));
    assert_eq!(sum.cached_input, Some(2));
    assert_eq!(sum.output, Some(5));
    assert_eq!(sum.reasoning, None);
}

/// Costs accumulate, and an absent side is treated as the other.
#[test]
fn add_cost_accumulates_optionally() {
    assert_eq!(add_cost(None, None), None);
    let one = Some(Cost {
        comparable: Some(0.01),
        actual: Some(0.01),
    });
    assert_eq!(add_cost(None, one), one);
    let summed = add_cost(one, one).unwrap();
    assert_eq!(summed.comparable, Some(0.02));
    assert_eq!(summed.actual, Some(0.02));
}

// ---------------------------------------------------------------------------
// Context visibility: the per-turn breakdown, always emitted
// ---------------------------------------------------------------------------

/// The loop emits a `ContextBreakdown` each turn — after the turn starts and before the
/// turn's tool call — accounting the window by source with a total, a window limit, and a
/// fullness ratio. Context visibility is intrinsic, so this happens on every run.
#[tokio::test]
async fn run_emits_context_breakdown_each_turn() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-cv".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/echo"));

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);
    let events = sink.events();

    let breakdowns: Vec<_> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown {
                by_source,
                total_tokens,
                window_limit,
                fullness,
            } => Some((by_source, *total_tokens, *window_limit, *fullness)),
            _ => None,
        })
        .collect();

    // The default mock scripts two turns; a breakdown is emitted at the top of each.
    assert!(
        !breakdowns.is_empty(),
        "a breakdown should be emitted per turn"
    );
    let turns = events
        .iter()
        .filter(|e| matches!(e.kind, GgTelemetryKind::TurnStarted {}))
        .count();
    assert_eq!(breakdowns.len(), turns, "one breakdown per turn");

    let (by_source, total, window_limit, fullness) = &breakdowns[0];
    // A stable band per source, in ALL order, present even at zero.
    assert_eq!(by_source.len(), GgContextSource::ALL.len());
    for (band, &source) in by_source.iter().zip(GgContextSource::ALL.iter()) {
        assert_eq!(band.source, source);
    }
    // The pinned system + user prompt are in the window from the first turn.
    let tokens_for = |source: GgContextSource| {
        by_source
            .iter()
            .find(|b| b.source == source)
            .map(|b| b.tokens)
            .unwrap()
    };
    assert!(tokens_for(GgContextSource::System) > 0);
    assert!(tokens_for(GgContextSource::UserPrompt) > 0);
    assert!(*total > 0);
    assert_eq!(
        *total,
        by_source.iter().map(|b| b.tokens).sum::<u64>(),
        "the total equals the sum of the bands"
    );
    // The window is the one the launch pushed in for this model; fullness follows.
    assert_eq!(*window_limit, Some(TEST_CONTEXT_WINDOW));
    let f = fullness.expect("fullness is known when the window is");
    assert!(f > 0.0 && f < 1.0);

    // Ordering: the first breakdown sits after the first TurnStarted and before the
    // write_file tool call it accounted for.
    let first_turn = events
        .iter()
        .position(|e| matches!(e.kind, GgTelemetryKind::TurnStarted {}))
        .unwrap();
    let first_breakdown = events
        .iter()
        .position(|e| matches!(e.kind, GgTelemetryKind::ContextBreakdown { .. }))
        .unwrap();
    let first_call = events
        .iter()
        .position(|e| matches!(&e.kind, GgTelemetryKind::ToolCall { .. }))
        .unwrap();
    assert!(first_turn < first_breakdown && first_breakdown < first_call);
}

/// Context visibility is not a capability, so no configuration can switch it off: a run whose
/// set carries no context capability at all still emits a `ContextBreakdown` every turn. The
/// minimal set is exactly that — the context-window override is opt-in, so `minimal` declares
/// none of it — and the breakdown is emitted regardless.
#[tokio::test]
async fn run_emits_context_breakdown_without_any_context_capability() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-nocv".to_string()), Box::new(sink.clone()));

    let set = GgCapabilitySet::minimal("mock/echo");
    // Precondition: the set names no context capability that could gate the breakdown.
    assert!(
        set.capability(CAPABILITY_CONTEXT_WINDOW_OVERRIDE).is_none(),
        "the minimal set should carry no context capability"
    );
    let inv = invocation(dir.path(), set);

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);
    let events = sink.events();

    assert!(
        events
            .iter()
            .any(|e| matches!(e.kind, GgTelemetryKind::ContextBreakdown { .. })),
        "context visibility is intrinsic and must emit a breakdown regardless of capabilities"
    );
    // The rest of the run is intact.
    assert!(dir.path().join("index.html").exists());
    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
}

/// The window a run is measured against is the catalog's figure for the model, pushed in
/// with the invocation — and **nothing** when the launch pushed none. gg holds no model
/// table of its own to guess from and no default to fall back on.
#[test]
fn resolve_window_limit_takes_the_catalog_window_and_never_guesses() {
    let set = GgCapabilitySet::minimal("anthropic/claude-opus-4.8");
    let catalog = windows("anthropic/claude-opus-4.8", 200_000);
    assert_eq!(
        resolve_window_limit(set.root(), &catalog, "anthropic/claude-opus-4.8"),
        Some(200_000)
    );

    // A model the launch pushed no window for resolves to nothing at all — a guessed
    // denominator would silently mis-scale every fullness figure and the compaction
    // trigger, so the launch check refuses the run instead.
    assert_eq!(
        resolve_window_limit(set.root(), &catalog, "mock/echo"),
        None
    );
    assert_eq!(
        resolve_window_limit(set.root(), &BTreeMap::new(), "anthropic/claude-opus-4.8"),
        None
    );
}

/// The launch check names every bound model the invocation carries no window for, and passes
/// only when all of them are covered.
#[test]
fn validate_model_windows_requires_every_bound_model() {
    let mut set = GgCapabilitySet::minimal("anthropic/claude-opus-4.8");
    set.agents.push(GgAgentConfig {
        name: "subagent".to_string(),
        model_id: "openai/gpt-5.4-mini".to_string(),
        ..GgAgentConfig::root()
    });

    let err = validate_model_windows(&set, &windows("anthropic/claude-opus-4.8", 200_000))
        .expect_err("a bound model with no window is a launch failure");
    assert!(
        err.contains("openai/gpt-5.4-mini"),
        "unexpected error: {err}"
    );
    assert!(
        !err.contains("anthropic/claude-opus-4.8"),
        "the covered model should not be named: {err}"
    );

    assert!(validate_model_windows(&set, &test_windows(&set)).is_ok());
    // A set that binds nothing has nothing to cover.
    assert!(validate_model_windows(&GgCapabilitySet::default(), &BTreeMap::new()).is_ok());
}

/// A bound model missing from `modelProviders` refuses the launch, and every missing pin is
/// named together. A blank slug is a missing pin: it would send no `provider.only`.
#[test]
fn validate_model_providers_requires_every_bound_model() {
    let mut set = GgCapabilitySet::minimal("anthropic/claude-opus-4.8");
    set.agents.push(GgAgentConfig {
        name: "subagent".to_string(),
        model_id: "openai/gpt-5.4-mini".to_string(),
        ..GgAgentConfig::root()
    });

    let err = validate_model_providers(
        &set,
        &BTreeMap::from([(
            "anthropic/claude-opus-4.8".to_string(),
            "anthropic".to_string(),
        )]),
    )
    .expect_err("a bound model with no provider pin is a launch failure");
    assert!(
        err.contains("openai/gpt-5.4-mini"),
        "unexpected error: {err}"
    );
    assert!(
        !err.contains("anthropic/claude-opus-4.8"),
        "the pinned model should not be named: {err}"
    );

    let blank = BTreeMap::from([
        ("anthropic/claude-opus-4.8".to_string(), "  ".to_string()),
        ("openai/gpt-5.4-mini".to_string(), "openai".to_string()),
    ]);
    let err = validate_model_providers(&set, &blank).expect_err("a blank pin is no pin");
    assert!(
        err.contains("anthropic/claude-opus-4.8"),
        "unexpected error: {err}"
    );

    assert!(validate_model_providers(&set, &test_providers(&set)).is_ok());
    assert!(validate_model_providers(&GgCapabilitySet::default(), &BTreeMap::new()).is_ok());
}

/// A model the offline mock answers sends no request, so it needs no pin: the free
/// validation launch against `mock/test` stays a launch with a window and nothing else.
#[test]
fn validate_model_providers_exempts_a_mock_model() {
    let mut set = GgCapabilitySet::minimal("mock/test");
    assert!(validate_model_providers(&set, &BTreeMap::new()).is_ok());

    set.agents.push(GgAgentConfig {
        name: "subagent".to_string(),
        model_id: "openai/gpt-5.4-mini".to_string(),
        ..GgAgentConfig::root()
    });
    let err = validate_model_providers(&set, &BTreeMap::new())
        .expect_err("a live model beside the mock still needs its pin");
    assert!(
        err.contains("openai/gpt-5.4-mini") && !err.contains("mock/test"),
        "{err}"
    );
}

/// A `context-window-override` capability enabled with the given `windowLimit`, the lever the
/// resolve-window tests narrow a model's window with.
fn window_override(limit: u64) -> GgCapabilityConfig {
    GgCapabilityConfig {
        params: json!({ "windowLimit": limit }),
        ..GgCapabilityConfig::enabled(CAPABILITY_CONTEXT_WINDOW_OVERRIDE)
    }
}

/// An enabled `context-window-override` narrows the catalog's figure by its `windowLimit`.
#[test]
fn resolve_window_limit_narrows_with_the_param() {
    let mut set = GgCapabilitySet::minimal("anthropic/claude-opus-4.8");
    set.agents[0].capabilities.push(window_override(42_000));
    let catalog = windows("anthropic/claude-opus-4.8", 200_000);
    assert_eq!(
        resolve_window_limit(set.root(), &catalog, "anthropic/claude-opus-4.8"),
        Some(42_000)
    );
}

/// A `windowLimit` of `0` is an override that narrows nothing — one the run **records** and never
/// applies, which would make the two arms of a context-window study the same arm. It refuses the
/// launch rather than reverting to the model's own window.
#[test]
fn a_window_limit_of_zero_is_refused() {
    let mut set = GgCapabilitySet::minimal("anthropic/claude-opus-4.8");
    set.agents[0].capabilities.push(GgCapabilityConfig {
        params: json!({ "windowLimit": 0 }),
        ..GgCapabilityConfig::enabled(CAPABILITY_CONTEXT_WINDOW_OVERRIDE)
    });

    let defects = window_defects(&set);
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert_eq!(
        defects[0].locus,
        "context-window-override.params.windowLimit"
    );
    assert_eq!(defects[0].agent.as_deref(), Some("root"), "{defects:?}");
}

/// The narrowing is **per agent**, like every other capability: a run may narrow its implementer's
/// window and measure its reviewer against its model's own.
#[test]
fn resolve_window_limit_reads_the_agents_own_override() {
    let mut set = GgCapabilitySet::minimal("anthropic/claude-opus-4.8");
    set.agents[0].capabilities.push(window_override(42_000));
    set.agents.push(GgAgentConfig {
        slug: "reviewer".to_string(),
        name: "Reviewer".to_string(),
        ..GgAgentConfig::root()
    });
    let catalog = windows("anthropic/claude-opus-4.8", 200_000);

    assert_eq!(
        resolve_window_limit(set.root(), &catalog, "anthropic/claude-opus-4.8"),
        Some(42_000)
    );
    assert_eq!(
        resolve_window_limit(
            set.agent("reviewer").expect("the second profile"),
            &catalog,
            "anthropic/claude-opus-4.8"
        ),
        Some(200_000),
        "a profile that declared no override is not narrowed because another one did"
    );
}

/// A `context-window-override` that is present but **disabled** narrows nothing — its recorded
/// `windowLimit` is the off arm's remembered configuration, not an applied one — so the model
/// runs against its full catalog window.
#[test]
fn resolve_window_limit_ignores_a_disabled_override() {
    let mut set = GgCapabilitySet::minimal("anthropic/claude-opus-4.8");
    crate::tools::grant_configured(
        &mut set.agents[0],
        GgCapabilityConfig {
            enabled: false,
            ..window_override(42_000)
        },
    );
    assert_eq!(
        resolve_window_limit(
            set.root(),
            &windows("anthropic/claude-opus-4.8", 200_000),
            "anthropic/claude-opus-4.8"
        ),
        Some(200_000)
    );
}

/// The override is read **only** from the `context-window-override` capability: a `windowLimit`
/// param stashed on some other capability is not a window override and is ignored.
#[test]
fn resolve_window_limit_ignores_the_param_on_another_capability() {
    let mut set = GgCapabilitySet::minimal("anthropic/claude-opus-4.8");
    for cap in &mut set.agents[0].capabilities {
        if cap.id == CAPABILITY_SHELL {
            cap.params = crate::tools::configured(
                CAPABILITY_CONTEXT_WINDOW_OVERRIDE,
                json!({ "windowLimit": 32_000 }),
            )
            .params;
        }
    }
    assert_eq!(
        resolve_window_limit(
            set.root(),
            &windows("anthropic/claude-opus-4.8", 200_000),
            "anthropic/claude-opus-4.8"
        ),
        Some(200_000)
    );
}

/// The window-limit override is a **ceiling**: an override above the model's window is not a
/// defect, and the agent is measured against the smaller of the two — the model's own window, which
/// is the figure the record then carries. A configuration authored against a 400k-window model
/// launches unchanged against a 262k one.
#[test]
fn an_override_above_the_model_window_is_clamped_to_it() {
    let model_id = "anthropic/claude-opus-4.8";
    let mut set = GgCapabilitySet::minimal(model_id);
    set.agents[0].capabilities.push(window_override(2_000_000));
    let catalog = windows(model_id, 200_000);

    assert!(
        window_defects(&set).is_empty(),
        "{:?}",
        window_defects(&set)
    );
    assert_eq!(
        resolve_window_limit(set.root(), &catalog, model_id),
        Some(200_000)
    );
    // The whole launch pass, with the run's windows in hand — the one hook that could compare
    // the figure against the model's window — accepts the configuration too.
    let dir = TempDir::new().unwrap();
    let mut inv = invocation(dir.path(), set.clone());
    inv.model_windows = catalog.clone();
    assert!(
        crate::validate::validate_launch(&inv).is_ok(),
        "{:?}",
        crate::validate::validate_launch(&inv)
    );

    // A model the launch pushed no window for is left alone here, and said nothing about:
    // `validate_model_windows` owns that refusal, and naming one defect twice is worse than naming
    // it once.
    assert_eq!(
        resolve_window_limit(set.root(), &BTreeMap::new(), model_id),
        None
    );
    assert!(window_ceiling_notes(&set.agents, &BTreeMap::new()).is_empty());
}

/// The clamp is said out loud at launch, once per agent it applies to, naming the agent, the
/// configured ceiling, the model's window and the window the agent is measured against — the last
/// being the resolved figure, so an armed compaction's headroom shows in it. An override the model
/// window honours in full says nothing, and neither does a profile with no override.
#[test]
fn the_launch_note_names_every_agent_whose_ceiling_narrows_nothing() {
    let model_id = "anthropic/claude-opus-4.8";
    let mut set = GgCapabilitySet::minimal(model_id);
    set.agents[0].capabilities.push(window_override(2_000_000));
    set.agents.push(GgAgentConfig {
        slug: "reviewer".to_string(),
        name: "Reviewer".to_string(),
        model_id: model_id.to_string(),
        ..GgAgentConfig::root()
    });
    set.agents[1].capabilities.push(window_override(50_000));
    set.agents.push(GgAgentConfig {
        slug: "planner".to_string(),
        name: "Planner".to_string(),
        model_id: model_id.to_string(),
        ..GgAgentConfig::root()
    });
    let catalog = windows(model_id, 200_000);

    let notes = window_ceiling_notes(&set.agents, &catalog);
    assert_eq!(notes.len(), 1, "{notes:?}");
    let note = &notes[0];
    assert!(note.starts_with("`root`: "), "{note}");
    assert!(
        note.contains("context-window-override.params.windowLimit = 2000000"),
        "{note}"
    );
    assert!(note.contains("200000-token window"), "{note}");
    assert!(note.contains(model_id), "{note}");
    assert!(note.contains("measured against 200000 tokens"), "{note}");
    assert!(
        !note.contains("reviewer") && !note.contains("planner"),
        "{note}"
    );

    // With compaction armed, the measured figure is the model's window less the summary headroom —
    // the same figure `resolve_window_limit` hands the fullness signal and the record.
    crate::tools::grant(&mut set.agents[0], CAPABILITY_COMPACTION);
    let notes = window_ceiling_notes(&set.agents, &catalog);
    assert_eq!(notes.len(), 1, "{notes:?}");
    assert!(
        notes[0].contains("measured against 160000 tokens"),
        "{}",
        notes[0]
    );
}

/// A session launched with a ceiling above its model's window **runs** — it is not refused — and
/// says so once, on the root emitter at launch, before any turn: the note names the ceiling, the
/// model's window and the window the agent is measured against, which is what every turn's
/// breakdown then carries.
#[tokio::test]
async fn a_ceiling_above_the_model_window_launches_and_is_said_once() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-ceiling".to_string()), Box::new(sink.clone()));
    let mut set = GgCapabilitySet::minimal("mock/echo");
    set.agents[0].capabilities.push(window_override(2_000_000));
    let inv = invocation(dir.path(), set);

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);
    let events = sink.events();
    assert!(error_messages(&events).is_empty(), "{events:?}");

    let notes: Vec<_> = warn_messages(&events)
        .into_iter()
        .filter(|message| message.contains("narrows nothing"))
        .collect();
    assert_eq!(notes.len(), 1, "{notes:?}");
    assert!(
        notes[0].contains("windowLimit = 2000000")
            && notes[0].contains(&format!("{TEST_CONTEXT_WINDOW}-token window"))
            && notes[0].contains(&format!("measured against {TEST_CONTEXT_WINDOW} tokens")),
        "{}",
        notes[0]
    );
    // Said at launch, on the root's emitter, before the first turn.
    let note_at = events
        .iter()
        .position(|e| {
            matches!(&e.kind, GgTelemetryKind::Log { message, .. }
            if message.contains("narrows nothing"))
        })
        .unwrap();
    assert_eq!(events[note_at].agent_id.as_deref(), Some(ROOT_AGENT_ID));
    let first_turn = events
        .iter()
        .position(|e| matches!(e.kind, GgTelemetryKind::TurnStarted {}))
        .unwrap();
    assert!(note_at < first_turn, "{note_at} vs {first_turn}");

    // And the run measured the agent against the model's window, not the ceiling.
    let window_limit = events
        .iter()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { window_limit, .. } => Some(*window_limit),
            _ => None,
        })
        .expect("a breakdown per turn");
    assert_eq!(window_limit, Some(TEST_CONTEXT_WINDOW));
}

/// Every value gg refuses in `set`'s window overrides. The check reads the figure alone — whether
/// it is above the model's window is the resolver's clamp rather than a launch question — so it
/// needs no catalog.
fn window_defects(set: &GgCapabilitySet) -> Vec<crate::validate::LaunchDefect> {
    let mut report = crate::validate::LaunchReport::collecting();
    for profile in &set.agents {
        report.for_agent(&profile.slug, |report| check_launch(profile, report));
    }
    report.into_defects()
}

/// Enabling compaction reserves the summary headroom out of the window the agent is
/// measured against — including out of a narrowed override — so the summarization call has
/// room to run. The catalog window, the override, and the reserve compose.
#[test]
fn resolve_window_limit_reserves_compaction_headroom() {
    let mut set = GgCapabilitySet::minimal("anthropic/claude-opus-4.8");
    crate::tools::grant(&mut set.agents[0], CAPABILITY_COMPACTION);
    let catalog = windows("anthropic/claude-opus-4.8", 200_000);
    assert_eq!(
        resolve_window_limit(set.root(), &catalog, "anthropic/claude-opus-4.8"),
        Some(160_000)
    );

    set.agents[0].capabilities.push(window_override(50_000));
    assert_eq!(
        resolve_window_limit(set.root(), &catalog, "anthropic/claude-opus-4.8"),
        Some(40_000)
    );
}

/// **The context-usage signal's threshold is a share of the window the agent may actually fill.**
///
/// There is one usable window per agent and both readers of it come off this resolver, so the same
/// thread earns a block under an armed compaction and none without one: a compaction hands back a
/// smaller window, and three quarters of a smaller window arrives sooner. A threshold measured
/// against the model's raw window instead would hold the block back past the point the compaction
/// trigger fires, which is exactly the point the agent still had a chance to act.
#[test]
fn the_signal_threshold_is_a_share_of_the_window_compaction_leaves() {
    let model_id = "anthropic/claude-opus-4.8";
    let catalog = windows(model_id, 2_000);
    let bare = GgCapabilitySet::minimal(model_id);
    let mut compacting = GgCapabilitySet::minimal(model_id);
    crate::tools::grant(&mut compacting.agents[0], CAPABILITY_COMPACTION);
    assert_eq!(
        (
            resolve_window_limit(bare.root(), &catalog, model_id),
            resolve_window_limit(compacting.root(), &catalog, model_id),
        ),
        (Some(2_000), Some(1_600)),
        "a fifth of the window is held back for the summarization call"
    );

    // One read of roughly 1,250 tokens: under three quarters of the model's whole window, over
    // three quarters of what the armed compaction leaves.
    let filled = |limit: Option<u64>| {
        let mut ctx = ContextModel::new(Arc::new(HeuristicTokenEstimator::new()), limit, false);
        ctx.set_system("system");
        ctx.push_file_view(
            Some("src/main.rs".to_string()),
            None,
            "c1",
            "main ".repeat(1_000),
            Vec::new(),
        );
        ctx.refresh_context_usage_signal(UsageSignalOptions {
            can_evict: true,
            program_language: None,
            can_close_views: false,
            can_archive: true,
            top_file_views: 5,
            threshold_percent: DEFAULT_SIGNAL_THRESHOLD_PERCENT,
        });
        ctx.messages().into_iter().any(|message| {
            message
                .content
                .is_some_and(|content| content.starts_with("Context Usage:"))
        })
    };
    assert!(
        !filled(resolve_window_limit(bare.root(), &catalog, model_id)),
        "measured against the model's whole window this thread is not yet three quarters of it"
    );
    assert!(
        filled(resolve_window_limit(compacting.root(), &catalog, model_id)),
        "measured against the window the compaction leaves, the same thread has reached it"
    );
}

/// Each agent is measured against **its own** model's window: a multi-model run carries one
/// catalog entry per bound model, and a subagent on a smaller model must not be measured
/// against the primary's window.
#[test]
fn resolve_window_limit_is_per_model() {
    let set = GgCapabilitySet::minimal("anthropic/claude-opus-4.8");
    let catalog = BTreeMap::from([
        ("anthropic/claude-opus-4.8".to_string(), 200_000),
        ("openai/gpt-5.4-mini".to_string(), 400_000),
    ]);
    assert_eq!(
        resolve_window_limit(set.root(), &catalog, "anthropic/claude-opus-4.8"),
        Some(200_000)
    );
    assert_eq!(
        resolve_window_limit(set.root(), &catalog, "openai/gpt-5.4-mini"),
        Some(400_000)
    );
}

// ---------------------------------------------------------------------------
// Skills: the capability switch, and the pinned, deduplicated skill read
// ---------------------------------------------------------------------------

/// `minimal`, with the skills capability disabled (the off arm of the comparison).
fn minimal_without_skills(model: &str) -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal(model);
    for cap in &mut set.agents[0].capabilities {
        if cap.id == CAPABILITY_SKILLS {
            cap.enabled = false;
        }
    }
    set
}

/// A `read_skill` call for `name`, with the given id.
fn read_skill_call(id: &str, name: &str) -> ModelResponse {
    ModelResponse {
        text: Some(format!("reading {name}")),
        tool_calls: vec![ToolCall {
            id: id.to_string(),
            name: "read_skill".to_string(),
            arguments: json!({ "name": name }),
        }],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts::default(),
        cost: None,
        provider: None,
        loop_aborts: LoopAborts::none(),
    }
}

/// A terminal, tool-free response that ends the loop.
fn stop_response() -> ModelResponse {
    finish_call("call_finish", "done")
}

/// A reply with **no tool call at all** — which is an error turn, not a conclusion. The helper a
/// test reaches for when the text-only reply *is* the subject; every other test wants
/// [`stop_response`], which ends the session the one way a session ends.
fn text_only_response() -> ModelResponse {
    ModelResponse {
        text: Some("done".to_string()),
        tool_calls: Vec::new(),
        finish_reason: FinishReason::Stop,
        usage: TokenCounts::default(),
        cost: None,
        provider: None,
        loop_aborts: LoopAborts::none(),
    }
}

/// With the skills capability off, the run offers no `read_skill` tool and emits no
/// `SkillsState` — even though a skills directory is present (switching the capability off makes the
/// feature vanish). The default script's `read_skill` call comes back as an unknown tool.
#[tokio::test]
async fn run_without_skills_capability_offers_no_skill_tool_or_state() {
    let dir = TempDir::new().unwrap();
    seed_default_skill(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-noskills".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), minimal_without_skills("mock/echo"));

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);
    let events = sink.events();

    // No skills telemetry at all.
    assert!(
        !events
            .iter()
            .any(|e| matches!(e.kind, GgTelemetryKind::SkillsState { .. })),
        "skills off must not emit any SkillsState"
    );
    // The `read_skill` call is not dispatchable — it is withheld like any tool a run does not offer.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok, .. } if name == "read_skill" && !*ok
        )),
        "read_skill should be an unknown tool when the capability is off"
    );
    // The run still completes and builds the file.
    assert!(dir.path().join("index.html").exists());
    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
}

/// Reading the same skill twice pins its body **once**: the Skill-source token band does
/// not grow on the repeat read, and only the first (fresh) read emits a `SkillsState`.
#[tokio::test]
async fn drive_pins_a_read_skill_once_across_repeat_reads() {
    let dir = TempDir::new().unwrap();
    std::fs::write(
        dir.path().join("guide.md"),
        "---\nname: guide\ndescription: a guide.\n---\nThis is the guide body with enough words to count.",
    )
    .unwrap();
    let library = Arc::new(SkillLibrary::loaded(dir.path()));
    assert_eq!(library.len(), 1);

    let set = GgCapabilitySet::minimal("mock/echo");
    let registry = ToolRegistry::from_run(
        set.root(),
        &skills_modules(&library),
        &AgentFacts::default(),
    );
    let runtime = SkillsRuntime::new(Arc::clone(&library));
    let ctx = ToolContext::new(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-dedup".to_string()), Box::new(sink.clone()));

    // Read `guide` twice, then stop — three turns, so three per-turn breakdowns.
    let client = MockClient::new(
        "mock/echo",
        vec![
            read_skill_call("c1", "guide"),
            read_skill_call("c2", "guide"),
            stop_response(),
        ],
    );

    let agent = Agent::root(ROOT_PROFILE_ID);
    let end = agent
        .drive(
            &client,
            "go",
            &registry,
            &ctx,
            &emitter,
            &mut test_modules(test_context_setup(), no_code().enabled)
                .with(ModuleHandle::Skills(runtime))
                .with(ModuleHandle::Memories(MemoriesRuntime::disabled()))
                .with(ModuleHandle::Tasks(TasksRuntime::disabled()))
                .with(ModuleHandle::Board(BoardRuntime::disabled())),
            DriveSetup {
                limits: no_limits(10),
                compaction: no_compaction(),
                amc: no_amc(),
                autoload: no_autoload(),
                persistence: no_persistence(),
                read_policy: Some(ReadPolicy::Unlimited),
                shell_offload: OffloadPolicy::ample(),
                code: no_code(),
                discovery: DiscoveryWarning::default(),
                hooks: no_hooks(),
                ending_role: EndingRole::Standard,
                opening: Opening::Fresh,
                carried_programs: None,
                turn_base: 0,
                replay: None,
            },
            &[],
            &GgAgentConfig::root(),
            &GgCapabilitySet::default(),
            &mut None,
            None,
        )
        .await;
    assert_eq!(end.status, "completed");

    let events = sink.events();

    // Only the first (fresh) read emits a SkillsState; the repeat does not.
    assert_eq!(
        events
            .iter()
            .filter(|e| matches!(e.kind, GgTelemetryKind::SkillsState { .. }))
            .count(),
        1,
        "a repeat read must not re-emit SkillsState"
    );

    // The Skill token band across the per-turn breakdowns: zero before the read, then a
    // fixed positive value that does not double when the skill is read again.
    let skill_bands: Vec<u64> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } => Some(
                by_source
                    .iter()
                    .find(|b| b.source == GgContextSource::Skill)
                    .map(|b| b.tokens)
                    .unwrap_or(0),
            ),
            _ => None,
        })
        .collect();
    assert_eq!(skill_bands.len(), 3, "one breakdown per turn");
    assert_eq!(
        skill_bands[0], 0,
        "no skill is pinned before the first read"
    );
    assert!(skill_bands[1] > 0, "the fresh read pins the skill body");
    assert_eq!(
        skill_bands[1], skill_bands[2],
        "the repeat read must not pin a second copy"
    );
}

// ---------------------------------------------------------------------------
// Memories: the capability switch, and the bounded, pinned, model-curated scratchpad
// ---------------------------------------------------------------------------

/// `minimal`, with the memories capability disabled (the off arm of the comparison).
fn minimal_without_memories(model: &str) -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal(model);
    for cap in &mut set.agents[0].capabilities {
        if cap.id == test_cabinet_core::gg::CAPABILITY_MEMORIES {
            cap.enabled = false;
        }
    }
    set
}

/// A `write_memory` call with the given id, name, and body.
fn write_memory_call(id: &str, name: &str, body: &str) -> ModelResponse {
    ModelResponse {
        text: Some(format!("noting {name}")),
        tool_calls: vec![ToolCall {
            id: id.to_string(),
            name: "write_memory".to_string(),
            arguments: json!({ "name": name, "description": "a note", "body": body }),
        }],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts::default(),
        cost: None,
        provider: None,
        loop_aborts: LoopAborts::none(),
    }
}

/// With the memories capability off, the run offers no memory tools and emits no
/// `MemoryState` — even though the default script tries to write one (switching the capability off makes
/// the feature vanish). The write_memory call comes back as an unknown tool.
#[tokio::test]
async fn run_without_memories_capability_offers_no_memory_tools_or_state() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-nomem".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), minimal_without_memories("mock/echo"));

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);
    let events = sink.events();

    // No memories telemetry at all.
    assert!(
        !events
            .iter()
            .any(|e| matches!(e.kind, GgTelemetryKind::MemoryState { .. })),
        "memories off must not emit any MemoryState"
    );
    // No Memory-source tokens ever accumulate.
    assert!(
        events.iter().all(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } =>
                by_source
                    .iter()
                    .find(|b| b.source == GgContextSource::Memory)
                    .map(|b| b.tokens)
                    .unwrap_or(0)
                    == 0,
            _ => true,
        }),
        "memories off must never account tokens to the Memory source"
    );
    // The write_memory call is withheld like any tool a run does not offer.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok, .. } if name == "write_memory" && !*ok
        )),
        "write_memory should be an unknown tool when the capability is off"
    );
    // The run still completes and builds the file.
    assert!(dir.path().join("index.html").exists());
    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
}

/// A write that breaches a cap is refused end to end: the tool result fails with the
/// revise-or-evict guidance, the store stays within the cap, and the pinned Memory block
/// reflects only the accepted memory.
#[tokio::test]
async fn drive_enforces_memory_caps_end_to_end() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-cap".to_string()), Box::new(sink.clone()));

    // A one-memory budget so the second write hits the count cap cheaply.
    let caps = crate::memories::MemoryCaps {
        max_count: Some(1),
        max_len_per_memory: Some(500),
        max_total_len: Some(5_000),
        max_len_index: None,
        max_len_description: None,
        max_results: None,
    };
    let memories = MemoriesRuntime::new(crate::memories::MemoryStrategy::Scratchpad, caps);
    // A second handle on the same store, kept behind so what the run left in it can be read after
    // `drive` has taken the module.
    let kept = memories.shared();
    let set = GgCapabilitySet::minimal("mock/echo");
    let library = Arc::new(SkillLibrary::empty());
    let registry = ToolRegistry::from_run(
        set.root(),
        &skills_modules(&library).with(ModuleHandle::Memories(memories.shared())),
        &AgentFacts::default(),
    );

    // Write `first` (accepted), then `second` (refused — count cap), then stop.
    let client = MockClient::new(
        "mock/echo",
        vec![
            write_memory_call("c1", "first", "the first note body"),
            write_memory_call("c2", "second", "the second note body"),
            stop_response(),
        ],
    );

    let agent = Agent::root(ROOT_PROFILE_ID);
    let end = agent
        .drive(
            &client,
            "go",
            &registry,
            &ctx,
            &emitter,
            &mut test_modules(test_context_setup(), no_code().enabled)
                .with(ModuleHandle::Skills(SkillsRuntime::disabled()))
                .with(ModuleHandle::Memories(memories))
                .with(ModuleHandle::Tasks(TasksRuntime::disabled()))
                .with(ModuleHandle::Board(BoardRuntime::disabled())),
            DriveSetup {
                limits: no_limits(10),
                compaction: no_compaction(),
                amc: no_amc(),
                autoload: no_autoload(),
                persistence: no_persistence(),
                read_policy: Some(ReadPolicy::Unlimited),
                shell_offload: OffloadPolicy::ample(),
                code: no_code(),
                discovery: DiscoveryWarning::default(),
                hooks: no_hooks(),
                ending_role: EndingRole::Standard,
                opening: Opening::Fresh,
                carried_programs: None,
                turn_base: 0,
                replay: None,
            },
            &[],
            &GgAgentConfig::root(),
            &GgCapabilitySet::default(),
            &mut None,
            None,
        )
        .await;
    assert_eq!(end.status, "completed");

    let events = sink.events();

    // The first write succeeded; the second was refused (not silently accepted).
    let write_results: Vec<bool> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::ToolResult { name, ok, .. } if name == "write_memory" => Some(*ok),
            _ => None,
        })
        .collect();
    assert_eq!(
        write_results,
        vec![true, false],
        "second write hits the cap"
    );

    // The refusal carried revise-or-evict guidance to the model.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok: false, summary: Some(s), .. }
                if name == "write_memory" && s.contains("delete_memory")
        )),
        "the cap breach must instruct the model to revise or evict"
    );

    // The final MemoryState stays within the cap: exactly one memory.
    let last_count = events
        .iter()
        .rev()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::MemoryState { count, .. } => Some(*count),
            _ => None,
        })
        .expect("a MemoryState was emitted");
    assert_eq!(last_count, 1, "the count cap held");

    // The accepted memory is in the store. It is *not* yet in the window: with no
    // compaction on this run there has been no boundary to rebuild the pinned block at,
    // and the model has been reading its own write in the thread (see
    // `memory_block_is_rebuilt_only_at_a_compaction_boundary`).
    assert_eq!(kept.store().lock().unwrap().count(), 1);
    let last_memory_tokens = memory_band_tokens(&events);
    assert_eq!(
        last_memory_tokens, 0,
        "no compaction has happened, so no memory block has been pinned"
    );
}

/// The tokens the latest `ContextBreakdown` attributes to the
/// [`Memory`](GgContextSource::Memory) band — how much of the window the pinned memory
/// block is costing.
fn memory_band_tokens(events: &[GgTelemetryEvent]) -> u64 {
    events
        .iter()
        .rev()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } => Some(
                by_source
                    .iter()
                    .find(|b| b.source == GgContextSource::Memory)
                    .map(|b| b.tokens)
                    .unwrap_or(0),
            ),
            _ => None,
        })
        .expect("a context breakdown was emitted")
}

/// One `create_memory` call, as a model response.
fn create_memory_call(id: &str, name: &str, contents: &str) -> ModelResponse {
    ModelResponse {
        text: Some(format!("noting {name}")),
        tool_calls: vec![ToolCall {
            id: id.to_string(),
            name: "create_memory".to_string(),
            arguments: json!({
                "name": name,
                "description": "a note",
                "contents": contents,
            }),
        }],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts::default(),
        cost: None,
        provider: None,
        loop_aborts: LoopAborts::none(),
    }
}

/// A markdown-strategy run end to end: the loop offers that strategy's tools (and not the
/// scratchpad's), pins the **index** rather than the contents, and reports the strategy in its
/// telemetry.
///
/// The pinning is the assertion that matters. The strategy's whole claim is that a run can hold
/// more memory than it could afford to carry, which is only true if the contents stay out of the
/// window until they are read — so a block that carried them would leave the feature indisting-
/// uishable from the scratchpad it exists to be an alternative to.
#[tokio::test]
async fn drive_pins_only_the_index_under_the_markdown_strategy() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-markdown".to_string()), Box::new(sink.clone()));

    let strategy = crate::memories::MemoryStrategy::Markdown;
    let memories = MemoriesRuntime::new(strategy, crate::memories::MemoryCaps::UNBOUNDED);
    // A second handle on the same store, kept behind so the block gg *would* pin can be
    // read after `drive` has taken ownership of the runtime.
    let pinned = memories.shared();
    let set = GgCapabilitySet::minimal("mock/echo");
    let library = Arc::new(SkillLibrary::empty());
    let registry = ToolRegistry::from_run(
        set.root(),
        &skills_modules(&library).with(ModuleHandle::Memories(memories.shared())),
        &AgentFacts::default(),
    );
    let offered = registry.tool_names();
    assert!(offered.iter().any(|name| name == "create_memory"));
    assert!(
        !offered.iter().any(|name| name == "write_memory"),
        "a markdown run is not offered the scratchpad's tools"
    );

    let client = MockClient::new(
        "mock/echo",
        vec![
            create_memory_call("c1", "layout", "THE-CONTENTS-OF-THE-MEMORY"),
            stop_response(),
        ],
    );

    let agent = Agent::root(ROOT_PROFILE_ID);
    let end = agent
        .drive(
            &client,
            "go",
            &registry,
            &ctx,
            &emitter,
            &mut test_modules(test_context_setup(), no_code().enabled)
                .with(ModuleHandle::Skills(SkillsRuntime::disabled()))
                .with(ModuleHandle::Memories(memories))
                .with(ModuleHandle::Tasks(TasksRuntime::disabled()))
                .with(ModuleHandle::Board(BoardRuntime::disabled())),
            DriveSetup {
                limits: no_limits(10),
                compaction: no_compaction(),
                amc: no_amc(),
                autoload: no_autoload(),
                persistence: no_persistence(),
                read_policy: Some(ReadPolicy::Unlimited),
                shell_offload: OffloadPolicy::ample(),
                code: no_code(),
                discovery: DiscoveryWarning::default(),
                hooks: no_hooks(),
                ending_role: EndingRole::Standard,
                opening: Opening::Fresh,
                carried_programs: None,
                turn_base: 0,
                replay: None,
            },
            &[],
            &GgAgentConfig::root(),
            &GgCapabilitySet::default(),
            &mut None,
            None,
        )
        .await;
    assert_eq!(end.status, "completed");

    let events = sink.events();
    let strategy_reported = events
        .iter()
        .rev()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::MemoryState { strategy, .. } => Some(strategy.clone()),
            _ => None,
        })
        .expect("a MemoryState was emitted");
    assert_eq!(strategy_reported, "markdown");

    // What the strategy would pin is the index alone. Asserted on the block itself
    // rather than on the window, because the loop rebuilds it at a compaction boundary
    // and this run has none — the block's *shape* is this test's claim, and the timing
    // of the rebuild is `memory_block_is_rebuilt_only_at_a_compaction_boundary`'s.
    assert_eq!(
        pinned.store().lock().unwrap().index_text(),
        "- `layout` — a note"
    );
    let block = pinned
        .context_block()
        .expect("the markdown strategy pins a block once a memory exists");
    let rendered = block.content.clone().unwrap_or_default();
    assert!(rendered.contains("- `layout` — a note"), "{rendered}");
    assert!(
        !rendered.contains("THE-CONTENTS-OF-THE-MEMORY"),
        "the contents must stay out of the window until they are read: {rendered}"
    );
}

/// The pinned memory block costs the window **nothing until a compaction boundary** — the
/// prompt-cache half of gg's memory-in-the-window contract.
///
/// A block rebuilt every time the model curates re-sends every memory it holds in order to
/// tell it something its own tool result already told it, and on a long run that is most of
/// what memory costs. So while the thread is intact, the window carries no block at all.
///
/// The other half — that the memories *are* in the window verbatim on the far side of the
/// boundary, which is what makes carrying nothing before it safe — is
/// [`drive_compacts_at_the_threshold_and_retains_pinned_state`]. The two run the same
/// script deliberately: the same run that ends with the memory pinned begins with it
/// costing nothing.
#[tokio::test]
async fn the_memory_block_costs_nothing_until_the_boundary() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-refresh".to_string()), Box::new(sink.clone()));

    let (registry, skills, memories, tasks) = compaction_runtimes(dir.path());
    let client = MockClient::new("mock/echo", compaction_script());

    let agent = Agent::root(ROOT_PROFILE_ID);
    let end = agent
        .drive(
            &client,
            "go",
            &registry,
            &ctx,
            &emitter,
            &mut test_modules(test_context_setup_with_window(4_000), no_code().enabled)
                .with(ModuleHandle::Skills(skills))
                .with(ModuleHandle::Memories(memories))
                .with(ModuleHandle::Tasks(tasks))
                .with(ModuleHandle::Board(BoardRuntime::disabled())),
            DriveSetup {
                limits: no_limits(10),
                compaction: compaction_at(0.6),
                amc: no_amc(),
                autoload: no_autoload(),
                persistence: no_persistence(),
                read_policy: Some(ReadPolicy::Unlimited),
                shell_offload: OffloadPolicy::ample(),
                code: no_code(),
                discovery: DiscoveryWarning::default(),
                hooks: no_hooks(),
                ending_role: EndingRole::Standard,
                opening: Opening::Fresh,
                carried_programs: None,
                turn_base: 0,
                replay: None,
            },
            &[],
            &GgAgentConfig::root(),
            &GgCapabilitySet::default(),
            &mut None,
            None,
        )
        .await;
    assert_eq!(end.status, "completed");

    let events = sink.events();
    let compaction_pos = events
        .iter()
        .position(|e| matches!(e.kind, GgTelemetryKind::Compaction { .. }))
        .expect("the run crossed a compaction boundary");

    // The memory was written well before the boundary — the script writes it on turn two
    // and balloons the window on turn four — so there were turns in between that could
    // have carried a block, and none of them did.
    let wrote_at = events
        .iter()
        .position(|e| matches!(&e.kind, GgTelemetryKind::MemoryState { count, .. } if *count == 1))
        .expect("the scripted memory was written");
    assert!(
        wrote_at < compaction_pos,
        "the memory must be written before the boundary for this to prove anything"
    );
    let breakdowns_between = events[wrote_at..compaction_pos]
        .iter()
        .filter(|e| matches!(e.kind, GgTelemetryKind::ContextBreakdown { .. }))
        .count();
    assert!(
        breakdowns_between > 0,
        "there must be a turn between the write and the boundary"
    );

    let pre_boundary_peak = events[..compaction_pos]
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } => Some(
                by_source
                    .iter()
                    .find(|b| b.source == GgContextSource::Memory)
                    .map(|b| b.tokens)
                    .unwrap_or(0),
            ),
            _ => None,
        })
        .max()
        .unwrap_or(0);
    assert_eq!(
        pre_boundary_peak, 0,
        "no turn before the boundary pays for a memory block"
    );
    // And after it, it does — the same assertion the retention test makes, restated here
    // so this test reads as the whole before/after story rather than half of one.
    assert!(memory_band_tokens(&events) > 0);
}

// ---------------------------------------------------------------------------
// Tasks: the capability switch, and the blocked-by DAG driven through the loop
// ---------------------------------------------------------------------------

/// `minimal`, with the tasks capability disabled (the off arm of the comparison).
fn minimal_without_tasks(model: &str) -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal(model);
    for cap in &mut set.agents[0].capabilities {
        if cap.id == CAPABILITY_TASKS {
            cap.enabled = false;
        }
    }
    set
}

/// With the tasks capability off, the run offers no task tools and emits no `TasksState` —
/// even though the default script tries to build a DAG (switching the capability off makes the feature
/// vanish). The task calls come back as unknown tools, and no TaskList tokens accumulate.
#[tokio::test]
async fn run_without_tasks_capability_offers_no_task_tools_or_state() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-notasks".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), minimal_without_tasks("mock/echo"));

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);
    let events = sink.events();

    // No tasks telemetry at all.
    assert!(
        !events
            .iter()
            .any(|e| matches!(e.kind, GgTelemetryKind::TasksState { .. })),
        "tasks off must not emit any TasksState"
    );
    // No TaskList-source tokens ever accumulate.
    assert!(
        events.iter().all(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } =>
                by_source
                    .iter()
                    .find(|b| b.source == GgContextSource::TaskList)
                    .map(|b| b.tokens)
                    .unwrap_or(0)
                    == 0,
            _ => true,
        }),
        "tasks off must never account tokens to the TaskList source"
    );
    // The add_task call is withheld like any tool a run does not offer.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok, .. } if name == "add_task" && !*ok
        )),
        "add_task should be an unknown tool when the capability is off"
    );
    // The run still completes and builds the file.
    assert!(dir.path().join("index.html").exists());
    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
}

/// A blocked-by DAG driven through the loop: two tasks with an edge, a cycle-inducing edge
/// that is refused, then completion. The refused edge never applies, and the pinned task
/// list flips the dependent task from blocked to ready once its blocker is done.
#[tokio::test]
async fn drive_builds_a_dag_and_rejects_a_cycle_end_to_end() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-dag".to_string()), Box::new(sink.clone()));

    let tasks = TasksRuntime::new(50);
    let set = GgCapabilitySet::minimal("mock/echo");
    let library = Arc::new(SkillLibrary::empty());
    let registry = ToolRegistry::from_run(
        set.root(),
        &skills_modules(&library).with(ModuleHandle::Tasks(tasks.shared())),
        &AgentFacts::default(),
    );

    // add a, add b (blocked by a), try a blocked-by b (cycle → refused), complete a, stop.
    let call = |id: &str, name: &str, args: serde_json::Value| ModelResponse {
        text: Some(format!("{name} {id}")),
        tool_calls: vec![ToolCall {
            id: id.to_string(),
            name: name.to_string(),
            arguments: args,
        }],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts::default(),
        cost: None,
        provider: None,
        loop_aborts: LoopAborts::none(),
    };
    let client = MockClient::new(
        "mock/echo",
        vec![
            call("c1", "add_task", json!({ "id": "a", "title": "A" })),
            call(
                "c2",
                "add_task",
                json!({ "id": "b", "title": "B", "blockedBy": ["a"] }),
            ),
            call(
                "c3",
                "set_blocked_by",
                json!({ "id": "a", "blockedBy": ["b"] }),
            ),
            call("c4", "complete_task", json!({ "id": "a" })),
            stop_response(),
        ],
    );

    let agent = Agent::root(ROOT_PROFILE_ID);
    let end = agent
        .drive(
            &client,
            "go",
            &registry,
            &ctx,
            &emitter,
            &mut test_modules(test_context_setup(), no_code().enabled)
                .with(ModuleHandle::Skills(SkillsRuntime::disabled()))
                .with(ModuleHandle::Memories(MemoriesRuntime::disabled()))
                .with(ModuleHandle::Tasks(tasks))
                .with(ModuleHandle::Board(BoardRuntime::disabled())),
            DriveSetup {
                limits: no_limits(10),
                compaction: no_compaction(),
                amc: no_amc(),
                autoload: no_autoload(),
                persistence: no_persistence(),
                read_policy: Some(ReadPolicy::Unlimited),
                shell_offload: OffloadPolicy::ample(),
                code: no_code(),
                discovery: DiscoveryWarning::default(),
                hooks: no_hooks(),
                ending_role: EndingRole::Standard,
                opening: Opening::Fresh,
                carried_programs: None,
                turn_base: 0,
                replay: None,
            },
            &[],
            &GgAgentConfig::root(),
            &GgCapabilitySet::default(),
            &mut None,
            None,
        )
        .await;
    assert_eq!(end.status, "completed");

    let events = sink.events();

    // The cycle-inducing edge was refused.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok: false, .. } if name == "set_blocked_by"
        )),
        "the cycle edge must be refused"
    );

    // The final DAG: both tasks present, b still only blocked by a, a done.
    let last_tasks = events
        .iter()
        .rev()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::TasksState { tasks, .. } => Some(tasks.clone()),
            _ => None,
        })
        .expect("a TasksState was emitted");
    let a = last_tasks.iter().find(|t| t.id == "a").unwrap();
    let b = last_tasks.iter().find(|t| t.id == "b").unwrap();
    assert!(a.blocked_by.is_empty(), "the cycle edge never applied to a");
    assert_eq!(b.blocked_by, vec!["a".to_string()]);
    assert_eq!(a.status, test_cabinet_core::gg::GgTaskStatus::Done);

    // The pinned task list, once a is done, shows b as ready rather than blocked.
    let last_task_breakdown = events
        .iter()
        .rev()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } => Some(
                by_source
                    .iter()
                    .find(|b| b.source == GgContextSource::TaskList)
                    .map(|b| b.tokens)
                    .unwrap_or(0),
            ),
            _ => None,
        })
        .expect("a context breakdown was emitted");
    assert!(
        last_task_breakdown > 0,
        "the pinned task list is accounted to the TaskList source"
    );
}

/// **The task list is always a list the agent is shown.**
///
/// Every task tool is offered, every call lands in the store, every `TasksState` reaches the
/// console — and the pinned block enters the window on every turn. It is what the agent steers
/// its work by from turn to turn, so it is always carried in the prompt as its own message.
///
/// It is asserted from the loop rather than from the module because the claim is about *prompt
/// assembly*: the loop refreshes every module's block in one pass rather than naming the task
/// block, so a mistake here would be a mistake in the pass that refreshes them all.
#[tokio::test]
async fn drive_always_carries_the_task_list_in_the_window() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-tasks-pinned".to_string()), Box::new(sink.clone()));

    let tasks = TasksRuntime::new(50);
    let set = GgCapabilitySet::minimal("mock/echo");
    let library = Arc::new(SkillLibrary::empty());
    let registry = ToolRegistry::from_run(
        set.root(),
        &skills_modules(&library).with(ModuleHandle::Tasks(tasks.shared())),
        &AgentFacts::default(),
    );
    assert!(
        registry.tool_names().iter().any(|name| name == "add_task"),
        "the tasks module contributes every one of its tools"
    );

    let client = MockClient::new(
        "mock/echo",
        vec![
            ModelResponse {
                text: Some("adding a task".to_string()),
                tool_calls: vec![ToolCall {
                    id: "c1".to_string(),
                    name: "add_task".to_string(),
                    arguments: json!({ "id": "a", "title": "A task nobody is shown" }),
                }],
                finish_reason: FinishReason::ToolCalls,
                usage: TokenCounts::default(),
                cost: None,
                provider: None,
                loop_aborts: LoopAborts::none(),
            },
            stop_response(),
        ],
    );

    let end = Agent::root(ROOT_PROFILE_ID)
        .drive(
            &client,
            "go",
            &registry,
            &ctx,
            &emitter,
            &mut test_modules(test_context_setup(), no_code().enabled)
                .with(ModuleHandle::Skills(SkillsRuntime::disabled()))
                .with(ModuleHandle::Memories(MemoriesRuntime::disabled()))
                .with(ModuleHandle::Tasks(tasks))
                .with(ModuleHandle::Board(BoardRuntime::disabled())),
            DriveSetup {
                limits: no_limits(5),
                compaction: no_compaction(),
                amc: no_amc(),
                autoload: no_autoload(),
                persistence: no_persistence(),
                read_policy: Some(ReadPolicy::Unlimited),
                shell_offload: OffloadPolicy::ample(),
                code: no_code(),
                discovery: DiscoveryWarning::default(),
                hooks: no_hooks(),
                ending_role: EndingRole::Standard,
                opening: Opening::Fresh,
                carried_programs: None,
                turn_base: 0,
                replay: None,
            },
            &[],
            &GgAgentConfig::root(),
            &GgCapabilitySet::default(),
            &mut None,
            None,
        )
        .await;
    assert_eq!(end.status, "completed");

    let events = sink.events();
    // The call ran and the store took it — the module is live, not switched off.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok, .. } if name == "add_task" && *ok
        )),
        "the task tools work"
    );
    let last_tasks = events
        .iter()
        .rev()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::TasksState { tasks, .. } => Some(tasks.clone()),
            _ => None,
        })
        .expect("the module reports its state");
    assert_eq!(last_tasks.len(), 1);

    // ...and once there is a task, the window carries the list.
    assert!(
        events.iter().any(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } =>
                by_source
                    .iter()
                    .find(|band| band.source == GgContextSource::TaskList)
                    .map(|band| band.tokens)
                    .unwrap_or(0)
                    > 0,
            _ => false,
        }),
        "a task list with contents accounts tokens to the TaskList source"
    );
}

// ---------------------------------------------------------------------------
// Epics & issues: the capability switch, and the board built through the loop
// ---------------------------------------------------------------------------

/// `minimal`, plus the (opt-in) project-management capability enabled. The Root lists itself in its
/// roster because an issue is filed *assigned* to one of its implementers, and is its own merge
/// agent (which the capability requires).
fn minimal_with_epics_issues(model: &str) -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal(model);
    crate::tools::grant_configured(
        &mut set.agents[0],
        crate::tools::configured(
            CAPABILITY_PROJECT_MANAGEMENT,
            json!({ PROJECT_MANAGEMENT_PARAM_MERGE_AGENT: ROOT_PROFILE_ID }),
        ),
    );
    set.agents[0]
        .subagents
        .push(GgSubagentRef::any(ROOT_PROFILE_ID));
    set
}

/// With the project-management capability off (its default — it is opt-in), the run offers no
/// board tools and emits no `BoardState`, even though the default script tries to build a board.
/// The board calls come back as unknown tools.
#[tokio::test]
async fn run_without_epics_issues_capability_offers_no_board_tools_or_state() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-noboard".to_string()), Box::new(sink.clone()));
    // `minimal` does not include project-management, so the board is off.
    let inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/echo"));

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);
    let events = sink.events();

    // No board telemetry at all.
    assert!(
        !events
            .iter()
            .any(|e| matches!(e.kind, GgTelemetryKind::BoardState { .. })),
        "the board off must not emit any BoardState"
    );
    // The create_epic call is withheld like any tool a run does not offer.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok, .. } if name == "create_epic" && !*ok
        )),
        "create_epic should be an unknown tool when the capability is off"
    );
    // The run still completes and builds the file.
    assert!(dir.path().join("index.html").exists());
    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
}

/// The offline default script builds a board end to end when the capability is enabled: an epic,
/// two issues with a blocked-by edge, and a refused cycle-inducing edge. Mirrors the tasks DAG
/// e2e but exercises the heavyweight tier through the full `run` path.
#[tokio::test]
async fn run_builds_a_board_end_to_end_when_epics_issues_enabled() {
    use crate::client::{DEFAULT_MOCK_EPIC, DEFAULT_MOCK_ISSUE_INPUT, DEFAULT_MOCK_ISSUE_RENDER};

    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-board".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), minimal_with_epics_issues("mock/echo"));

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);
    let events = sink.events();

    // The board tools were offered and used: the epic and both issues were created.
    for (tool, ok_expected) in [
        ("create_epic", true),
        ("create_issue", true),
        ("set_issue_blocked_by", false),
    ] {
        assert!(
            events.iter().any(|e| matches!(
                &e.kind,
                GgTelemetryKind::ToolResult { name, ok, .. }
                    if name == tool && *ok == ok_expected
            )),
            "expected `{tool}` result ok={ok_expected}"
        );
    }

    // The final board: the epic, both issues, the input issue blocked by the render issue, and
    // the refused cycle never applied (the render issue has no blockers).
    let last_board = events
        .iter()
        .rev()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::BoardState { epics, issues, .. } => {
                Some((epics.clone(), issues.clone()))
            }
            _ => None,
        })
        .expect("a BoardState was emitted");
    let (epics, issues) = last_board;
    assert!(epics.iter().any(|epic| epic.id == DEFAULT_MOCK_EPIC));
    let render = issues
        .iter()
        .find(|i| i.id == DEFAULT_MOCK_ISSUE_RENDER)
        .expect("the render issue exists");
    let input = issues
        .iter()
        .find(|i| i.id == DEFAULT_MOCK_ISSUE_INPUT)
        .expect("the input issue exists");
    assert!(
        render.blocked_by.is_empty(),
        "the cycle edge never applied to the render issue"
    );
    assert_eq!(
        input.blocked_by,
        vec![DEFAULT_MOCK_ISSUE_RENDER.to_string()]
    );
    assert_eq!(input.epic_id.as_deref(), Some(DEFAULT_MOCK_EPIC));
    // The structured dispatch brief survives onto the board.
    assert!(!render.in_scope.is_empty());
    assert!(!render.out_of_scope.is_empty());
    assert!(!render.completion_criteria.is_empty());
}

// ---------------------------------------------------------------------------
// Compaction: the threshold trigger, pinned-state retention, and the off arm
// ---------------------------------------------------------------------------

/// A big-text assistant turn that also calls a harmless tool (so the loop continues),
/// ballooning the ephemeral history to push the window past the compaction threshold.
fn balloon_turn(id: &str) -> ModelResponse {
    ModelResponse {
        text: Some("ephemeral working notes ".repeat(600)),
        tool_calls: vec![ToolCall {
            id: id.to_string(),
            name: "list_dir".to_string(),
            arguments: json!({ "path": "." }),
        }],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts::default(),
        cost: None,
        provider: None,
        loop_aborts: LoopAborts::none(),
    }
}

/// The script that establishes pinned state (a read skill, a memory, a task), then
/// balloons the window, then stops — five scripted turns.
fn compaction_script() -> Vec<ModelResponse> {
    vec![
        read_skill_call("c_skill", DEFAULT_MOCK_SKILL),
        write_memory_call("c_mem", "plan", "the game is an arrow-key maze runner"),
        ModelResponse {
            text: Some("planning the scaffold".to_string()),
            tool_calls: vec![ToolCall {
                id: "c_task".to_string(),
                name: "add_task".to_string(),
                arguments: json!({ "id": "t1", "title": "Scaffold the page" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts::default(),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
        },
        balloon_turn("c_ls"),
        stop_response(),
    ]
}

/// Build the runtimes + registry for a compaction drive test: a one-skill library, an
/// empty memory store, and an empty task store, all bound into the toolset.
fn compaction_runtimes(dir: &Path) -> (ToolRegistry, SkillsRuntime, MemoriesRuntime, TasksRuntime) {
    seed_default_skill(dir);
    let library = Arc::new(SkillLibrary::loaded(&dir.join(".gg").join("skills")));
    assert_eq!(library.len(), 1, "the seeded skill loaded");
    let skills = SkillsRuntime::new(Arc::clone(&library));
    let memories = MemoriesRuntime::new(
        crate::memories::MemoryStrategy::Scratchpad,
        crate::memories::MemoryCaps::UNBOUNDED,
    );
    let tasks = TasksRuntime::new(50);
    let set = GgCapabilitySet::minimal("mock/echo");
    let registry = ToolRegistry::from_run(
        set.root(),
        &skills_modules(&library)
            .with(ModuleHandle::Memories(memories.shared()))
            .with(ModuleHandle::Tasks(tasks.shared())),
        &AgentFacts::default(),
    );
    (registry, skills, memories, tasks)
}

/// A short mock run crosses a compaction boundary: once the ballooned ephemeral history
/// pushes the window past the threshold, the loop summarizes and restarts the thread —
/// keeping the pinned skill, memory, and task list verbatim and reclaiming the window.
#[tokio::test]
async fn drive_compacts_at_the_threshold_and_retains_pinned_state() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-compact".to_string()), Box::new(sink.clone()));

    let (registry, skills, memories, tasks) = compaction_runtimes(dir.path());
    let client = MockClient::new("mock/echo", compaction_script());

    // A small window and a moderate threshold, so the ballooned ephemeral turn crosses it
    // while the pinned prefix alone stays under it.
    let agent = Agent::root(ROOT_PROFILE_ID);
    let end = agent
        .drive(
            &client,
            "go",
            &registry,
            &ctx,
            &emitter,
            &mut test_modules(test_context_setup_with_window(4_000), no_code().enabled)
                .with(ModuleHandle::Skills(skills))
                .with(ModuleHandle::Memories(memories))
                .with(ModuleHandle::Tasks(tasks))
                .with(ModuleHandle::Board(BoardRuntime::disabled())),
            DriveSetup {
                limits: no_limits(10),
                compaction: compaction_at(0.6),
                amc: no_amc(),
                autoload: no_autoload(),
                persistence: no_persistence(),
                read_policy: Some(ReadPolicy::Unlimited),
                shell_offload: OffloadPolicy::ample(),
                code: no_code(),
                discovery: DiscoveryWarning::default(),
                hooks: no_hooks(),
                ending_role: EndingRole::Standard,
                opening: Opening::Fresh,
                carried_programs: None,
                turn_base: 0,
                replay: None,
            },
            &[],
            &GgAgentConfig::root(),
            &GgCapabilitySet::default(),
            &mut None,
            None,
        )
        .await;
    assert_eq!(end.status, "completed");

    let events = sink.events();

    // Exactly one compaction boundary, and it reclaimed the window with the retention proof.
    let compactions: Vec<_> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::Compaction {
                trigger_fullness,
                before_tokens,
                after_tokens,
                summary_tokens,
                retained,
                ..
            } => Some((
                *trigger_fullness,
                *before_tokens,
                *after_tokens,
                *summary_tokens,
                *retained,
            )),
            _ => None,
        })
        .collect();
    assert_eq!(compactions.len(), 1, "the run crossed exactly one boundary");
    let (trigger, before, after, summary_tokens, retained) = compactions[0];
    assert_eq!(trigger, 0.6);
    assert!(
        after < before,
        "compaction reclaimed window (after < before)"
    );
    assert!(summary_tokens > 0);
    // The pinned state that survived: a read skill, a task, and a memory.
    assert_eq!(retained.skills, 1, "the read skill was retained");
    assert_eq!(retained.tasks, 1, "the task list was retained");
    assert_eq!(retained.memories, 1, "the memory was retained");

    // The next context breakdown after the boundary reflects the reclaimed window.
    let compaction_pos = events
        .iter()
        .position(|e| matches!(e.kind, GgTelemetryKind::Compaction { .. }))
        .unwrap();
    let post_total = events[compaction_pos..]
        .iter()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { total_tokens, .. } => Some(*total_tokens),
            _ => None,
        })
        .expect("a breakdown follows the compaction");
    assert_eq!(
        post_total, after,
        "the post-compaction breakdown shows the reclaimed total"
    );
    assert!(post_total < before);

    // Retention held live: the pinned bands are still accounted after the boundary, and the
    // ephemeral bands were reclaimed.
    let post_breakdown = events[compaction_pos..]
        .iter()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } => Some(by_source.clone()),
            _ => None,
        })
        .unwrap();
    let band = |source: GgContextSource| {
        post_breakdown
            .iter()
            .find(|b| b.source == source)
            .map(|b| b.tokens)
            .unwrap_or(0)
    };
    assert!(band(GgContextSource::Skill) > 0, "the skill body survived");
    assert!(band(GgContextSource::Memory) > 0, "the memory survived");
    assert!(
        band(GgContextSource::TaskList) > 0,
        "the task list survived"
    );
    assert!(
        band(GgContextSource::History) > 0,
        "the summary is in the window"
    );
    assert_eq!(
        band(GgContextSource::Assistant),
        0,
        "the ephemeral turns were reclaimed"
    );

    // The pinned state is intact in its own telemetry too.
    let last_memory = events
        .iter()
        .rev()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::MemoryState { memories, .. } => Some(memories.clone()),
            _ => None,
        })
        .expect("a MemoryState was emitted");
    assert!(last_memory.iter().any(|m| m.name == "plan"));
    let last_tasks = events
        .iter()
        .rev()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::TasksState { tasks, .. } => Some(tasks.clone()),
            _ => None,
        })
        .expect("a TasksState was emitted");
    assert!(last_tasks.iter().any(|t| t.id == "t1"));
    let last_skills = events
        .iter()
        .rev()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::SkillsState { skills, .. } => Some(skills.clone()),
            _ => None,
        })
        .expect("a SkillsState was emitted");
    assert!(
        last_skills
            .iter()
            .any(|s| s.name == DEFAULT_MOCK_SKILL && s.read)
    );
}

/// The same window-crossing run with the compaction capability **off** never compacts: no
/// Compaction event is emitted even though the window overflows, and the run still finishes.
#[tokio::test]
async fn drive_never_compacts_when_capability_off() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-nocompact".to_string()), Box::new(sink.clone()));

    let (registry, skills, memories, tasks) = compaction_runtimes(dir.path());
    let client = MockClient::new("mock/echo", compaction_script());

    let agent = Agent::root(ROOT_PROFILE_ID);
    let end = agent
        .drive(
            &client,
            "go",
            &registry,
            &ctx,
            &emitter,
            &mut test_modules(test_context_setup_with_window(4_000), no_code().enabled)
                .with(ModuleHandle::Skills(skills))
                .with(ModuleHandle::Memories(memories))
                .with(ModuleHandle::Tasks(tasks))
                .with(ModuleHandle::Board(BoardRuntime::disabled())),
            DriveSetup {
                limits: no_limits(10),
                compaction: no_compaction(),
                amc: no_amc(),
                autoload: no_autoload(),
                persistence: no_persistence(),
                read_policy: Some(ReadPolicy::Unlimited),
                shell_offload: OffloadPolicy::ample(),
                code: no_code(),
                discovery: DiscoveryWarning::default(),
                hooks: no_hooks(),
                ending_role: EndingRole::Standard,
                opening: Opening::Fresh,
                carried_programs: None,
                turn_base: 0,
                replay: None,
            },
            &[],
            &GgAgentConfig::root(),
            &GgCapabilitySet::default(),
            &mut None,
            None,
        )
        .await;
    assert_eq!(end.status, "completed");

    let events = sink.events();
    assert!(
        !events
            .iter()
            .any(|e| matches!(e.kind, GgTelemetryKind::Compaction { .. })),
        "compaction off must never emit a Compaction event"
    );
    // The window did overflow (proving the off arm is what suppressed compaction, not a
    // window that never filled).
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ContextBreakdown { fullness: Some(f), .. } if *f >= 0.6
        )),
        "the window crossed the threshold, yet nothing compacted"
    );
}

// ---------------------------------------------------------------------------
// Agent-managed context, end to end through the loop
// ---------------------------------------------------------------------------

/// A capability set with the agent-managed-context capability enabled on top of the minimal
/// defaults, so the reclaim tools are offered and the fullness signal is injected.
fn minimal_with_amc(model: &str) -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal(model);
    crate::tools::grant(&mut set.agents[0], CAPABILITY_AGENT_MANAGED_CONTEXT);
    set
}

/// The context-usage block is shaped by what its agent was actually given: the per-file breakdown
/// appears only for an agent that can evict, its length is the agent's own configuration, and the
/// turn headers are armed only for an agent that can archive.
#[test]
fn amc_setup_reads_the_agents_own_toolset_and_configuration() {
    let library = Arc::new(SkillLibrary::empty());
    let archive = Arc::new(Mutex::new(ArchiveStore::new()));
    let resolve = |profile: &GgAgentConfig| {
        let registry = ToolRegistry::from_run(
            profile,
            &skills_modules(&library).with(ModuleHandle::Archive(ArchiveRuntime::from_store(
                Arc::clone(&archive),
            ))),
            &AgentFacts::default(),
        );
        let (granted, _) =
            crate::sandbox::resolve_operations(profile.operations.iter().map(String::as_str));
        AmcSetup::resolve(
            profile,
            &registry,
            Arc::clone(&archive),
            "archive-0".to_string(),
            // The run's own resolution, threaded in exactly as the loop threads it: the language is
            // resolved once per agent and read from there, never re-derived per consumer.
            profile.is_enabled(CAPABILITY_RESPONSES_AS_CODE).then(|| {
                crate::sandbox::resolve_program_language(
                    profile,
                    &mut crate::validate::LaunchReport::Discarding,
                )
            }),
            &granted,
        )
    };

    // Off: no signal, no reclaim, and nothing to configure.
    let off = resolve(&GgAgentConfig::root());
    assert!(!off.enabled);
    assert!(!off.can_evict && !off.can_archive);

    // On, authored the way a new capability is written: both reclaim tools, and the breakdown
    // length the authoring catalog puts in the document. Nothing here is a figure gg stood in for
    // an absent one — `GgCapabilityConfig::enabled` wrote it down, and the resolver read what was
    // written.
    let authored = test_cabinet_core::gg::authored_capability(CAPABILITY_AGENT_MANAGED_CONTEXT)
        .and_then(|entry| entry.params.get(PARAM_TOP_FILE_VIEWS))
        .and_then(serde_json::Value::as_u64)
        .expect("the authoring catalog writes a top-file-views figure") as usize;
    let authored_threshold =
        test_cabinet_core::gg::authored_capability(CAPABILITY_AGENT_MANAGED_CONTEXT)
            .and_then(|entry| entry.params.get(PARAM_SIGNAL_THRESHOLD_PERCENT))
            .and_then(serde_json::Value::as_u64)
            .expect("the authoring catalog writes a signal threshold");
    assert_eq!(authored_threshold, DEFAULT_SIGNAL_THRESHOLD_PERCENT);
    let mut on = GgAgentConfig::root();
    crate::tools::grant(&mut on, CAPABILITY_AGENT_MANAGED_CONTEXT);
    let written = resolve(&on);
    assert!(written.enabled && written.can_evict && written.can_archive);
    assert_eq!(written.top_file_views, authored);
    assert_eq!(
        written.signal_options(),
        UsageSignalOptions {
            can_evict: true,
            // A tool-calling agent has no `view` object, so the block must not point at `view.close`.
            program_language: None,
            can_close_views: false,
            can_archive: true,
            top_file_views: authored,
            threshold_percent: authored_threshold,
        }
    );

    // A code agent holds `views.close` exactly when its grant names it: the capability buys the
    // call and the allowlist grants it, and the signal reads the grant rather than the mode.
    let mut code = GgAgentConfig::root();
    crate::tools::grant(&mut code, CAPABILITY_RESPONSES_AS_CODE);
    crate::tools::grant(&mut code, CAPABILITY_AGENT_MANAGED_CONTEXT);
    assert!(
        resolve(&code).can_close_views,
        "a code agent granted the capability's calls holds `views.close`"
    );
    code.operations.retain(|id| id != "views.close");
    assert!(
        !resolve(&code).can_close_views,
        "an allowlist that omits `views.close` withholds it from the signal too"
    );

    // On, configured: the breakdown is as long as the profile asked for.
    let mut configured = GgAgentConfig::root();
    crate::tools::grant_configured(
        &mut configured,
        crate::tools::configured(
            CAPABILITY_AGENT_MANAGED_CONTEXT,
            json!({ PARAM_TOP_FILE_VIEWS: 12 }),
        ),
    );
    assert_eq!(resolve(&configured).top_file_views, 12);

    // The threshold is read the same way, and a document that says nothing about it is the one
    // absence gg answers with a figure of its own.
    let mut quiet = GgAgentConfig::root();
    crate::tools::grant_configured(
        &mut quiet,
        crate::tools::configured(
            CAPABILITY_AGENT_MANAGED_CONTEXT,
            json!({ PARAM_TOP_FILE_VIEWS: 5 }),
        ),
    );
    assert_eq!(
        resolve(&quiet).signal_threshold_percent,
        DEFAULT_SIGNAL_THRESHOLD_PERCENT
    );

    let mut eager = GgAgentConfig::root();
    crate::tools::grant_configured(
        &mut eager,
        crate::tools::configured(
            CAPABILITY_AGENT_MANAGED_CONTEXT,
            json!({ PARAM_TOP_FILE_VIEWS: 5, PARAM_SIGNAL_THRESHOLD_PERCENT: 0 }),
        ),
    );
    assert_eq!(resolve(&eager).signal_threshold_percent, 0);

    // An ungranted tool is read off the registry rather than assumed from the capability, so the
    // block never points at a call this agent does not have.
    let mut without_evict = on.clone();
    without_evict
        .tools
        .retain(|name| name != EVICT_FILE_VIEW_TOOL);
    let narrowed = resolve(&without_evict);
    assert!(narrowed.enabled && narrowed.can_archive);
    assert!(!narrowed.can_evict);

    // `view.close` is read off the responses-as-code capability rather than the registry, because
    // `view` is not a tool: it is bound into every program's scope unconditionally. Without this an
    // agent could be shown a `Text Views` band with no call named that reclaims it.
    let mut code = on.clone();
    crate::tools::grant(&mut code, CAPABILITY_RESPONSES_AS_CODE);
    assert!(resolve(&code).program_language.is_some());
}

/// The FileView token band of every emitted `ContextBreakdown`, in order.
fn file_view_bands(events: &[test_cabinet_core::gg::GgTelemetryEvent]) -> Vec<u64> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } => Some(
                by_source
                    .iter()
                    .find(|b| b.source == GgContextSource::FileView)
                    .map(|b| b.tokens)
                    .unwrap_or(0),
            ),
            _ => None,
        })
        .collect()
}

/// The offline agent-managed-context e2e: the scripted mock writes and reads a file, evicts the
/// file view (reclaiming it), archives the older thread, then searches the archive to recover
/// it. The stream carries the `ContextManaged` effects, the file-view band drops to zero, and
/// the shared archive holds the recovered material.
#[tokio::test]
async fn drive_manages_context_end_to_end() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-amc".to_string()), Box::new(sink.clone()));

    let set = minimal_with_amc("mock/echo");
    let archive = Arc::new(Mutex::new(ArchiveStore::new()));
    let library = Arc::new(SkillLibrary::empty());
    let registry = ToolRegistry::from_run(
        set.root(),
        &skills_modules(&library).with(ModuleHandle::Archive(ArchiveRuntime::from_store(
            Arc::clone(&archive),
        ))),
        &AgentFacts::default(),
    );

    let client = MockClient::with_agent_managed_context_script("mock/echo");
    let agent = Agent::root(ROOT_PROFILE_ID);
    let end = agent
        .drive(
            &client,
            "go",
            &registry,
            &ctx,
            &emitter,
            &mut test_modules(test_context_setup(), no_code().enabled)
                .with(ModuleHandle::Skills(SkillsRuntime::disabled()))
                .with(ModuleHandle::Memories(MemoriesRuntime::disabled()))
                .with(ModuleHandle::Tasks(TasksRuntime::disabled()))
                .with(ModuleHandle::Board(BoardRuntime::disabled())),
            DriveSetup {
                limits: no_limits(20),
                compaction: no_compaction(),
                amc: amc_with(Arc::clone(&archive)),
                autoload: no_autoload(),
                persistence: no_persistence(),
                read_policy: Some(ReadPolicy::Unlimited),
                shell_offload: OffloadPolicy::ample(),
                code: no_code(),
                discovery: DiscoveryWarning::default(),
                hooks: no_hooks(),
                ending_role: EndingRole::Standard,
                opening: Opening::Fresh,
                carried_programs: None,
                turn_base: 0,
                replay: None,
            },
            &[],
            &GgAgentConfig::root(),
            &GgCapabilitySet::default(),
            &mut None,
            None,
        )
        .await;
    assert_eq!(end.status, "completed");

    let events = sink.events();

    // (a) an evict ContextManaged effect that actually reclaimed tokens.
    let evict = events
        .iter()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::ContextManaged {
                action: GgContextAction::EvictFileViews,
                reclaimed_tokens,
                items,
                ..
            } => Some((*reclaimed_tokens, *items)),
            _ => None,
        })
        .expect("an evict_file_views ContextManaged event");
    assert!(evict.0 > 0, "the eviction reclaimed tokens");
    assert_eq!(evict.1, 1, "one file view was evicted");

    // (b) an archive ContextManaged effect.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ContextManaged {
                action: GgContextAction::ArchiveThread,
                ..
            }
        )),
        "an archive_thread ContextManaged event"
    );

    // (c) the file-view band rose (after the read) and fell back to zero (after the evict).
    let bands = file_view_bands(&events);
    assert!(
        bands.iter().any(|&t| t > 0),
        "the file view entered the window"
    );
    assert_eq!(
        *bands.last().unwrap(),
        0,
        "the file-view band drops to zero after eviction"
    );

    // (d) search_archive recovered the archived reference (a successful hit), and the shared
    // archive still holds the material out of the live window.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok: true, summary: Some(s), .. }
                if name == "search_archive" && s.contains("archive hit")
        )),
        "search_archive returned a hit"
    );
    assert!(
        !archive.lock().unwrap().search("level.json", 10).is_empty(),
        "the archived thread material remains searchable after the run"
    );

    // (e) every tool result the run sent carried a turn header, so the model had the turn numbers
    // its `archive_thread` call named and the per-result cost to choose between them.
    let results: Vec<String> = logged_messages(&events)
        .into_iter()
        .filter(|(role, _)| role == "tool")
        .map(|(_, content)| content)
        .collect();
    assert!(!results.is_empty(), "the run sent tool results");
    for result in &results {
        assert!(
            result.starts_with("Turn #") && result.contains(" tokens\n----\n"),
            "every tool result is headed with its turn and cost: {result:?}"
        );
    }

    // (f) exactly one context-usage block was ever sent. Its previous incarnation was a pinned
    // thread item that had to be superseded rather than removed, so a long run accumulated a
    // trail of stale readings — and a compaction carried the live one across on top of that.
    for prompt in prompt_contents(&events) {
        assert_eq!(
            prompt
                .iter()
                .filter(|content| content.starts_with("Context Usage:"))
                .count(),
            1,
            "one usage block per prompt: {prompt:?}"
        );
        assert!(
            prompt
                .last()
                .is_some_and(|c| c.starts_with("Context Usage:")),
            "and it is the last message of the prompt: {prompt:?}"
        );
    }
}

/// Every pooled context message the stream carried, as `(role, content)`.
fn logged_messages(events: &[test_cabinet_core::gg::GgTelemetryEvent]) -> Vec<(String, String)> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::ContextMessage {
                role,
                content: Some(content),
                ..
            } => Some((role.clone(), content.clone())),
            _ => None,
        })
        .collect()
}

/// Each `Prompt` event's message bodies, in the order they were sent — resolved through the
/// message pool the references point into.
fn prompt_contents(events: &[test_cabinet_core::gg::GgTelemetryEvent]) -> Vec<Vec<String>> {
    let mut pool: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut prompts = Vec::new();
    for event in events {
        match &event.kind {
            GgTelemetryKind::ContextMessage { id, content, .. } => {
                pool.insert(id.clone(), content.clone().unwrap_or_default());
            }
            GgTelemetryKind::Prompt { request, .. } => {
                prompts.push(
                    request
                        .iter()
                        .map(|reference| pool[&reference.id].clone())
                        .collect(),
                );
            }
            _ => {}
        }
    }
    prompts
}

/// With the capability off, none of the agent-managed-context tools are offered and no
/// `ContextManaged` effect or fullness signal is produced — the capability-off arm. Driving the
/// same script, every reclaim/search call comes back as an unknown-tool error and the run still
/// completes.
#[tokio::test]
async fn drive_without_amc_offers_no_context_management() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-no-amc".to_string()), Box::new(sink.clone()));

    // Minimal set (no agent-managed-context), and no archive bound to the registry.
    let set = GgCapabilitySet::minimal("mock/echo");
    let library = Arc::new(SkillLibrary::empty());
    let registry = ToolRegistry::from_run(
        set.root(),
        &skills_modules(&library),
        &AgentFacts::default(),
    );
    for name in ["evict_file_view", "archive_thread", "search_archive"] {
        assert!(
            !registry.definitions().iter().any(|d| d.name == name),
            "`{name}` must not be offered when the capability is off"
        );
    }

    let client = MockClient::with_agent_managed_context_script("mock/echo");
    let agent = Agent::root(ROOT_PROFILE_ID);
    let end = agent
        .drive(
            &client,
            "go",
            &registry,
            &ctx,
            &emitter,
            &mut test_modules(test_context_setup(), no_code().enabled)
                .with(ModuleHandle::Skills(SkillsRuntime::disabled()))
                .with(ModuleHandle::Memories(MemoriesRuntime::disabled()))
                .with(ModuleHandle::Tasks(TasksRuntime::disabled()))
                .with(ModuleHandle::Board(BoardRuntime::disabled())),
            DriveSetup {
                limits: no_limits(20),
                compaction: no_compaction(),
                amc: no_amc(),
                autoload: no_autoload(),
                persistence: no_persistence(),
                read_policy: Some(ReadPolicy::Unlimited),
                shell_offload: OffloadPolicy::ample(),
                code: no_code(),
                discovery: DiscoveryWarning::default(),
                hooks: no_hooks(),
                ending_role: EndingRole::Standard,
                opening: Opening::Fresh,
                carried_programs: None,
                turn_base: 0,
                replay: None,
            },
            &[],
            &GgAgentConfig::root(),
            &GgCapabilitySet::default(),
            &mut None,
            None,
        )
        .await;
    assert_eq!(end.status, "completed");

    let events = sink.events();
    assert!(
        !events
            .iter()
            .any(|e| matches!(e.kind, GgTelemetryKind::ContextManaged { .. })),
        "the off arm must never emit a ContextManaged event"
    );
    // No fullness signal reached the model: no context item content starts with the signal
    // line (the breakdown's System band is only the base prompt).
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok: false, .. } if name == "evict_file_view"
        )),
        "the reclaim call falls through to an unknown-tool error when the capability is off"
    );
}

// ---------------------------------------------------------------------------
// Phase 4: the agent abstraction, agent-tagged telemetry, and per-slot accounting
// ---------------------------------------------------------------------------

/// The single-agent run is tagged as the root agent end to end: every emitted event carries
/// `agentId: "root"` and no parent, an `AgentSpawned` announces the root (its slot, model, depth,
/// and no brief) before the loop runs, and a `SlotUsage` rollup for the primary slot is emitted at
/// the end — while the run still builds the artifact exactly as before.
#[tokio::test]
async fn run_tags_events_as_root_and_emits_agent_spawned_and_slot_usage() {
    let dir = TempDir::new().unwrap();
    seed_default_skill(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-agent".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/echo"));

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);

    // The single-agent run still produced the artifact (the refactor is behavior-preserving).
    assert!(dir.path().join("index.html").exists());

    let events = sink.events();

    // (a) Every event an agent emits carries that agent's id and (for the root) no parent — the
    //     attribution the subagent tree is reconstructed from.
    assert!(
        events
            .iter()
            .all(|e| e.agent_id.as_deref() == Some(ROOT_AGENT_ID) && e.parent_agent_id.is_none()),
        "every event must be tagged with the root agent id and no parent"
    );

    // (b) Exactly one AgentSpawned for the root: primary slot, the resolved mock model, depth 0,
    //     and no brief (the root is driven by the build prompt, not a delegated brief).
    let spawns: Vec<_> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::AgentSpawned {
                profile_id,
                model_id,
                depth,
                brief,
                worktree,
                cwd,
            } => Some((
                profile_id.clone(),
                model_id.clone(),
                *depth,
                brief.clone(),
                worktree.clone(),
                cwd.clone(),
            )),
            _ => None,
        })
        .collect();
    assert_eq!(spawns.len(), 1, "exactly one AgentSpawned for the root");
    let (profile_id, model_id, depth, brief, worktree, cwd) = &spawns[0];
    assert_eq!(profile_id, ROOT_PROFILE_ID);
    assert_eq!(model_id, "mock/echo");
    assert_eq!(*depth, 0);
    assert!(brief.is_none(), "the root carries no delegated brief");
    assert!(
        worktree.is_none(),
        "the root runs in the main tree, not a worktree"
    );
    // …and the spawn says *where* that tree is: the root's working directory is the workspace, which
    // is what its tools (and any command it runs without a path) are rooted at.
    assert_eq!(
        cwd.as_str(),
        dir.path().to_string_lossy().as_ref(),
        "the root's announced working directory is the workspace"
    );

    // The spawn announces the agent before its first turn runs.
    let spawn_pos = events
        .iter()
        .position(|e| matches!(e.kind, GgTelemetryKind::AgentSpawned { .. }))
        .unwrap();
    let first_turn = events
        .iter()
        .position(|e| matches!(e.kind, GgTelemetryKind::TurnStarted {}))
        .unwrap();
    assert!(
        spawn_pos < first_turn,
        "AgentSpawned precedes the first turn"
    );

    // (c) A per-slot usage rollup for the primary slot, summing the run's usage and cost, emitted
    //     near the end (after the loop, before the terminal SessionEnded).
    let rollups: Vec<_> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::SlotUsage {
                profile_id,
                model_id,
                tokens,
                cost,
            } => Some((profile_id.clone(), model_id.clone(), *tokens, *cost)),
            _ => None,
        })
        .collect();
    assert_eq!(rollups.len(), 1, "one SlotUsage rollup for the one slot");
    let (profile_id, model_id, tokens, cost) = &rollups[0];
    assert_eq!(profile_id, ROOT_PROFILE_ID);
    assert_eq!(model_id, "mock/echo");
    assert!(
        tokens.total().is_some_and(|t| t > 0),
        "the primary-slot rollup sums the run's tokens"
    );
    assert!(
        cost.and_then(|c| c.comparable).is_some_and(|c| c > 0.0),
        "the primary-slot rollup sums the run's cost"
    );

    // The rollup sums the same tokens the per-turn Usage deltas report (it is a rollup, not an
    // extra delta — an ingester sums the deltas, so the two must agree).
    let summed: u64 = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::Usage { tokens, .. } => tokens.total(),
            _ => None,
        })
        .sum();
    assert_eq!(
        tokens.total(),
        Some(summed),
        "the SlotUsage rollup equals the sum of the per-turn Usage deltas"
    );
    // And each delta says whose spend it is, so a consumer need not wait for the rollup (or guess
    // from the capability set) to know which model the money went to.
    assert_eq!(
        usage_by_slot_model(&events),
        HashMap::from([(
            (ROOT_PROFILE_ID.to_string(), "mock/echo".to_string()),
            summed
        )]),
        "every usage delta is attributed to the profile and model that spent it"
    );

    // The rollup is emitted after the loop (after the last TurnStarted) and before SessionEnded.
    let slot_usage_pos = events
        .iter()
        .position(|e| matches!(e.kind, GgTelemetryKind::SlotUsage { .. }))
        .unwrap();
    let last_turn = events
        .iter()
        .rposition(|e| matches!(e.kind, GgTelemetryKind::TurnStarted {}))
        .unwrap();
    let session_end = events
        .iter()
        .position(|e| matches!(e.kind, GgTelemetryKind::SessionEnded { .. }))
        .unwrap();
    assert!(last_turn < slot_usage_pos && slot_usage_pos < session_end);
}

/// A session whose credential is refused mid-flight is a **launch failure**, exactly as a
/// missing credential is: the process exits non-zero so `core` records a harness error
/// instead of collecting an empty tree and scoring it against a model that never ran.
#[tokio::test]
async fn run_reports_a_refused_credential_as_a_launch_failure() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-auth".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/primary"));
    let factory = ScriptedFactory::new().slot(ROOT_PROFILE_ID, |_| {
        Box::new(FailingClient {
            mode: FailureMode::Auth,
        })
    });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::HarnessError,
    );

    // The terminal status names the credential, so the failure is legible in the stream
    // rather than only in the exit code.
    let events = sink.events();
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::SessionEnded { status } if status == "auth_error"
        )),
        "the session must end `auth_error`, not `model_error`"
    );
}

/// A session whose root spent the client's whole retry schedule ends `model_error` and exits `1`:
/// the failure is the provider's, and the host retries a harness error rather than scoring a run
/// an outage cut short.
#[tokio::test]
async fn run_reports_exhausted_retries_as_a_harness_error() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-outage".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/primary"));
    let factory = ScriptedFactory::new().slot(ROOT_PROFILE_ID, |_| {
        Box::new(FailingClient {
            mode: FailureMode::Retryable,
        })
    });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::HarnessError,
    );

    let events = sink.events();
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::SessionEnded { status } if status == "model_error"
        )),
        "the session ends `model_error` — the provider's failure, named in the stream"
    );
}

/// A response fatal on the first attempt is the same ruling: the session ends `model_error` and
/// the process exits `1`.
#[tokio::test]
async fn run_reports_a_fatal_response_as_a_harness_error() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-fatal".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/primary"));
    let factory = ScriptedFactory::new().slot(ROOT_PROFILE_ID, |_| {
        Box::new(FailingClient {
            mode: FailureMode::Fatal,
        })
    });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::HarnessError,
    );

    let events = sink.events();
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::SessionEnded { status } if status == "model_error"
        )),
        "the session ends `model_error`"
    );
}

/// A root whose every attempt looped ends `model_error` too, but the failure is the model's rather
/// than the provider's: the session exits `0` and the run is collected and scored.
#[tokio::test]
async fn run_scores_a_root_that_looped_every_attempt() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-loop".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/primary"));
    let factory = ScriptedFactory::new().slot(ROOT_PROFILE_ID, |_| {
        Box::new(FailingClient {
            mode: FailureMode::Looping,
        })
    });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran,
    );
    assert!(
        sink.events().iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::SessionEnded { status } if status == "model_error"
        )),
        "the session still ends `model_error`"
    );
}

/// A reply from a provider other than the pin ends the run as gg's failure, not the model's: the
/// session ends `internal_error`, and the error names the pinned and the served provider.
#[tokio::test]
async fn run_ends_as_a_harness_failure_on_a_provider_mismatch() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-mismatch".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/primary"));
    let factory = ScriptedFactory::new().slot(ROOT_PROFILE_ID, |_| {
        Box::new(FailingClient {
            mode: FailureMode::ProviderMismatch,
        })
    });

    run_with_factory(&inv, &emitter, Arc::new(factory)).await;

    let events = sink.events();
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::SessionEnded { status } if status == "internal_error"
        )),
        "the session ends `internal_error`"
    );
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::Log { level, message }
                if level == "error" && message.contains("OpenAI") && message.contains("Azure")
        )),
        "an error line names the pinned and the served provider"
    );
}

/// A configuration whose root profile carries **its own id and its own display name** runs exactly
/// like any other: the root is the first profile a set declares, not one whose id is
/// [`ROOT_PROFILE_ID`], so the run resolves its model, drives it, and accounts its usage under that
/// id. The display name is along for the ride — nothing the run emits is keyed on it, which is what
/// makes renaming a profile free.
#[tokio::test]
async fn run_drives_a_root_profile_under_its_own_id() {
    let dir = TempDir::new().unwrap();
    seed_default_skill(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-renamed".to_string()), Box::new(sink.clone()));
    let mut set = GgCapabilitySet::minimal("mock/echo");
    set.agents[0].slug = "conductor".to_string();
    set.agents[0].name = "The Conductor".to_string();
    let inv = invocation(dir.path(), set);

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);
    assert!(dir.path().join("index.html").exists());

    // The run's telemetry attributes the root's work to its profile **id**, so per-profile
    // accounting follows a reference that resolves rather than a name two profiles could share.
    let events = sink.events();
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::AgentSpawned { profile_id, depth, .. }
                if profile_id == "conductor" && *depth == 0
        )),
        "the root is announced under its profile id"
    );
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::SlotUsage { profile_id, .. } if profile_id == "conductor"
        )),
        "usage is accounted under its profile id"
    );
    assert!(
        !events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::AgentSpawned { profile_id, .. }
                | GgTelemetryKind::SlotUsage { profile_id, .. } if profile_id == "The Conductor"
        )),
        "and never under the display name, which nothing resolves"
    );
}

/// A launch-failure diagnostic (no primary slot bound) is still tagged as the root agent — the
/// stream is agent-attributed from the very first event, before any model is resolved.
#[tokio::test]
async fn run_tags_launch_failure_events_as_root() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-lf".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), GgCapabilitySet::default());

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::HarnessError);

    let events = sink.events();
    assert!(!events.is_empty());
    assert!(
        events
            .iter()
            .all(|e| e.agent_id.as_deref() == Some(ROOT_AGENT_ID) && e.parent_agent_id.is_none()),
        "even launch-failure diagnostics are tagged as the root agent"
    );
    // No agent ever started running, so no AgentSpawned or SlotUsage is emitted.
    assert!(
        !events
            .iter()
            .any(|e| matches!(e.kind, GgTelemetryKind::AgentSpawned { .. }))
    );
    assert!(
        !events
            .iter()
            .any(|e| matches!(e.kind, GgTelemetryKind::SlotUsage { .. }))
    );
}

/// Every agent resolves its client through its own profile, so the profile's
/// [prompt-cache lifetime](GgAgentConfig::prompt_cache_ttl) rides along on the binding — a run in
/// which the delegating root buys the extended lifetime and its short-lived worker does not is one
/// configuration, resolved per agent.
#[test]
fn profile_binding_carries_the_profiles_prompt_cache_lifetime() {
    let set = GgCapabilitySet {
        agents: vec![
            GgAgentConfig {
                model_id: "mock/a".to_string(),
                prompt_cache_ttl: GgPromptCacheTtl::Extended,
                subagents: vec![GgSubagentRef::any("worker")],
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                slug: "worker".to_string(),
                name: "Worker".to_string(),
                model_id: "mock/b".to_string(),
                ..GgAgentConfig::root()
            },
        ],
        ..GgCapabilitySet::default()
    };

    let root = profile_binding(&set, ROOT_PROFILE_ID).expect("the root profile resolves");
    assert_eq!(root.model_id, "mock/a");
    assert_eq!(root.prompt_cache_ttl, GgPromptCacheTtl::Extended);

    let worker = profile_binding(&set, "worker").expect("the worker profile resolves");
    assert_eq!(worker.model_id, "mock/b");
    assert_eq!(worker.prompt_cache_ttl, GgPromptCacheTtl::Standard);
}

/// Agent-profile validation rejects the launch-blocking misconfigurations and accepts a good set.
/// (The old `effective_slot` / `slot_binding` / multi-model-collapse tests were removed with the
/// slot mechanism they exercised — an agent now runs under a profile it names by id, not a resolved
/// slot.)
#[test]
fn the_launch_refusal_enforces_the_profile_invariants() {
    // A good set (root bound, ids unique, references resolved) validates.
    assert!(crate::validate::refusal(&GgCapabilitySet::minimal("mock/echo")).is_ok());

    // The root is the *first* profile, not one whose id is `root`: a set whose root carries some
    // other id is a perfectly good set, and refusing it would make the id a reserved word.
    let own_id_root = GgCapabilitySet {
        agents: vec![GgAgentConfig {
            slug: "conductor".to_string(),
            model_id: "mock/b".to_string(),
            ..GgAgentConfig::root()
        }],
        ..GgCapabilitySet::default()
    };
    assert!(crate::validate::refusal(&own_id_root).is_ok());

    // …and the same with the other profiles a real multi-agent configuration carries, each named
    // from the root's roster by id.
    let own_id_root_with_roster = GgCapabilitySet {
        agents: vec![
            GgAgentConfig {
                slug: "conductor".to_string(),
                model_id: "mock/a".to_string(),
                subagents: vec![GgSubagentRef::any("reviewer")],
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                slug: "reviewer".to_string(),
                model_id: "mock/b".to_string(),
                ..GgAgentConfig::root()
            },
        ],
        ..GgCapabilitySet::default()
    };
    assert!(crate::validate::refusal(&own_id_root_with_roster).is_ok());

    // No profiles at all: nothing to run.
    let no_agents = GgCapabilitySet {
        agents: Vec::new(),
        ..GgCapabilitySet::default()
    };
    let err = crate::validate::refusal(&no_agents).unwrap_err();
    assert!(
        err.contains("no agent profiles"),
        "unexpected reason: {err}"
    );

    // An agent still deferred to a model slot never had its model supplied.
    let deferred = GgCapabilitySet {
        agents: vec![GgAgentConfig {
            model_id: String::new(),
            model_slot: Some("critic".to_string()),
            ..GgAgentConfig::root()
        }],
        ..GgCapabilitySet::default()
    };
    let err = crate::validate::refusal(&deferred).unwrap_err();
    assert!(err.contains("model slot"), "unexpected reason: {err}");

    // A duplicate profile **id** is ambiguous: every reference resolves to the first profile that
    // has it, so the second could never be addressed at all.
    let dup = GgCapabilitySet {
        agents: vec![
            GgAgentConfig {
                model_id: "mock/a".to_string(),
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                model_id: "mock/b".to_string(),
                ..GgAgentConfig::root()
            },
        ],
        ..GgCapabilitySet::default()
    };
    assert!(
        crate::validate::refusal(&dup)
            .unwrap_err()
            .contains("more than once")
    );

    // An empty profile id is refused for the same reason: there would be nothing to reference.
    let unnamed = GgCapabilitySet {
        agents: vec![GgAgentConfig {
            slug: String::new(),
            model_id: "mock/a".to_string(),
            ..GgAgentConfig::root()
        }],
        ..GgCapabilitySet::default()
    };
    assert!(
        crate::validate::refusal(&unnamed)
            .unwrap_err()
            .contains("empty id")
    );

    // An empty model id is rejected.
    let empty_model = GgCapabilitySet {
        agents: vec![GgAgentConfig {
            model_id: String::new(),
            ..GgAgentConfig::root()
        }],
        ..GgCapabilitySet::default()
    };
    assert!(crate::validate::refusal(&empty_model).is_err());

    // ...but an FSM shell with no model is exactly right: a machine takes no turns, so the model
    // check is asked of the profiles its states run and not of the machine itself.
    let machine = GgCapabilitySet {
        agents: vec![
            GgAgentConfig {
                model_id: String::new(),
                capabilities: vec![GgCapabilityConfig {
                    params: json!({ FSM_PARAM_STATES: [{ "name": "only", "agentId": "worker" }] }),
                    ..GgCapabilityConfig::enabled(CAPABILITY_FSM)
                }],
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                slug: "worker".to_string(),
                name: "Worker".to_string(),
                model_id: "mock/a".to_string(),
                ..GgAgentConfig::root()
            },
        ],
        ..GgCapabilitySet::default()
    };
    assert!(crate::validate::refusal(&machine).is_ok());
    // And the client a dispatch onto that machine resolves is the entry state's, not the shell's.
    assert_eq!(
        profile_binding(&machine, ROOT_PROFILE_ID).expect("the machine resolves a model"),
        GgSlotBinding::new("worker", "mock/a"),
    );

    // A subagent allowlist naming an agent this set does not declare is rejected.
    let dangling = GgCapabilitySet {
        agents: vec![GgAgentConfig {
            model_id: "mock/a".to_string(),
            subagents: vec![GgSubagentRef {
                agent_id: "ghost".to_string(),
                description: String::new(),
                scopes: ALL_SUBAGENT_SCOPES.to_vec(),
            }],
            ..GgAgentConfig::root()
        }],
        ..GgCapabilitySet::default()
    };
    assert!(
        crate::validate::refusal(&dangling)
            .unwrap_err()
            .contains("ghost")
    );
}

/// **Two profiles may carry the same display name**, and everything still addresses them apart.
///
/// A name is display text: it is what a console, a run log and a roster's prose call an agent, and
/// nothing resolves a reference by reading one — which is what makes renaming a profile free. So a
/// launch does not read names at all, and the pair below (identically named, differently bound)
/// launches, resolves, and binds each half to its own model by id.
#[test]
fn two_profiles_may_share_a_display_name_and_are_addressed_apart_by_id() {
    let set = GgCapabilitySet {
        agents: vec![
            GgAgentConfig {
                slug: "reviewer".to_string(),
                name: "Reviewer".to_string(),
                model_id: "mock/a".to_string(),
                subagents: vec![GgSubagentRef::any("reviewer-2")],
                ..GgAgentConfig::root()
            },
            GgAgentConfig {
                slug: "reviewer-2".to_string(),
                name: "Reviewer".to_string(),
                model_id: "mock/b".to_string(),
                ..GgAgentConfig::root()
            },
        ],
        ..GgCapabilitySet::default()
    };

    assert!(
        crate::validate::refusal(&set).is_ok(),
        "a shared name is not a defect; only a shared id is"
    );
    assert_eq!(
        set.agent("reviewer-2").map(|a| a.model_id.as_str()),
        Some("mock/b"),
        "an id resolves to its own profile, however many share its name"
    );
    assert_eq!(
        profile_binding(&set, "reviewer-2").expect("the second profile resolves"),
        GgSlotBinding::new("reviewer-2", "mock/b"),
        "and the binding it runs on is keyed by that id"
    );
    // The model-facing roster is the same story: the entry the root offers points at exactly one of
    // the two, and what it hands the model back is that profile's id — the name is only the prose
    // beside it, and here it cannot tell them apart at all.
    let roster = set.roster(set.root(), GgSubagentScope::Subagent);
    assert_eq!(
        GgRosterEntry::ids(&roster),
        vec!["reviewer-2".to_string()],
        "the vocabulary a call is admitted by is the id"
    );
    assert_eq!(roster[0].name, "Reviewer");
    assert!(GgRosterEntry::offers(&roster, "reviewer-2"));
    assert!(
        !GgRosterEntry::offers(&roster, "Reviewer"),
        "a display name is not a reference, so it admits nothing"
    );
}

/// An agent that may **file issues** must have someone to assign them to: an issue names its
/// assignee from the filer's own **implementer** roster entries, so a project-management agent with
/// none could never write a valid `create_issue` call. A roster entry that is only spawnable does
/// not count — the scopes are what the check reads. Withholding the tool — read-only board access —
/// is the supported way to have an issue-less board, and it is accepted.
#[test]
fn an_issue_filer_needs_an_implementer_to_assign_to() {
    let board_agent = |ungranted: &[&str], subagents: Vec<GgSubagentRef>| {
        let mut root = GgAgentConfig {
            model_id: "mock/a".to_string(),
            subagents,
            ..GgAgentConfig::root()
        };
        crate::tools::grant_configured(
            &mut root,
            crate::tools::configured(
                CAPABILITY_PROJECT_MANAGEMENT,
                json!({ PROJECT_MANAGEMENT_PARAM_MERGE_AGENT: ROOT_PROFILE_ID }),
            ),
        );
        // …minus whichever of the board's calls this case withholds. Read-only board access is the
        // supported way to have an issue-less board, and under an allowlist it is expressed by
        // leaving `create_issue` out rather than by naming it anywhere.
        root.tools
            .retain(|name| !ungranted.contains(&name.as_str()));
        GgCapabilitySet {
            agents: vec![root],
            ..GgCapabilitySet::default()
        }
    };

    let err = crate::validate::refusal(&board_agent(&[], Vec::new())).unwrap_err();
    assert!(err.contains("no `implementer`"), "unexpected reason: {err}");

    // A spawnable-only roster entry is not an implementer, so it does not satisfy the check.
    let spawn_only = vec![GgSubagentRef::new(
        ROOT_PROFILE_ID,
        &[GgSubagentScope::Subagent],
    )];
    let err = crate::validate::refusal(&board_agent(&[], spawn_only.clone())).unwrap_err();
    assert!(err.contains("no `implementer`"), "unexpected reason: {err}");

    // Read-only board access (no `create_issue`) is fine with no roster at all.
    assert!(crate::validate::refusal(&board_agent(&["create_issue"], Vec::new())).is_ok());

    // And so is an issue filer with an implementer to assign to.
    assert!(
        crate::validate::refusal(&board_agent(
            &[],
            vec![GgSubagentRef::new(
                ROOT_PROFILE_ID,
                &[GgSubagentScope::Implementer]
            )],
        ))
        .is_ok()
    );
}

/// Per-slot accounting keys on `(slot, model)`: usage on the same slot/model accumulates, a
/// different model on the same slot is a separate rollup, and the emitted `SlotUsage` events
/// mirror the recorded entries in first-seen order.
#[test]
fn slot_accounting_sums_per_slot_and_model() {
    let counts = |input: u64, output: u64| TokenCounts {
        uncached_input: Some(input),
        cached_input: None,
        output: Some(output),
        reasoning: None,
    };
    let cost = |c: f64| {
        Some(Cost {
            comparable: Some(c),
            actual: Some(c),
        })
    };

    let mut acc = SlotAccounting::default();
    // Two records on the same (slot, model) accumulate.
    acc.record(ROOT_PROFILE_ID, "mock/opus", counts(100, 10), cost(0.01));
    acc.record(ROOT_PROFILE_ID, "mock/opus", counts(50, 5), cost(0.02));
    // A different model on the same slot is its own rollup (a re-pointed slot stays attributable).
    acc.record("subagent", "mock/haiku", counts(30, 3), cost(0.001));

    let events = acc.slot_usage_events();
    assert_eq!(events.len(), 2, "two (slot, model) rollups");

    match &events[0] {
        GgTelemetryKind::SlotUsage {
            profile_id,
            model_id,
            tokens,
            cost,
        } => {
            assert_eq!(profile_id, ROOT_PROFILE_ID);
            assert_eq!(model_id, "mock/opus");
            assert_eq!(tokens.uncached_input, Some(150));
            assert_eq!(tokens.output, Some(15));
            assert_eq!(tokens.total(), Some(165));
            assert_eq!(cost.unwrap().comparable, Some(0.03));
        }
        other => panic!("expected the primary/opus rollup first, got {other:?}"),
    }
    match &events[1] {
        GgTelemetryKind::SlotUsage {
            profile_id,
            model_id,
            tokens,
            ..
        } => {
            assert_eq!(profile_id, "subagent");
            assert_eq!(model_id, "mock/haiku");
            assert_eq!(tokens.total(), Some(33));
        }
        other => panic!("expected the subagent/haiku rollup second, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// Phase 4b: subagents — the scheduler, spawn/wait/return, messaging, recursion
// ---------------------------------------------------------------------------

/// A per-slot client producer: mints a fresh client for a binding (each subagent needs its own
/// script cursor).
type ClientProducer = Box<dyn Fn(&GgSlotBinding) -> Box<dyn ModelClient> + Send + Sync>;

/// A per-slot client factory for the subagent e2es: each bound slot maps to a
/// [producer](ClientProducer). An unmapped slot gets an empty-script mock (which finishes
/// immediately).
struct ScriptedFactory {
    producers: HashMap<String, ClientProducer>,
}

impl ScriptedFactory {
    fn new() -> Self {
        Self {
            producers: HashMap::new(),
        }
    }

    fn slot(
        mut self,
        slot: &str,
        producer: impl Fn(&GgSlotBinding) -> Box<dyn ModelClient> + Send + Sync + 'static,
    ) -> Self {
        self.producers.insert(slot.to_string(), Box::new(producer));
        self
    }
}

impl ClientFactory for ScriptedFactory {
    fn client_for(&self, binding: &GgSlotBinding) -> Result<Box<dyn ModelClient>, ModelError> {
        match self.producers.get(&binding.slot) {
            Some(producer) => Ok(producer(binding)),
            None => Ok(Box::new(MockClient::new(
                binding.model_id.clone(),
                Vec::new(),
            ))),
        }
    }
}

/// A capability set with the run's `maxParallel` and a subagents `maxDepth` on the root, plus one
/// [agent profile](GgAgentConfig) per named `extra_agent` — whose [slug](GgAgentConfig::slug) is that
/// name, since that is what every roster entry, spawn call and telemetry row here addresses it by
/// (model `mock/<id>`, on the root's primary `mock/primary`). Every profile may spawn every
/// declared agent (a permissive test allowlist), and every profile carries the same depth cap so a
/// child can spawn a grandchild.
/// How many error turns in a row end an agent in a [`subagent_set`] run. Wide enough that a
/// scripted agent doing its work is never stopped by it, narrow enough that one which never ends
/// its session stops in a second rather than running the test out.
const SPAWNED_ERROR_CEILING: u64 = 5;

fn subagent_set(max_parallel: u64, max_depth: u64, extra_agents: &[&str]) -> GgCapabilitySet {
    let subagents =
        crate::tools::configured(CAPABILITY_SUBAGENTS, json!({ "maxDepth": max_depth }));
    // The delegation allowlist shared by every profile: the root plus each extra agent, by id.
    let allowlist: Vec<GgSubagentRef> = std::iter::once(ROOT_PROFILE_ID)
        .chain(extra_agents.iter().copied())
        .map(|id| GgSubagentRef {
            agent_id: id.to_string(),
            description: String::new(),
            scopes: ALL_SUBAGENT_SCOPES.to_vec(),
        })
        .collect();
    let profile = |id: &str, name: &str, model: &str| {
        let mut agent = GgAgentConfig {
            slug: id.to_string(),
            name: name.to_string(),
            model_id: model.to_string(),
            subagents: allowlist.clone(),
            ..GgAgentConfig::root()
        };
        crate::tools::grant_configured(&mut agent, subagents.clone());
        agent
    };
    let mut agents = vec![profile(ROOT_PROFILE_ID, ROOT_AGENT, "mock/primary")];
    for id in extra_agents {
        agents.push(profile(id, id, &format!("mock/{id}")));
    }
    GgCapabilitySet {
        agents,
        limits: test_cabinet_core::gg::GgRunLimits {
            max_parallel: Some(max_parallel),
            // Declared, because gg arms no error ceiling nobody wrote: several of these fixtures
            // script a child that answers without ever ending its session, and what stops such an
            // agent is this ceiling and nothing else.
            max_consecutive_errors: Some(SPAWNED_ERROR_CEILING),
            ..test_cabinet_core::gg::GgRunLimits::authored()
        },
        ..GgCapabilitySet::default()
    }
}

/// Every `AgentSpawned` in the stream, as `(agentId, parentId, slot, depth, brief)`.
type Spawn = (Option<String>, Option<String>, String, u64, Option<String>);
fn agent_spawns(events: &[test_cabinet_core::gg::GgTelemetryEvent]) -> Vec<Spawn> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::AgentSpawned {
                profile_id,
                depth,
                brief,
                ..
            } => Some((
                e.agent_id.clone(),
                e.parent_agent_id.clone(),
                profile_id.clone(),
                *depth,
                brief.clone(),
            )),
            _ => None,
        })
        .collect()
}

/// The subagent tools are only offered when the capability is on — the capability-off arm.
#[test]
fn subagent_tools_are_gated_on_the_capability() {
    let names = ["spawn_subagent", "wait_for_subagents", "send_message"];

    // Off (minimal has no subagents): none offered.
    let off = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/echo").root());
    for name in names {
        assert!(
            !off.definitions().iter().any(|d| d.name == name),
            "`{name}` must not be offered when subagents is off"
        );
    }

    // On (and with at least one agent it may spawn): all three offered. The roster is **resolved**
    // against the set first, which is the only form the registry takes one in: an entry is a
    // profile id, and what the tool schema enumerates is the ids the set actually declares.
    let mut set = GgCapabilitySet::minimal("mock/echo");
    crate::tools::grant(&mut set.agents[0], CAPABILITY_SUBAGENTS);
    set.agents[0].subagents.push(GgSubagentRef {
        agent_id: ROOT_PROFILE_ID.to_string(),
        description: String::new(),
        scopes: ALL_SUBAGENT_SCOPES.to_vec(),
    });
    let spawnable = set.roster(set.root(), GgSubagentScope::Subagent);
    assert_eq!(
        GgRosterEntry::ids(&spawnable),
        vec![ROOT_PROFILE_ID.to_string()],
        "the vocabulary the schema enumerates is the profile id"
    );
    let on = ToolRegistry::from_run(
        set.root(),
        &crate::modules::CapabilityModules::inert(),
        &AgentFacts {
            spawnable: &spawnable,
            ..AgentFacts::default()
        },
    );
    for name in names {
        assert!(
            on.definitions().iter().any(|d| d.name == name),
            "`{name}` must be offered when subagents is on"
        );
    }

    // On but with an empty roster: there is no agent to spawn, so the tools stay withheld.
    let mut empty = GgCapabilitySet::minimal("mock/echo");
    crate::tools::grant(&mut empty.agents[0], CAPABILITY_SUBAGENTS);
    let empty = ToolRegistry::from_capabilities(empty.root());
    for name in names {
        assert!(
            !empty.definitions().iter().any(|d| d.name == name),
            "`{name}` must not be offered with an empty subagent roster"
        );
    }
}

/// A capability set in which the root and one subagent profile both keep memories, organized as a
/// scratchpad and scoped by `scope` — the one knob these scoping e2es vary.
fn memory_scope_set(scope: &str) -> GgCapabilitySet {
    let mut set = subagent_set(2, 3, &["subagent"]);
    for agent in &mut set.agents {
        // The memories capability is on by default, so this re-points the entry that is already
        // there rather than adding a second one gg would never read.
        let memories = agent
            .capabilities
            .iter_mut()
            .find(|capability| capability.id == CAPABILITY_MEMORIES)
            .expect("the default capabilities include memories");
        memories.enabled = true;
        memories.params =
            crate::tools::configured(CAPABILITY_MEMORIES, json!({ "scope": scope })).params;
    }
    set
}

/// The memory names each agent's **last** `MemoryState` reports, keyed by agent id — what each
/// agent was holding when it stopped, which is the whole observable of a memory scope.
fn memories_by_agent(
    events: &[test_cabinet_core::gg::GgTelemetryEvent],
) -> HashMap<String, Vec<String>> {
    let mut held: HashMap<String, Vec<String>> = HashMap::new();
    for event in events {
        if let GgTelemetryKind::MemoryState { memories, .. } = &event.kind {
            held.insert(
                event.agent_id.clone().unwrap_or_default(),
                memories.iter().map(|m| m.name.clone()).collect(),
            );
        }
    }
    held
}

/// The scope each agent's last `MemoryState` reports, keyed by agent id.
fn scopes_by_agent(events: &[test_cabinet_core::gg::GgTelemetryEvent]) -> HashMap<String, String> {
    let mut scopes = HashMap::new();
    for event in events {
        if let GgTelemetryKind::MemoryState { scope, .. } = &event.kind {
            scopes.insert(event.agent_id.clone().unwrap_or_default(), scope.clone());
        }
    }
    scopes
}

/// The offline end-to-end proof that `inherited` is wired through a **real spawn**: the root writes
/// a memory, delegates, and the child it spawned is holding that memory before it writes one of its
/// own — after which the root's own store holds both, because there was only ever one.
#[tokio::test]
async fn an_inherited_subagent_curates_its_spawners_memories() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-mem".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), memory_scope_set("inherited"));
    let factory = ScriptedFactory::new()
        .slot(ROOT_PROFILE_ID, |b| {
            Box::new(MockClient::with_memory_parent_script(&b.model_id))
        })
        .slot("subagent", |b| {
            Box::new(MockClient::with_memory_child_script(&b.model_id))
        });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();
    let held = memories_by_agent(&events);
    let child = held
        .get("agent-0")
        .expect("the child reported its memories");
    assert_eq!(
        child,
        &vec![
            MOCK_MEMORY_CHILD.to_string(),
            MOCK_MEMORY_PARENT.to_string()
        ],
        "the child holds its spawner's memory as well as its own"
    );
    let root = held.get(ROOT_AGENT_ID).expect("the root reported its own");
    assert_eq!(
        root,
        &vec![
            MOCK_MEMORY_CHILD.to_string(),
            MOCK_MEMORY_PARENT.to_string()
        ],
        "and the child's write landed in the store the root is holding"
    );

    // Each holder's scope is on the wire, so the console can tell one shared store from two.
    let scopes = scopes_by_agent(&events);
    assert_eq!(scopes.get("agent-0").map(String::as_str), Some("inherited"));

    // The revision for the child's write is reported once, on the child's own stream — the root
    // holds the same store but did not make the write.
    let authors: Vec<Option<String>> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::MemoryRevision { name, .. } if name == MOCK_MEMORY_CHILD => {
                Some(e.agent_id.clone())
            }
            _ => None,
        })
        .collect();
    assert_eq!(
        authors,
        vec![Some("agent-0".to_string())],
        "one revision, on the author's stream"
    );

    // And the linked-memory notice reached the root's *window*: it is holding a store somebody
    // else wrote to, so its next turn is told what changed and what the memory is for.
    let noticed = events.iter().any(|e| match &e.kind {
        GgTelemetryKind::ContextMessage { content, .. } => content.as_deref().is_some_and(|text| {
            text.contains("Another agent sharing your memories") && text.contains(MOCK_MEMORY_CHILD)
        }),
        _ => false,
    });
    assert!(noticed, "the root was told about the child's write");
}

/// **A holder that binds somebody else's store opens with it in its window.**
///
/// The pinned memory block is otherwise rebuilt only at a compaction boundary, because between
/// boundaries the model's own calls and their confirmations are what tell it what it holds. That
/// reasoning covers a store the agent filled itself and says nothing about one it was *handed*: an
/// inherited notebook was never written by a call in this thread, so nothing carries the news and
/// the window would open with no trace of memories the system prompt says are shown in full — and,
/// under `scratchpad`, no read call to reach them with either. gg therefore builds the block once
/// as the window is opened.
#[tokio::test]
async fn an_inherited_store_is_in_the_childs_window_from_its_first_turn() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-mem".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), memory_scope_set("inherited"));
    let factory = ScriptedFactory::new()
        .slot(ROOT_PROFILE_ID, |b| {
            Box::new(MockClient::with_memory_parent_script(&b.model_id))
        })
        .slot("subagent", |b| {
            Box::new(MockClient::with_memory_child_script(&b.model_id))
        });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();
    // The child's very first window report: its own memory call has not happened yet, so any
    // Memory-band tokens are the block gg opened it on.
    let opening = events
        .iter()
        .find_map(|event| match &event.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. }
                if event.agent_id.as_deref() == Some("agent-0") =>
            {
                Some(by_source.clone())
            }
            _ => None,
        })
        .expect("the child reported its window");
    let memory_band = opening
        .iter()
        .find(|usage| usage.source == GgContextSource::Memory)
        .map(|usage| usage.tokens)
        .unwrap_or(0);
    assert!(
        memory_band > 0,
        "the child opened on the notebook it inherited: {opening:?}"
    );
    // And it is the spawner's memory that is in there, not an empty block.
    let shown = events.iter().any(|event| match &event.kind {
        GgTelemetryKind::ContextMessage { content, .. } => {
            event.agent_id.as_deref() == Some("agent-0")
                && content
                    .as_deref()
                    .is_some_and(|text| text.contains(MOCK_MEMORY_PARENT))
        }
        _ => false,
    });
    assert!(
        shown,
        "the inherited memory itself is in the child's window"
    );
}

/// The same run under `isolated` — the default, and the behaviour every existing configuration
/// keeps: the child gets a notebook of its own and neither agent sees the other's memory.
#[tokio::test]
async fn an_isolated_subagent_keeps_its_own_memories() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-mem".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), memory_scope_set("isolated"));
    let factory = ScriptedFactory::new()
        .slot(ROOT_PROFILE_ID, |b| {
            Box::new(MockClient::with_memory_parent_script(&b.model_id))
        })
        .slot("subagent", |b| {
            Box::new(MockClient::with_memory_child_script(&b.model_id))
        });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let held = memories_by_agent(&sink.events());
    assert_eq!(
        held.get("agent-0"),
        Some(&vec![MOCK_MEMORY_CHILD.to_string()]),
        "the child holds only what it wrote"
    );
    assert_eq!(
        held.get(ROOT_AGENT_ID),
        Some(&vec![MOCK_MEMORY_PARENT.to_string()]),
        "and the root only what it wrote"
    );
}

/// The headline offline e2e under a cap of **1**: the root spawns a child on a different slot,
/// blocks to wait on it (freeing its slot so the child can run — cap=1 could not run the child
/// otherwise), the child does a bit of work and returns a value, and the root collects it. This
/// exercises spawn → schedule → run → return and the blocked-frees-slot rule together.
#[tokio::test]
async fn run_spawns_a_subagent_that_runs_under_cap_one_and_returns() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-sub".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), subagent_set(1, 3, &["subagent"]));
    let factory = ScriptedFactory::new()
        .slot(ROOT_PROFILE_ID, |b| {
            Box::new(MockClient::with_subagent_parent_script(&b.model_id))
        })
        .slot("subagent", |b| {
            Box::new(MockClient::with_subagent_child_script(&b.model_id))
        });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    // The child actually ran in the shared workspace.
    assert!(
        dir.path().join(MOCK_SUBAGENT_FILE).exists(),
        "the subagent wrote its file, so it ran"
    );

    let events = sink.events();

    // Two agents spawned: the root (depth 0, no brief) and one child (depth 1, on the subagent
    // slot, parented at root, carrying a brief).
    let spawns = agent_spawns(&events);
    assert_eq!(spawns.len(), 2, "the root and exactly one child");
    assert!(
        spawns
            .iter()
            .any(
                |(id, parent, profile_id, depth, brief)| id.as_deref() == Some(ROOT_AGENT_ID)
                    && parent.is_none()
                    && profile_id == ROOT_PROFILE_ID
                    && *depth == 0
                    && brief.is_none()
            ),
        "the root spawn is depth 0 on primary with no brief"
    );
    let (child_id, child_parent, child_slot, child_depth, child_brief) = spawns
        .iter()
        .find(|(_, _, _, depth, _)| *depth == 1)
        .expect("a depth-1 child spawn");
    assert_eq!(child_id.as_deref(), Some("agent-0"));
    assert_eq!(child_parent.as_deref(), Some(ROOT_AGENT_ID));
    assert_eq!(child_slot, "subagent");
    assert_eq!(*child_depth, 1);
    assert!(
        child_brief.is_some(),
        "the child carries its dispatched brief"
    );

    // The child returned its distinctive value on its own stream, attributed to it and its parent.
    let (ret_id, ret_parent, ret_summary) = events
        .iter()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::AgentReturned { summary } => Some((
                e.agent_id.clone(),
                e.parent_agent_id.clone(),
                summary.clone(),
            )),
            _ => None,
        })
        .expect("the child emitted AgentReturned");
    assert_eq!(ret_id.as_deref(), Some("agent-0"));
    assert_eq!(ret_parent.as_deref(), Some(ROOT_AGENT_ID));
    assert_eq!(
        ret_summary, MOCK_SUBAGENT_RETURN,
        "its final message is the return value"
    );

    // The parent collected the result (a successful wait).
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok: true, .. } if name == "wait_for_subagents"
        )),
        "the parent's wait_for_subagents succeeded"
    );

    // Blocked-frees-slot under cap=1: the child could only start after the parent freed its slot by
    // blocking, so the parent's Blocked transition precedes the child's spawn.
    let parent_blocked = events
        .iter()
        .position(|e| {
            e.agent_id.as_deref() == Some(ROOT_AGENT_ID)
                && matches!(
                    e.kind,
                    GgTelemetryKind::AgentStatus {
                        status: GgAgentStatus::Blocked,
                        ..
                    }
                )
        })
        .expect("the root blocked while waiting");
    let child_started = events
        .iter()
        .position(|e| {
            e.agent_id.as_deref() == Some("agent-0")
                && matches!(e.kind, GgTelemetryKind::AgentSpawned { .. })
        })
        .expect("the child started");
    assert!(
        parent_blocked < child_started,
        "under cap=1 the child starts only after the parent frees its slot by blocking"
    );

    // Per-slot accounting spans both models: a rollup for each of the primary and subagent slots.
    let rollups: Vec<_> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::SlotUsage {
                profile_id,
                model_id,
                ..
            } => Some((profile_id.clone(), model_id.clone())),
            _ => None,
        })
        .collect();
    assert_eq!(
        rollups.len(),
        2,
        "one rollup per (slot, model) the run touched"
    );
    assert!(
        rollups
            .iter()
            .any(|(profile_id, model)| profile_id == ROOT_PROFILE_ID && model == "mock/primary")
    );
    assert!(
        rollups
            .iter()
            .any(|(slot, model)| slot == "subagent" && model == "mock/subagent")
    );

    // ...and so do the per-turn `Usage` deltas, each naming the profile and model that spent it.
    // This is what makes the per-model split readable **while the run is still going**: the rollups
    // above are only streamed once an agent has ended, so a console with nothing but deltas to work
    // from could otherwise show a multi-model run's total and nothing about where it went. Summing
    // one key's deltas reproduces that key's rollup exactly, so the live figure and the durable one
    // can never disagree.
    let deltas = usage_by_slot_model(&events);
    let rolled: HashMap<(String, String), u64> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::SlotUsage {
                profile_id,
                model_id,
                tokens,
                ..
            } => Some((
                (profile_id.clone(), model_id.clone()),
                tokens.total().unwrap_or(0),
            )),
            _ => None,
        })
        .collect();
    assert_eq!(
        deltas, rolled,
        "the deltas, grouped by the (slot, model) each names, reproduce the rollups exactly"
    );
    assert_eq!(deltas.len(), 2, "both models are separately attributed");

    // The session completed.
    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
}

/// A spawn at the maximum depth is **refused** (a tool error to the model), not queued: with
/// `maxDepth = 1`, the root's child (depth 1) cannot spawn deeper, and no depth-2 agent appears.
#[tokio::test]
async fn spawn_is_refused_at_the_max_depth() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-depth".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), subagent_set(4, 1, &["subagent", "worker"]));

    // The child tries to spawn a grandchild on the `worker` slot — refused by the depth cap.
    let child_tries_to_spawn = || -> Box<dyn ModelClient> {
        let attempt = ModelResponse {
            text: Some("Trying to delegate deeper.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_deep".to_string(),
                name: "spawn_subagent".to_string(),
                arguments: json!({ "prompt": "do the sub-sub work", "agent": "worker" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts::default(),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
        };
        Box::new(MockClient::new(
            "mock/subagent",
            vec![attempt, stop_response()],
        ))
    };
    let factory = ScriptedFactory::new()
        .slot(ROOT_PROFILE_ID, |b| {
            Box::new(MockClient::with_subagent_parent_script(&b.model_id))
        })
        .slot("subagent", move |_| child_tries_to_spawn());

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();

    // Only the root (depth 0) and its one child (depth 1) were spawned — the grandchild was refused.
    let spawns = agent_spawns(&events);
    assert_eq!(spawns.len(), 2, "no agent spawns past the depth cap");
    assert!(
        !spawns.iter().any(|(_, _, _, depth, _)| *depth >= 2),
        "no depth-2 agent may exist under maxDepth=1"
    );

    // The child's spawn attempt was refused with a depth-cap error (on the child's stream).
    assert!(
        events
            .iter()
            .any(|e| e.agent_id.as_deref() == Some("agent-0")
                && matches!(
                    &e.kind,
                    GgTelemetryKind::ToolResult { name, ok: false, summary: Some(s), .. }
                        if name == "spawn_subagent" && s.contains("maximum delegation depth")
                )),
        "the deeper spawn is refused with a depth-cap message"
    );
}

/// Recursion: with a generous depth cap, a subagent can itself spawn a subagent. The root spawns a
/// child on `subagent`, which spawns a grandchild on `worker`, which does the work — three agents at
/// depths 0, 1, 2.
#[tokio::test]
async fn subagents_recurse_within_the_depth_cap() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-rec".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), subagent_set(4, 3, &["subagent", "worker"]));

    // The mid-level child spawns a grandchild on `worker`, waits for it, then finishes.
    let child_spawns_grandchild = || -> Box<dyn ModelClient> {
        let spawn = ModelResponse {
            text: Some("Delegating deeper to a worker.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_gspawn".to_string(),
                name: "spawn_subagent".to_string(),
                arguments: json!({ "prompt": "do the leaf work", "agent": "worker" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts::default(),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
        };
        let wait = ModelResponse {
            text: Some("Waiting for the worker.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_gwait".to_string(),
                name: "wait_for_subagents".to_string(),
                arguments: json!({}),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts::default(),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
        };
        Box::new(MockClient::new(
            "mock/subagent",
            vec![spawn, wait, stop_response()],
        ))
    };

    let factory = ScriptedFactory::new()
        .slot(ROOT_PROFILE_ID, |b| {
            Box::new(MockClient::with_subagent_parent_script(&b.model_id))
        })
        .slot("subagent", move |_| child_spawns_grandchild())
        .slot("worker", |b| {
            Box::new(MockClient::with_subagent_child_script(&b.model_id))
        });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    // The leaf grandchild ran (wrote the file).
    assert!(
        dir.path().join(MOCK_SUBAGENT_FILE).exists(),
        "the depth-2 grandchild did the work"
    );

    let events = sink.events();
    let spawns = agent_spawns(&events);
    assert_eq!(spawns.len(), 3, "root, child, grandchild");
    let depths: BTreeSet<u64> = spawns.iter().map(|(_, _, _, depth, _)| *depth).collect();
    assert_eq!(
        depths,
        BTreeSet::from([0, 1, 2]),
        "one agent at each depth 0..=2"
    );

    // The grandchild (depth 2, on the worker slot) is parented at the mid-level child.
    let (gc_id, gc_parent, gc_slot, _, _) = spawns
        .iter()
        .find(|(_, _, _, depth, _)| *depth == 2)
        .expect("a depth-2 grandchild");
    assert_eq!(gc_slot, "worker");
    assert_eq!(
        gc_id.as_deref(),
        Some("agent-1"),
        "the second spawn minted agent-1"
    );
    assert_eq!(
        gc_parent.as_deref(),
        Some("agent-0"),
        "parented at the mid-level child"
    );
}

/// A client that reports, in its single final message, whether it saw a sentinel string in its
/// context — used to prove a `send_message` reached a running child and affected its output.
struct InboxProbeClient;

#[async_trait::async_trait]
impl ModelClient for InboxProbeClient {
    async fn complete(
        &self,
        messages: &[Message],
        _tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        let saw_ping = messages.iter().any(|m| {
            m.content
                .as_deref()
                .is_some_and(|content| content.contains("PARENT_PING"))
        });
        let text = if saw_ping {
            "child received PARENT_PING from its parent".to_string()
        } else {
            "child received no message".to_string()
        };
        Ok(ModelResponse {
            text: Some(text),
            tool_calls: Vec::new(),
            finish_reason: FinishReason::Stop,
            usage: TokenCounts::default(),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
        })
    }

    fn model_id(&self) -> &str {
        "mock/subagent"
    }
}

/// A parent can message a running subagent, and the message reaches it: the child injects the
/// parent's message at its turn boundary, so its (message-sensitive) output reflects it.
#[tokio::test]
async fn send_message_reaches_a_running_subagent_and_affects_it() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-msg".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), subagent_set(2, 3, &["subagent"]));

    // The parent spawns a child, messages it (before it runs — the message buffers in the inbox),
    // then waits for it.
    let parent_messages_child = || -> Box<dyn ModelClient> {
        let spawn = ModelResponse {
            text: Some("Spawning a child to probe.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_spawn".to_string(),
                name: "spawn_subagent".to_string(),
                arguments: json!({ "prompt": "await instructions", "agent": "subagent" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts::default(),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
        };
        let message = ModelResponse {
            text: Some("Guiding the child.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_msg".to_string(),
                name: "send_message".to_string(),
                arguments: json!({ "agentId": "agent-0", "message": "PARENT_PING: focus on X" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts::default(),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
        };
        let wait = ModelResponse {
            text: Some("Waiting for the child.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_wait".to_string(),
                name: "wait_for_subagents".to_string(),
                arguments: json!({}),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts::default(),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
        };
        Box::new(MockClient::new(
            "mock/primary",
            vec![spawn, message, wait, stop_response()],
        ))
    };

    let factory = ScriptedFactory::new()
        .slot(ROOT_PROFILE_ID, move |_| parent_messages_child())
        .slot("subagent", |_| Box::new(InboxProbeClient));

    // The child never ends its own session — it answers the probe and nothing else — so it is
    // stopped by the run's consecutive-error ceiling, which is what makes the run's outcome
    // `LimitExceeded`. The scenario is about the message reaching a child that is still running,
    // which is exactly the child a ceiling has to stop; the ceiling is the fixture, not the finding.
    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::LimitExceeded
    );

    let events = sink.events();

    // The send succeeded.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok: true, .. } if name == "send_message"
        )),
        "send_message to the running child succeeded"
    );

    // The child saw the message and reflected it in its return value — proving the live channel.
    let summary = events
        .iter()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::AgentReturned { summary }
                if e.agent_id.as_deref() == Some("agent-0") =>
            {
                Some(summary.clone())
            }
            _ => None,
        })
        .expect("the child returned");
    assert!(
        summary.contains("PARENT_PING"),
        "the child received and acted on the parent's message (got: {summary:?})"
    );
}

/// Messaging an agent that is not one of the sender's subagents, or one that has already returned, is
/// refused with guidance rather than delivered.
#[tokio::test]
async fn send_message_refuses_unknown_and_finished_targets() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-msg-err".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), subagent_set(2, 3, &["subagent"]));

    // The parent spawns a child, waits for it to finish, THEN messages it (too late) and also
    // messages a never-spawned id.
    let parent = || -> Box<dyn ModelClient> {
        let spawn = ModelResponse {
            text: Some("spawn".to_string()),
            tool_calls: vec![ToolCall {
                id: "s".to_string(),
                name: "spawn_subagent".to_string(),
                arguments: json!({ "prompt": "quick work", "agent": "subagent" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts::default(),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
        };
        let wait = ModelResponse {
            text: Some("wait".to_string()),
            tool_calls: vec![ToolCall {
                id: "w".to_string(),
                name: "wait_for_subagents".to_string(),
                arguments: json!({}),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts::default(),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
        };
        let msg_finished = ModelResponse {
            text: Some("message the finished child".to_string()),
            tool_calls: vec![ToolCall {
                id: "m1".to_string(),
                name: "send_message".to_string(),
                arguments: json!({ "agentId": "agent-0", "message": "too late" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts::default(),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
        };
        let msg_unknown = ModelResponse {
            text: Some("message a stranger".to_string()),
            tool_calls: vec![ToolCall {
                id: "m2".to_string(),
                name: "send_message".to_string(),
                arguments: json!({ "agentId": "agent-99", "message": "who are you" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts::default(),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
        };
        Box::new(MockClient::new(
            "mock/primary",
            vec![spawn, wait, msg_finished, msg_unknown, stop_response()],
        ))
    };

    let factory = ScriptedFactory::new()
        .slot(ROOT_PROFILE_ID, move |_| parent())
        .slot("subagent", |b| {
            Box::new(MockClient::with_subagent_child_script(&b.model_id))
        });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();
    let refusals: Vec<String> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::ToolResult {
                name,
                ok: false,
                summary: Some(s),
                ..
            } if name == "send_message" => Some(s.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(refusals.len(), 2, "both messages are refused");
    assert!(
        refusals.iter().any(|s| s.contains("already returned")),
        "messaging a finished child is refused"
    );
    assert!(
        refusals
            .iter()
            .any(|s| s.contains("not one of this agent's subagents")),
        "messaging an unknown agent is refused"
    );
}

// ---------------------------------------------------------------------------
// Phase 4d: declared workflows — fan-out + sequencing over the same scheduler
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Issue reviews: reviewers gate acceptance, and the worktree merges on approval
// ---------------------------------------------------------------------------

/// The prefix of the epic the scripted issue-review e2es file their issue under.
const REVIEW_EPIC_PREFIX: &str = "FEAT";

/// The board issue the scripted issue-review e2es create, dispatch, and complete — **gg's** id for
/// it, the first number under [`REVIEW_EPIC_PREFIX`].
const REVIEW_ISSUE_ID: &str = "FEAT-1";

/// The id of the *n*th agent gg dispatches to implement [`REVIEW_ISSUE_ID`] — derived from the issue,
/// so the first attempt, the post-review rework pass, and each retry are all legible as attempts at
/// the same work.
fn review_implementer(attempt: usize) -> String {
    format!("{REVIEW_ISSUE_ID}.{attempt}i")
}

/// [`subagent_set`], plus the project-management capability (with the required merge agent) — a
/// review-gated run. `extra_slots` names the profiles the scripted issue lists as its reviewers.
fn issue_review_set(extra_slots: &[&str]) -> GgCapabilitySet {
    let mut set = subagent_set(4, 3, extra_slots);
    crate::tools::grant_configured(
        &mut set.agents[0],
        crate::tools::configured(
            CAPABILITY_PROJECT_MANAGEMENT,
            json!({ PROJECT_MANAGEMENT_PARAM_MERGE_AGENT: ROOT_PROFILE_ID }),
        ),
    );
    set
}

/// A one-tool-call assistant turn.
fn tool_call_response(id: &str, name: &str, args: serde_json::Value) -> ModelResponse {
    ModelResponse {
        text: Some(format!("calling {name}")),
        tool_calls: vec![ToolCall {
            id: id.to_string(),
            name: name.to_string(),
            arguments: args,
        }],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts::default(),
        cost: None,
        provider: None,
        loop_aborts: LoopAborts::none(),
    }
}

/// The scripted **Root** profile for an issue-review e2e in the auto-dispatch model. Each agent that
/// resolves the Root profile is served in dispatch order:
///
/// - **agent 0 (the root)**: file one epic and one issue naming `reviewer` as its reviewer, then
///   finish. Submitting the issue enqueues it, so gg auto-dispatches a top-level agent to implement
///   it.
/// - **agents 1+ (that dispatched issue agent, and the same agent on every review round)**: write a
///   distinct work file, then finish — which is what completes the issue — so each round leaves a
///   countable trace and the re-review's diff has new content.
fn issue_review_root_producer(
    counter: Arc<AtomicUsize>,
) -> impl Fn(&GgSlotBinding) -> Box<dyn ModelClient> + Send + Sync + 'static {
    move |b| {
        let n = counter.fetch_add(1, Ordering::SeqCst);
        let responses = match n {
            0 => vec![
                tool_call_response(
                    "epic",
                    "create_epic",
                    json!({
                        "prefix": REVIEW_EPIC_PREFIX,
                        "title": "Build",
                        "description": "the build",
                    }),
                ),
                tool_call_response(
                    "issue",
                    "create_issue",
                    json!({
                        "title": "Add the widget",
                        "inScope": "Implement the widget.",
                        "outOfScope": "Unrelated changes.",
                        "completionCriteria": "The widget is fully implemented.",
                        "epicId": REVIEW_EPIC_PREFIX,
                        "agent": ROOT_PROFILE_ID,
                        "reviewers": ["reviewer"],
                    }),
                ),
                stop_response(),
            ],
            _ => vec![
                tool_call_response(
                    "write",
                    "write_file",
                    json!({ "path": format!("work-{n}.txt"), "contents": "work\n" }),
                ),
                stop_response(),
            ],
        };
        Box::new(MockClient::new(&b.model_id, responses))
    }
}

/// A reviewer that declares its verdict in one turn — `approve`, or `request_changes` with one
/// actionable item.
fn reviewer_verdict_mock(model_id: &str, approved: bool) -> MockClient {
    let turn = if approved {
        ending_call("verdict", "approve", json!({}))
    } else {
        ending_call(
            "verdict",
            "request_changes",
            json!({ "items": ["Add the missing widget to the game."] }),
        )
    };
    MockClient::new(model_id, vec![turn])
}

/// A `reviewer`-slot producer that requests changes for its first `approve_after` dispatches, then
/// approves — the scripted "approve-after-N" that terminates the (otherwise unbounded) fix loop.
fn approve_after_producer(
    counter: Arc<AtomicUsize>,
    approve_after: usize,
) -> impl Fn(&GgSlotBinding) -> Box<dyn ModelClient> + Send + Sync + 'static {
    move |b| {
        let n = counter.fetch_add(1, Ordering::SeqCst);
        Box::new(reviewer_verdict_mock(&b.model_id, n >= approve_after))
    }
}

/// Every `IssueReview` event in the stream, as `(issueId, phase, items, baseline)`. The issue id
/// rides on the event envelope (`issue_id`), not the payload. Who rendered each verdict is read by
/// [`review_verdicts`] instead, so the phase assertions stay readable.
type Review = (
    Option<String>,
    GgIssueReviewPhase,
    Option<Vec<String>>,
    Option<String>,
);
fn issue_reviews(events: &[test_cabinet_core::gg::GgTelemetryEvent]) -> Vec<Review> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::IssueReview {
                phase,
                items,
                baseline,
                ..
            } => Some((e.issue_id.clone(), *phase, items.clone(), baseline.clone())),
            _ => None,
        })
        .collect()
}

/// Every `IssueReview` event as `(phase, changes-requesting reviewer, approving reviewers)`, each
/// reviewer rendered `agentId/profileId` — the reviewer *instance* and the profile it ran, which
/// together are the attribution a console reduction joins on.
type Verdicts = (GgIssueReviewPhase, Option<String>, Vec<String>);
fn review_verdicts(events: &[test_cabinet_core::gg::GgTelemetryEvent]) -> Vec<Verdicts> {
    let render = |r: &test_cabinet_core::gg::GgReviewer| format!("{}/{}", r.agent_id, r.profile_id);
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::IssueReview {
                phase,
                reviewer,
                approvals,
                ..
            } => Some((
                *phase,
                reviewer.as_ref().map(render),
                approvals.iter().flatten().map(render).collect(),
            )),
            _ => None,
        })
        .collect()
}

/// Every `WorktreeMerged` in the stream, as `(issueId, branch, merged, conflicts)`.
type Reconcile = (Option<String>, String, bool, bool);
fn worktree_merges(events: &[test_cabinet_core::gg::GgTelemetryEvent]) -> Vec<Reconcile> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::WorktreeMerged {
                branch,
                merged,
                conflicts,
            } => Some((e.issue_id.clone(), branch.clone(), *merged, *conflicts)),
            _ => None,
        })
        .collect()
}

/// The most recent status reported for `issue_id` on any `BoardState`.
fn last_issue_status(
    events: &[test_cabinet_core::gg::GgTelemetryEvent],
    issue_id: &str,
) -> Option<GgIssueStatus> {
    events.iter().rev().find_map(|e| match &e.kind {
        GgTelemetryKind::BoardState { issues, .. } => {
            issues.iter().find(|i| i.id == issue_id).map(|i| i.status)
        }
        _ => None,
    })
}

/// A project-management capability set (a global board with auto-dispatch), optionally with a
/// `maxRetries` override.
///
/// An issue names the profile it is dispatched under, drawn from the filer's own spawnable set, so
/// the Root lists **itself** — the smallest configuration that can both file an issue and have one
/// worked. (A set that let an agent file issues with nobody to assign them to is refused at launch.)
fn project_set(max_retries: Option<u64>) -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal("mock/primary");
    let mut overrides = json!({ PROJECT_MANAGEMENT_PARAM_MERGE_AGENT: ROOT_PROFILE_ID });
    if let Some(retries) = max_retries {
        overrides["maxRetries"] = json!(retries);
    }
    crate::tools::grant_configured(
        &mut set.agents[0],
        crate::tools::configured(CAPABILITY_PROJECT_MANAGEMENT, overrides),
    );
    set.agents[0].subagents.push(GgSubagentRef {
        agent_id: ROOT_PROFILE_ID.to_string(),
        description: String::new(),
        scopes: ALL_SUBAGENT_SCOPES.to_vec(),
    });
    set
}

/// The id gg assigns the single ungrouped issue the scripted board e2es file: the first number under
/// the ungrouped prefix, since none of them groups its issue under an epic.
const UNGROUPED_ISSUE_ID: &str = "ISSUE-1";

/// A well-formed `create_issue` call assigned to the Root. It names no id — gg assigns one
/// ([`UNGROUPED_ISSUE_ID`], the first number under the ungrouped prefix).
fn create_issue_call() -> ModelResponse {
    tool_call_response(
        "issue",
        "create_issue",
        json!({
            "title": "Add the widget",
            "inScope": "Implement the widget.",
            "outOfScope": "Nothing else.",
            "completionCriteria": "The widget works.",
            "agent": ROOT_PROFILE_ID,
        }),
    )
}

/// **Submitting an issue auto-dispatches a top-level agent that implements it.** The root only
/// files the issue and finishes; gg — not the root — spawns a dedicated top-level agent, hands it
/// the issue's structured brief, and that agent completes it.
#[tokio::test]
async fn submitting_an_issue_auto_dispatches_an_agent_that_completes_it() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-pm".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), project_set(None));

    let counter = Arc::new(AtomicUsize::new(0));
    let factory = ScriptedFactory::new().slot(ROOT_PROFILE_ID, move |b| {
        let n = counter.fetch_add(1, Ordering::SeqCst);
        let responses = if n == 0 {
            // The root files the issue and finishes — no manual dispatch.
            vec![create_issue_call(), stop_response()]
        } else {
            // The auto-dispatched agent finishes, which completes its assigned issue.
            vec![stop_response()]
        };
        Box::new(MockClient::new(&b.model_id, responses))
    });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );
    let events = sink.events();
    let spawns = agent_spawns(&events);
    assert_eq!(
        spawns.len(),
        2,
        "the root and exactly one auto-dispatched issue agent run"
    );
    let dispatched = spawns
        .iter()
        .find(|(id, _, _, _, _)| id.as_deref() != Some("root"))
        .expect("an auto-dispatched agent");
    assert_eq!(
        dispatched.1, None,
        "the auto-dispatched agent is top-level (no parent)"
    );
    assert_eq!(dispatched.3, 0, "the auto-dispatched agent is at depth 0");
    assert!(
        dispatched
            .4
            .as_deref()
            .is_some_and(|b| b.contains("Implement the widget.")),
        "the agent was handed the issue's structured brief"
    );
    assert_eq!(
        last_issue_status(&events, UNGROUPED_ISSUE_ID),
        Some(GgIssueStatus::Done),
        "the issue is completed by its assigned agent"
    );
}

/// **An issue its assigned agent cannot complete is re-dispatched, then marked failed.** With the
/// default one retry, an issue whose agents keep ending *without finishing* — here on a fatal model
/// error, but a spent turn ceiling or a breached limit reads the same way — is attempted twice and
/// then goes to the terminal `failed` state (its dependents would stay blocked).
#[tokio::test]
async fn an_uncompleted_issue_is_retried_then_failed() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-pm-fail".to_string()), Box::new(sink.clone()));
    // Default retries (1) → two attempts before failing.
    let inv = invocation(dir.path(), project_set(Some(1)));

    let counter = Arc::new(AtomicUsize::new(0));
    let factory = ScriptedFactory::new().slot(ROOT_PROFILE_ID, move |b| {
        let n = counter.fetch_add(1, Ordering::SeqCst);
        if n == 0 {
            return Box::new(MockClient::new(
                &b.model_id,
                vec![create_issue_call(), stop_response()],
            )) as Box<dyn ModelClient>;
        }
        // Every dispatched agent ends on a model error rather than a completion, so its issue is
        // never handed back.
        Box::new(FailingClient {
            mode: FailureMode::Fatal,
        })
    });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );
    let events = sink.events();
    let dispatched = agent_spawns(&events)
        .iter()
        .filter(|(id, _, _, _, _)| id.as_deref() != Some("root"))
        .count();
    assert_eq!(
        dispatched, 2,
        "the issue is attempted `maxRetries + 1` = 2 times"
    );
    assert_eq!(
        last_issue_status(&events, UNGROUPED_ISSUE_ID),
        Some(GgIssueStatus::Failed),
        "the issue is marked failed once its retries are exhausted"
    );
}

// ---------------------------------------------------------------------------
// A board split across profiles: one agent files the work, another implements it
// ---------------------------------------------------------------------------

/// The [slug](GgAgentConfig::slug) of the implementer profile in the
/// [split](split_project_set) board configuration — what its roster entry, the issue it is
/// assigned, and its telemetry all name it by.
const CODER_PROFILE_ID: &str = "coder";

/// That profile's display name, which differs from its id precisely so nothing can quietly resolve
/// a reference by reading it.
const CODER_AGENT: &str = "Coder";

/// A **two-profile** project-management set — the shape a real board run has: the Root files and
/// dispatches work and owns the board, and a separate implementer profile does the work with **no**
/// project-management capability of its own (it authors nothing; it is authored *at*).
///
/// Every earlier board e2e has the Root implement its own issues, which quietly hid the whole
/// division of labour: the Root has the board capability, so it always had the ending call.
fn split_project_set() -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal("mock/primary");
    crate::tools::grant_configured(
        &mut set.agents[0],
        crate::tools::configured(
            CAPABILITY_PROJECT_MANAGEMENT,
            json!({ PROJECT_MANAGEMENT_PARAM_MERGE_AGENT: ROOT_PROFILE_ID }),
        ),
    );
    set.agents[0].subagents.push(GgSubagentRef::new(
        CODER_PROFILE_ID,
        &[GgSubagentScope::Implementer],
    ));
    set.agents.push(GgAgentConfig {
        slug: CODER_PROFILE_ID.to_string(),
        name: CODER_AGENT.to_string(),
        model_id: "mock/coder".to_string(),
        ..GgAgentConfig::root()
    });
    set
}

/// A well-formed `create_issue` call assigned to the [implementer](CODER_PROFILE_ID) **by id**,
/// with no id of its own (gg assigns [`UNGROUPED_ISSUE_ID`]).
fn create_issue_for_coder() -> ModelResponse {
    tool_call_response(
        "issue",
        "create_issue",
        json!({
            "title": "Add the widget",
            "inScope": "Implement the widget.",
            "outOfScope": "Nothing else.",
            "completionCriteria": "The widget works.",
            "agent": CODER_PROFILE_ID,
        }),
    )
}

/// **An implementer profile without the board capability completes its issue by finishing.**
///
/// This is the division of labour a board run is *for*: the Root files the work, a coder profile
/// implements it, and the coder is deliberately not given `project-management` — it has no business
/// filing epics. It needs no board move to hand the work back either: the issue is completed by its
/// implementer completing, so a coder that does the work and finishes takes the issue to `done`
/// without ever touching the board.
#[tokio::test]
async fn an_implementer_without_the_board_capability_completes_its_issue() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-pm-split".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), split_project_set());

    let factory = ScriptedFactory::new()
        .slot(ROOT_PROFILE_ID, |b| {
            // The root only files the issue, assigned to the coder.
            Box::new(MockClient::new(
                &b.model_id,
                vec![create_issue_for_coder(), stop_response()],
            ))
        })
        .slot(CODER_PROFILE_ID, |b| {
            // The coder does the work and simply finishes — the whole of the hand-back.
            Box::new(MockClient::new(
                &b.model_id,
                vec![
                    tool_call_response(
                        "write",
                        "write_file",
                        json!({ "path": "widget.txt", "contents": "the widget\n" }),
                    ),
                    stop_response(),
                ],
            ))
        });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );
    let events = sink.events();
    let dispatched: Vec<_> = agent_spawns(&events)
        .into_iter()
        .filter(|(id, _, _, _, _)| id.as_deref() != Some("root"))
        .collect();
    assert_eq!(
        dispatched.len(),
        1,
        "the issue is implemented on the first attempt, not retried: {dispatched:?}"
    );
    assert_eq!(
        dispatched[0].2, CODER_PROFILE_ID,
        "the issue was dispatched under the profile it was assigned to"
    );
    assert!(
        !events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, .. } if name == "complete_issue"
        )),
        "the coder made no board move at all"
    );
    assert_eq!(
        last_issue_status(&events, UNGROUPED_ISSUE_ID),
        Some(GgIssueStatus::Done),
        "an implementer with no board capability still takes its issue all the way to done"
    );
}

/// **The board is run-global, so it exists whenever *any* profile owns it** — not only when the
/// Root does. A set that puts project management on a dedicated board-owning profile would otherwise
/// offer that profile the board tools while the run around it had no board runtime and no
/// dispatcher, so every issue it filed would sit on the board forever.
#[tokio::test]
async fn a_board_owned_by_a_non_root_profile_still_dispatches() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-pm-nonroot".to_string()), Box::new(sink.clone()));

    // The root delegates; the `planner` profile owns the board and files the work; the `coder`
    // profile implements it. Each is spawned, assigned and accounted by its id.
    let mut set = split_project_set();
    let board_cap = set.agents[0]
        .capabilities
        .pop()
        .expect("the project-management capability just pushed");
    let roster = std::mem::take(&mut set.agents[0].subagents);
    crate::tools::grant(&mut set.agents[0], CAPABILITY_SUBAGENTS);
    set.agents[0]
        .subagents
        .push(GgSubagentRef::new("planner", &[GgSubagentScope::Subagent]));
    let mut planner = GgAgentConfig {
        slug: "planner".to_string(),
        name: "Planner".to_string(),
        model_id: "mock/planner".to_string(),
        subagents: roster,
        ..GgAgentConfig::root()
    };
    crate::tools::grant_configured(&mut planner, board_cap);
    set.agents.push(planner);
    let inv = invocation(dir.path(), set);

    let factory = ScriptedFactory::new()
        .slot(ROOT_PROFILE_ID, |b| {
            Box::new(MockClient::new(
                &b.model_id,
                vec![
                    tool_call_response(
                        "spawn",
                        "spawn_subagent",
                        json!({ "agent": "planner", "prompt": "plan the work" }),
                    ),
                    stop_response(),
                ],
            ))
        })
        .slot("planner", |b| {
            Box::new(MockClient::new(
                &b.model_id,
                vec![create_issue_for_coder(), stop_response()],
            ))
        })
        .slot(CODER_PROFILE_ID, |b| {
            Box::new(MockClient::new(&b.model_id, vec![stop_response()]))
        });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );
    let events = sink.events();
    assert!(
        agent_spawns(&events)
            .iter()
            .any(|(_, _, profile_id, _, _)| profile_id == CODER_PROFILE_ID),
        "the issue the non-root board owner filed was auto-dispatched"
    );
    assert_eq!(
        last_issue_status(&events, UNGROUPED_ISSUE_ID),
        Some(GgIssueStatus::Done),
        "and taken to done"
    );
}

/// **An agent can wait on an issue until it reaches a terminal state.** The root files an issue
/// (auto-dispatched and completed by another agent) and `wait_for_issue`s on it; the wait resolves
/// once the issue is done and reports it.
#[tokio::test]
async fn an_agent_can_wait_for_an_issue_until_it_completes() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-pm-wait".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), project_set(None));

    let counter = Arc::new(AtomicUsize::new(0));
    let factory = ScriptedFactory::new().slot(ROOT_PROFILE_ID, move |b| {
        let n = counter.fetch_add(1, Ordering::SeqCst);
        let responses = if n == 0 {
            // The root files the issue, waits on it, then finishes.
            vec![
                create_issue_call(),
                tool_call_response(
                    "wait",
                    "wait_for_issue",
                    json!({ "issueId": UNGROUPED_ISSUE_ID }),
                ),
                stop_response(),
            ]
        } else {
            vec![stop_response()]
        };
        Box::new(MockClient::new(&b.model_id, responses))
    });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );
    let events = sink.events();
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok: true, summary: Some(s), .. }
                if name == "wait_for_issue" && s.contains("done")
        )),
        "the root's wait_for_issue resolved and reported the issue done"
    );
    assert_eq!(
        last_issue_status(&events, UNGROUPED_ISSUE_ID),
        Some(GgIssueStatus::Done),
    );
}

/// A project-management set (global board + auto-dispatch) with responses-as-code on, so the root
/// and the agents gg auto-dispatches both run their turns as programs.
fn code_project_set() -> GgCapabilitySet {
    let mut set = project_set(None);
    crate::tools::grant(&mut set.agents[0], CAPABILITY_RESPONSES_AS_CODE);
    set
}

/// **A responses-as-code program waits on an issue, deferred until the program ends.** The root
/// files an issue and calls `project.waitForIssue` in the *same* program — which records the wait
/// and returns rather than blocking inside the program — so the turn continues; then, after the
/// program has run, the loop suspends the root until the auto-dispatched agent completes the issue,
/// and the root resumes and finishes. This is the deferral that gives a composed program a shape for
/// a control-flow wait it otherwise has none for: the call is honoured between turns, not within
/// one.
#[tokio::test]
async fn a_code_program_waits_for_an_issue_after_it_ends() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-pm-code-wait".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), code_project_set());

    let counter = Arc::new(AtomicUsize::new(0));
    let factory = ScriptedFactory::new().slot(ROOT_PROFILE_ID, move |b| {
        let n = counter.fetch_add(1, Ordering::SeqCst);
        let responses = if n == 0 {
            // The root files the issue and registers the wait in one program. There is no `finish`,
            // so the turn continues — and the wait does not block here; the loop performs it once
            // the program has ended, after which the root's next program finishes.
            vec![
                // The wait names the id `createIssue` **returned** — the program cannot invent one,
                // which is exactly why the call hands it back.
                code_reply(
                    "import * as gg from \"gg\";\nconst issue = gg.board.createIssue({ title: \"Add the widget\", \
                     inScope: \"Implement the widget.\", outOfScope: \"Nothing else.\", \
                     completionCriteria: \"The widget works.\", agent: \"root\" });\n\
                     gg.board.waitForIssue(issue.id);",
                ),
                code_reply(FINISHING_PROGRAM),
            ]
        } else {
            // The auto-dispatched issue agent finishes, which is what completes the issue.
            vec![code_reply("import * as gg from \"gg\";\ngg.session.finish(\"issue done\");")]
        };
        Box::new(MockClient::new(&b.model_id, responses))
    });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );
    let events = sink.events();

    // The program's `waitForIssue` was bound and serviced under responses-as-code — it registered
    // the wait rather than throwing, which is the parity this change exists to give. Recorded as
    // an `ApiResult` under the operation the program called, because that is the whole of what a
    // program's call produces: no tool pair is streamed on this surface at all.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ApiResult { operation, ok: true, .. }
                if operation == "board.wait_for_issue"
        )),
        "the program's waitForIssue was serviced"
    );
    // The deferred wait actually suspended the root after its program ended — the whole point, and
    // what distinguishes it from a no-op that just kept looping.
    assert!(
        events
            .iter()
            .any(|e| e.agent_id.as_deref() == Some(ROOT_AGENT_ID)
                && matches!(
                    e.kind,
                    GgTelemetryKind::AgentStatus {
                        status: GgAgentStatus::Blocked,
                        ..
                    }
                )),
        "the root suspended on the deferred wait after its program ended"
    );
    assert_eq!(
        last_issue_status(&events, UNGROUPED_ISSUE_ID),
        Some(GgIssueStatus::Done),
        "the awaited issue reached a terminal Done state",
    );
}

/// **An issue with reviewers is not accepted until they approve, and its work merges on the way.**
/// The assigned agent marks its work complete (which moves the issue to `in review`, not `done`), a
/// reviewer requests changes, gg re-invokes the issue's **own** agent with the items, the re-review
/// approves, and only then is the issue merged and marked done.
#[tokio::test]
async fn an_issues_reviewers_gate_its_acceptance_and_its_merge() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-cr".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), issue_review_set(&["reviewer"]));

    let root_counter = Arc::new(AtomicUsize::new(0));
    let review_counter = Arc::new(AtomicUsize::new(0));
    let factory = ScriptedFactory::new()
        .slot(
            ROOT_PROFILE_ID,
            issue_review_root_producer(Arc::clone(&root_counter)),
        )
        .slot(
            "reviewer",
            // Approve on the 2nd review (one changes-requested round first).
            approve_after_producer(Arc::clone(&review_counter), 1),
        );

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();
    let reviews = issue_reviews(&events);

    // The lifecycle: (requested → changes_requested) then (requested → approved), all scoped to the
    // issue. Each round emits its own `requested`, because each round is a fresh review of freshly
    // reworked code.
    let phases: Vec<GgIssueReviewPhase> = reviews.iter().map(|(_, p, _, _)| *p).collect();
    assert_eq!(
        phases,
        vec![
            GgIssueReviewPhase::Requested,
            GgIssueReviewPhase::ChangesRequested,
            GgIssueReviewPhase::Requested,
            GgIssueReviewPhase::Approved,
        ],
        "each review round runs requested → (changes_requested | approved)"
    );
    assert!(
        reviews
            .iter()
            .all(|(id, _, _, _)| id.as_deref() == Some(REVIEW_ISSUE_ID)),
        "every IssueReview event is scoped to the issue under review"
    );
    // The changes-requested round carries the reviewer's actionable items and the baseline it
    // diffed against.
    let (_, _, items, baseline) = reviews
        .iter()
        .find(|(_, p, _, _)| *p == GgIssueReviewPhase::ChangesRequested)
        .expect("a changes_requested phase");
    assert!(
        items
            .as_ref()
            .is_some_and(|items| items.iter().any(|i| i.contains("missing widget"))),
        "the changes_requested event carries the reviewer's items"
    );
    assert!(
        baseline.is_some(),
        "the review records the baseline it diffed against"
    );

    // The implementer *finishing* is the claim, not the acceptance: it never makes a board move of
    // its own, and the issue reaches `done` only through the review.
    assert!(
        !events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, .. } if name == "complete_issue"
        )),
        "there is no completion tool for the implementer to call"
    );
    assert_eq!(
        last_issue_status(&events, REVIEW_ISSUE_ID),
        Some(GgIssueStatus::Done),
        "the issue is accepted (marked done) after approval"
    );

    // The reviewer ran twice (round 1 + re-review) and the issue's own agent ran the fix round.
    let spawns = agent_spawns(&events);
    assert_eq!(
        spawns
            .iter()
            .filter(|(_, _, slot, _, _)| slot == "reviewer")
            .count(),
        2,
        "a reviewer is dispatched for the first review and the re-review"
    );
    // The reviewer's brief carries the *summary* of what changed against the issue's baseline — the
    // files to look at — and sends it to read them in the worktree it is running in, rather than
    // pasting the patch (which would carry every generated file the work touched).
    assert!(
        spawns
            .iter()
            .any(|(_, _, slot, _, brief)| slot == "reviewer"
                && brief.as_deref().is_some_and(|b| b.contains("work-1.txt")
                    && b.contains("## What changed")
                    && flat(b).contains("The work is in your current working directory.")
                    && !b.contains("```diff"))),
        "the reviewer is given the change summary and sent to the worktree, not handed the patch"
    );
    // The rework was done by the issue's OWN assigned agent (Root), re-invoked with the original
    // brief plus the review's items — not by a separate fix profile.
    let fix_spawns: Vec<_> = spawns
        .iter()
        .filter(|(_, _, profile_id, _, brief)| {
            profile_id == ROOT_PROFILE_ID
                && brief
                    .as_deref()
                    .is_some_and(|b| b.contains("## Requested changes"))
        })
        .collect();
    assert_eq!(
        fix_spawns.len(),
        1,
        "one rework round for the one changes round"
    );
    let fix_brief = fix_spawns[0].4.as_deref().unwrap();
    assert!(
        fix_brief.contains("Implement the widget."),
        "the re-invoked agent gets the original issue brief (its in-scope)"
    );
    assert!(
        fix_brief.contains("missing widget"),
        "the re-invoked agent gets the reviewer's actionable items"
    );

    // The work happened in the issue's own worktree and was merged back on acceptance — so both
    // rounds' files are in the main workspace at the end, and the merge is reported once.
    let merges = worktree_merges(&events);
    assert_eq!(merges.len(), 1, "the issue's worktree is reconciled once");
    assert_eq!(
        (merges[0].0.as_deref(), merges[0].2, merges[0].3),
        (Some(REVIEW_ISSUE_ID), true, false),
        "the accepted issue's branch merges cleanly, on the issue's own stream"
    );
    assert!(
        dir.path().join("work-1.txt").exists(),
        "the dispatched issue agent's work merged into the main workspace"
    );
    assert!(
        dir.path().join("work-2.txt").exists(),
        "the rework round's work merged into the main workspace"
    );

    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
}

/// **The agents working an issue are named after it, and every verdict says who rendered it.**
///
/// The same review-gated run as above, read through the *names*: the issue is `FEAT-1` (numbered
/// under its epic's prefix, not chosen by the model), its first implementer is `FEAT-1.0i` and the
/// post-review rework pass `FEAT-1.1i`, and each round's reviewer is named under the implementer
/// whose work it reviewed — `FEAT-1.0i.0r`, then `FEAT-1.1i.0r`. That nesting is what makes a
/// concurrent fleet legible: one id says which work, which attempt, and which review of it.
#[tokio::test]
async fn issue_agents_are_named_after_the_issue_and_verdicts_name_their_reviewer() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-cr-names".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), issue_review_set(&["reviewer"]));

    let root_counter = Arc::new(AtomicUsize::new(0));
    let review_counter = Arc::new(AtomicUsize::new(0));
    let factory = ScriptedFactory::new()
        .slot(
            ROOT_PROFILE_ID,
            issue_review_root_producer(Arc::clone(&root_counter)),
        )
        .slot(
            "reviewer",
            approve_after_producer(Arc::clone(&review_counter), 1),
        );

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();
    let spawns = agent_spawns(&events);

    // The two implementer passes are numbered attempts at the issue, in order.
    let implementers: Vec<String> = spawns
        .iter()
        .filter(|(_, parent, profile_id, _, brief)| {
            parent.is_none()
                && profile_id == ROOT_PROFILE_ID
                && brief
                    .as_deref()
                    .is_some_and(|b| b.contains("Add the widget"))
        })
        .filter_map(|(id, _, _, _, _)| id.clone())
        .collect();
    assert_eq!(
        implementers,
        vec![review_implementer(0), review_implementer(1)],
        "each attempt at the issue is named after it"
    );

    // Each reviewer is named under the implementer whose work it reviewed.
    let reviewers: Vec<String> = spawns
        .iter()
        .filter(|(_, _, slot, _, _)| slot == "reviewer")
        .filter_map(|(id, _, _, _, _)| id.clone())
        .collect();
    assert_eq!(
        reviewers,
        vec![
            format!("{}.0r", review_implementer(0)),
            format!("{}.0r", review_implementer(1)),
        ],
        "a review is named under the attempt it reviewed, so the pairing is readable"
    );

    // And the telemetry attributes each verdict: the changes-requested round names the reviewer that
    // ended it, and the approving round names who approved.
    assert_eq!(
        review_verdicts(&events),
        vec![
            (GgIssueReviewPhase::Requested, None, Vec::new()),
            (
                GgIssueReviewPhase::ChangesRequested,
                Some(format!("{}.0r/reviewer", review_implementer(0))),
                Vec::new(),
            ),
            (GgIssueReviewPhase::Requested, None, Vec::new()),
            (
                GgIssueReviewPhase::Approved,
                None,
                vec![format!("{}.0r/reviewer", review_implementer(1))],
            ),
        ],
        "every verdict says which agent, under which profile, rendered it"
    );
}

/// **Every reviewer an issue names must approve, and they run in turn.** An issue naming two
/// reviewers dispatches both; only when the last one approves is the issue accepted.
#[tokio::test]
async fn an_issues_reviewers_all_have_to_approve() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-cr-reviewers".to_string()), Box::new(sink.clone()));

    let mut set = issue_review_set(&["critic", "auditor"]);
    // Reviewers are mandatory on this run, so an issue cannot be filed without naming them.
    for cap in &mut set.agents[0].capabilities {
        if cap.id == CAPABILITY_PROJECT_MANAGEMENT {
            cap.params = crate::tools::configured(
                CAPABILITY_PROJECT_MANAGEMENT,
                json!({ "reviewers": true, PROJECT_MANAGEMENT_PARAM_MERGE_AGENT: ROOT_PROFILE_ID }),
            )
            .params;
        }
    }
    let inv = invocation(dir.path(), set);

    let root_counter = Arc::new(AtomicUsize::new(0));
    let factory = ScriptedFactory::new()
        .slot(ROOT_PROFILE_ID, move |b| {
            let n = root_counter.fetch_add(1, Ordering::SeqCst);
            let responses = if n == 0 {
                vec![
                    tool_call_response(
                        "issue",
                        "create_issue",
                        json!({
                            "title": "Add the widget",
                            "inScope": "Implement the widget.",
                            "outOfScope": "Unrelated changes.",
                            "completionCriteria": "The widget is fully implemented.",
                            "agent": ROOT_PROFILE_ID,
                            "reviewers": ["critic", "auditor"],
                        }),
                    ),
                    stop_response(),
                ]
            } else {
                vec![
                    tool_call_response(
                        "write",
                        "write_file",
                        json!({ "path": format!("work-{n}.txt"), "contents": "work\n" }),
                    ),
                    stop_response(),
                ]
            };
            Box::new(MockClient::new(&b.model_id, responses))
        })
        .slot("critic", |b| {
            Box::new(reviewer_verdict_mock(&b.model_id, true))
        })
        .slot("auditor", |b| {
            Box::new(reviewer_verdict_mock(&b.model_id, true))
        });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();
    let spawns = agent_spawns(&events);
    for slot in ["critic", "auditor"] {
        assert!(
            spawns.iter().any(|(_, _, s, _, _)| s == slot),
            "the issue's `{slot}` reviewer was dispatched"
        );
    }
    assert_eq!(
        last_issue_status(&events, UNGROUPED_ISSUE_ID),
        Some(GgIssueStatus::Done),
        "the issue is accepted once every declared reviewer approves"
    );
}

/// The rework → re-review loop has **no cycle limit**: it runs as many rounds as the reviewer keeps
/// requesting changes and terminates only on approval. Scripted with approve-after-3: three
/// changes-requested rounds, three rework rounds, then approval accepts the issue.
#[tokio::test]
async fn the_review_loop_has_no_cycle_limit_and_terminates_on_approval() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-cr-n".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), issue_review_set(&["reviewer"]));

    let root_counter = Arc::new(AtomicUsize::new(0));
    let review_counter = Arc::new(AtomicUsize::new(0));
    let factory = ScriptedFactory::new()
        .slot(
            ROOT_PROFILE_ID,
            issue_review_root_producer(Arc::clone(&root_counter)),
        )
        .slot(
            "reviewer",
            approve_after_producer(Arc::clone(&review_counter), 3),
        );

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();
    let reviews = issue_reviews(&events);

    let changes = reviews
        .iter()
        .filter(|(_, p, _, _)| *p == GgIssueReviewPhase::ChangesRequested)
        .count();
    let approvals = reviews
        .iter()
        .filter(|(_, p, _, _)| *p == GgIssueReviewPhase::Approved)
        .count();
    assert_eq!(
        changes, 3,
        "three changes-requested rounds ran (no cycle limit)"
    );
    assert_eq!(approvals, 1, "the loop terminates on the single approval");

    // Four reviewer dispatches (three changes + the approving one) and three rework rounds.
    let spawns = agent_spawns(&events);
    assert_eq!(
        spawns
            .iter()
            .filter(|(_, _, slot, _, _)| slot == "reviewer")
            .count(),
        4,
        "a reviewer ran for each of the four review rounds"
    );
    assert_eq!(
        spawns
            .iter()
            .filter(|(_, _, profile_id, _, brief)| profile_id == ROOT_PROFILE_ID
                && brief
                    .as_deref()
                    .is_some_and(|b| b.contains("## Requested changes")))
            .count(),
        3,
        "the issue's own agent was re-invoked for each of the three changes rounds"
    );

    // Rework does NOT burn the retry budget — the issue is still accepted after three rounds, which
    // is far past the default single retry.
    assert_eq!(
        last_issue_status(&events, REVIEW_ISSUE_ID),
        Some(GgIssueStatus::Done),
        "the issue is accepted once the rework loop terminates on approval"
    );
}

/// An issue that names **no** reviewers is accepted as soon as its agent completes it — no review
/// telemetry, no reviewer dispatched — but its worktree is still merged back, which is what makes
/// its work visible to the issues that depend on it.
#[tokio::test]
async fn an_issue_without_reviewers_is_accepted_and_merged_directly() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-cr-off".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), issue_review_set(&[]));

    let counter = Arc::new(AtomicUsize::new(0));
    let factory = ScriptedFactory::new().slot(ROOT_PROFILE_ID, move |b| {
        let n = counter.fetch_add(1, Ordering::SeqCst);
        let responses = if n == 0 {
            vec![
                tool_call_response(
                    "issue",
                    "create_issue",
                    json!({
                        "title": "Add the widget",
                        "inScope": "Implement the widget.",
                        "outOfScope": "Unrelated changes.",
                        "completionCriteria": "The widget is fully implemented.",
                        "agent": ROOT_PROFILE_ID,
                    }),
                ),
                stop_response(),
            ]
        } else {
            vec![
                tool_call_response(
                    "write",
                    "write_file",
                    json!({ "path": "work.txt", "contents": "work\n" }),
                ),
                stop_response(),
            ]
        };
        Box::new(MockClient::new(&b.model_id, responses))
    });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();
    assert!(
        issue_reviews(&events).is_empty(),
        "no IssueReview telemetry when the issue named no reviewers"
    );
    assert_eq!(
        agent_spawns(&events).len(),
        2,
        "the root and the one auto-dispatched issue agent run — no reviewers"
    );
    assert_eq!(
        last_issue_status(&events, UNGROUPED_ISSUE_ID),
        Some(GgIssueStatus::Done),
        "the issue is accepted as soon as its agent completes it"
    );
    // The isolation is still real: the agent worked on a branch that was merged back.
    let merges = worktree_merges(&events);
    assert_eq!(merges.len(), 1);
    assert!(merges[0].2, "the accepted issue's branch merged cleanly");
    assert!(
        dir.path().join("work.txt").exists(),
        "the merged work is in the main workspace"
    );
    assert!(
        dir.path().join(".git").exists(),
        "project management makes the workspace a git repo so issues can be isolated"
    );
}

/// **A failed issue's work is discarded unmerged.** The dispatched agent writes something and then
/// dies on a model error; with its retries exhausted the issue is marked `failed` and its branch is
/// thrown away, so the main workspace never sees half-finished work — the counterpart to the
/// merge-on-acceptance path.
#[tokio::test]
async fn a_failed_issues_worktree_is_discarded_unmerged() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-issue-fail".to_string()), Box::new(sink.clone()));
    // No retries, so the first failure is terminal.
    let mut set = issue_review_set(&[]);
    for cap in &mut set.agents[0].capabilities {
        if cap.id == CAPABILITY_PROJECT_MANAGEMENT {
            cap.params = crate::tools::configured(
                CAPABILITY_PROJECT_MANAGEMENT,
                json!({ PROJECT_MANAGEMENT_PARAM_MERGE_AGENT: ROOT_PROFILE_ID, "maxRetries": 0 }),
            )
            .params;
        }
    }
    let inv = invocation(dir.path(), set);

    let counter = Arc::new(AtomicUsize::new(0));
    let factory = ScriptedFactory::new().slot(ROOT_PROFILE_ID, move |b| {
        let n = counter.fetch_add(1, Ordering::SeqCst);
        if n == 0 {
            Box::new(MockClient::new(
                &b.model_id,
                vec![
                    tool_call_response(
                        "issue",
                        "create_issue",
                        json!({
                            "title": "Add the widget",
                            "inScope": "Implement the widget.",
                            "outOfScope": "Nothing else.",
                            "completionCriteria": "The widget works.",
                            "agent": ROOT_PROFILE_ID,
                        }),
                    ),
                    stop_response(),
                ],
            ))
        } else {
            Box::new(WriteThenFailClient::new("half-done.txt", "half\n"))
        }
    });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();
    assert_eq!(
        last_issue_status(&events, UNGROUPED_ISSUE_ID),
        Some(GgIssueStatus::Failed),
        "the issue fails once its retries are exhausted"
    );
    let merges = worktree_merges(&events);
    assert_eq!(merges.len(), 1, "the failed issue's worktree is reconciled");
    assert_eq!(
        (merges[0].2, merges[0].3),
        (false, false),
        "a failed issue's branch is discarded, neither merged nor conflicted"
    );
    assert!(
        !dir.path().join("half-done.txt").exists(),
        "the half-finished work never reaches the main workspace"
    );
}

/// **A merge conflict is handed to the merge agent, which finishes the merge.** Two issues become
/// actionable at once, so both branch from the same commit and both create the same file with
/// different contents: whichever merges second cannot apply cleanly. gg dispatches the configured
/// merge agent into the main tree, it resolves and commits, and the issue is accepted with the
/// conflict recorded on its reconciliation.
#[tokio::test]
async fn a_conflicting_issue_merge_is_resolved_by_the_merge_agent() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-merge".to_string()), Box::new(sink.clone()));

    // The Root files both issues and implements them; `merger` is the shell-capable merge agent.
    let mut set = issue_review_set(&["merger"]);
    for cap in &mut set.agents[0].capabilities {
        if cap.id == CAPABILITY_PROJECT_MANAGEMENT {
            cap.params = crate::tools::configured(
                CAPABILITY_PROJECT_MANAGEMENT,
                json!({ PROJECT_MANAGEMENT_PARAM_MERGE_AGENT: "merger" }),
            )
            .params;
        }
    }
    let inv = invocation(dir.path(), set);

    // Client minting is synchronous and in dispatch order (the board dispatches in creation order),
    // so agent 1 owns the first issue and agent 2 the second. Both are ungrouped, so the board
    // numbers them `ISSUE-1` and `ISSUE-2`.
    let issue_titles = ["one", "two"];
    let issue_ids = ["ISSUE-1", "ISSUE-2"];
    let root_counter = Arc::new(AtomicUsize::new(0));
    let factory = ScriptedFactory::new()
        .slot(ROOT_PROFILE_ID, move |b| {
            let n = root_counter.fetch_add(1, Ordering::SeqCst);
            let responses = if n == 0 {
                issue_titles
                    .iter()
                    .map(|title| {
                        tool_call_response(
                            title,
                            "create_issue",
                            json!({
                                "title": format!("Write the shared file ({title})"),
                                "inScope": "Write shared.txt.",
                                "outOfScope": "Nothing else.",
                                "completionCriteria": "shared.txt exists.",
                                "agent": ROOT_PROFILE_ID,
                            }),
                        )
                    })
                    .chain(std::iter::once(stop_response()))
                    .collect()
            } else {
                let id = issue_ids[(n - 1).min(issue_ids.len() - 1)];
                vec![
                    tool_call_response(
                        "write",
                        "write_file",
                        json!({ "path": "shared.txt", "contents": format!("from issue {id}\n") }),
                    ),
                    stop_response(),
                ]
            };
            Box::new(MockClient::new(&b.model_id, responses))
        })
        // The merge agent resolves the conflict the only way it can be resolved here — keep the
        // incoming side — and commits, which is what "finish the merge" means.
        .slot("merger", |b| {
            Box::new(MockClient::new(
                &b.model_id,
                vec![
                    tool_call_response(
                        "resolve",
                        "shell",
                        json!({
                            "command": "git checkout --theirs shared.txt && git add -A && \
                                        git -c user.name=gg -c user.email=gg@clockwyrks.local \
                                        commit --no-edit"
                        }),
                    ),
                    stop_response(),
                ],
            ))
        });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();
    let merges = worktree_merges(&events);
    assert_eq!(merges.len(), 2, "both issues' branches are reconciled");
    assert!(
        merges.iter().all(|(_, _, merged, _)| *merged),
        "both issues land in the main workspace, the conflicting one via the merge agent"
    );
    assert_eq!(
        merges.iter().filter(|(_, _, _, c)| *c).count(),
        1,
        "exactly one of the two merges conflicted"
    );
    assert!(
        agent_spawns(&events)
            .iter()
            .any(|(_, _, profile_id, _, _)| profile_id == "merger"),
        "the merge agent was dispatched to resolve the conflict"
    );
    for id in issue_ids {
        assert_eq!(
            last_issue_status(&events, id),
            Some(GgIssueStatus::Done),
            "issue `{id}` is accepted once its work is in the main workspace"
        );
    }
    assert!(
        dir.path().join("shared.txt").exists(),
        "the merged file is in the main workspace"
    );
}

/// A run that enables project management **must** name a merge agent, and that agent must be able to
/// run a shell — resolving a merge means running `git`. Both are launch-time refusals, so a
/// misconfiguration is caught before any model is called.
#[test]
fn project_management_requires_a_shell_capable_merge_agent() {
    let base = || {
        let mut set = GgCapabilitySet::minimal("mock/primary");
        set.agents[0]
            .subagents
            .push(GgSubagentRef::any(ROOT_PROFILE_ID));
        set
    };

    // No merge agent at all — written `null`, since a capability authored the way a document
    // authors one already names the root, and the absence is what this arm is about.
    let mut missing = base();
    crate::tools::grant_configured(
        &mut missing.agents[0],
        crate::tools::configured(
            CAPABILITY_PROJECT_MANAGEMENT,
            json!({ PROJECT_MANAGEMENT_PARAM_MERGE_AGENT: serde_json::Value::Null }),
        ),
    );
    let err =
        crate::validate::refusal(&missing).expect_err("a board with no merge agent is refused");
    assert!(
        err.contains(PROJECT_MANAGEMENT_PARAM_MERGE_AGENT),
        "the error names the param: {err}"
    );

    // A merge agent that is not a declared profile.
    let mut unknown = base();
    crate::tools::grant_configured(
        &mut unknown.agents[0],
        crate::tools::configured(
            CAPABILITY_PROJECT_MANAGEMENT,
            json!({ PROJECT_MANAGEMENT_PARAM_MERGE_AGENT: "nobody" }),
        ),
    );
    let err = crate::validate::refusal(&unknown).expect_err("an undeclared merge agent is refused");
    assert!(
        err.contains("nobody"),
        "the error names the id that resolved to nothing: {err}"
    );

    // A declared merge agent without the shell capability.
    let mut shell_less = base();
    crate::tools::grant_configured(
        &mut shell_less.agents[0],
        crate::tools::configured(
            CAPABILITY_PROJECT_MANAGEMENT,
            json!({ PROJECT_MANAGEMENT_PARAM_MERGE_AGENT: "merger" }),
        ),
    );
    let mut merger = GgAgentConfig {
        slug: "merger".to_string(),
        name: "Merger".to_string(),
        model_id: "mock/merger".to_string(),
        ..GgAgentConfig::root()
    };
    merger.capabilities.retain(|cap| cap.id != CAPABILITY_SHELL);
    shell_less.agents.push(merger);
    let err =
        crate::validate::refusal(&shell_less).expect_err("a shell-less merge agent is refused");
    assert!(
        err.contains("shell"),
        "the error says why a shell is needed: {err}"
    );

    // The same set with the shell restored launches.
    let mut ok = shell_less.clone();
    crate::tools::grant(&mut ok.agents[1], CAPABILITY_SHELL);
    assert!(
        crate::validate::refusal(&ok).is_ok(),
        "a shell-capable merge agent is accepted"
    );
}

/// An issue's `agent` must be a roster entry scoped as an **implementer**, and its `reviewers` must
/// be scoped as **reviewers** — the two are governed independently, so a profile trusted to write
/// code is not automatically trusted to review it.
#[test]
fn issue_assignment_is_governed_by_roster_scopes() {
    let mut set = GgCapabilitySet::minimal("mock/primary");
    set.agents[0].subagents = vec![
        GgSubagentRef::new("builder", &[GgSubagentScope::Implementer]),
        GgSubagentRef::new("critic", &[GgSubagentScope::Reviewer]),
    ];
    // Both targets are declared, because a resolved roster is resolved *against the set*: an entry
    // pointing at a profile nothing declares is dropped before a policy ever sees it.
    for (id, name) in [("builder", "Builder"), ("critic", "Critic")] {
        set.agents.push(GgAgentConfig {
            slug: id.to_string(),
            name: name.to_string(),
            model_id: "mock/primary".to_string(),
            ..GgAgentConfig::root()
        });
    }
    let policy = IssuePolicy::resolve(
        set.root(),
        set.roster(set.root(), GgSubagentScope::Implementer),
        set.roster(set.root(), GgSubagentScope::Reviewer),
        &mut crate::validate::LaunchReport::Discarding,
    );
    assert!(policy.allows_implementer("builder"));
    assert!(!policy.allows_implementer("critic"));
    assert!(policy.allows_reviewer("critic"));
    assert!(!policy.allows_reviewer("builder"));
    // A subagent-only entry is namable for neither.
    assert!(!set.root().can_spawn("builder"));
    assert!(
        set.root()
            .allows_scope("builder", GgSubagentScope::Implementer)
    );
}

/// The agent topology for the offline issue-review e2e (driven by the `DefaultClientFactory`
/// `mock/demo-*` scripts). The `issue-review-parent` script is message-driven and plays **three
/// roles on the Root profile** — the root that files the issue, the agent auto-dispatched to
/// implement it, and that same agent when the review sends it back. Only the reviewer is a distinct
/// model. The Root's roster names itself as the implementer and `reviewer` as the reviewer; the Root
/// is also the merge agent the capability requires.
fn issue_review_e2e_set() -> GgCapabilitySet {
    let mut root = GgAgentConfig {
        model_id: "mock/demo-issue-review-parent".to_string(),
        ..GgAgentConfig::root()
    };
    crate::tools::grant_configured(
        &mut root,
        crate::tools::configured(
            CAPABILITY_PROJECT_MANAGEMENT,
            json!({ PROJECT_MANAGEMENT_PARAM_MERGE_AGENT: ROOT_PROFILE_ID }),
        ),
    );
    root.subagents = vec![
        GgSubagentRef::new(ROOT_PROFILE_ID, &[GgSubagentScope::Implementer]),
        GgSubagentRef::new("reviewer", &[GgSubagentScope::Reviewer]),
    ];
    let reviewer = GgAgentConfig {
        slug: "reviewer".to_string(),
        name: "Reviewer".to_string(),
        model_id: "mock/demo-review-reviewer".to_string(),
        ..GgAgentConfig::root()
    };
    GgCapabilitySet {
        agents: vec![root, reviewer],
        ..GgCapabilitySet::default()
    }
}

/// The full review → rework → approve cycle driven **offline through the real binary path** (the
/// `DefaultClientFactory` + the `mock/…` model-id scripts), not the in-crate scripted factory: the
/// reviewer requests the fix marker, the re-invoked agent writes it, and the re-review approves.
#[tokio::test]
async fn issue_review_offline_e2e_through_the_default_factory() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-cr-mock".to_string()), Box::new(sink.clone()));

    let inv = invocation(dir.path(), issue_review_e2e_set());

    // `run` uses the production DefaultClientFactory, which selects the mock scripts by model id.
    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);

    // The initial pass did its work, the rework pass wrote the review fix marker, and both merged
    // back into the main workspace when the issue was accepted.
    assert!(
        dir.path().join(MOCK_REVIEW_WORKER_FILE).exists(),
        "the initial pass did its work"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join(MOCK_REVIEW_FIX_FILE))
            .ok()
            .as_deref()
            .map(str::trim),
        Some(MOCK_REVIEW_FIX_SENTINEL),
        "the re-invoked agent applied the reviewer's requested change"
    );

    let events = sink.events();
    let reviews = issue_reviews(&events);
    assert!(
        reviews
            .iter()
            .any(|(_, p, _, _)| *p == GgIssueReviewPhase::ChangesRequested),
        "the first review requested changes"
    );
    assert!(
        reviews
            .iter()
            .any(|(_, p, _, _)| *p == GgIssueReviewPhase::Approved),
        "the re-review approved"
    );
    assert_eq!(
        last_issue_status(&events, &format!("{MOCK_ISSUE_REVIEW_PREFIX}-1")),
        Some(GgIssueStatus::Done),
        "the issue is accepted after the offline review→rework→approve cycle"
    );
    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
}

// ---------------------------------------------------------------------------
// Stage P6a: the aggregatable session summary computed + emitted by the binary
// ---------------------------------------------------------------------------

/// The single `SessionSummary` a run emits (its payload), or `None` when the run emitted none.
fn session_summary(events: &[GgTelemetryEvent]) -> Option<GgSessionSummary> {
    events.iter().find_map(|e| match &e.kind {
        GgTelemetryKind::SessionSummary { summary } => Some((**summary).clone()),
        _ => None,
    })
}

/// The per-turn `Usage` deltas summed by the `(slot, model)` each one names — the live,
/// delta-only reconstruction of the per-model spend a console derives while a run is still going,
/// before any end-of-agent `SlotUsage` rollup exists.
///
/// Panics on an unattributed delta: a live gg run has a model binding for every turn it takes, so
/// a delta with no `(slot, model)` would be a hole in exactly the accounting this reconstruction
/// exists to make possible.
fn usage_by_slot_model(events: &[GgTelemetryEvent]) -> HashMap<(String, String), u64> {
    let mut totals: HashMap<(String, String), u64> = HashMap::new();
    for event in events {
        let GgTelemetryKind::Usage {
            profile_id,
            model_id,
            tokens,
            ..
        } = &event.kind
        else {
            continue;
        };
        *totals
            .entry((profile_id.clone(), model_id.clone()))
            .or_default() += tokens.total().unwrap_or(0);
    }
    totals
}

/// The `(slot, model)` keys of the `SlotUsage` rollups the stream carried, in emission order.
fn slot_usage_keys(events: &[GgTelemetryEvent]) -> Vec<(String, String)> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::SlotUsage {
                profile_id,
                model_id,
                ..
            } => Some((profile_id.clone(), model_id.clone())),
            _ => None,
        })
        .collect()
}

/// A run emits exactly one `SessionSummary`, **immediately before** the terminal `SessionEnded`,
/// and — for a plain single-agent run — it summarizes a lone root agent whose per-slot cost rollup
/// matches the `SlotUsage` the run streamed.
#[tokio::test]
async fn run_emits_a_session_summary_immediately_before_session_ended() {
    let dir = TempDir::new().unwrap();
    seed_default_skill(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-summary".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/echo"));

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);
    let events = sink.events();

    // Exactly one summary, and it sits directly before the (final) SessionEnded.
    let summary_pos = events
        .iter()
        .position(|e| matches!(e.kind, GgTelemetryKind::SessionSummary { .. }))
        .expect("a session summary was emitted");
    assert_eq!(
        events
            .iter()
            .filter(|e| matches!(e.kind, GgTelemetryKind::SessionSummary { .. }))
            .count(),
        1,
        "exactly one session summary"
    );
    let ended_pos = events.len() - 1;
    assert!(matches!(
        events[ended_pos].kind,
        GgTelemetryKind::SessionEnded { .. }
    ));
    assert_eq!(
        summary_pos + 1,
        ended_pos,
        "the summary immediately precedes SessionEnded"
    );

    let summary = session_summary(&events).unwrap();
    assert_eq!(summary.terminal_status, "completed");
    // A single-agent run: one AgentSpawned (the root), no subagents, depth 0.
    let spawned = events
        .iter()
        .filter(|e| matches!(e.kind, GgTelemetryKind::AgentSpawned { .. }))
        .count() as u64;
    assert_eq!(summary.agents_spawned, spawned);
    assert_eq!(summary.agents_spawned, 1);
    assert_eq!(summary.subagent_count, 0);
    assert_eq!(summary.max_subagent_depth, 0);
    assert_eq!(summary.compactions, 0);
    assert!(!summary.ran_out_of_context);
    // Context visibility is on by default, so the run reported a final fullness.
    assert!(
        summary.final_fullness.is_some(),
        "a fullness was reported by the default context visibility"
    );
    // No board or reviews in a minimal run.
    assert_eq!(summary.issue_reviews, 0);
    assert_eq!(summary.issues_created, 0);
    assert_eq!(summary.issues_completed, 0);
    // The per-slot rollup matches the SlotUsage the run streamed (one `primary` slot).
    let slot_keys = slot_usage_keys(&events);
    assert_eq!(
        summary
            .slot_costs
            .iter()
            .map(|c| (c.profile_id.clone(), c.model_id.clone()))
            .collect::<Vec<_>>(),
        slot_keys
    );
    assert_eq!(summary.slot_costs.len(), 1);
    assert_eq!(summary.slot_costs[0].profile_id, ROOT_PROFILE_ID);
    // The effective toolset is recorded on the summary: the exact set of tools the run offered its
    // agent (shell + the filesystem tools among them), so two configurations are comparable on what
    // their agents were actually handed.
    assert!(
        !summary.effective_tools.is_empty(),
        "the run recorded its effective toolset"
    );
    for tool in ["shell", "read_file", "write_file", "edit_file", "list_dir"] {
        assert!(
            summary.effective_tools.iter().any(|t| t == tool),
            "expected `{tool}` in the recorded effective toolset"
        );
    }
}

/// An allowlist recorded on the capability set is honored end to end: a tool it does not name is
/// absent from the effective toolset the summary records, while the rest of its capability's tools
/// remain — the finest-grained lever there is, observable on the run's durable outcome.
#[tokio::test]
async fn an_allowlist_is_reflected_in_the_recorded_effective_toolset() {
    let dir = TempDir::new().unwrap();
    seed_default_skill(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-narrowed".to_string()), Box::new(sink.clone()));
    // Filesystem stays on, but `edit_file` is left out (the apply-patch-vs-write lever).
    let mut set = GgCapabilitySet::minimal("mock/echo");
    set.agents[0].tools.retain(|name| name != "edit_file");
    let inv = invocation(dir.path(), set);

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);
    let summary = session_summary(&sink.events()).unwrap();

    // The ungranted tool is absent from the recorded effective toolset...
    assert!(
        !summary.effective_tools.iter().any(|t| t == "edit_file"),
        "`edit_file` is not in this agent's allowlist"
    );
    // ...while the rest of the filesystem capability's tools (and shell) remain offered.
    for tool in ["read_file", "write_file", "list_dir", "shell"] {
        assert!(
            summary.effective_tools.iter().any(|t| t == tool),
            "expected `{tool}` to remain offered"
        );
    }
}

/// A multi-agent, reviewer-gated run's summary counts each aggregatable figure exactly as the stream
/// carried it: every spawned agent, each issue-review phase, the board's issues, and the per-slot
/// rollups — so an aggregate query can trust the recorded summary without replaying the stream.
#[tokio::test]
async fn session_summary_counts_match_an_issue_review_run_stream() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-cr-summary".to_string()), Box::new(sink.clone()));

    let set = issue_review_e2e_set();
    let inv = invocation(dir.path(), set);

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);
    let events = sink.events();
    let summary = session_summary(&events).expect("a session summary was emitted");

    // The summary sits immediately before the terminal SessionEnded.
    let summary_pos = events
        .iter()
        .position(|e| matches!(e.kind, GgTelemetryKind::SessionSummary { .. }))
        .unwrap();
    assert_eq!(summary_pos + 1, events.len() - 1);
    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
    assert_eq!(summary.terminal_status, "completed");

    // Agents: the summary's count equals the AgentSpawned events (root + worker + reviewer(s) +
    // fixer(s)), and the run delegated, so there was more than just the root.
    let spawned = events
        .iter()
        .filter(|e| matches!(e.kind, GgTelemetryKind::AgentSpawned { .. }))
        .count() as u64;
    assert_eq!(summary.agents_spawned, spawned);
    assert!(summary.subagent_count >= 1, "the run spawned subagents");
    assert_eq!(summary.subagent_count, summary.agents_spawned - 1);
    let deepest = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::AgentSpawned { depth, .. } => Some(*depth),
            _ => None,
        })
        .max()
        .unwrap();
    assert_eq!(summary.max_subagent_depth, deepest);

    // Issue reviews: the three figures match the phases the stream carried.
    let reviews = issue_reviews(&events);
    let requested = reviews
        .iter()
        .filter(|(_, p, _, _)| *p == GgIssueReviewPhase::Requested)
        .count() as u64;
    let changes = reviews
        .iter()
        .filter(|(_, p, _, _)| *p == GgIssueReviewPhase::ChangesRequested)
        .count() as u64;
    let approved = reviews
        .iter()
        .filter(|(_, p, _, _)| *p == GgIssueReviewPhase::Approved)
        .count() as u64;
    assert_eq!(summary.issue_reviews, requested);
    assert_eq!(summary.review_cycles, changes + approved);
    assert_eq!(summary.issues_reopened, changes);
    // This mock does a review → changes → approve cycle, so all three are exercised.
    assert!(summary.issue_reviews >= 1);
    assert!(summary.issues_reopened >= 1);
    assert!(summary.review_cycles >= 2);

    // Issues: the review issue was created and accepted (done) by the end.
    assert!(summary.issues_created >= 1);
    assert_eq!(
        summary.issues_completed, summary.issues_created,
        "every created issue was completed in this scripted run"
    );

    // Per-slot rollup matches the SlotUsage rollups the run streamed.
    let slot_keys = slot_usage_keys(&events);
    assert_eq!(
        summary
            .slot_costs
            .iter()
            .map(|c| (c.profile_id.clone(), c.model_id.clone()))
            .collect::<Vec<_>>(),
        slot_keys
    );
    assert!(
        summary.slot_costs.len() >= 2,
        "the run spent on more than one slot (worker + reviewer)"
    );
}

// ---------------------------------------------------------------------------
// Replay capture (Phase 7a) — recording the non-deterministic inputs
// ---------------------------------------------------------------------------

/// A run that asked for **nothing** is still recorded. This is the always-on property, and the
/// only way to see it is to drive a session with a bare configuration and find a journal.
///
/// It matters because the capability it replaced could not be armed retroactively: the record
/// exists for surprising outcomes, and an outcome is surprising precisely when nobody predicted
/// it.
#[tokio::test]
async fn a_run_with_no_capabilities_configured_is_still_captured() {
    let dir = TempDir::new().unwrap();
    seed_default_skill(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-default".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/echo"));
    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);

    let lines = read_session_journal(dir.path());
    assert!(
        !journal_entries(&lines).is_empty(),
        "an unconfigured run pins its inputs anyway",
    );
    // And the operator log says so — the only place a reader finds out, without opening the
    // artifact, how much of the run was recorded.
    let logs = sink.lines();
    assert!(
        logs.iter()
            .any(|line| line.contains("session capture: journaled")),
        "the close-out line reports the capture, got {logs:?}",
    );
}

/// A real session pins its **invocation envelope** and a row for **every agent it created**,
/// alongside the inputs — the provenance a reconstruction binds itself to before it consumes a
/// single entry.
///
/// The ordering assertion at the end is the load-bearing one, and it is what the whole agent table
/// exists for: the row is written when the agent *comes into existence*, ahead of its first pinned
/// input rather than derived from it. That is why an agent which records nothing — one parked
/// behind the parallelism cap when the run is killed, one whose first model call never returns —
/// is still in the table. A set derived from the entries silently drops exactly those agents, and a
/// reconstruction would then run a smaller fleet than the run did.
#[tokio::test]
async fn a_captured_run_pins_its_envelope_and_every_agent_it_created() {
    let dir = TempDir::new().unwrap();
    let emitter = Emitter::with_sink(
        Some("run-provenance".to_string()),
        Box::new(CollectingSink::new()),
    );
    let set = subagent_set(1, 3, &["subagent"]);
    let inv = invocation(dir.path(), set.clone());
    let factory = ScriptedFactory::new()
        .slot(ROOT_PROFILE_ID, |b| {
            Box::new(MockClient::with_subagent_parent_script(&b.model_id))
        })
        .slot("subagent", |b| {
            Box::new(MockClient::with_subagent_child_script(&b.model_id))
        });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let lines = read_session_journal(dir.path());

    // The envelope, as the launch resolved it.
    let seed = journal_seed(&lines).expect("the run pinned its invocation envelope");
    assert_eq!(seed.prompt, "Build a tiny game.");
    assert_eq!(
        seed.model_windows.keys().collect::<Vec<_>>(),
        vec!["mock/primary", "mock/subagent"],
        "every model the run could bind, not only the root's",
    );
    assert_eq!(
        seed.model_windows["mock/primary"],
        resolve_window_limit(set.root(), &inv.model_windows, "mock/primary")
            .expect("a resolved window"),
        "the **resolved** window the fullness signal is measured against, not the catalog figure",
    );
    assert!(
        seed.model_modalities["mock/primary"].vision,
        "nothing was denied, so the resolved modality state is the optimistic offline default",
    );

    // The table: both agents, each keyed by how it came to exist.
    let rows = journal_agent_table(&lines);
    assert_eq!(
        rows.iter()
            .map(|row| row.agent_id.as_str())
            .collect::<Vec<_>>(),
        vec![ROOT_AGENT_ID, "agent-0"],
        "the root and the child it spawned, in creation order",
    );
    assert_eq!(rows[0].origin, GgSessionAgentOrigin::Root);
    assert_eq!(
        rows[1].origin,
        GgSessionAgentOrigin::Spawn {
            parent: ROOT_AGENT_ID.to_string(),
            ordinal: 0,
        },
        "keyed on the spawner and the spawn's position in its turn loop — never on the child's \
         own id, which a playback assigns off its own counter",
    );
    assert_eq!(
        rows[1].profile_id, "subagent",
        "the row joins on the profile id",
    );
    assert_eq!(
        rows[1].profile,
        set.agent("subagent").expect("the profile is declared").name,
        "and carries that profile's display name, for reading",
    );
    for row in &rows {
        assert_eq!(
            row.terminal_status,
            Some(GgAgentStatus::Done),
            "both loops ended, so both rows were superseded by a terminal one",
        );
    }

    // And the child's row was written before it pinned anything at all.
    let row_at = lines
        .iter()
        .position(
            |line| matches!(line, GgJournalLine::Agent { agent } if agent.agent_id == "agent-0"),
        )
        .expect("the child's opening row");
    let first_entry_at = lines
        .iter()
        .position(
            |line| matches!(line, GgJournalLine::Entry { entry } if entry.agent_id == "agent-0"),
        )
        .expect("the child did record inputs, which is what makes the ordering meaningful");
    assert!(
        row_at < first_entry_at,
        "the child is in the table before its first pinned input, so an agent that never \
         reaches one is in the table too",
    );
}

/// Drive a two-agent run whose **child fails**: the root delegates, the child's provider refuses
/// every turn it takes, and the root goes on to finish.
///
/// The two tests below read the two records of that child's ending — its provenance row and the
/// agent-tree telemetry — and both are here rather than in the fault file because nothing of gg's
/// broke: a model error is the plainest failure an agent can have, which is exactly what makes it
/// the right thing to ask the question with.
async fn run_with_a_failing_child(dir: &Path, emitter: &Emitter) {
    let inv = invocation(dir, subagent_set(1, 3, &["subagent"]));
    let factory = ScriptedFactory::new()
        .slot(ROOT_PROFILE_ID, |b| {
            Box::new(MockClient::with_subagent_parent_script(&b.model_id))
        })
        .slot("subagent", |_| {
            Box::new(FailingClient {
                mode: FailureMode::Fatal,
            })
        });

    assert_eq!(
        run_with_factory(&inv, emitter, Arc::new(factory)).await,
        SessionOutcome::Ran,
        "a subagent whose model refused it is a run that ran: the failure is the result",
    );
}

/// **A failed agent's provenance row says it failed**, beside a finished one that says it did not.
///
/// The row is what a reconstruction and the run record read an agent's ending from, and it carries
/// only the two states — so if it recorded [`Done`](GgAgentStatus::Done) for every agent that
/// reached an ending, every failure gg has would be indistinguishable from a clean finish in the
/// record: a child that died mid-task, a refused credential, and — since a gg defect ends an agent
/// on a [failure status](is_failure_status) too — a node the [attribution seam](attribution) exists
/// to make legible.
#[tokio::test]
async fn a_failed_agents_provenance_row_records_that_it_failed() {
    let dir = TempDir::new().unwrap();
    let emitter = Emitter::with_sink(
        Some("run-failed-row".to_string()),
        Box::new(CollectingSink::new()),
    );

    run_with_a_failing_child(dir.path(), &emitter).await;

    let rows = journal_agent_table(&read_session_journal(dir.path()));
    assert_eq!(
        rows.iter()
            .map(|row| (row.agent_id.as_str(), row.terminal_status))
            .collect::<Vec<_>>(),
        vec![
            (ROOT_AGENT_ID, Some(GgAgentStatus::Done)),
            ("agent-0", Some(GgAgentStatus::Failed)),
        ],
        "one run, two endings, and the table tells them apart",
    );
}

/// **A failed agent is reported failed on the agent tree**, which is the same ending read from the
/// live stream instead of from the record.
///
/// The console draws its tree from these transitions, so this is where an operator watching a run
/// finds out that a node of it died — and it is deliberately asserted apart from the row above:
/// they are two independent readings of one [terminal status](TerminalStatus), and the whole point
/// of reading them off one predicate is that they cannot disagree.
#[tokio::test]
async fn a_failed_agent_is_reported_failed_on_the_agent_tree() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-failed-tree".to_string()), Box::new(sink.clone()));

    run_with_a_failing_child(dir.path(), &emitter).await;

    let events = sink.events();
    let terminal_for = |agent: &str| {
        events
            .iter()
            .filter(|event| event.agent_id.as_deref() == Some(agent))
            .rev()
            .find_map(|event| match event.kind {
                GgTelemetryKind::AgentStatus { status, .. } => Some(status),
                _ => None,
            })
    };
    assert_eq!(
        terminal_for("agent-0"),
        Some(GgAgentStatus::Failed),
        "the child's node ends red: its model refused every turn it took",
    );
    assert_eq!(
        terminal_for(ROOT_AGENT_ID),
        Some(GgAgentStatus::Done),
        "and its spawner's does not — a child that failed is not a root that did",
    );
}

/// Read and parse the `.gg/replay.ndjson` capture journal a replay-captured run writes under
/// `dir`, one [line](GgJournalLine) per record.
fn read_session_journal(dir: &Path) -> Vec<GgJournalLine> {
    let path = dir.join(GG_SESSION_JOURNAL_PATH);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|err| panic!("capture journal at {}: {err}", path.display()));
    text.lines()
        .map(|line| {
            serde_json::from_str(line)
                .unwrap_or_else(|err| panic!("capture journal line `{line}`: {err}"))
        })
        .collect()
}

/// The **last** [invocation envelope](GgSessionSeed) a journal carries, which is the one assembly
/// keeps: a later line supersedes an earlier one, because the resolved modality state is not known
/// until the session ends.
fn journal_seed(lines: &[GgJournalLine]) -> Option<&GgSessionSeed> {
    lines.iter().rev().find_map(|line| match line {
        GgJournalLine::Seed { seed } => Some(seed.as_ref()),
        _ => None,
    })
}

/// The [agent table](GgSessionAgent) a journal implies, folded the way assembly folds it: upserted
/// by `agent_id`, in creation order, so the terminal row supersedes the opening one.
fn journal_agent_table(lines: &[GgJournalLine]) -> Vec<GgSessionAgent> {
    let mut table: Vec<GgSessionAgent> = Vec::new();
    for line in lines {
        let GgJournalLine::Agent { agent } = line else {
            continue;
        };
        match table
            .iter_mut()
            .find(|existing| existing.agent_id == agent.agent_id)
        {
            Some(existing) => *existing = agent.as_ref().clone(),
            None => table.push(agent.as_ref().clone()),
        }
    }
    table
}

/// The pinned inputs a journal carries, in write order.
fn journal_entries(lines: &[GgJournalLine]) -> Vec<&GgSessionEntry> {
    lines
        .iter()
        .filter_map(|line| match line {
            GgJournalLine::Entry { entry } => Some(entry.as_ref()),
            _ => None,
        })
        .collect()
}

/// The pooled message body at `index`, as the journal wrote it.
fn journal_message(lines: &[GgJournalLine], index: u32) -> serde_json::Value {
    lines
        .iter()
        .find_map(|line| match line {
            GgJournalLine::Message { index: at, message } if *at == index => {
                Some(message.body.clone())
            }
            _ => None,
        })
        .unwrap_or_else(|| panic!("the journal pooled a message at index {index}"))
}

/// A replay-captured run streams a `.gg/replay.ndjson` journal that pins every model call
/// (pooled request + response) and every tool result, tagged by agent + a globally monotonic
/// sequence, in order.
#[tokio::test]
async fn session_capture_records_model_io_and_tool_results_in_order() {
    let dir = TempDir::new().unwrap();
    seed_default_skill(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-replay".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/echo"));

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);

    let lines = read_session_journal(dir.path());
    // The header identifies the session (what `core` stamps as the run id) and the configuration.
    let GgJournalLine::Header {
        session_id,
        capability_set,
        ..
    } = &lines[0]
    else {
        panic!("the journal opens with its header, got {:?}", lines[0]);
    };
    assert_eq!(session_id, &inv.session_id);
    assert_eq!(
        capability_set.as_ref(),
        &inv.capability_set,
        "the header pins the configuration the run was launched under"
    );
    // And it terminates, so the record is provably not a session that died mid-capture.
    assert!(
        matches!(
            lines.last(),
            Some(GgJournalLine::End {
                truncation: None,
                ..
            })
        ),
        "a completed run terminates its journal, got {:?}",
        lines.last()
    );

    let entries = journal_entries(&lines);
    // The sequence is globally monotonic and strictly increasing in recording order.
    let seqs: Vec<u64> = entries.iter().map(|entry| entry.seq).collect();
    assert!(!seqs.is_empty(), "a captured run records entries");
    assert!(
        seqs.windows(2).all(|w| w[0] < w[1]),
        "sequence is strictly increasing, got {seqs:?}"
    );

    // Every model turn was recorded (request + response). The default mock takes at least two
    // turns: one that writes the file and one that stops.
    let model_ios: Vec<_> = entries
        .iter()
        .filter(|entry| matches!(entry.kind, GgSessionEntryKind::ModelIo { .. }))
        .collect();
    assert!(
        model_ios.len() >= 2,
        "at least two model turns recorded, got {}",
        model_ios.len()
    );
    for entry in &model_ios {
        let GgSessionEntryKind::ModelIo {
            request, response, ..
        } = &entry.kind
        else {
            unreachable!()
        };
        // A request is pool references plus the fingerprint of the question it asked, and every
        // reference resolves to a body the journal actually wrote.
        assert!(
            !request.messages.is_empty(),
            "a request carries its messages"
        );
        for index in &request.messages {
            assert!(journal_message(&lines, *index).is_object());
        }
        assert!(
            request.toolset.is_some(),
            "and the toolset it offered, pooled once for the whole run"
        );
        assert!(
            response.get("finishReason").is_some(),
            "a recorded response carries its finish reason"
        );
    }
    // The toolset really is pooled once rather than once per turn.
    let toolsets = lines
        .iter()
        .filter(|line| matches!(line, GgJournalLine::Toolset { .. }))
        .count();
    assert_eq!(toolsets, 1, "the offered toolset is written once");

    // The scripted `write_file` tool result was recorded with its exact call + outcome.
    let write_result = entries.iter().find_map(|entry| match &entry.kind {
        GgSessionEntryKind::ToolResult { call, outcome } if call.name == "write_file" => {
            Some((entry.seq, outcome.clone()))
        }
        _ => None,
    });
    let (result_seq, outcome) = write_result.expect("the write_file tool result was recorded");
    assert!(outcome.ok, "the write succeeded");

    // Single-agent run: every entry is tagged with the root agent.
    assert!(
        entries.iter().all(|entry| entry.agent_id == ROOT_AGENT_ID),
        "a single-agent run tags every session-record entry with the root"
    );

    // The model call that requested `write_file` precedes the recorded `write_file` tool result.
    let call_seq = model_ios
        .iter()
        .find(|entry| match &entry.kind {
            GgSessionEntryKind::ModelIo { response, .. } => {
                response.to_string().contains("write_file")
            }
            _ => false,
        })
        .map(|entry| entry.seq)
        .expect("a model turn that requested write_file");
    assert!(
        call_seq < result_seq,
        "the model call precedes the tool result it requested"
    );
}

/// Every model turn a captured run takes is followed by that agent's **prompt frame**: the window
/// it was sent, carrying the four typed fields the flat message array does not — each item's slot,
/// its retention, the turn it was pushed on, and a paged file view's region.
///
/// The wiring is what this proves. The recorder's own tests show the entry is well-formed; only a
/// driven run shows the loop reaches the seam at all, at the one place it holds the
/// [`PromptItem`](crate::context::PromptItem) stream, and *after* the call it describes.
#[tokio::test]
async fn session_capture_records_a_prompt_frame_for_every_model_turn() {
    let dir = TempDir::new().unwrap();
    seed_default_skill(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-frames".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/echo"));

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);

    let lines = read_session_journal(dir.path());
    let entries = journal_entries(&lines);
    let frames: Vec<_> = entries
        .iter()
        .filter(|entry| matches!(entry.kind, GgSessionEntryKind::PromptFrame { .. }))
        .collect();
    let model_ios: Vec<_> = entries
        .iter()
        .filter(|entry| matches!(entry.kind, GgSessionEntryKind::ModelIo { .. }))
        .collect();
    assert_eq!(
        frames.len(),
        model_ios.len(),
        "one frame per model turn, got {} frames for {} turns",
        frames.len(),
        model_ios.len()
    );

    // Each frame follows the turn it describes and pins the *same* window: identical pooled
    // message indices, because both seams intern through the one interner. That is also why the
    // frame writes no new bodies — it is a list of small integers.
    let mut pending: Option<(u64, &Vec<u32>)> = None;
    let mut checked = 0;
    for entry in &entries {
        match &entry.kind {
            GgSessionEntryKind::ModelIo { request, .. } => {
                pending = Some((entry.seq, &request.messages));
            }
            GgSessionEntryKind::PromptFrame { items } => {
                let (call_seq, messages) = pending.take().expect("a frame follows a model call");
                assert!(call_seq < entry.seq, "the frame lands after its call");
                assert_eq!(
                    items.iter().map(|item| item.message).collect::<Vec<_>>(),
                    *messages,
                    "the frame pins the window the call was sent"
                );
                // The system prompt is the window's first item, held in its own slot and carried
                // across a compaction verbatim — and it is unnumbered, since it is seeded before
                // the first turn opens.
                let system = items.first().expect("a window has a system prompt");
                assert_eq!(system.slot, GgSessionPromptSlot::System);
                assert_eq!(system.retention, GgSessionRetention::Pinned);
                assert_eq!(system.turn, 0);
                // Everything after it this run is thread material: the mock takes no paged read
                // and the minimal set arms no context-usage signal.
                assert!(
                    items[1..]
                        .iter()
                        .all(|item| item.slot == GgSessionPromptSlot::Thread),
                    "the rest of the window is the thread"
                );
                checked += 1;
            }
            _ => {}
        }
    }
    assert!(checked > 0, "at least one frame was checked");
}

/// The capture close-out sits **before** the session summary, so the summary stays the last
/// event before the terminal `SessionEnded`.
///
/// That adjacency is what lets `core` lift the summary onto the run record without re-parsing the
/// stream, and it is the one thing always-on capture could have quietly broken: a close-out line
/// emitted after the summary would have separated the pair on *every* run instead of on the rare
/// configured one.
#[tokio::test]
async fn the_capture_close_out_does_not_separate_the_summary_from_session_ended() {
    let dir = TempDir::new().unwrap();
    seed_default_skill(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-epilogue".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/echo"));

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);

    let events = sink.events();
    let capture_pos = events
        .iter()
        .position(|event| match &event.kind {
            GgTelemetryKind::Log { message, .. } => message.starts_with("session capture:"),
            _ => false,
        })
        .expect("every run reports its capture");
    let summary_pos = events
        .iter()
        .position(|event| matches!(event.kind, GgTelemetryKind::SessionSummary { .. }))
        .expect("a session summary was emitted");
    assert!(capture_pos < summary_pos);
    assert_eq!(
        summary_pos + 1,
        events.len() - 1,
        "the summary is still the last thing before SessionEnded"
    );
}

/// A multi-agent replay-captured run records entries from the root **and** its subagent,
/// interleaved under one globally monotonic sequence, so the record reconstructs the concurrent
/// tree deterministically.
#[tokio::test]
async fn replay_capture_interleaves_a_multi_agent_run() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-replay-sub".to_string()), Box::new(sink.clone()));
    // Subagents + multi-model on top of the minimal defaults, with a subagent slot bound.
    let set = subagent_set(1, 3, &["subagent"]);
    let inv = invocation(dir.path(), set);
    let factory = ScriptedFactory::new()
        .slot(ROOT_PROFILE_ID, |b| {
            Box::new(MockClient::with_subagent_parent_script(&b.model_id))
        })
        .slot("subagent", |b| {
            Box::new(MockClient::with_subagent_child_script(&b.model_id))
        });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let lines = read_session_journal(dir.path());
    let entries = journal_entries(&lines);

    // Both the root and the spawned subagent (`agent-0`) recorded entries.
    let agents: std::collections::BTreeSet<&str> = entries
        .iter()
        .map(|entry| entry.agent_id.as_str())
        .collect();
    assert!(
        agents.contains(ROOT_AGENT_ID),
        "the root recorded replay entries"
    );
    assert!(
        agents.contains("agent-0"),
        "the subagent recorded replay entries, got agents {agents:?}"
    );

    // One global sequence spans both agents, strictly increasing across the interleaving.
    let seqs: Vec<u64> = entries.iter().map(|entry| entry.seq).collect();
    assert!(
        seqs.windows(2).all(|w| w[0] < w[1]),
        "the global sequence is strictly increasing across agents, got {seqs:?}"
    );

    // The subagent's own model I/O was captured (its turns ran through a RecordingClient too).
    assert!(
        entries.iter().any(|entry| entry.agent_id == "agent-0"
            && matches!(entry.kind, GgSessionEntryKind::ModelIo { .. })),
        "the subagent's model I/O was recorded"
    );
}

/// The core, replayable telemetry kinds of one agent's stream, as compact `(tag, detail)` pairs —
/// the per-turn model/tool sequence a replay reconstruction must reproduce (everything else in the
/// stream, e.g. context breakdowns and skill/memory/task state, is derived telemetry the record does
/// not pin and the reconstruction does not re-emit).
fn core_turns(events: &[GgTelemetryEvent], agent: &str) -> Vec<(&'static str, String)> {
    events
        .iter()
        .filter(|e| e.agent_id.as_deref() == Some(agent))
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::TurnStarted {} => Some(("turn", String::new())),
            GgTelemetryKind::Usage { .. } => Some(("usage", String::new())),
            GgTelemetryKind::AssistantMessage { text } => Some(("assistant", text.clone())),
            GgTelemetryKind::ToolCall { name, .. } => Some(("call", name.clone())),
            GgTelemetryKind::ToolResult { name, ok, .. } => {
                Some(("result", format!("{name}:{ok}")))
            }
            _ => None,
        })
        .collect()
}

/// The end-to-end completeness proof: capture a real run, then check the written journal pins an
/// outcome for **every** tool call its recorded model responses requested, in order, and that the
/// pinned pairs are exactly the ones the run's own telemetry stream showed.
///
/// That is the guarantee replay exists for — a record that reconstructs without a gap is provably
/// complete for the run it captured — asserted directly against the journal. Driving the
/// production loop back through it (rather than checking it is complete) is
/// the capture's job, and arrives with it.
#[tokio::test]
async fn a_captured_run_journals_an_outcome_for_every_call_it_made() {
    let dir = TempDir::new().unwrap();
    seed_default_skill(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-roundtrip".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/echo"));

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);

    let lines = read_session_journal(dir.path());
    let entries = journal_entries(&lines);

    // Walk the journal exactly as a reconstruction would: each model turn opens with the calls its
    // response requested, and each recorded tool result must answer the next one, by id and name.
    let mut awaiting: std::collections::VecDeque<(String, String)> = Default::default();
    let mut model_calls = 0usize;
    let mut probes = 0usize;
    let mut tool_calls = 0usize;
    let mut journaled: Vec<(&'static str, String)> = Vec::new();
    for entry in &entries {
        match &entry.kind {
            GgSessionEntryKind::ModelIo { response, .. } => {
                assert!(
                    awaiting.is_empty(),
                    "turn at seq {} opened with {awaiting:?} still unanswered — the capture would \
                     be incomplete",
                    entry.seq
                );
                let response: crate::model::ModelResponse =
                    serde_json::from_value(response.clone()).expect("a recorded response");
                awaiting = response
                    .tool_calls
                    .iter()
                    .map(|call| (call.id.clone(), call.name.clone()))
                    .collect();
                model_calls += 1;
            }
            GgSessionEntryKind::ToolResult { call, outcome } => {
                let expected = awaiting
                    .pop_front()
                    .unwrap_or_else(|| panic!("seq {} answers a call no turn made", entry.seq));
                assert_eq!((call.id.clone(), call.name.clone()), expected);
                journaled.push(("call", call.name.clone()));
                journaled.push(("result", format!("{}:{}", call.name, outcome.ok)));
                tool_calls += 1;
            }
            // The prompt frame describes the window the turn just recorded was sent, so it lands
            // between a call and the results answering it and is no part of that pairing. Skipped
            // rather than removed from the walk: the `other` arm below is what proves the capture
            // emits nothing this reconstruction would not understand.
            GgSessionEntryKind::PromptFrame { .. } => {}
            // The turn-boundary inputs: read before the turn's model call, so they land between
            // one turn's results and the next turn's call and are likewise no part of the
            // pairing. Counted rather than merely skipped — a boundary that stopped probing
            // would be a run that could no longer be killed.
            GgSessionEntryKind::CancelProbe { canceled } => {
                assert!(!canceled, "this run was never canceled");
                probes += 1;
            }
            GgSessionEntryKind::Clock { .. } => {}
            other => panic!("unexpected entry kind {other:?}"),
        }
    }
    assert!(
        probes >= model_calls,
        "every turn probes for cancellation before it calls the model: {probes} probe(s) for \
         {model_calls} turn(s)"
    );
    assert!(
        awaiting.is_empty(),
        "the record left {awaiting:?} unanswered"
    );
    assert!(model_calls >= 2, "the run took at least two model turns");
    assert!(tool_calls >= 1, "and made at least one tool call");

    // And the pinned pairs are the ones the run streamed, in the same order.
    let streamed: Vec<(&'static str, String)> = core_turns(&sink.events(), ROOT_AGENT_ID)
        .into_iter()
        .filter(|(tag, _)| *tag == "call" || *tag == "result")
        .collect();
    assert!(!streamed.is_empty(), "the run streamed calls and results");
    assert_eq!(
        journaled, streamed,
        "the journal pins exactly the calls and results the run made"
    );
}

// ---------------------------------------------------------------------------
// Reading images: attaching them, and surviving a model that cannot see them
// ---------------------------------------------------------------------------

/// A minimal valid PNG header, so the workspace holds something `sniff_image` accepts.
const TEST_PNG: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
];

/// A client that plays a fixed script but **refuses any request carrying an image**, the
/// way OpenRouter answers a text-only model. It records every request it saw so a test
/// can prove the retry went out without the picture.
struct VisionRefusingClient {
    model_id: String,
    turn: AtomicUsize,
    /// Whether each received request carried an image, in order.
    seen: Mutex<Vec<bool>>,
}

impl VisionRefusingClient {
    fn new(model_id: &str) -> Arc<Self> {
        Arc::new(Self {
            model_id: model_id.to_string(),
            turn: AtomicUsize::new(0),
            seen: Mutex::new(Vec::new()),
        })
    }

    /// Whether each request this client received carried an image, in order.
    fn requests(&self) -> Vec<bool> {
        self.seen.lock().unwrap().clone()
    }
}

#[async_trait::async_trait]
impl ModelClient for VisionRefusingClient {
    async fn complete(
        &self,
        messages: &[Message],
        _tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        let carries_images = messages.iter().any(|m| !m.images.is_empty());
        self.seen.lock().unwrap().push(carries_images);
        if carries_images {
            return Err(ModelError::VisionUnsupported {
                model_id: self.model_id.clone(),
                message: "No endpoints found that support image input".to_string(),
            });
        }
        // Turn 1 reads the mockup; every later turn ends the session.
        let tool_calls = if self.turn.fetch_add(1, Ordering::SeqCst) == 0 {
            vec![ToolCall {
                id: "call_read".to_string(),
                name: "read_file".to_string(),
                arguments: json!({ "path": "ref.png" }),
            }]
        } else {
            vec![ToolCall {
                id: "call_finish".to_string(),
                name: "finish".to_string(),
                arguments: json!({ "summary": "done" }),
            }]
        };
        Ok(ModelResponse {
            text: Some("done".to_string()),
            finish_reason: FinishReason::ToolCalls,
            tool_calls,
            usage: TokenCounts::default(),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
        })
    }

    fn model_id(&self) -> &str {
        &self.model_id
    }
}

/// The load-bearing guarantee: a model that turns out not to accept image input does not
/// fail the run. The read succeeds, the provider refuses the follow-up turn, gg strips
/// the picture and retries, and the session completes.
#[tokio::test]
async fn a_provider_refusing_images_does_not_fail_the_run() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("ref.png"), TEST_PNG).unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-vision".to_string()), Box::new(sink.clone()));

    let client = VisionRefusingClient::new("mock/text-only");
    let produced = Arc::clone(&client);
    let factory = Arc::new(ScriptedFactory::new().slot(ROOT_PROFILE_ID, move |_| {
        Box::new(SharedClient(Arc::clone(&produced)))
    }));

    let inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/text-only"));
    assert_eq!(
        run_with_factory(&inv, &emitter, factory).await,
        SessionOutcome::Ran,
        "a refused image must not discard the run"
    );

    // Turn 1 (no image) → the read → turn 2 carrying the image, refused → the same turn
    // retried without it. The retry is the proof the recovery actually re-ran the turn.
    assert_eq!(
        client.requests(),
        vec![false, true, false],
        "the refused turn was retried with the image removed"
    );

    let events = sink.events();
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::Log { level, message }
                if level == "warn" && message.contains("does not accept image input")
        )),
        "the discovery is reported once, loudly"
    );
    assert!(
        events.iter().any(
            |e| matches!(&e.kind, GgTelemetryKind::SessionEnded { status } if status == "completed")
        ),
        "the session completed normally"
    );
}

/// **The native tool-calling path still attaches pictures, and is deliberately uncapped.**
///
/// The one-channel rule — a picture enters the window through a `view.openFile` or not at all —
/// belongs to [responses as code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) alone. On the
/// native path every `read_file` result is already an attributable, evictable message, so an image
/// rides on it exactly as it always has and no budget bounds how many. That asymmetry is the point:
/// this arm is the **control** of the A/B the code capability exists to measure, and moving it to
/// fix a defect in the treatment arm would measure something else.
///
/// Five mockups — one past the code arm's cap — read on one native turn, and the proof is the
/// *provider's* view: every one of them is in front of the model.
#[tokio::test]
async fn the_native_path_still_attaches_pictures_and_caps_none_of_them() {
    let dir = TempDir::new().unwrap();
    for name in ["a.png", "b.png", "c.png", "d.png", "e.png"] {
        std::fs::write(dir.path().join(name), TEST_PNG).unwrap();
    }
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(
        Some("run-native-images".to_string()),
        Box::new(sink.clone()),
    );

    let seen = Arc::new(Mutex::new(Vec::<usize>::new()));
    let recorded = Arc::clone(&seen);
    let factory = Arc::new(ScriptedFactory::new().slot(ROOT_PROFILE_ID, move |b| {
        Box::new(ImageReadingClient {
            model_id: b.model_id.clone(),
            turn: AtomicUsize::new(0),
            seen: Arc::clone(&recorded),
        })
    }));

    let inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/primary"));
    assert_eq!(
        run_with_factory(&inv, &emitter, factory).await,
        SessionOutcome::Ran
    );

    let carried = seen.lock().unwrap().clone();
    assert_eq!(
        carried.first().copied(),
        Some(0),
        "the opening turn has read nothing yet"
    );
    assert_eq!(
        carried.get(1).copied(),
        Some(5),
        "every picture a native read produced is in front of the model, cap or no cap: {carried:?}"
    );
}

/// A client that reads five pictures on its first turn and then finishes, recording how many
/// messages of each request it saw carried an image.
struct ImageReadingClient {
    model_id: String,
    turn: AtomicUsize,
    seen: Arc<Mutex<Vec<usize>>>,
}

#[async_trait::async_trait]
impl ModelClient for ImageReadingClient {
    async fn complete(
        &self,
        messages: &[Message],
        _tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        self.seen
            .lock()
            .unwrap()
            .push(messages.iter().filter(|m| !m.images.is_empty()).count());
        let tool_calls = if self.turn.fetch_add(1, Ordering::SeqCst) == 0 {
            ["a.png", "b.png", "c.png", "d.png", "e.png"]
                .iter()
                .enumerate()
                .map(|(index, path)| ToolCall {
                    id: format!("call_read_{index}"),
                    name: "read_file".to_string(),
                    arguments: json!({ "path": path }),
                })
                .collect()
        } else {
            vec![ToolCall {
                id: "call_finish".to_string(),
                name: "finish".to_string(),
                arguments: json!({ "summary": "done" }),
            }]
        };
        Ok(ModelResponse {
            text: Some("reading the mockups".to_string()),
            finish_reason: FinishReason::ToolCalls,
            tool_calls,
            usage: TokenCounts::default(),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
        })
    }

    fn model_id(&self) -> &str {
        &self.model_id
    }
}

/// A newtype letting several agents share one scripted client through the factory.
struct SharedClient(Arc<VisionRefusingClient>);

#[async_trait::async_trait]
impl ModelClient for SharedClient {
    async fn complete(
        &self,
        messages: &[Message],
        tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        self.0.complete(messages, tools).await
    }

    fn model_id(&self) -> &str {
        self.0.model_id()
    }
}

/// **The `View` heading is documented, and it is documented unconditionally.**
///
/// The prompt's heading vocabulary is built from [`code_heading`], but the *rows* — and their gates
/// — are hand-maintained, so a band added to the contract does not appear here on its own. This
/// pins the two facts that would otherwise go wrong silently: that the word the model is taught is
/// the word [`code_heading`] actually prefixes a text view with, and that it is taught to **every**
/// code run. The view module is bound whatever the capability set says, so a run with no tools at
/// all can still produce a `View` message — and a model that met one it had never been told about
/// would be reading an unexplained block in its own window.
///
/// The row must **not** name the call that produces the message: the description reaches every
/// rendered prompt on every arm, so the one row nothing gates would also be the one place a
/// catalogued function is guaranteed to leak
/// into a document that promises it names none. The label half is what the reader actually needs —
/// it is how a block in the window is matched to the value that produced it — and it is what
/// survives.
#[test]
fn the_view_heading_is_documented_for_every_code_run() {
    let withheld = code_heading_views(false, false, false);
    let heading = code_heading(GgContextSource::TextView).expect("a text view carries a heading");
    let row = withheld
        .iter()
        .find(|view| view.heading == heading)
        .unwrap_or_else(|| panic!("no `{heading}` row in {withheld:#?}"));
    // The heading a text view actually carries is `View: {label}`, so the description has to say
    // where the label goes or the model cannot match a block to the value it showed itself.
    assert!(row.description.contains("label"), "{row:#?}");
    // And it says it without naming the call, which the prompt's own contract forbids and which
    // `a_rendered_prompt_names_no_function_but_the_one_that_ends_the_session` holds end to end.
    assert!(
        !row.description.contains(&crate::sandbox::spell(
            crate::sandbox::language(GgProgramLanguage::TypeScript),
            crate::sandbox::VIEWS_OPEN_TEXT
        )),
        "{row:#?}"
    );

    // The `File` heading, by contrast, is gated: a run that neither reads, autoloads nor persists
    // can never show one, and naming it would describe a message kind that cannot arrive.
    let file = code_heading(GgContextSource::FileView).expect("a file view carries a heading");
    assert!(!withheld.iter().any(|view| view.heading == file));
    assert!(
        code_heading_views(false, false, true)
            .iter()
            .any(|view| view.heading == file)
    );
}

// ---------------------------------------------------------------------------
// Responses as code
// ---------------------------------------------------------------------------

/// The code-shaped execution mode, end to end through the loop and the wasmtime sandbox. It lives
/// in its own file because every one of its tests pays a component compile, and because what it
/// guards — the servicing seam between the sandbox and the loop — is a distinct concern from the
/// tool-calling turn these tests otherwise cover.
#[path = "agent.sandbox.test.rs"]
mod sandbox_tests;

/// The [execution ceilings](crate::limits) driven through the **live loop**: that a breached ceiling
/// really stops a session rather than only recording that it was breached.
///
/// Separate from `limits.test.rs` (which unit-tests the arithmetic with no loop behind it) because
/// what these guard is liveness, and separate from `agent.sandbox.test.rs` because none of them
/// needs a program: they drive the ceilings with a scripted client and no component compile at all.
#[path = "agent.limits.test.rs"]
mod limits_tests;

/// The model-call **rejection loop** through the live session: a timed-out call and a
/// length-capped reply recorded as error turns, kept out of the context and the run's metrics,
/// and retried on the same turn — plus the append-only prompt invariant, which those retries and
/// every ordinary turn must preserve.
///
/// Separate from `agent.limits.test.rs` because what these guard is the pre-turn seam — the loop
/// between the model call and the turn that never happened — rather than the ceilings' own
/// arithmetic, which those tests already hold.
#[path = "agent.rejection.test.rs"]
mod rejection_tests;

/// The loop under an **operator cancellation** — the host's kill, driven through the live loop for
/// the same reason the ceilings are: what these guard is that a killed run really stops, keeps what
/// it accumulated, and still emits the epilogue a frozen view is rebuilt from.
///
/// Separate from `cancel.test.rs` (which unit-tests the sentinel watch with no loop behind it) on
/// exactly the terms `agent.limits.test.rs` is separate from `limits.test.rs`.
#[path = "agent.cancel.test.rs"]
mod cancel_tests;

/// The **briefs gg generates for the agents it delegates to**, and the ending each one teaches.
///
/// Separate because a brief is model-facing product text rather than loop behaviour: what it has to
/// get right is that a delegated agent in code mode is told to end by calling `finish`, since every
/// consumer of a child's work gates on the `completed` only that call produces.
#[path = "agent.briefs.test.rs"]
mod brief_tests;

/// The three **in-loop** [compaction](crate::compaction) strategies driven through the live loop:
/// the agent condensing its own thread across a turn boundary, and everything else being refused
/// while it does.
///
/// Separate from `compaction.test.rs` (the trigger and the rewrite, with no loop behind them)
/// because what these guard is the boundary-spanning loop state — gg asks on one turn and the model
/// answers on the next — which only exists in [`Agent::drive`].
#[path = "agent.compaction.test.rs"]
mod compaction_tests;

/// [Agent persistence](crate::persistence) through the **live loop**: that a finishing instance's open
/// file views are recorded against its profile, and that the next instance opens its first turn on
/// them, re-read from the workspace as it stands then.
///
/// Separate from `persistence.test.rs` (the record, the key and the restore, with no loop behind them)
/// because what these guard is the two seams in [`Agent::drive`] — the seed before the first turn and
/// the record on the completion path — which only exist here.
#[path = "agent.persistence.test.rs"]
mod persistence_tests;

/// **FSM agents through the live loop**: a whole machine driven offline through the real binary —
/// the incarnation loop, the transfer between states, the refusal of an undeclared target, and the
/// telemetry a console reduces a lineage from.
///
/// Separate from `fsm.test.rs` (the table, the validation and the position, with no loop behind
/// them) because what these guard is the half that only exists in [`run_agent`]: that a transition
/// really does tear one instance down and stand another up, on the same slot, carrying exactly what
/// the edge named.
#[path = "agent.fsm.test.rs"]
mod fsm_tests;

/// **`fork` and `exec` through the live loop**: an agent replacing itself with another and an agent
/// running a copy of itself, both driven offline through the real binary.
///
/// Separate from `modules.test.rs` (the transfer primitive and the clone, with no loop behind them)
/// for the same reason `agent.fsm.test.rs` is separate from `fsm.test.rs`: what these guard is that
/// a succession really replaces the running agent on its own slot with its thread intact, and that
/// a copy really opens holding state it never wrote.
#[path = "agent.transitions.test.rs"]
mod transition_tests;

/// **Module identity through the live loop**: what each incarnation reports about the modules it
/// *holds*, and the join between a holder and the store behind it.
///
/// Separate from `modules.test.rs` (the mint, the copy semantics and the transfer report, with no
/// loop behind them) for the same reason the two files above are separate from their primitives:
/// what these guard is that a roster is really emitted, really emitted before the agent has touched
/// anything, and really reports the same id two holders of one store both report.
#[path = "agent.modules.test.rs"]
mod module_tests;

/// **What each instance is offered**, the surface half of the pair the file above covers the holding
/// half of: that every incarnation really reports its resolved toolset (and, in code mode, its bound
/// API objects), so *"never offered"* and *"offered and never called"* are distinguishable findings.
///
/// Separate from the toolset tests in this file — which prove the *gating* with no loop behind it —
/// because what these guard is that the gated result reaches the record once per instance, carrying
/// the ending calls the loop appends outside the registry.
#[path = "agent.surface.test.rs"]
mod surface_tests;

/// **gg's own faults, in the status they end an agent on**: that a broken guest artifact and a
/// broken wasm host both end the agent under `internal_error` rather than under the model's status.
///
/// Separate because what these guard is attribution rather than loop behaviour — the same rule
/// `agent.profiles.test.rs` holds for the profile family of gg defects, on the sandbox family.
#[path = "agent.faults.test.rs"]
mod fault_tests;

/// **[Discovery](crate::discovery) across a turn boundary**: that only a documentation view the
/// model could actually have read clears a call it wrote.
///
/// Separate because it is the one property of the mechanism that no unit test can hold — what
/// distinguishes a view opened on an earlier turn from one opened by the running program is *when
/// the model saw it*, which needs a real window and two real turns.
#[path = "agent.discovery.test.rs"]
mod discovery_tests;

/// **A `wait_for_issue` whose answer is never coming**: the run breaking under a suspended agent,
/// and a board that has stalled behind a failed issue.
///
/// Separate because these are the only tests in the family whose failure mode is a run that does not
/// end — every one of them is bounded by a timeout, and what they guard is that an agent gg
/// suspended is reachable at all.
#[path = "agent.waits.test.rs"]
mod wait_tests;

/// **An agent profile the run does not declare**, at each of the sites that resolve one, plus the
/// two other ways a succession's resolution can fail.
///
/// Separate because almost every test in it has to *skip the launch checks* to reach what it guards
/// — these are gg's own defects, unreachable from any configuration a launch would accept — so they
/// build the [`Orchestrator`] by hand rather than driving a session through the real entry point,
/// which is the one thing the files above all do. The exception is the failure in the family that
/// needs no defect, a provider that will not build, which is driven end to end like everything else.
#[path = "agent.profiles.test.rs"]
mod profile_tests;

/// The **handoff-compaction summarizer's** model call reaches the record.
///
/// It did not before this: gg's second model client was resolved through the same factory as the
/// agent's own and then handed straight to the loop unwrapped, so every handoff-compaction call in
/// every record captured to date is missing — and a handoff is the one event that rewrites an
/// agent's whole window, so a record missing it describes a conversation whose next turn appears
/// to come out of nowhere.
///
/// Driven through the production launch path rather than by constructing a `CompactionSetup`,
/// because the wrapping *is* the launch path: the point of the test is that the client the loop is
/// handed is the recorded one.
#[tokio::test]
async fn a_handoff_compactions_summarizer_call_reaches_the_record() {
    let dir = TempDir::new().unwrap();
    seed_default_skill(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-handoff".to_string()), Box::new(sink.clone()));

    let mut set = GgCapabilitySet::minimal("mock/echo");
    crate::tools::grant_configured(
        &mut set.agents[0],
        GgCapabilityConfig {
            implementation: Some(
                test_cabinet_core::gg::COMPACTION_STRATEGY_HANDOFF_COMPACTION.to_string(),
            ),
            ..crate::tools::configured(
                CAPABILITY_COMPACTION,
                json!({ test_cabinet_core::gg::COMPACTION_PARAM_MODEL: "mock/compactor" }),
            )
        },
    );
    // A window narrow enough that the thread crosses the trigger within a few turns, so the run
    // actually hands off rather than passing the assertion below by never compacting at all.
    let mut inv = invocation(dir.path(), set);
    inv.model_windows = BTreeMap::from([
        ("mock/echo".to_string(), 1_200),
        ("mock/compactor".to_string(), 1_200),
    ]);

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);

    let lines = read_session_journal(dir.path());
    let roles: Vec<GgClientRole> = journal_entries(&lines)
        .iter()
        .filter_map(|entry| match &entry.kind {
            GgSessionEntryKind::ModelIo { request, .. } => Some(request.role),
            _ => None,
        })
        .collect();
    // The boundary really was crossed — otherwise the assertion below would pass vacuously on a
    // run that simply never compacted.
    assert!(
        sink.events().iter().any(
            |event| matches!(&event.kind, GgTelemetryKind::Compaction { strategy, .. }
                if strategy == test_cabinet_core::gg::COMPACTION_STRATEGY_HANDOFF_COMPACTION)
        ),
        "the run crossed a handoff-compaction boundary"
    );
    assert!(
        roles.contains(&GgClientRole::Compaction),
        "the summarizer's call is in the record: {roles:?}"
    );
    assert!(
        roles.contains(&GgClientRole::Agent),
        "and the agent's own turns still are too: {roles:?}"
    );
}

/// The vision-recovery sequence, in the record: `model_error → model_io → prompt_frame`.
///
/// All three parts are load-bearing. The **error** is what the loop
/// branched on, so a reconstruction that could not see it would send the images again and diverge
/// for a reason that has nothing to do with any real change. The **call that followed** is what was
/// actually sent. And the **frame** lands after that call rather than after the refused one — which
/// is not an accident of ordering but the whole reason the frame is recorded where it is: the
/// window it describes is the stripped one.
#[tokio::test]
async fn a_vision_refusal_records_the_error_the_retry_and_the_frame_in_that_order() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("ref.png"), TEST_PNG).unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-vision".to_string()), Box::new(sink.clone()));

    let client = VisionRefusingClient::new("mock/text-only");
    let produced = Arc::clone(&client);
    let factory = Arc::new(ScriptedFactory::new().slot(ROOT_PROFILE_ID, move |_| {
        Box::new(SharedClient(Arc::clone(&produced)))
    }));
    let inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/text-only"));
    assert_eq!(
        run_with_factory(&inv, &emitter, factory).await,
        SessionOutcome::Ran
    );

    let lines = read_session_journal(dir.path());
    let entries = journal_entries(&lines);
    // The refusal, and what the record says about it: the class the loop branched on, and the
    // model that refused — not merely that something failed.
    let refusal = entries
        .iter()
        .position(|entry| match &entry.kind {
            GgSessionEntryKind::ModelError { error, .. } => {
                assert_eq!(error.kind, GgSessionModelErrorKind::VisionUnsupported);
                assert_eq!(error.model_id.as_deref(), Some("mock/text-only"));
                true
            }
            _ => false,
        })
        .expect("the refused call is in the record");

    // What follows it, in order, for the same agent.
    let after: Vec<&GgSessionEntryKind> = entries[refusal + 1..]
        .iter()
        .map(|entry| &entry.kind)
        .filter(|kind| {
            matches!(
                kind,
                GgSessionEntryKind::ModelIo { .. } | GgSessionEntryKind::PromptFrame { .. }
            )
        })
        .collect();
    assert!(
        matches!(after.first(), Some(GgSessionEntryKind::ModelIo { .. })),
        "the stripped retry follows the refusal, got {:?}",
        after.first()
    );
    let Some(GgSessionEntryKind::PromptFrame { items }) = after.get(1) else {
        panic!(
            "the frame follows the call that was sent, got {:?}",
            after.get(1)
        );
    };

    // And the frame describes the **stripped** window: the retry is what it attached to, so no
    // item in it still carries an image payload.
    let carries_image = items.iter().any(|item| {
        let body = journal_message(&lines, item.message);
        body["images"]
            .as_array()
            .is_some_and(|images| !images.is_empty())
    });
    assert!(
        !carries_image,
        "the frame attached to the call that was actually sent, which carried no images"
    );
}

// ---------------------------------------------------------------------------
// The model seam: who is asking
// ---------------------------------------------------------------------------

/// A [`ClientFactory`] that records the [identity](AgentIdentity) behind every resolution, and
/// delegates the client itself to a [`ScriptedFactory`].
///
/// The whole point of the identity seam is that gg's own resolution sites *state* whose client they
/// are asking for — so the only way to test them is a real session, driven through the real
/// dispatch paths, with a factory that watches.
struct IdentityWatchingFactory {
    inner: ScriptedFactory,
    seen: Arc<Mutex<Vec<(String, AgentIdentity)>>>,
    /// Resolutions made through the **anonymous** method, which by design is the `fork` tool's
    /// model-naming lookup and nothing else.
    anonymous: Arc<Mutex<Vec<String>>>,
}

impl IdentityWatchingFactory {
    fn new(inner: ScriptedFactory) -> Self {
        Self {
            inner,
            seen: Arc::new(Mutex::new(Vec::new())),
            anonymous: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

impl ClientFactory for IdentityWatchingFactory {
    fn client_for(&self, binding: &GgSlotBinding) -> Result<Box<dyn ModelClient>, ModelError> {
        self.anonymous
            .lock()
            .expect("anonymous lock")
            .push(binding.slot.clone());
        self.inner.client_for(binding)
    }

    fn client_for_agent(
        &self,
        binding: &GgSlotBinding,
        identity: &AgentIdentity,
    ) -> Result<Box<dyn ModelClient>, ModelError> {
        self.seen
            .lock()
            .expect("identity lock")
            .push((binding.slot.clone(), identity.clone()));
        self.inner.client_for(binding)
    }
}

/// Every agent in a real session binds its client under a **provenance**, never under its id — and
/// an agent's second client (the compaction handoff summarizer) binds under the same provenance and
/// a different role.
///
/// This is the property the whole playback binding rests on. Subagent ids come off a global counter
/// in the order agents reach their spawn, and a playback removes model latency entirely, so two
/// concurrent agents interleave differently and an id-keyed lookup would hand agent A the responses
/// recorded for agent B — silent, and catastrophic. Provenance is a function of a parent's own
/// ordered turn loop, which a reconstruction re-derives.
#[tokio::test]
async fn every_agent_binds_its_client_under_its_provenance() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-seams".to_string()), Box::new(sink.clone()));

    // A delegating root that also condenses on a **second** model, so both of one agent's client
    // resolutions happen in one session.
    let mut set = subagent_set(1, 3, &["subagent"]);
    let mut compaction =
        crate::tools::configured(CAPABILITY_COMPACTION, json!({ "model": "mock/condenser" }));
    compaction.implementation =
        Some(test_cabinet_core::gg::COMPACTION_STRATEGY_HANDOFF_SUMMARIZATION.to_string());
    crate::tools::grant_configured(&mut set.agents[0], compaction);
    let mut inv = invocation(dir.path(), set);
    inv.model_windows
        .insert("mock/condenser".to_string(), TEST_CONTEXT_WINDOW);

    let factory = Arc::new(IdentityWatchingFactory::new(
        ScriptedFactory::new()
            .slot(ROOT_PROFILE_ID, |b| {
                Box::new(MockClient::with_subagent_parent_script(&b.model_id))
            })
            .slot("subagent", |b| {
                Box::new(MockClient::with_subagent_child_script(&b.model_id))
            }),
    ));
    let seen = Arc::clone(&factory.seen);
    let anonymous = Arc::clone(&factory.anonymous);

    assert_eq!(
        run_with_factory(&inv, &emitter, factory).await,
        SessionOutcome::Ran
    );

    let seen = seen.lock().expect("identity lock").clone();

    // The root: bound trivially, on its own turn-loop client.
    assert!(
        seen.iter()
            .any(|(profile_id, identity)| profile_id == ROOT_PROFILE_ID
                && *identity == AgentIdentity::agent(GgSessionAgentOrigin::Root)),
        "the root binds as `Root`: {seen:?}"
    );
    // Its handoff summarizer: the **same** origin, under the compaction role. A second origin here
    // would send a reconstruction looking for an agent that never existed.
    assert!(
        seen.iter().any(|(slot, identity)| slot == COMPACTION_SLOT
            && *identity == AgentIdentity::compaction(GgSessionAgentOrigin::Root)),
        "the handoff summarizer binds as the root's compaction client: {seen:?}"
    );
    // The delegated child: keyed on its spawner and its position in that spawner's own strictly
    // ordered turn loop — not on `agent-0`, the id it happened to draw.
    assert!(
        seen.iter().any(|(slot, identity)| slot == "subagent"
            && *identity
                == AgentIdentity::agent(GgSessionAgentOrigin::Spawn {
                    parent: ROOT_AGENT_ID.to_string(),
                    ordinal: 0,
                })),
        "the spawned child binds on (spawner, spawn ordinal): {seen:?}"
    );

    // And nothing in this session resolved anonymously: the only site that does is the `fork`
    // tool's model-naming lookup, which this run never reaches.
    assert!(
        anonymous.lock().expect("anonymous lock").is_empty(),
        "every resolution in an ordinary session states whose it is"
    );
}

/// `session_started` announces the routing key the run minted, and the session record's journal
/// header keeps the same key beside the session id. The key is a cuid2 whatever the session id is:
/// a caller-supplied id far past OpenAI's 64-character cap on `prompt_cache_key` reaches neither.
#[tokio::test]
async fn session_started_and_the_journal_record_the_minted_routing_key() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let session_id = format!(
        "gg-{}",
        "an-over-long-caller-supplied-session-id-".repeat(4)
    );
    let emitter = Emitter::with_sink(Some(session_id.clone()), Box::new(sink.clone()));
    let mut inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/echo"));
    inv.session_id = session_id.clone();

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);

    let events = sink.events();
    let GgTelemetryKind::SessionStarted {
        routing_key: Some(announced),
        ..
    } = &events.first().expect("an event").kind
    else {
        panic!("the first event is a `session_started` naming the routing key");
    };
    assert!(cuid2::is_cuid2(announced.as_str()), "a cuid2: {announced}");
    assert_eq!(announced.len(), 24);
    assert_ne!(announced, &session_id);

    let journal = std::fs::read_to_string(dir.path().join(GG_SESSION_JOURNAL_PATH))
        .expect("the journal was written");
    let header: GgJournalLine =
        serde_json::from_str(journal.lines().next().expect("a header line"))
            .expect("the header parses");
    let GgJournalLine::Header {
        session_id: recorded_session,
        routing_key: recorded_key,
        ..
    } = header
    else {
        panic!("the first journal line is the header");
    };
    assert_eq!(recorded_session, session_id);
    assert_eq!(recorded_key.as_deref(), Some(announced.as_str()));
}

/// `session_started` records each agent profile's reasoning setting, in the resolved capability
/// set it announces — the run's record of the effort every request of that profile was held to,
/// per profile rather than as one figure for the run.
#[tokio::test]
async fn session_started_records_each_profile_s_reasoning_setting() {
    use test_cabinet_core::gg::{GgReasoning, GgReasoningEffort};
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("gg-reasoning".to_string()), Box::new(sink.clone()));
    let mut set = GgCapabilitySet::minimal("mock/echo");
    set.agents[0].reasoning = Some(GgReasoning {
        effort: Some(GgReasoningEffort::Low),
        max_tokens: None,
    });
    set.agents.push(GgAgentConfig {
        slug: "scout".to_string(),
        name: "Scout".to_string(),
        model_id: "mock/echo".to_string(),
        reasoning: Some(GgReasoning {
            effort: None,
            max_tokens: Some(512),
        }),
        ..GgAgentConfig::root()
    });
    let inv = invocation(dir.path(), set);

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);

    let events = sink.events();
    let GgTelemetryKind::SessionStarted { capability_set, .. } =
        &events.first().expect("an event").kind
    else {
        panic!("the first event is the `session_started` announcement");
    };
    assert_eq!(
        capability_set.agents[0].reasoning,
        Some(GgReasoning {
            effort: Some(GgReasoningEffort::Low),
            max_tokens: None,
        })
    );
    assert_eq!(
        capability_set.agents[1].reasoning,
        Some(GgReasoning {
            effort: None,
            max_tokens: Some(512),
        })
    );
}

/// Each launch mints its own key, so two runs are never pinned to one provider endpoint's cache
/// by accident, and the seams a run is built from carry the key they minted.
#[test]
fn every_launch_mints_its_own_routing_key() {
    let first = SessionSeams::live(
        crate::client::DEFAULT_MODEL_CALL_TIMEOUT,
        crate::client::RetryPolicy::default(),
        BTreeMap::new(),
    );
    let second = SessionSeams::substituted(first.factory.clone(), real_shell());
    assert!(cuid2::is_cuid2(first.routing_key.as_str()));
    assert!(cuid2::is_cuid2(second.routing_key.as_str()));
    assert_ne!(first.routing_key, second.routing_key);
}
