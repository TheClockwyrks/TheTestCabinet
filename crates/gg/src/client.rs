//! The gg **model clients**: the concrete providers behind the
//! [`ModelClient`] trait, plus the slot → client
//! resolution the loop uses.
//!
//! Two providers ship in Phase 0:
//!
//! - [`OpenRouterClient`] — talks to OpenRouter's OpenAI-compatible chat-completions
//!   endpoint. It reads `OPENROUTER_API_KEY` from the environment, sends the
//!   recommended identity headers, and maps the run's [`Message`]s and
//!   [`ToolDefinition`]s to the OpenAI wire shape and the response back to a
//!   [`ModelResponse`]. Request building, streamed-reply assembly, status classification,
//!   and backoff timing are factored into **pure functions** ([`build_request_body`],
//!   [`StreamAccumulator`], [`classify_status`], [`backoff_delay`]) so they are unit
//!   tested against recorded JSON with **no network**.
//! - [`MockClient`] — a scripted, offline client that replays a fixed list of
//!   [`ModelResponse`]s one per [`complete`](ModelClient::complete) call, ignoring its
//!   inputs. Its [default script](MockClient::with_default_script) writes a minimal
//!   playable `index.html` then finishes, so the whole loop + tools + telemetry runs
//!   deterministically with no key.
//!
//! # Resilience
//!
//! A known failure of an existing harness is discarding a whole run on a single
//! transient API error. [`OpenRouterClient`] guards against that with **bounded
//! exponential backoff** ([`RetryPolicy`]): it retries `429`, `5xx`, and transport
//! errors on the schedule the run's limits configure, and only then returns
//! [`ModelError::RetryExhausted`]. A `4xx`
//! (auth or otherwise) returns [`ModelError::Fatal`]
//! immediately — retrying will not help. The retry loop lives **inside the client**,
//! so a caller only ever decides "retry this whole turn later?" for a retryable
//! error versus "give up" for a fatal one.
//!
//! # Provider selection
//!
//! [`client_for_slot`] turns a [`GgSlotBinding`] into a boxed client. It selects the
//! [`MockClient`] when **either** of these holds (checked in this order):
//!
//! 1. the `TCAB_GG_FAKE_MODEL` environment variable is set to a non-empty value — a
//!    global offline override for CI and local iteration;
//! 2. the binding's `model_id` names the `mock` provider by prefix (`mock/…` or
//!    `mock:…`).
//!
//! Otherwise it builds an [`OpenRouterClient`], which requires `OPENROUTER_API_KEY`
//! and returns [`ModelError::MissingApiKey`]
//! when it is absent — a real binding with no key fails loudly rather than silently
//! falling back to the mock.
//!
//! # The mock is test infrastructure, not a launchable model
//!
//! [`MockClient`] exists so gg's own suite can drive the **real** binary offline —
//! the whole spawn → wait → return path and its issue-review variant are exercised through
//! [`mock_client_for`], not around it.
//! It is **not** a model anyone can run a real test case on: the launch path resolves
//! every bound model's [context window](test_cabinet_core::gg::GgInvocation::model_windows)
//! from the model catalog and refuses a run it cannot resolve one for, and no catalog
//! or provider lists a `mock/…` id. A mock binding therefore reaches gg only from a
//! test that constructs the invocation itself (supplying the windows a launch would
//! have), which is exactly the intended blast radius.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{Value, json};
use test_cabinet_core::gg::{
    GgLoopDetection, GgPromptCacheTtl, GgSlotBinding, GgTelemetryKind, ROOT_PROFILE_ID,
};
use test_cabinet_core::gg_session_record::{GgClientRole, GgSessionAgentOrigin};
use test_cabinet_core::metrics::{Cost, TokenCounts};

use crate::context::{BpeTokenEstimator, TokenEstimator};
use crate::loopguard::{LoopGuard, LoopGuardConfig, LoopVerdict, resolve_loop_guard};
use crate::model::{
    FinishReason, LoopAborts, Message, ModelClient, ModelError, ModelResponse, Role, ToolCall,
    ToolDefinition,
};
use crate::telemetry::Emitter;

#[cfg(doc)]
use crate::loopguard::ResolvedLoopGuard;

/// OpenRouter's OpenAI-compatible API root.
const OPENROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1";
/// The environment variable holding the OpenRouter credential.
const API_KEY_ENV: &str = "OPENROUTER_API_KEY";
/// The environment variable that forces the offline [`MockClient`] for any binding.
const FAKE_MODEL_ENV: &str = "TCAB_GG_FAKE_MODEL";
/// The provider token that selects the mock (as `provider` or a `model_id` prefix).
const MOCK_PROVIDER: &str = "mock";
/// `X-Title` sent to OpenRouter to identify the app on its dashboards.
const GG_X_TITLE: &str = "gg";
/// `HTTP-Referer` sent to OpenRouter — an app-identity hint used for its rankings,
/// not a navigational URL.
const GG_HTTP_REFERER: &str = "https://testcabinet.ai/";
/// The header form of the [routing key](RoutingKey), which OpenRouter accepts interchangeably
/// with the `session_id` body field.
const SESSION_ID_HEADER: &str = "x-session-id";
/// Maximum length of a provider error body copied into a [`ModelError`].
const ERROR_BODY_CAP: usize = 2000;

/// The **per-model-call ceiling** a run takes when its
/// [limits](test_cabinet_core::gg::GgRunLimits) write no `modelCallTimeoutSecs`: fifteen minutes.
///
/// The ceiling caps one **attempt's whole duration**, from sending the request to the last chunk
/// of its reply. The backoff between attempts sits outside it, so the run's retry schedule is
/// waited out in full whatever the ceiling.
///
/// It is the outer bound. A stream that goes without a delta from the model is cut sooner by the
/// run's [stream-idle bound](DEFAULT_MODEL_STREAM_IDLE) and retried on the client's own schedule;
/// the ceiling is what cuts a reply whose deltas keep arriving for longer than it, and every
/// attempt when an operator sets the idle bound above it (for a provider that sends nothing until
/// its reply is complete).
///
/// A call that hits the ceiling surfaces as [`ModelError::Timeout`] **immediately**, without
/// spending the client's own retry budget — each internal retry of a ceiling-long stall would
/// cost the full ceiling again — and the turn loop records it as an error turn and asks again, so
/// the bounded retry is the turn-level one the error ceilings govern. It must therefore never end
/// the session by itself.
pub const DEFAULT_MODEL_CALL_TIMEOUT: Duration = Duration::from_secs(900);

/// The **stream-idle bound** a run takes when its
/// [limits](test_cabinet_core::gg::GgRunLimits) write no `modelStreamIdleSecs`: **sixty
/// seconds**.
///
/// This is the bound that answers a provider which stops answering mid-reply. Every reply is read
/// as a [stream](OpenRouterClient), so a model's silence and its thinking are distinguishable
/// within seconds: a model that reasons at length produces reasoning deltas for the whole of that
/// time when the provider streams them, while a provider that has stopped sends nothing, or sends
/// only the keep-alive comments OpenRouter uses to hold a connection open. The bound is therefore
/// measured **since the last chunk carrying a delta** — content, reasoning or tool-call arguments —
/// or since the request was sent when none has arrived yet, and keep-alive comments and blank lines
/// leave the clock running.
///
/// A stream whose clock expires is **cancelled and retried on the client's own
/// [schedule](RetryPolicy)**, exactly as a transport error is, so a stall costs the run the idle
/// bound and one backoff wait rather than the whole
/// [call ceiling](DEFAULT_MODEL_CALL_TIMEOUT) and an error turn. Sixty seconds is comfortably
/// above the longest gap between deltas any streaming provider inserts in a healthy reply, and
/// comfortably below the fifteen-minute ceiling a silent provider would otherwise consume.
pub const DEFAULT_MODEL_STREAM_IDLE: Duration = Duration::from_secs(60);

/// The most [`cache_control` breakpoints](cache_breakpoints) one request may carry.
///
/// Anthropic — the provider that requires explicit markers — caps a request at four, and that is
/// the binding limit for every provider gg reaches through OpenRouter.
const MAX_CACHE_BREAKPOINTS: usize = 4;

/// The spacing, in messages, of the **stable grid** the rolling
/// [breakpoints](cache_breakpoints) snap to.
///
/// A breakpoint is only worth placing where it will still be a breakpoint next turn: a cache is
/// read by matching the prefix that *ends at* a marker, so a marker that lands on a different
/// message each turn describes a prefix no earlier turn ever wrote. Snapping to multiples of a
/// fixed stride fixes that — index 16 is the same prefix on every turn of an append-only window —
/// while the stride keeps the un-cached remainder small.
const CACHE_BREAKPOINT_STRIDE: usize = 8;

/// The `ttl` the [stable breakpoints](CacheTtl::Extended) ask for — Anthropic's **extended**
/// cache lifetime, in the string form `cache_control` takes.
///
/// The default lifetime of a cache entry is five minutes, and that default is what a *harness*
/// silently loses caching to: a gg turn is not a chat turn. One turn runs a build, a test suite, or
/// a Playwright pass, and every agent in the run shares one runtime thread — so the gap between an
/// agent's consecutive requests is routinely minutes, and any gap past five minutes means the next
/// turn re-sends a prefix whose entry has expired and is billed in full. An hour covers every
/// realistic gap.
const CACHE_EXTENDED_TTL: &str = "1h";

/// Test-only: what answers an [`OpenRouterClient`] in place of the network, given the request the
/// attempt would have sent — see [`OpenRouterClient::answered_by`].
#[cfg(test)]
type Gateway = std::sync::Arc<dyn Fn(&reqwest::Request) -> reqwest::Response + Send + Sync>;

/// The run's **routing key**: the one value every request of a run carries as both `session_id`
/// and `prompt_cache_key` (see [`build_request_body`]).
///
/// gg mints it once, at launch, rather than deriving it from the run's session id. The session id
/// is caller-supplied text of any length, and the two fields are capped by the providers that read
/// them — OpenRouter caps `session_id` at 256 characters and OpenAI rejects a whole request whose
/// `prompt_cache_key` passes 64. A cuid2 is 24 characters, inside both, and the only property
/// routing needs is that every request of the run carries the same value.
///
/// A distinct type rather than a `String` so that nothing but a minted key can reach the wire in
/// its place: a client is built from a `RoutingKey`, never from whatever text was to hand.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoutingKey(String);

impl RoutingKey {
    /// Mint a fresh key: a 24-character cuid2. Called once per run, at launch; every client of the
    /// run carries a clone of the one it returns.
    pub fn mint() -> Self {
        Self(cuid2::create_id())
    }

    /// The key as it goes on the wire.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for RoutingKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// The skill name the [default mock script](MockClient::with_default_script) reads, so an
/// offline run can seed `.gg/skills/<name>.md` and demonstrate the skills capability.
pub const DEFAULT_MOCK_SKILL: &str = "getting-started";

/// The memory name the [default mock script](MockClient::with_default_script) writes, so an
/// offline run demonstrates the memories capability (a curated, pinned memory + its
/// `MemoryState` telemetry).
pub const DEFAULT_MOCK_MEMORY: &str = "game-plan";

/// The memory the [linked-memory parent script](MockClient::with_memory_parent_script) writes
/// before it delegates — what a subagent that inherits its spawner's memories must be holding on
/// its very first turn.
pub const MOCK_MEMORY_PARENT: &str = "house-style";

/// The memory the [linked-memory child script](MockClient::with_memory_child_script) writes, which
/// lands in whichever store that child bound — its spawner's under an inheriting scope, and its own
/// otherwise. That difference is the whole observable of memory scoping.
pub const MOCK_MEMORY_CHILD: &str = "field-notes";

/// The title of the first task the [FSM entry script](MockClient::with_fsm_explore_script) adds,
/// so a test can assert that a transferring transition carried the list across **intact** rather
/// than merely carrying a list of the right length.
pub const MOCK_FSM_TASK_ONE: &str = "Sketch the renderer";

/// The title of the second task the [FSM entry script](MockClient::with_fsm_explore_script) adds.
pub const MOCK_FSM_TASK_TWO: &str = "Wire the input loop";

/// The note the [FSM entry script](MockClient::with_fsm_explore_script) hands its successor, so a
/// test can assert it reached the successor's window rather than being dropped at the boundary.
pub const MOCK_FSM_HANDOFF_NOTE: &str = "the renderer sketch is the risky part";

/// The state the [FSM middle script](MockClient::with_fsm_build_script) asks for and cannot have —
/// the illegal target whose refusal a test asserts on.
pub const MOCK_FSM_UNDECLARED_STATE: &str = "ship";

/// The final message the [FSM terminal script](MockClient::with_fsm_verify_script) ends with, which
/// is the whole machine's return value.
pub const MOCK_FSM_RETURN: &str = "The machine ran to its terminal state.";

/// The title of the task the [exec predecessor script](MockClient::with_exec_before_script) adds
/// before it becomes somebody else — the state a successor whose profile has no task list must be
/// visibly **without**.
pub const MOCK_EXEC_TASK: &str = "Map the failing case";

/// The opening message the [exec predecessor script](MockClient::with_exec_before_script) hands the
/// agent it becomes, so a test can assert it reached the successor's window.
pub const MOCK_EXEC_PROMPT: &str = "the failing case is in the loader, not the parser";

/// The final message the [exec successor script](MockClient::with_exec_after_script) ends with —
/// the whole session's return value, produced by an agent that did not start it.
pub const MOCK_EXEC_RETURN: &str = "The session finished as the agent it became.";

/// The summary the [compacting-handoff script](MockClient::with_compacting_exec_script) writes in
/// the same turn as its `exec` — what the successor's window is rebuilt from, and what a handoff
/// applied ahead of the compaction would silently discard.
pub const MOCK_EXEC_SUMMARY: &str = "The loader is where the failing case lives.";

/// The title of the task the [fork script](MockClient::with_fork_script) adds **before** it forks,
/// so a test can assert the copy opened holding it without ever having written it.
pub const MOCK_FORK_TASK: &str = "Reproduce the crash";

/// The instructions the [fork script](MockClient::with_fork_script) gives its copy.
pub const MOCK_FORK_PROMPT: &str = "try the other fix while I finish this one";

/// The final message the [fork script](MockClient::with_fork_script) ends with.
pub const MOCK_FORK_RETURN: &str = "Forked the alternative and carried on.";

/// The id of the first task the [default mock script](MockClient::with_default_script) adds,
/// which the second task is blocked by (and which the script later completes to unblock it).
pub const DEFAULT_MOCK_TASK_SCAFFOLD: &str = "scaffold";

/// The id of the second task the [default mock script](MockClient::with_default_script) adds,
/// blocked by [`DEFAULT_MOCK_TASK_SCAFFOLD`] — the demonstrated blocked-by edge.
pub const DEFAULT_MOCK_TASK_MOVEMENT: &str = "movement";

/// The prefix — and so the id — of the epic the [default mock script](MockClient::with_default_script)
/// creates, so an offline run with the project-management capability demonstrates the board.
pub const DEFAULT_MOCK_EPIC: &str = "CORE";

/// The id of the first issue the [default mock script](MockClient::with_default_script) creates
/// (grouped under [`DEFAULT_MOCK_EPIC`]), which the second issue is blocked by (and which a
/// later attempt tries to cyclically block on the second). Numbered by the board, not chosen by the
/// script.
pub const DEFAULT_MOCK_ISSUE_RENDER: &str = "CORE-1";

/// The id of the second issue the [default mock script](MockClient::with_default_script) creates,
/// blocked by [`DEFAULT_MOCK_ISSUE_RENDER`] — the demonstrated board blocked-by edge.
pub const DEFAULT_MOCK_ISSUE_INPUT: &str = "CORE-2";

/// The deterministic summary the [`MockClient`] returns for a
/// [compaction](crate::compaction) summary request, so an offline run crosses a real
/// compaction boundary without network. Recognizable in tests as proof the summarizer's
/// model call was answered by the mock's marker path.
pub const MOCK_COMPACTION_SUMMARY: &str = "Building a minimal HTML5 canvas game in index.html; scaffolding and player movement \
     were the plan. Continue implementing and refining the game.";

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

/// The retries after the first attempt a run takes when its
/// [limits](test_cabinet_core::gg::GgRunLimits) write no `maxModelRetries`: **ten**.
///
/// Against the default [delay ceiling](DEFAULT_MODEL_RETRY_MAX_DELAY) the [schedule](backoff_delay)
/// waits about five minutes across the ten, long enough to outlast a pinned provider's brief
/// outage rather than give up inside it.
pub const DEFAULT_MAX_MODEL_RETRIES: u32 = 10;

/// The ceiling on one retry's backoff delay a run takes when its
/// [limits](test_cabinet_core::gg::GgRunLimits) write no `modelRetryMaxDelaySecs`: sixty seconds.
/// Against it the default ten retries wait about five minutes in all, and thirty retries at the
/// same ceiling wait about half an hour.
pub const DEFAULT_MODEL_RETRY_MAX_DELAY: Duration = Duration::from_secs(60);

/// Bounded exponential-backoff policy for [`OpenRouterClient`].
///
/// The schedule the run configures through its
/// [limits](test_cabinet_core::gg::GgRunLimits): `maxModelRetries` retries after the first
/// attempt ([`max_attempts`](Self::max_attempts) is that count plus one), the first retry
/// waiting one second and each next twice the last, capped at the `modelRetryMaxDelaySecs`
/// ceiling. The [defaults](Self::default) are the absent-key figures, so a client built without
/// the run's limits retries on the same schedule as one whose configuration wrote none.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetryPolicy {
    /// Total attempts (the first try plus retries) before giving up.
    pub max_attempts: u32,
    /// Delay before the first retry; doubled each subsequent retry.
    pub base_delay: Duration,
    /// Ceiling on any single backoff delay.
    pub max_delay: Duration,
}

impl RetryPolicy {
    /// This policy with its delay ceiling set — the `modelRetryMaxDelaySecs` the run configured.
    pub fn with_max_delay(mut self, max_delay: Duration) -> Self {
        self.max_delay = max_delay;
        self
    }
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            // The first attempt plus the default retries after it.
            max_attempts: DEFAULT_MAX_MODEL_RETRIES + 1,
            base_delay: Duration::from_secs(1),
            max_delay: DEFAULT_MODEL_RETRY_MAX_DELAY,
        }
    }
}

/// The backoff delay before the retry that follows attempt `attempt` (1-based):
/// `base_delay * 2^(attempt-1)`, capped at `max_delay`. Pure, so the schedule is unit
/// tested without waiting.
pub fn backoff_delay(attempt: u32, policy: &RetryPolicy) -> Duration {
    // Cap the shift so the doubling can never overflow; `saturating_mul` and `min`
    // keep the result within `max_delay` regardless.
    let shift = attempt.saturating_sub(1).min(16);
    policy
        .base_delay
        .saturating_mul(1u32 << shift)
        .min(policy.max_delay)
}

/// How an HTTP status should be treated by the retry loop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatusClass {
    /// A `2xx`: parse the body as a completion.
    Success,
    /// A `429` or `5xx`: transient, worth retrying. A `429` or `503` carrying a `Retry-After`
    /// header waits that long instead of the schedule's delay when it is the longer one (see
    /// [`retry_after_delay`]).
    Retryable,
    /// Any other status (notably `4xx` auth/validation): fatal, do not retry.
    Fatal,
}

/// Classify an HTTP status for the retry loop: `2xx` success, `429`/`5xx` retryable,
/// everything else fatal. Pure, so the classification is unit tested directly.
pub fn classify_status(status: u16) -> StatusClass {
    match status {
        200..=299 => StatusClass::Success,
        429 => StatusClass::Retryable,
        500..=599 => StatusClass::Retryable,
        _ => StatusClass::Fatal,
    }
}

/// The wait a response's `Retry-After` header asks for, when it asks for one.
///
/// Read as the **seconds** form only. The header's other spelling is an HTTP date, which would
/// take the local clock to turn into a wait; a date, like a malformed value, is read as no answer,
/// and the schedule's own delay stands exactly as an absent header leaves it.
pub fn retry_after_delay(response: &reqwest::Response) -> Option<Duration> {
    response
        .headers()
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim()
        .parse::<u64>()
        .ok()
        .map(Duration::from_secs)
}

/// The delay the retry that follows attempt `attempt` (1-based) waits: the
/// [schedule's](backoff_delay), or the `Retry-After` a `429` or `503` carried when it is the
/// longer one.
pub fn retry_wait(attempt: u32, policy: &RetryPolicy, retry_after: Option<Duration>) -> Duration {
    match retry_after {
        Some(asked) => backoff_delay(attempt, policy).max(asked),
        None => backoff_delay(attempt, policy),
    }
}

// ---------------------------------------------------------------------------
// OpenRouter client
// ---------------------------------------------------------------------------

/// A [`ModelClient`] over OpenRouter's OpenAI-compatible chat-completions endpoint.
///
/// The [`reqwest::Client`] and `base_url` are injected via [`new`](Self::new) so tests
/// can construct one without touching the network; the request building and the streamed-reply
/// assembly are in the pure [`build_request_body`]/[`StreamAccumulator`] functions.
///
/// # One transport, and it streams
///
/// Every reply this client reads is a [server-sent event](StreamAccumulator) stream. That is not a
/// preference for one wire shape over another; it is what makes two bounds possible that a
/// buffering read cannot express:
///
/// - the run's [stream-idle bound](DEFAULT_MODEL_STREAM_IDLE) — how long the stream may go without
///   a **delta from the model**. A buffering read has no notion of "the model is still thinking",
///   so a provider that stops answering is indistinguishable from one that is generating a long
///   reply, and the only bound available is the whole-call ceiling. On a stream the two are
///   separable within seconds: a model that reasons at length emits reasoning deltas for the whole
///   of that time, while a provider that has stopped emits nothing — or only the keep-alive
///   comments OpenRouter sends, which carry no delta and leave the clock running. A stream whose
///   clock expires is cancelled and retried on the client's own [schedule](RetryPolicy) exactly as
///   a transport error is, so a provider that stops answering costs the run the idle bound and one
///   backoff rather than the whole ceiling and an error turn.
/// - [loop detection](crate::loopguard), which can only abandon a reply it is shown *while it is
///   arriving*. A detector handed a completed reply has nothing left to save: the money, the wall
///   clock and the turn are spent by then.
///
/// Whether the detector runs over the stream is the agent's
/// [configured choice](crate::loopguard), and it changes nothing else: an agent with the detector
/// disarmed gets the same request bytes and the same assembly, watched by no one.
pub struct OpenRouterClient {
    http: reqwest::Client,
    base_url: String,
    model_id: String,
    api_key: String,
    retry: RetryPolicy,
    /// The run's record of which models' providers refused a pinned `tool_choice`, read by every
    /// [required-tool request](ModelClient::complete_requiring) this client sends. Shared with
    /// every other client the run's [factory](DefaultClientFactory) builds, so the pin is tried
    /// once per model per run: an agent's successor, its subagents and its handoff compaction all
    /// ask on `auto` once any of them has been refused. See [`ToolChoiceMemory`].
    tool_choice: ToolChoiceMemory,
    /// The run's [routing key](RoutingKey), the same value on every agent's client. It pins the
    /// whole run's requests to one provider endpoint, so an agent's successive turns reuse the
    /// prefix the last turn cached and sibling agents that open on the same prefix reuse each
    /// other's. Sent as the `session_id` and `prompt_cache_key` body fields and as the
    /// `x-session-id` header (OpenRouter accepts the header and `session_id` interchangeably;
    /// sending both means no intermediary that filters one of them can quietly cost the run its
    /// cache). `None` leaves the key off the wire entirely.
    routing_key: Option<RoutingKey>,
    /// The OpenRouter provider this client's requests are pinned to — the model's own
    /// developer, resolved at enqueue and pushed in as
    /// [`GgInvocation::model_providers`](test_cabinet_core::gg::GgInvocation::model_providers).
    /// Sent as `provider.only` with fallbacks refused, so a run cannot be moved onto another
    /// provider's price basis. `None` sends no pin, which a launched run never does: the launch
    /// refuses a bound model with none.
    provider: Option<String>,
    /// The [lifetime](CacheTtl) this client's requests ask for on their **stable** cache markers —
    /// the [choice](GgPromptCacheTtl) the agent profile this client was resolved for made. Per
    /// client rather than per run: a client serves one agent, and that is the granularity at which
    /// the extended lifetime is worth its premium.
    stable_ttl: CacheTtl,
    /// The [detector](LoopGuardConfig) each of this client's replies is watched with, or `None`
    /// when the agent this client serves left [loop detection](GgLoopDetection) off.
    ///
    /// It decides only **whether the detector runs** — every reply is a
    /// [stream](Self) whatever the declaration says, so arming the detector changes nothing about
    /// the transport and unarmed changes nothing about the stream. Carried as the
    /// already-[resolved](resolve_loop_guard) configuration rather than as the declaration, so the
    /// per-attempt path constructs a [`LoopGuard`] and does no interpretation at all.
    loop_guard: Option<LoopGuardConfig>,
    /// The ceiling each of this client's calls runs under, resolved from the run's
    /// [limits](crate::limits::RunLimits::model_call_timeout) and applied over one attempt's whole
    /// duration. [`DEFAULT_MODEL_CALL_TIMEOUT`] states what absence resolves to.
    model_call_timeout: Duration,
    /// How long this client waits, between chunks carrying a [delta](WireDelta) from the model,
    /// before cancelling the attempt — resolved from the run's
    /// [limits](crate::limits::RunLimits::model_stream_idle), and always in force.
    /// [`DEFAULT_MODEL_STREAM_IDLE`] states what absence resolves to.
    model_stream_idle: Duration,
    /// The stream each retry is announced on, as a `warn` naming the attempt, the status or
    /// transport error that provoked it, and the delay before the next attempt. Set by
    /// [`announce_retries_on`](ModelClient::announce_retries_on) when the agent that will call
    /// this client takes it up, because only the agent knows the id its stream is scoped to.
    /// `None` announces nothing, which is a client no agent has taken up.
    retry_stream: Mutex<Option<Emitter>>,
    /// Test-only: where each attempt's response comes from instead of the network, so a test can
    /// hand the client a reply whose body is exactly the chunks it chooses, ready or pending, and
    /// drive the whole call on a paused clock with no socket whose readiness could race it.
    #[cfg(test)]
    gateway: Option<Gateway>,
}

impl OpenRouterClient {
    /// Construct a client from its parts. `base_url` is the API root (no trailing
    /// `/chat/completions`); pass an injected `http` and a test `base_url` to exercise
    /// it offline. `routing_key` is the run's [routing key](RoutingKey) this client stamps on every
    /// request; `None` sends none.
    ///
    /// The prompt cache takes the [standard lifetime](CacheTtl::Standard); a client for an agent
    /// configured for the extended one is built through
    /// [`with_prompt_cache_ttl`](Self::with_prompt_cache_ttl). [Loop detection](crate::loopguard)
    /// is **off** — the detector is the only thing the switch changes, since every reply is read
    /// as a [stream](Self) whatever it says; a client for an agent that armed it is built through
    /// [`with_loop_detection`](Self::with_loop_detection).
    pub fn new(
        base_url: impl Into<String>,
        http: reqwest::Client,
        model_id: impl Into<String>,
        api_key: impl Into<String>,
        retry: RetryPolicy,
        routing_key: Option<RoutingKey>,
    ) -> Self {
        Self {
            http,
            base_url: base_url.into(),
            model_id: model_id.into(),
            api_key: api_key.into(),
            retry,
            tool_choice: ToolChoiceMemory::default(),
            routing_key,
            provider: None,
            stable_ttl: CacheTtl::Standard,
            loop_guard: None,
            model_call_timeout: DEFAULT_MODEL_CALL_TIMEOUT,
            model_stream_idle: DEFAULT_MODEL_STREAM_IDLE,
            retry_stream: Mutex::new(None),
            #[cfg(test)]
            gateway: None,
        }
    }

    /// This client answered by `gateway` rather than by the network: every attempt's response is
    /// what it returns, given the request the attempt would have sent, headers and body alike.
    /// Test-only — see [`gateway`](Self::gateway).
    #[cfg(test)]
    pub(crate) fn answered_by(
        mut self,
        gateway: impl Fn(&reqwest::Request) -> reqwest::Response + Send + Sync + 'static,
    ) -> Self {
        self.gateway = Some(std::sync::Arc::new(gateway));
        self
    }

    /// This client reading and recording [tool-choice refusals](ToolChoiceMemory) in `memory`,
    /// the run-wide record its [factory](DefaultClientFactory) shares between every client it
    /// builds. A client built without it keeps a record of its own.
    pub fn with_tool_choice_memory(mut self, memory: ToolChoiceMemory) -> Self {
        self.tool_choice = memory;
        self
    }

    /// Post `body` to `url` — one attempt's request, on whichever transport the caller is.
    async fn post(&self, url: &str, body: &Value) -> reqwest::Result<reqwest::Response> {
        #[cfg(test)]
        if let Some(gateway) = &self.gateway {
            return Ok(gateway(&self.attempt(url).json(body).build()?));
        }
        self.attempt(url).json(body).send().await
    }

    /// This client bounding each of its calls by `timeout` — the run's resolved
    /// [`modelCallTimeoutSecs`](crate::limits::RunLimits::model_call_timeout), which
    /// [`client_for_slot`] carries in from the launch, exactly as it carries the
    /// [prompt-cache lifetime](Self::with_prompt_cache_ttl).
    ///
    /// A client built without it takes [`DEFAULT_MODEL_CALL_TIMEOUT`].
    pub fn with_model_call_timeout(mut self, timeout: Duration) -> Self {
        self.model_call_timeout = timeout;
        self
    }

    /// This client cancelling a stream that goes `idle` without a delta from the model — the
    /// run's resolved [`modelStreamIdleSecs`](crate::limits::RunLimits::model_stream_idle),
    /// carried in beside the [call ceiling](Self::with_model_call_timeout) for the same reason:
    /// the factory builds the clients before an agent exists to resolve limits for.
    ///
    /// A client built without it takes [`DEFAULT_MODEL_STREAM_IDLE`]. There is no armed reading
    /// of the bound to be missing: a stream with no idle bound is one a silent provider holds for
    /// the whole call ceiling, so it is always in force.
    pub fn with_stream_idle(mut self, idle: Duration) -> Self {
        self.model_stream_idle = idle;
        self
    }

    /// One retry announced on the [stream](Self::retry_stream) the calling agent handed over:
    /// the attempt that just failed (`attempt`, 1-based), the status or transport error that
    /// failed it, and the delay before the next attempt.
    fn announce_retry(&self, attempt: u32, cause: &str, delay: Duration) {
        let stream = self
            .retry_stream
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(emitter) = stream.as_ref() {
            emitter.emit(GgTelemetryKind::Log {
                level: "warn".to_string(),
                message: retry_message(attempt, self.retry.max_attempts, cause, delay),
            });
        }
    }

    /// This client with `ttl` as the [lifetime](CacheTtl) its stable cache markers ask for — the
    /// agent profile's [configured choice](GgPromptCacheTtl), which
    /// [`client_for_slot`] carries in on the binding.
    pub fn with_prompt_cache_ttl(mut self, ttl: GgPromptCacheTtl) -> Self {
        self.stable_ttl = ttl.into();
        self
    }

    /// This client pinning every request to `provider` — the OpenRouter slug the launch resolved
    /// for its model, sent as `provider.only` with fallbacks refused. A blank slug is no pin.
    pub fn with_provider(mut self, provider: impl Into<String>) -> Self {
        let provider = provider.into();
        self.provider = (!provider.trim().is_empty()).then_some(provider);
        self
    }

    /// This client retrying on `policy` — the run's resolved
    /// [retry schedule](crate::limits::RunLimits::retry_policy), which [`client_for_slot`]
    /// carries in from the launch beside the [per-call ceiling](Self::with_model_call_timeout).
    ///
    /// A client built without it takes the [defaults](RetryPolicy::default) — the absent-key
    /// figures, so the two readings cannot disagree.
    pub fn with_retry_policy(mut self, policy: RetryPolicy) -> Self {
        self.retry = policy;
        self
    }

    /// This client watching its replies for a [generation loop](crate::loopguard) as `declared` —
    /// the agent profile's [configured choice](GgLoopDetection), which
    /// [`client_for_slot`] carries in on the binding, exactly as it carries the
    /// [prompt-cache lifetime](Self::with_prompt_cache_ttl).
    ///
    /// A declaration that is off (the default) is a no-op, and an unarmed declaration is one too:
    /// every reply is read as a [stream](Self) whatever the detector says, so the switch decides
    /// only whether anything watches that stream.
    ///
    /// The [warnings](ResolvedLoopGuard::warnings) resolution produces are deliberately dropped
    /// here. They are one-per-run operator advice about a detector armed exactly as declared and
    /// provably inert, not one-per-agent-client advice, and a client has no stream to emit them on;
    /// the launch path resolves the same declaration itself and logs them once, in the register of
    /// the [run limits](crate::limits::resolve_run_limits)' warnings. Resolution is pure, so
    /// resolving twice cannot disagree.
    ///
    /// The sink is [discarding](crate::validate::LaunchReport::Discarding) for the same reason: a
    /// knob gg cannot arm refused this run at launch, before any client existed to be built.
    pub fn with_loop_detection(mut self, declared: GgLoopDetection) -> Self {
        self.loop_guard =
            resolve_loop_guard(&declared, &mut crate::validate::LaunchReport::Discarding).config;
        self
    }

    /// Build a live client for `binding`, reading `OPENROUTER_API_KEY` from the
    /// environment. Returns [`ModelError::MissingApiKey`] when the credential is
    /// absent or empty.
    ///
    /// `routing_key` is the run's [routing key](RoutingKey), stamped on every request and shared by
    /// the root and every subagent. Sharing it is deliberate: agents that open on the same prefix
    /// (same calling convention, the same autoloaded specs) then route to the same provider
    /// endpoint and reuse one another's cached prefix, and an agent's own successive turns stay on
    /// that endpoint so each turn reads the prefix the last one cached.
    pub fn from_binding(
        binding: &GgSlotBinding,
        routing_key: &RoutingKey,
    ) -> Result<Self, ModelError> {
        let api_key = std::env::var(API_KEY_ENV)
            .ok()
            .filter(|k| !k.trim().is_empty())
            .ok_or(ModelError::MissingApiKey)?;
        Ok(Self::new(
            OPENROUTER_BASE_URL,
            reqwest::Client::new(),
            binding.model_id.clone(),
            api_key,
            RetryPolicy::default(),
            Some(routing_key.clone()),
        )
        .with_prompt_cache_ttl(binding.prompt_cache_ttl)
        .with_loop_detection(binding.loop_detection))
    }

    /// The chat-completions URL for this client's base.
    fn endpoint(&self) -> String {
        format!("{}/chat/completions", self.base_url.trim_end_matches('/'))
    }

    /// Reject a reply the pinned provider did not serve.
    ///
    /// OpenRouter names the serving provider on every response, and [`usage`](crate::model)
    /// records it. A response from any other provider ends the call as
    /// [`ProviderMismatch`](ModelError::ProviderMismatch): the cost recorded from that point
    /// would be on a different price basis than the pin. The two are compared as
    /// [the same provider](test_cabinet_core::pricing::same_provider), since a response spells
    /// the provider as the endpoints listing does and a hand-set pin may use the tag's spelling.
    /// A reply that names no provider has nothing to disagree with and passes.
    fn pinned(
        &self,
        parsed: Result<ModelResponse, ModelError>,
    ) -> Result<ModelResponse, ModelError> {
        let (Some(pinned), Ok(response)) = (self.provider.as_deref(), &parsed) else {
            return parsed;
        };
        match response.provider.as_deref() {
            Some(served) if !test_cabinet_core::pricing::same_provider(served, pinned) => {
                Err(ModelError::ProviderMismatch {
                    pinned: pinned.to_string(),
                    served: served.to_string(),
                })
            }
            _ => parsed,
        }
    }

    /// The one `warn` a [tool-choice downgrade](ToolChoiceMemory) is logged with, on the stream
    /// [retries](Self::announce_retry) are announced on: the model and the provider's message.
    fn announce_tool_choice_downgrade(&self, message: &str) {
        let stream = self
            .retry_stream
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(emitter) = stream.as_ref() {
            emitter.emit(GgTelemetryKind::Log {
                level: "warn".to_string(),
                message: tool_choice_downgrade_message(&self.model_id, message),
            });
        }
    }

    /// One attempt's request, headers and all, before its body is attached.
    ///
    /// The headers are the run's identity and its [routing key](RoutingKey); a request that
    /// quietly stopped sending the key would cost the agent its prompt cache.
    fn attempt(&self, url: &str) -> reqwest::RequestBuilder {
        let mut request = self
            .http
            .post(url)
            .header(
                reqwest::header::AUTHORIZATION,
                format!("Bearer {}", self.api_key),
            )
            .header("HTTP-Referer", GG_HTTP_REFERER)
            .header("X-Title", GG_X_TITLE);
        // The header form of the `session_id` the body already carries — see `routing_key`.
        if let Some(key) = &self.routing_key {
            request = request.header(SESSION_ID_HEADER, key.as_str());
        }
        request
    }
}

#[async_trait::async_trait]
impl ModelClient for OpenRouterClient {
    async fn complete(
        &self,
        messages: &[Message],
        tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        let body = build_request_body(
            &self.model_id,
            messages,
            tools,
            self.routing_key.as_ref(),
            self.provider.as_deref(),
            self.stable_ttl,
        );
        self.send(body, messages).await
    }

    /// Offer `tool` and pin `tool_choice` to it, so the reply is the call rather than the model's
    /// judgement about whether to make one — the wire form of the default's intent, which cannot
    /// express the requirement.
    ///
    /// The pin is sent where the provider takes it. A [`400` naming
    /// `tool_choice`](is_tool_choice_refusal) is answered by re-sending the same request with
    /// `tool_choice` set to `auto`, at once and outside the retry schedule, and the refusal is
    /// recorded in the run's [`ToolChoiceMemory`] so every later required-tool request for this
    /// model, a turn's and a handoff compaction's alike, is sent on `auto` from the start. The
    /// run that recorded it logs it once.
    async fn complete_requiring(
        &self,
        messages: &[Message],
        tool: &ToolDefinition,
    ) -> Result<ModelResponse, ModelError> {
        let mut body = build_required_tool_request_body(
            &self.model_id,
            messages,
            tool,
            self.routing_key.as_ref(),
            self.provider.as_deref(),
            self.stable_ttl,
        );
        if self.tool_choice.refused(&self.model_id) {
            body["tool_choice"] = json!("auto");
            return self.send(body, messages).await;
        }
        match self.send(body.clone(), messages).await {
            Err(ModelError::Fatal { status, message })
                if is_tool_choice_refusal(status, &message) =>
            {
                if self.tool_choice.record_refusal(&self.model_id) {
                    self.announce_tool_choice_downgrade(&message);
                }
                body["tool_choice"] = json!("auto");
                self.send(body, messages).await
            }
            outcome => outcome,
        }
    }

    fn model_id(&self) -> &str {
        &self.model_id
    }

    fn announce_retries_on(&self, emitter: &Emitter) {
        *self
            .retry_stream
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(emitter.clone());
    }
}

impl OpenRouterClient {
    /// POST one already-built request body, with this client's retry/backoff policy and its
    /// classification of what came back — the shared transport behind both
    /// [`complete`](ModelClient::complete) and
    /// [`complete_requiring`](ModelClient::complete_requiring), which differ only in the body they
    /// build. `messages` is passed for the one thing the transport reads off it: whether the
    /// request carried pictures, which decides whether a fatal refusal is the recoverable
    /// [vision](ModelError::VisionUnsupported) one.
    ///
    /// There is one transport, and it [streams](Self): the reply is read as server-sent events
    /// whether or not the agent armed [loop detection](crate::loopguard), which decides only
    /// whether a [`LoopGuard`] watches those events.
    async fn send(&self, body: Value, messages: &[Message]) -> Result<ModelResponse, ModelError> {
        let url = self.endpoint();
        let mut last_err = String::new();
        // The trip of the most recent abandoned attempt, and what every abandoned attempt so far
        // amounted to. Both survive across attempts because both are reported at the end: the
        // tally on the response that finally works, the trip on the error if none ever does.
        let mut last_trip: Option<String> = None;
        let mut loop_aborts = LoopAborts::none();
        // Whether this request carries a picture at all. A provider's "no image route"
        // refusal is only recoverable-by-dropping-images if there were images to drop;
        // without that check a coincidentally-similar error body would be misread as one.
        let carries_images = messages.iter().any(|message| !message.images.is_empty());

        for attempt in 1..=self.retry.max_attempts {
            // Two clocks start with the attempt. The run's [per-call
            // ceiling](DEFAULT_MODEL_CALL_TIMEOUT) caps the attempt's whole duration, from the
            // request to the last chunk; the backoff between attempts sits outside it. An attempt
            // that runs past it surfaces immediately rather than spending the retry budget, since
            // each internal retry would cost the full ceiling again and the turn-level retry is
            // the bounded one. The [stream-idle bound](DEFAULT_MODEL_STREAM_IDLE) runs from the
            // request too, so a provider that never sends a response head is a stall like one
            // that stops sending deltas.
            let started = tokio::time::Instant::now();
            let deadline = started + self.model_call_timeout;
            let idle_deadline = started + self.model_stream_idle;
            let sent =
                match tokio::time::timeout_at(deadline.min(idle_deadline), self.post(&url, &body))
                    .await
                {
                    Ok(sent) => Some(sent),
                    Err(_) if deadline <= idle_deadline => {
                        return Err(ModelError::Timeout {
                            after: self.model_call_timeout,
                            provider: None,
                        });
                    }
                    Err(_) => {
                        last_err = stall_cause(self.model_stream_idle, None);
                        None
                    }
                };

            // The `Retry-After` a retryable status carries asks for a wait of its own, honoured
            // when it is longer than the schedule's delay.
            let mut retry_after = None;

            match sent {
                // The head never arrived within the idle bound: the stall is already recorded.
                None => {}
                // Transport-level failure (connect/reset/etc.): always retryable.
                Some(Err(err)) => last_err = format!("transport error: {err}"),
                Some(Ok(resp)) => {
                    let status = resp.status().as_u16();
                    match classify_status(status) {
                        StatusClass::Success => {
                            match read_stream(
                                resp.bytes_stream(),
                                self.loop_guard,
                                deadline,
                                started,
                                self.model_stream_idle,
                            )
                            .await
                            {
                                StreamOutcome::Reply(response) => {
                                    // The tally of thrown-away attempts rides out on the reply that
                                    // worked; nothing else the turn loop is handed could carry it.
                                    let response = ModelResponse {
                                        loop_aborts,
                                        ..response
                                    };
                                    // A reply from a provider other than the pin is not a reply this
                                    // run can use: its cost would be on a different basis.
                                    return self.pinned(Ok(response));
                                }
                                StreamOutcome::Looping { detail, generated } => {
                                    // The size is recorded here rather than only rendered into the
                                    // message, because it is the one measure of an abandoned attempt
                                    // gg can vouch for: the provider's usage payload arrives at the
                                    // end of a stream that was never read to its end.
                                    loop_aborts.record(generated.words, generated.chars);
                                    last_err = format!("abandoned a looping reply: {detail}");
                                    last_trip = Some(detail);
                                }
                                StreamOutcome::Interrupted(detail) => last_err = detail,
                                // A stall is a transport failure like any other: the attempt is
                                // cancelled, the cause names the idle bound that expired, and the
                                // loop below backs off and asks again exactly as it does for a
                                // reset connection. That is the whole point of bounding a stall by
                                // the seconds it actually costs rather than by the call ceiling —
                                // a provider that stops answering costs the run the idle bound per
                                // attempt, not the ceiling per turn.
                                StreamOutcome::Stalled { idle, provider } => {
                                    last_err = stall_cause(idle, provider.as_deref());
                                }
                                StreamOutcome::Ceiling { provider } => {
                                    return Err(ModelError::Timeout {
                                        after: self.model_call_timeout,
                                        provider,
                                    });
                                }
                                StreamOutcome::Malformed(err) => return Err(err),
                            }
                        }
                        StatusClass::Fatal => {
                            let body = resp.text().await.unwrap_or_default();
                            return Err(self.refusal(status, &body, carries_images));
                        }
                        StatusClass::Retryable => {
                            if status == 429 || status == 503 {
                                retry_after = retry_after_delay(&resp);
                            }
                            let body = resp.text().await.unwrap_or_default();
                            last_err = format!("HTTP {status}: {}", truncate(&body));
                        }
                    }
                }
            }

            if attempt < self.retry.max_attempts {
                let delay = retry_wait(attempt, &self.retry, retry_after);
                self.announce_retry(attempt, &last_err, delay);
                tokio::time::sleep(delay).await;
            }
        }

        match last_trip {
            Some(detail) => Err(ModelError::ResponseLoop {
                // What was read and thrown away — which is what the message says, and whose
                // attempt count is not the same as this loop's when some attempts failed at the
                // HTTP level and never produced a reply to judge.
                discarded: loop_aborts,
                detail,
            }),
            None => Err(ModelError::RetryExhausted {
                attempts: self.retry.max_attempts,
                last: last_err,
            }),
        }
    }

    /// The [`ModelError`] a non-retryable status is: an image refusal when the request carried
    /// pictures and the body says so, and an ordinary [`Fatal`](ModelError::Fatal) otherwise.
    ///
    /// The distinction is load-bearing: a vision refusal is the one fatal status the turn loop
    /// *recovers* from, by [stripping](Message::strip_images) the pictures and re-running the turn.
    fn refusal(&self, status: u16, body: &str, carries_images: bool) -> ModelError {
        if carries_images && is_image_unsupported(status, body) {
            return ModelError::VisionUnsupported {
                model_id: self.model_id.clone(),
                message: truncate(body),
            };
        }
        ModelError::Fatal {
            status,
            message: truncate(body),
        }
    }
}

/// The `cause` a stalled stream is retried under: the [idle bound](DEFAULT_MODEL_STREAM_IDLE) that
/// expired and the provider the chunks that did arrive named, when any did.
///
/// This is the sentence the retry's `warn` line carries, so a stall and an outage reach the
/// operator through the same channel — one says `transport error`, the other says the stream
/// stalled — and a stalled provider is blacklistable by name exactly as a failing one is.
fn stall_cause(idle: Duration, provider: Option<&str>) -> String {
    match provider {
        Some(provider) => format!(
            "the stream stalled: no delta from the model for {}s (provider: {provider})",
            idle.as_secs()
        ),
        None => format!(
            "the stream stalled: no delta from the model for {}s",
            idle.as_secs()
        ),
    }
}

/// The `warn` line a retry is announced with: the attempt that failed (1-based) out of
/// `max_attempts`, the status or transport error that failed it, and the wait before the next.
pub fn retry_message(attempt: u32, max_attempts: u32, cause: &str, delay: Duration) -> String {
    format!(
        "model request attempt {attempt} of {max_attempts} failed ({cause}); retrying in {:.1}s",
        delay.as_secs_f64(),
    )
}

/// How one streamed attempt ended.
///
/// Five outcomes rather than a `Result`, because the caller's three-way decision — return, retry,
/// give up — is not the two-way one a `Result` expresses. In particular a reply the detector
/// abandoned and a stream that went idle are neither a success nor a fatal failure of the
/// *request*: both are retryable failures of the answer, and collapsing either into an error would
/// put the retry decision in the wrong place.
#[derive(Debug)]
enum StreamOutcome {
    /// The stream completed and assembled into a reply.
    Reply(ModelResponse),
    /// [Loop detection](crate::loopguard) abandoned the reply mid-stream. Carries the
    /// [trip](crate::loopguard::LoopTrip)'s rendered sentence for the log and, if no attempt ever
    /// succeeds, for the [error](ModelError::ResponseLoop), and beside it the size of what was
    /// generated and thrown away. **Retryable.**
    Looping {
        /// The operator-facing sentence: which rule fired, in that rule's own units, and how much
        /// of the reply had arrived.
        detail: String,
        /// What the abandoned attempt had generated by the moment the stream was dropped, as its
        /// own figures so the caller can sum them across attempts rather than parse them back out
        /// of `detail`.
        generated: Generated,
    },
    /// The connection failed part-way through the reply. **Retryable**, on the same terms as a
    /// transport error before the response head: nothing about the request was wrong.
    Interrupted(String),
    /// The stream went [`modelStreamIdleSecs`](crate::limits::RunLimits::model_stream_idle)
    /// without a delta from the model — the bound that answers a provider which stops answering
    /// mid-reply. **Retryable on the client's own schedule**, exactly as an interrupted connection
    /// is, because the attempt is cancelled the moment the bound expires rather than being waited
    /// out to the call ceiling.
    Stalled {
        /// The idle bound that expired, so the retry's `warn` line names the figure that fired
        /// rather than one a reader has to look up.
        idle: Duration,
        /// The upstream provider serving the stalled stream, when a chunk named one.
        provider: Option<String>,
    },
    /// The run's [per-call ceiling](DEFAULT_MODEL_CALL_TIMEOUT) elapsed over the whole attempt —
    /// the head wait and the body's reads together. Surfaced as [`ModelError::Timeout`] **without**
    /// consuming the retry budget: an attempt that ran the whole ceiling is the one failure whose
    /// internal retry would cost as much again, and the turn-level retry is the bounded one.
    Ceiling {
        /// The upstream provider serving the attempt, when a chunk named one.
        provider: Option<String>,
    },
    /// The stream was not a stream gg can read — an unparseable event, a provider error object, a
    /// tool call whose assembled arguments are not JSON, or an empty reply with no finish reason.
    /// **Fatal**, exactly as the same conditions always were.
    Malformed(ModelError),
}

/// How much output an abandoned attempt had generated by the moment its stream was dropped.
///
/// Measured by the [guard](LoopGuard) rather than reported by the provider, for the reason the
/// [tally](LoopAborts) it feeds gives: the usage payload arrives at the *end* of a stream that was
/// deliberately never read to its end.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Generated {
    /// Completed words the guard counted.
    words: u64,
    /// Characters the guard counted, as characters rather than bytes.
    chars: u64,
}

/// How long a `deadline` has left, or zero when it has already passed.
///
/// tokio's [`Instant`](tokio::time::Instant) has no saturating subtraction (its `Sub` panics on
/// overflow), and the transport's two clocks both need one: whichever has less time left bounds
/// the next read, and a clock that has already run out must read as zero rather than panic.
fn time_left(deadline: tokio::time::Instant) -> Duration {
    let now = tokio::time::Instant::now();
    if deadline > now {
        deadline - now
    } else {
        Duration::ZERO
    }
}

/// Read one streamed response to its end, its abandonment, or its failure.
///
/// The [guard](LoopGuard) is constructed **per attempt**, not per turn: each attempt is a fresh
/// reply, and carrying a window across attempts would let words from a discarded reply condemn its
/// replacement. It is `Option`, because whether the detector runs is the agent's own
/// [configured choice](crate::loopguard) and nothing about the read depends on it — every reply is
/// a stream, armed or not.
///
/// Two clocks bound the read, and they answer different questions:
///
/// - `idle` is the run's [stream-idle bound](DEFAULT_MODEL_STREAM_IDLE), measured **since the last
///   chunk carrying a delta from the model**, or since `idle_from` (the moment the request was
///   sent) when none has arrived yet. Keep-alive comments and blank lines do not restart
///   it, which is the whole point: they arrive repeatedly while a provider is thinking or has
///   stopped, and a reader that treated them as progress would wait the idle bound out on each
///   one. Expiring it is a [`Stalled`](StreamOutcome::Stalled) outcome, which the caller retries on
///   the client's own schedule exactly as it retries a reset connection.
/// - `deadline` is the attempt's share of the run's [per-call
///   ceiling](DEFAULT_MODEL_CALL_TIMEOUT), already running when the read starts (it bounds the head
///   wait too). Expiring it is a [`Ceiling`](StreamOutcome::Ceiling) outcome, which the caller
///   surfaces immediately without spending the retry budget.
///
/// Each read is therefore bounded by whichever clock has the less time left, so a read is never cut
/// by the bound that was not the reason it stalled — and which one fired is answered by comparing
/// the two, not by an ordering the caller has to reconstruct.
///
/// Abandoning is simply returning: the response's chunk stream is dropped on the way out, which
/// closes the connection and stops the provider sending the rest. gg neither reads nor pays for the
/// remainder — which is also how a stalled attempt is cancelled.
///
/// Generic over the chunk stream rather than taking the [`reqwest::Response`], so a test can hand it
/// chunks that are ready without any I/O and then a stream that never yields again — which is what
/// lets both clocks be asserted under paused time instead of by waiting them out.
async fn read_stream<S, B, E>(
    mut stream: S,
    guard: Option<LoopGuardConfig>,
    deadline: tokio::time::Instant,
    idle_from: tokio::time::Instant,
    idle: Duration,
) -> StreamOutcome
where
    S: futures_util::Stream<Item = Result<B, E>> + Unpin,
    B: AsRef<[u8]>,
    E: std::fmt::Display,
{
    let mut guard = guard.map(LoopGuard::new);
    let mut accumulator = StreamAccumulator::new();
    // When the last delta from the model arrived, or when the request was sent before any has.
    // The idle budget is spent from here, and a chunk that carries no delta (a keep-alive
    // comment, a blank line, the usage trailer) leaves it where it was.
    let mut last_delta = idle_from;

    loop {
        let ceiling_left = time_left(deadline);
        let idle_left = idle.saturating_sub(last_delta.elapsed());
        let chunk = match tokio::time::timeout(ceiling_left.min(idle_left), stream.next()).await {
            Ok(Some(chunk)) => chunk,
            Ok(None) => break,
            Err(_) => {
                return if ceiling_left <= idle_left {
                    StreamOutcome::Ceiling {
                        provider: accumulator.provider().map(str::to_string),
                    }
                } else {
                    StreamOutcome::Stalled {
                        idle,
                        provider: accumulator.provider().map(str::to_string),
                    }
                };
            }
        };
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(err) => return StreamOutcome::Interrupted(format!("stream interrupted: {err}")),
        };
        let delta = match accumulator.push_bytes(chunk.as_ref()) {
            Ok(delta) => delta,
            Err(err) => return StreamOutcome::Malformed(err),
        };
        if delta.progressed {
            last_delta = tokio::time::Instant::now();
        }
        if let Some(trip) = guard
            .as_mut()
            .and_then(|guard| match guard.push(&delta.text) {
                LoopVerdict::Continue => None,
                LoopVerdict::Looping(trip) => Some(trip),
            })
        {
            // The trip says which rule fired and in that rule's own units — words for a repetition,
            // characters for the backstop. The size of what is being thrown away is carried in
            // **both** units, because that is what the discarded reply cost: the operator reading
            // this line wants to know how much generation was paid for and abandoned, whichever
            // rule caught it, and the turn's telemetry publishes the same two figures.
            let generated = Generated {
                words: guard.as_ref().map_or(0, LoopGuard::words_seen),
                chars: guard.as_ref().map_or(0, LoopGuard::chars_seen) as u64,
            };
            return StreamOutcome::Looping {
                detail: format!(
                    "{trip} ({} words, {} characters read before it was abandoned)",
                    generated.words, generated.chars,
                ),
                generated,
            };
        }
        // The terminal sentinel. Providers usually close the connection immediately after it, but
        // not always, and waiting for a close that a keep-alive proxy may not forward would stall
        // the turn on a reply that is already complete.
        if accumulator.done() {
            break;
        }
    }

    match accumulator.finish() {
        Ok(response) => StreamOutcome::Reply(response),
        Err(err) => StreamOutcome::Malformed(err),
    }
}

/// Whether a fatal response says the request's **images** were the problem — the model
/// has no provider route that accepts image input.
///
/// OpenRouter answers such a request with `404 {"error":{"message":"No endpoints found
/// that support image input"}}`, and upstream providers word it their own way. The
/// match is therefore on the error body's wording rather than the status alone: a `404`
/// on its own means an unknown or deprecated model, which is not recoverable by
/// dropping a picture. Pure, so the recognized wordings are unit tested against recorded
/// bodies with no network.
pub fn is_image_unsupported(status: u16, body: &str) -> bool {
    // `400` covers providers that reject the multi-part content shape outright rather
    // than routing on it; `404` is OpenRouter's own "no endpoint supports this" answer.
    if !matches!(status, 400 | 404 | 422) {
        return false;
    }
    let body = body.to_lowercase();
    // Every recognized phrasing pairs an image/vision/multimodal noun with a
    // refusal, so an unrelated 404 that merely mentions an image cannot match.
    const PHRASES: &[&str] = &[
        "support image input",
        "support image_url",
        "support images",
        "image input is not supported",
        "does not support image",
        "do not support image",
        "not support vision",
        "does not support vision",
        "no vision support",
        "image input not supported",
        "multimodal input is not supported",
        "invalid content type",
    ];
    PHRASES.iter().any(|phrase| body.contains(phrase))
}

/// Whether a fatal response refuses the request's pinned tool choice: a `400` whose body names
/// `tool_choice`.
///
/// The match is on the parameter rather than on one provider's wording of why it was refused,
/// because the reason varies (a model served in a thinking mode, a provider that never took the
/// object form) while the parameter does not. A thinking-mode refusal reads *"The tool_choice
/// parameter does not support being set to required or object in thinking mode"*.
pub fn is_tool_choice_refusal(status: u16, body: &str) -> bool {
    status == 400 && body.contains("tool_choice")
}

/// The `warn` line a [tool-choice downgrade](ToolChoiceMemory) is logged with: the model whose
/// provider refused the pin, and the provider's own message.
pub fn tool_choice_downgrade_message(model_id: &str, provider_message: &str) -> String {
    format!(
        "the provider refused a pinned tool choice for `{model_id}` ({provider_message}); \
         required-tool requests for it are sent with `tool_choice` set to `auto` for the rest of \
         the run",
    )
}

/// The run's record of the models whose provider refused a pinned `tool_choice`.
///
/// A [required-tool request](ModelClient::complete_requiring) is pinned to its one tool until
/// the model's provider [refuses the pin](is_tool_choice_refusal). The refusal is recorded here
/// and every later required-tool request for that model is sent on `auto`, so the pin is tried
/// once per model per run rather than once per request. A reply on `auto` that makes no call is
/// the caller's ordinary missing-completion handling.
///
/// Cloning shares the record. The run's [factory](DefaultClientFactory) holds one and hands it to
/// every client it builds, so an agent's successor, its subagents and its handoff compaction
/// client all read the same record.
#[derive(Debug, Clone, Default)]
pub struct ToolChoiceMemory(Arc<Mutex<BTreeSet<String>>>);

impl ToolChoiceMemory {
    /// Whether `model_id`'s provider has refused a pinned tool choice this run.
    pub fn refused(&self, model_id: &str) -> bool {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .contains(model_id)
    }

    /// Record that `model_id`'s provider refused a pinned tool choice. `true` when this call is
    /// the one that recorded it, which is the call that logs the downgrade.
    pub fn record_refusal(&self, model_id: &str) -> bool {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(model_id.to_string())
    }
}

/// Truncate a provider error body to [`ERROR_BODY_CAP`] so a huge HTML error page
/// never floods a [`ModelError`].
fn truncate(body: &str) -> String {
    let body = body.trim();
    if body.len() <= ERROR_BODY_CAP {
        body.to_string()
    } else {
        let mut cut = ERROR_BODY_CAP;
        while !body.is_char_boundary(cut) {
            cut -= 1;
        }
        format!("{}…", &body[..cut])
    }
}

// ---------------------------------------------------------------------------
// Request building (pure)
// ---------------------------------------------------------------------------

/// Build the OpenAI-compatible request body for a turn. Pure and injectable — the
/// client serializes exactly this. `tool_choice` is set to `"auto"` only when tools
/// are offered; `usage: { include: true }` asks OpenRouter to return cost.
///
/// When `routing_key` is `Some` it is sent as **`session_id`** — OpenRouter's
/// sticky-routing key, the field that keeps a conversation's requests on one provider *endpoint*
/// so each turn reuses the prefix the previous turn cached. A run's turns share one key (see
/// [`OpenRouterClient::from_binding`]); without a sticky key OpenRouter is free to balance
/// prefix-identical requests across endpoints, and every request that lands somewhere new is
/// billed fully uncached even though nothing about the prompt changed.
///
/// The same value also rides as `prompt_cache_key`. That field is the *OpenAI-style* key:
/// OpenRouter consults it for sticky routing only as a fallback when no `session_id` (or
/// `x-session-id` header) is present, and OpenAI-native endpoints use it to scope their own cache
/// lookups. Sending only `prompt_cache_key` leaves routing on that fallback path and produces runs
/// whose requests hit a fresh endpoint, and so a 0% cache rate, turn after turn even when the
/// provider *name* on the dashboard never changed. The key is a [minted](RoutingKey::mint) cuid2,
/// so it is inside both fields' caps whatever the run's session id is. `None` omits both fields
/// entirely.
///
/// On a model that [needs them](requires_cache_markers), the messages the
/// [breakpoint policy](cache_breakpoints) selects are additionally stamped with an explicit
/// `cache_control` marker, which is what actually *enables* the prompt cache on a provider that
/// does not cache implicitly — see that function for why the key alone is not enough.
///
/// `stable_ttl` is the [lifetime](CacheTtl) this request's **stable** markers ask for — the running
/// agent's [configured choice](GgPromptCacheTtl), which is per agent because whether an hour is
/// worth its write premium depends on how that agent's turns are shaped. The tail always takes
/// [`CacheTtl::Standard`], so `Standard` here produces exactly the unqualified markers gg sent
/// before the lifetime was configurable.
///
/// Every request asks the provider to deliver the reply as
/// [server-sent events](StreamAccumulator), so the request carries `stream: true` and
/// `stream_options: { include_usage: true }`. The first is the transport; the second is what makes
/// OpenRouter attach the `usage` block (and therefore the turn's cost) to the final chunk, without
/// which a streamed turn would silently account zero tokens. Streaming is not a
/// [loop-detection](crate::loopguard) concern: the detector is the *reason an agent might want* to
/// see the reply as it arrives, but the [stream-idle bound](DEFAULT_MODEL_STREAM_IDLE) needs the
/// same stream to tell a provider that has stopped from a model that is still thinking, so every
/// agent gets it and the detector decides only whether anything watches.
pub fn build_request_body(
    model_id: &str,
    messages: &[Message],
    tools: &[ToolDefinition],
    routing_key: Option<&RoutingKey>,
    provider: Option<&str>,
    stable_ttl: CacheTtl,
) -> Value {
    let marked_model = requires_cache_markers(model_id);
    let breakpoints = if marked_model {
        cache_breakpoints(messages)
    } else {
        Vec::new()
    };
    // The last breakpoint is the rolling tail; every earlier one names a prefix meant to survive
    // between turns (see `CacheTtl`). A *lone* breakpoint is the exception: the thread has not
    // started, so it is the opening context's anchor — the run's single most valuable entry, and
    // the one a long first turn would otherwise let expire before the second turn could read it —
    // so it counts as stable rather than as a tail.
    let tail = (breakpoints.len() > 1).then(|| breakpoints[breakpoints.len() - 1]);
    let messages: Vec<Value> = messages
        .iter()
        .enumerate()
        .map(|(index, message)| {
            let ttl = breakpoints.contains(&index).then(|| {
                if Some(index) == tail {
                    CacheTtl::Standard
                } else {
                    stable_ttl
                }
            });
            wire_message(message, ttl, marked_model)
        })
        .collect();
    let mut body = json!({
        "model": model_id,
        "messages": messages,
        "usage": { "include": true },
        "stream": true,
        "stream_options": { "include_usage": true },
    });

    if let Some(key) = routing_key.map(RoutingKey::as_str) {
        // The sticky-routing key, and the OpenAI-style fallback for the providers that read that
        // one instead. Same value: they name the same conversation.
        body["session_id"] = json!(key);
        body["prompt_cache_key"] = json!(key);
    }

    // The pin. `only` names the one provider this model's requests may be served by, and
    // `allow_fallbacks: false` makes an outage of that provider the error it is rather than a
    // silent move onto another provider's price basis. The sticky key stays: it still keeps a
    // run on one endpoint *within* the pinned provider. Absent only for a caller that has no
    // pin to send — a unit test of the body, never a launched run.
    if let Some(provider) = provider.filter(|provider| !provider.is_empty()) {
        body["provider"] = json!({ "only": [provider], "allow_fallbacks": false });
    }

    if !tools.is_empty() {
        let tools: Vec<Value> = tools
            .iter()
            .map(|tool| {
                json!({
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.parameters,
                    }
                })
            })
            .collect();
        body["tools"] = Value::Array(tools);
        body["tool_choice"] = json!("auto");
    }

    body
}

/// Build the request body for a turn that **must** be answered with a call to `tool`: the one tool
/// offered, and `tool_choice` naming it rather than `"auto"`.
///
/// Two callers require a call: every responses-as-code turn, whose reply must be a
/// `submit_program` call ([`ModelClient::complete_requiring`]), and
/// [handoff compaction](crate::compaction::HandoffCompactor), which has a single shot at a
/// structured answer and no next turn in which to ask again. Pure, like
/// [`build_request_body`], so the wire shape is unit tested without network.
pub fn build_required_tool_request_body(
    model_id: &str,
    messages: &[Message],
    tool: &ToolDefinition,
    routing_key: Option<&RoutingKey>,
    provider: Option<&str>,
    stable_ttl: CacheTtl,
) -> Value {
    let mut body = build_request_body(
        model_id,
        messages,
        std::slice::from_ref(tool),
        routing_key,
        provider,
        stable_ttl,
    );
    body["tool_choice"] = json!({
        "type": "function",
        "function": { "name": tool.name },
    });
    body
}

/// Whether `model_id` names a model that caches **only** what a request explicitly marks, and so
/// must be sent [`cache_control` breakpoints](cache_breakpoints).
///
/// This is the Anthropic family, and marking it is not optional: an unmarked request to a Claude
/// model is billed at the full input rate every turn, however byte-identical it is to the last one.
///
/// Every *other* provider gg reaches caches long prefixes implicitly, and for those the markers are
/// worse than useless. `cache_control` has to ride a content block, so marking a text-only message
/// promotes it from a bare string to a one-element array (see [`wire_message`]) — and because the
/// rolling breakpoints move every turn, the *same* message is then sent as a string on one turn and
/// as an array on the next. Anthropic normalizes both to content blocks and never notices; a
/// provider that caches implicitly off the forwarded OpenAI-shaped payload sees the prefix change
/// underneath it and re-bills the request in full. Measured against one such provider, marking cost
/// both the hit (0% where an unmarked request read 98%) and ~170 tokens of extra prompt on the
/// marked turns.
///
/// So the choice is not "sniff the model id or mark everything": marking everything *loses* caching
/// on everything that is not Anthropic. The match is deliberately loose — any id mentioning Claude,
/// whatever vendor prefix routes it — because the failure mode of not matching a Claude model is the
/// expensive one, and gg has already been through it once.
pub fn requires_cache_markers(model_id: &str) -> bool {
    let model_id = model_id.to_ascii_lowercase();
    model_id.starts_with("anthropic/") || model_id.contains("claude")
}

/// How long a [breakpoint](cache_breakpoints) asks the provider to keep its cache entry.
///
/// Within one request gg's breakpoints are not interchangeable, so their lifetimes need not be
/// either:
///
/// - The **stable** markers — the anchor and the grid points — name prefixes deliberately chosen to
///   still be prefixes several turns from now. These are what a turn *reads*, so they are the only
///   ones an [`Extended`](Self::Extended) lifetime can help: see [`CACHE_EXTENDED_TTL`]. Whether
///   they actually ask for it is the running agent's
///   [configured lifetime](GgPromptCacheTtl), passed into [`build_request_body`].
/// - The **tail** is rewritten every turn by construction and is read exactly once, by the turn
///   immediately after it. It always takes [`Standard`](Self::Standard); buying an hour for
///   material that is superseded in seconds would be paying the higher write premium for nothing. A
///   request whose *only* breakpoint is the anchor has no tail marker at all — see
///   [`build_request_body`].
///
/// Mixing the two in one request is supported, and the stable markers all precede the tail, which
/// is the order the providers that care require. The split is also what keeps the extended
/// lifetime close to cost-neutral for the agents configured with it: the premium falls on the
/// writes at the stable markers, which is what an extended lifetime exists to *stop* re-paying for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CacheTtl {
    /// The provider default (five minutes) — the tail always, and every marker on an agent left at
    /// the [standard](GgPromptCacheTtl::Standard) lifetime.
    #[default]
    Standard,
    /// [`CACHE_EXTENDED_TTL`] — the stable markers of an agent configured for the
    /// [extended](GgPromptCacheTtl::Extended) lifetime.
    Extended,
}

impl CacheTtl {
    /// The `cache_control` value this lifetime serializes to. The default lifetime is expressed by
    /// *omitting* `ttl`, so the standard marker is byte-identical to an unqualified breakpoint.
    fn marker(self) -> Value {
        match self {
            Self::Standard => json!({ "type": "ephemeral" }),
            Self::Extended => json!({ "type": "ephemeral", "ttl": CACHE_EXTENDED_TTL }),
        }
    }
}

impl From<GgPromptCacheTtl> for CacheTtl {
    /// The wire lifetime an [agent profile's](GgPromptCacheTtl) configured choice asks for on its
    /// stable breakpoints. The two enums are deliberately separate: the configuration is a stored
    /// contract, this is the request-building detail it selects.
    fn from(configured: GgPromptCacheTtl) -> Self {
        match configured {
            GgPromptCacheTtl::Standard => Self::Standard,
            GgPromptCacheTtl::Extended => Self::Extended,
        }
    }
}

/// Choose which messages carry an explicit `cache_control` breakpoint — the markers that turn a
/// provider's prompt cache **on**.
///
/// A [routing key](RoutingKey) only decides *which backend* a request lands on. It
/// does not ask for anything to be cached. Some providers (OpenAI, Gemini) cache long prefixes
/// implicitly and need nothing more, but Anthropic caches **only** what a request explicitly marks:
/// an unmarked request is billed at full input rate every turn no matter how much of it is
/// verbatim identical to the last one. gg sent no markers, so a run on an Anthropic model cached
/// nothing at all — the whole system prompt, tool schemas, and autoloaded specs were re-billed on
/// every single turn of the loop.
///
/// A marker caches the request prefix that *ends at* it, so where they go is the whole design:
///
/// - **The anchor** — the message before the first assistant turn. That is the run's fixed
///   preamble, it is the single largest static block gg sends, and because Anthropic orders a
///   request `tools → system → messages` a marker here covers the tool schemas too. It never moves,
///   so every turn after the first reads it.
///
///   **How much of the preamble it covers depends on the execution mode**, and that is worth being
///   exact about rather than describing the tool-calling case as if it were both. Under tool
///   calling the first assistant turn is the model's first reply, so the anchor sits at the end of
///   the whole opening context — the system prompt, the build prompt, the hook notes and any
///   autoloaded specifications. Under [responses-as-code](crate::bootstrap) the opening context
///   *contains* an assistant turn: the synthesized bootstrap program is pushed immediately after
///   the build prompt, so the anchor stops there and the material seeded after it — the bootstrap's
///   own documentation views, the hook notes, the specifications, a persistent agent's restored
///   desk — is covered by the grid points and the tail instead of by the anchor.
///
///   This function is deliberately not given the means to tell those apart. It is pure over
///   `messages`, which is the whole of what the transport layer knows; a synthesized assistant turn
///   and a model's own reply are the same thing on the wire, and threading gg's context bands down
///   here to distinguish them would put the window model inside the HTTP client. The consequence is
///   bounded: everything the anchor stops short of is a *prefix* of what the next marker covers, so
///   nothing goes uncached — one of the four available markers simply names a shorter prefix than
///   it does under tool calling.
/// - **Up to two grid points** — the rolling breakpoints over the accumulating thread, snapped to
///   multiples of [`CACHE_BREAKPOINT_STRIDE`] so they name the *same* prefix from one turn to the
///   next (see that constant). Two rather than one so that the turn which crosses a fresh grid
///   point — the one place the newest point cannot be a hit — still has an older one to read.
/// - **The tail** — the final message, which writes this turn's full prefix so the *next* turn can
///   read it. This is what makes the caching incremental rather than frozen at the preamble.
///
/// A candidate that lands on a message with no content block to hang a marker on (an assistant
/// turn that only called tools) is walked back to the nearest message that has one, and the result
/// is deduplicated — so the count never exceeds [`MAX_CACHE_BREAKPOINTS`], which is Anthropic's
/// hard cap and a request-rejecting error to exceed.
///
/// Which requests carry these markers at all is [the model's](requires_cache_markers) business, not
/// this function's: it decides *where* a marker goes, and is called only for a model that needs one.
///
/// Pure, so the placement is unit tested without network.
pub fn cache_breakpoints(messages: &[Message]) -> Vec<usize> {
    let Some(last) = messages.len().checked_sub(1) else {
        return Vec::new();
    };
    // The tail marker writes the prefix the **next** turn's request will read, so it must land on
    // the newest *conversation* message. gg's trailing slot — the context-usage signal — is a
    // `system`-role message re-rendered at the very end of every request: a prefix ending on it
    // never recurs (the next request has new conversation ahead of it), so an entry written there
    // is never read and the tail marker would be wasted every single turn. Walking back past
    // trailing `system` messages is safe
    // because the only mid-thread `system` message is the system prompt itself, at index 0.
    let tail = (0..=last)
        .rev()
        .find(|&index| messages[index].role != Role::System)
        .unwrap_or(last);
    // The opening context ends where the thread begins. With no assistant turn yet the whole
    // request is still preamble, so the anchor is simply the last message.
    let anchor = messages
        .iter()
        .position(|message| message.role == Role::Assistant)
        .map_or(tail, |first_turn| first_turn.saturating_sub(1));

    let mut candidates = vec![anchor];
    // Walk the grid back from the tail, taking points that are strictly inside the (anchor, tail)
    // span — a point at either end would only duplicate a breakpoint already placed there.
    let mut grid = tail - (tail % CACHE_BREAKPOINT_STRIDE);
    while candidates.len() < MAX_CACHE_BREAKPOINTS - 1 && grid > anchor {
        if grid < tail {
            candidates.push(grid);
        }
        let Some(next) = grid.checked_sub(CACHE_BREAKPOINT_STRIDE) else {
            break;
        };
        grid = next;
    }
    candidates.push(tail);

    let mut chosen: Vec<usize> = candidates
        .into_iter()
        .filter_map(|index| markable_at_or_before(messages, index))
        .collect();
    chosen.sort_unstable();
    chosen.dedup();
    chosen
}

/// The nearest index at or before `index` whose message can carry a marker, if any.
fn markable_at_or_before(messages: &[Message], index: usize) -> Option<usize> {
    (0..=index)
        .rev()
        .find(|&index| is_markable(&messages[index]))
}

/// Whether `message` serializes to at least one content block a `cache_control` marker can ride
/// on. An assistant turn that only requested tool calls has none — its `tool_calls` are not
/// content blocks — so it cannot be a breakpoint.
fn is_markable(message: &Message) -> bool {
    message
        .content
        .as_ref()
        .is_some_and(|content| !content.is_empty())
        || !message.images.is_empty()
}

/// Serialize one [`Message`] into the OpenAI wire shape. Assistant tool-call arguments
/// are re-encoded as a JSON **string**, as the API expects.
///
/// A message carrying [images](Message::images) becomes a **multi-part** content array
/// (`{type: "text"}` then one `{type: "image_url"}` per image, each a `data:` URL)
/// instead of a bare string; a text-only message is serialized exactly as before, so
/// the shape only changes where a picture is actually attached. Images ride on the
/// `tool` message answering the `read_file` that produced them — OpenRouter accepts
/// image parts there across providers, and keeping the picture attached to its own tool
/// result means the read and what it returned stay one item the context model can
/// account for, evict, and (if the provider turns out to refuse images) strip.
///
/// `cached` marks this message as a [prompt-cache breakpoint](cache_breakpoints) with the
/// [lifetime](CacheTtl) that breakpoint asks for, or leaves it unmarked when `None`. Because
/// `cache_control` rides a *content block* and a bare string has none, a marked text-only message
/// is promoted to the same multi-part array an image-bearing one already used. The marker goes on
/// the **last** part so the cached prefix covers the whole message — attaching it to the leading
/// text part of a message with pictures would leave the pictures, by far the expensive half,
/// outside the cache.
///
/// `stable_parts` serializes **every** content-bearing message as the multi-part array, marker or
/// no marker — set exactly for the [models that take markers](requires_cache_markers). It exists
/// because the rolling [breakpoints](cache_breakpoints) *move*: as the grid advances, a message
/// that carried a marker on one turn is unmarked on the next, and without this flag its wire shape
/// would flip between a bare string and a one-element array **mid-prefix** — a byte-level edit
/// behind the end of an otherwise append-only prompt, observed busting a run's cached prefix from
/// 24.7k tokens to 2.6k on the turn the grid moved. With it, a sent message's serialized form is a
/// function of the message alone: only the `cache_control` *field* comes and goes, which is
/// metadata the caching providers do not hash as content. Models that take no markers keep the
/// bare-string shape they always had — for them the array form is what busts implicit caching (see
/// [`requires_cache_markers`]).
fn wire_message(message: &Message, cached: Option<CacheTtl>, stable_parts: bool) -> Value {
    let mut obj = json!({ "role": role_str(message.role) });
    if !message.images.is_empty()
        || (message.content.is_some() && (stable_parts || cached.is_some()))
    {
        let mut parts: Vec<Value> = Vec::with_capacity(message.images.len() + 1);
        if let Some(content) = &message.content {
            parts.push(json!({ "type": "text", "text": content }));
        }
        for image in &message.images {
            parts.push(json!({
                "type": "image_url",
                "image_url": { "url": image.data_url() },
            }));
        }
        if let Some(ttl) = cached
            && let Some(last) = parts.last_mut()
        {
            last["cache_control"] = ttl.marker();
        }
        obj["content"] = Value::Array(parts);
    } else if let Some(content) = &message.content {
        obj["content"] = json!(content);
    }
    if !message.tool_calls.is_empty() {
        let calls: Vec<Value> = message
            .tool_calls
            .iter()
            .map(|call| {
                json!({
                    "id": call.id,
                    "type": "function",
                    "function": {
                        "name": call.name,
                        "arguments": serde_json::to_string(&call.arguments)
                            .unwrap_or_else(|_| "{}".to_string()),
                    }
                })
            })
            .collect();
        obj["tool_calls"] = Value::Array(calls);
    }
    if let Some(id) = &message.tool_call_id {
        obj["tool_call_id"] = json!(id);
    }
    obj
}

/// The wire role token for a [`Role`].
fn role_str(role: Role) -> &'static str {
    match role {
        Role::System => "system",
        Role::User => "user",
        Role::Assistant => "assistant",
        Role::Tool => "tool",
    }
}

// ---------------------------------------------------------------------------
// The single-document reply shape (pure, test-only)
// ---------------------------------------------------------------------------

/// Parse an OpenRouter chat-completions **response body** — the one-document reply a non-streaming
/// request receives — into a [`ModelResponse`].
///
/// gg no longer reads this shape off the wire: every reply arrives as a
/// [stream](StreamAccumulator). The parser survives as the **reference** the streamed assembler is
/// pinned against — the equivalence test feeds the accumulator an SSE transcript whose deltas
/// concatenate to exactly this document and asserts the two [`ModelResponse`]s are equal, which is
/// what guarantees that moving the whole transport onto the stream changed what gg reads by
/// nothing at all. Pure and network-free, so it is unit tested against recorded JSON.
///
/// Tool-call arguments (a JSON string on the wire) are parsed into structured [`Value`]s; usage is
/// mapped onto [`TokenCounts`] (cached input subtracted from input, reasoning subtracted from
/// output, per the metrics contract) and any reported cost onto [`Cost`] — all through the same
/// helpers the streamed assembler uses, so the two cannot drift.
#[cfg(test)]
pub fn parse_response(body: &str) -> Result<ModelResponse, ModelError> {
    let parsed: WireResponse = serde_json::from_str(body)
        .map_err(|err| ModelError::Parse(format!("{err}; body: {}", truncate(body))))?;

    // OpenRouter surfaces provider errors in a `2xx` envelope too; treat that as fatal
    // rather than silently returning an empty turn.
    if let Some(err) = parsed.error {
        return Err(ModelError::Parse(format!(
            "provider returned an error object: {}",
            err.message
        )));
    }

    let provider = parsed.provider.filter(|provider| !provider.is_empty());
    let choice = parsed
        .choices
        .into_iter()
        .next()
        .ok_or_else(|| ModelError::Parse("response had no choices".to_string()))?;

    let text = choice.message.content.filter(|content| !content.is_empty());

    let mut tool_calls = Vec::with_capacity(choice.message.tool_calls.len());
    for (index, call) in choice.message.tool_calls.into_iter().enumerate() {
        let arguments = parse_arguments(&call.function.arguments).map_err(|err| {
            ModelError::Parse(format!(
                "tool call #{index} ({}) had unparseable arguments: {err}",
                call.function.name
            ))
        })?;
        tool_calls.push(ToolCall {
            id: call.id,
            name: call.function.name,
            arguments,
        });
    }

    let mut finish_reason = map_finish_reason(choice.finish_reason.as_deref());
    // A provider that omits `finish_reason` but returned tool calls still stopped to
    // call tools; normalize that so the loop's dispatch decision is reliable.
    if finish_reason == FinishReason::Stop && !tool_calls.is_empty() {
        finish_reason = FinishReason::ToolCalls;
    }

    let (usage, cost, wire, reconciled) = map_usage(
        parsed.usage.as_ref(),
        reply_size(text.as_deref(), &tool_calls),
    );

    Ok(ModelResponse {
        text,
        tool_calls,
        finish_reason,
        usage,
        cost,
        provider,
        loop_aborts: LoopAborts::none(),
        usage_wire: wire,
        usage_reconciled: reconciled,
    })
}

/// Parse a tool call's `arguments` string. An empty string means "no arguments" and
/// maps to an empty object; anything else must be valid JSON.
fn parse_arguments(raw: &str) -> Result<Value, serde_json::Error> {
    if raw.trim().is_empty() {
        Ok(json!({}))
    } else {
        serde_json::from_str(raw)
    }
}

/// Map an OpenAI `finish_reason` string to a [`FinishReason`]. A missing reason maps to
/// [`FinishReason::Stop`] (callers normalize the tool-call case).
fn map_finish_reason(reason: Option<&str>) -> FinishReason {
    match reason {
        None | Some("stop") | Some("end_turn") => FinishReason::Stop,
        Some("tool_calls") | Some("function_call") => FinishReason::ToolCalls,
        Some("length") | Some("max_tokens") => FinishReason::Length,
        Some("content_filter") => FinishReason::ContentFilter,
        Some(other) => FinishReason::Other(other.to_string()),
    }
}

/// Map wire usage onto the shared [`TokenCounts`]/[`Cost`] contract. Cached input is
/// subtracted from the input total and reasoning from the output total (per the
/// metrics contract), using saturating subtraction so a provider's slightly
/// inconsistent details can never underflow.
///
/// `reply_tokens` is the [reply's own estimated size](reply_size), which bounds the
/// output/reasoning split (see [`split_completion`]): a provider's `reasoning_tokens` is
/// kept only while it leaves the reply that much room under `completion_tokens`, and a
/// split gg bounded is reported as
/// [`reconciled`](test_cabinet_core::gg::GgTelemetryKind::Usage).
///
/// The return also carries the provider's usage object verbatim (as JSON) so the
/// [`Usage`](test_cabinet_core::gg::GgTelemetryKind::Usage) event can publish it beside
/// the mapped counts: a published per-turn output figure is checkable against what the
/// provider actually said only if the record holds what it said.
fn map_usage(
    usage: Option<&WireUsage>,
    reply_tokens: Option<u64>,
) -> (TokenCounts, Option<Cost>, Option<Value>, bool) {
    let Some(usage) = usage else {
        return (TokenCounts::default(), None, None, false);
    };

    let cached_input = usage
        .prompt_tokens_details
        .as_ref()
        .and_then(|details| details.cached_tokens);
    let reasoning = usage
        .completion_tokens_details
        .as_ref()
        .and_then(|details| details.reasoning_tokens);

    let uncached_input = usage
        .prompt_tokens
        .map(|prompt| prompt.saturating_sub(cached_input.unwrap_or(0)));
    let (output, reasoning, reconciled) =
        split_completion(usage.completion_tokens, reasoning, reply_tokens);

    let counts = TokenCounts {
        uncached_input,
        cached_input,
        output,
        reasoning,
    };

    let cost = usage.cost.map(|cost| Cost {
        comparable: Some(cost),
        actual: Some(cost),
    });

    (counts, cost, Some(usage.to_wire()), reconciled)
}

/// Split one call's completion total into the output and reasoning classes, bounded by
/// the size of the reply gg measured itself.
///
/// The provider's `reasoning_tokens` is kept as given when it is consistent with the
/// reply — when the reply fits under the completion total beside it. When it does not
/// (reasoning equal to or beyond the whole completion, or past what the reply leaves),
/// the reply's own size is the output figure and what remains of the total is the
/// reasoning figure, and the split is reported as reconciled: gg's, not the provider's.
///
/// Every arm preserves the two properties the split must hold: output plus reasoning is
/// the provider's completion total wherever it reported one, and a class unreported by
/// the provider stays unreported rather than being invented as a zero. A call with no
/// completion total is mapped as reported — there is no total to bound a split against,
/// so the provider's reasoning figure stands and the reply's size is not imposed.
fn split_completion(
    completion: Option<u64>,
    reasoning: Option<u64>,
    reply_tokens: Option<u64>,
) -> (Option<u64>, Option<u64>, bool) {
    let Some(reply) = reply_tokens else {
        return (
            completion.map(|c| c.saturating_sub(reasoning.unwrap_or(0))),
            reasoning,
            false,
        );
    };
    let Some(completion) = completion else {
        return (None, reasoning, false);
    };

    let floor = reply.min(completion);
    if reasoning.unwrap_or(0) <= completion.saturating_sub(floor) {
        // The provider's split leaves the reply room under the total: record it as given.
        (
            Some(completion.saturating_sub(reasoning.unwrap_or(0))),
            reasoning,
            false,
        )
    } else {
        // It does not: the reply is the output, and the reasoning is what is left.
        (Some(floor), Some(completion - floor), true)
    }
}

// ---------------------------------------------------------------------------
// Wire response types
// ---------------------------------------------------------------------------

// The `WireResponse` family belongs to the single-document reply shape, whose only remaining
// reader is the test-only reference parser, so it compiles only there. `WireUsage` is shared with
// the streamed chunks and stays in every build.

#[cfg(test)]
#[derive(Debug, Deserialize)]
struct WireResponse {
    #[serde(default)]
    choices: Vec<WireChoice>,
    #[serde(default)]
    usage: Option<WireUsage>,
    #[serde(default)]
    error: Option<WireError>,
    /// OpenRouter's name for the upstream provider that served the call.
    #[serde(default)]
    provider: Option<String>,
}

/// A provider error object. Compiled unconditionally because a mid-stream chunk can carry one too.
#[derive(Debug, Deserialize)]
struct WireError {
    #[serde(default)]
    message: String,
}

#[cfg(test)]
#[derive(Debug, Deserialize)]
struct WireChoice {
    message: WireRespMessage,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[cfg(test)]
#[derive(Debug, Deserialize)]
struct WireRespMessage {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    tool_calls: Vec<WireRespToolCall>,
}

#[cfg(test)]
#[derive(Debug, Deserialize)]
struct WireRespToolCall {
    #[serde(default)]
    id: String,
    function: WireRespFunction,
}

#[cfg(test)]
#[derive(Debug, Deserialize)]
struct WireRespFunction {
    name: String,
    #[serde(default)]
    arguments: String,
}

/// The provider's usage object: the typed view gg maps onto, plus the object **verbatim**
/// as it arrived.
///
/// The verbatim half is captured at parse time (see the `Deserialize` impl) rather than
/// rebuilt from the mapped fields, so fields gg maps nothing onto — `total_tokens`, a
/// vendor's own detail keys — survive into the record. An unmapped field in the record is
/// a figure a reader can still check, where a dropped one is a silence that reads as
/// agreement.
#[derive(Debug)]
struct WireUsage {
    /// The mapped `prompt_tokens` total.
    prompt_tokens: Option<u64>,
    /// The mapped `completion_tokens` total.
    completion_tokens: Option<u64>,
    /// The mapped cost.
    cost: Option<f64>,
    /// The mapped prompt details.
    prompt_tokens_details: Option<WirePromptDetails>,
    /// The mapped completion details.
    completion_tokens_details: Option<WireCompletionDetails>,
    /// The object verbatim, exactly as parsed off the wire.
    raw: Value,
}

/// The mapped fields of a [`WireUsage`], as the wire carries them.
#[derive(Deserialize)]
struct WireUsageFields {
    #[serde(default)]
    prompt_tokens: Option<u64>,
    #[serde(default)]
    completion_tokens: Option<u64>,
    #[serde(default)]
    cost: Option<f64>,
    #[serde(default)]
    prompt_tokens_details: Option<WirePromptDetails>,
    #[serde(default)]
    completion_tokens_details: Option<WireCompletionDetails>,
}

impl<'de> Deserialize<'de> for WireUsage {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        // Read the whole object first — the verbatim record — and then map the fields off
        // it. One read, so the two halves cannot describe different objects.
        let raw = Value::deserialize(deserializer)?;
        let fields = WireUsageFields::deserialize(&raw).map_err(serde::de::Error::custom)?;
        Ok(Self {
            prompt_tokens: fields.prompt_tokens,
            completion_tokens: fields.completion_tokens,
            cost: fields.cost,
            prompt_tokens_details: fields.prompt_tokens_details,
            completion_tokens_details: fields.completion_tokens_details,
            raw,
        })
    }
}

impl WireUsage {
    /// The provider's usage object, verbatim: exactly the JSON it arrived as, beside the
    /// mapped counts on the [`Usage`](test_cabinet_core::gg::GgTelemetryKind::Usage) event.
    fn to_wire(&self) -> Value {
        self.raw.clone()
    }
}

#[derive(Debug, Deserialize)]
struct WirePromptDetails {
    #[serde(default)]
    cached_tokens: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct WireCompletionDetails {
    #[serde(default)]
    reasoning_tokens: Option<u64>,
}

// ---------------------------------------------------------------------------
// Streamed response assembly (pure)
// ---------------------------------------------------------------------------

/// The longest single server-sent-event line gg will buffer before giving up: **8 MiB**.
///
/// A chat-completion chunk is a few hundred bytes, so this is not a limit any provider approaches —
/// it is a bound on the one thing an SSE reader cannot otherwise bound. Lines are only recognised
/// at a newline, so a peer that sends bytes and never a newline would otherwise grow the buffer
/// without limit, and the [detector](LoopGuard) could not save the process because it is never
/// shown a delta until a line completes.
const MAX_SSE_LINE_BYTES: usize = 8 * 1024 * 1024;

/// The SSE field prefix carrying a chunk.
const SSE_DATA_PREFIX: &str = "data:";

/// The payload of the terminal `data:` line — the provider saying the reply is complete.
const SSE_DONE: &str = "[DONE]";

/// Accumulates OpenAI-style `chat.completion.chunk` deltas into one [`ModelResponse`].
///
/// **Pure and network-free**, on the same terms as [`build_request_body`]: it is fed `&[u8]` and
/// answers with values, so the whole streamed wire format — partial lines, keep-alive comments,
/// tool-call fragments arriving out of one field at a time, usage on a trailing chunk — is unit
/// tested against recorded transcripts with no server anywhere. The only thing [`read_stream`] adds
/// is a socket to read the bytes off.
///
/// It shares every mapping with the reply parsing ([`parse_arguments`], [`map_finish_reason`],
/// [`map_usage`], and the `Stop`-with-tool-calls normalisation), which is what keeps the assembled
/// stream byte-equivalent with the single-document reply it was split from — see the equivalence
/// test in `client.streaming.test.rs`, which feeds an SSE transcript whose deltas concatenate to a
/// buffered fixture and asserts the two [`ModelResponse`]s are equal.
///
/// # What it tolerates
///
/// Everything the format says is not a chunk: blank lines (the event separator), `:` comment lines
/// (OpenRouter sends `: OPENROUTER PROCESSING` as a keep-alive while a slow provider thinks), and
/// any other field line (`event:`, `id:`, `retry:`). Tolerated is not the same as progress:
/// [`push_bytes`](Self::push_bytes) reports whether the bytes carried a **delta** separately from
/// the text they carried, so the run's
/// [stream-idle bound](crate::limits::RunLimits::model_stream_idle) is spent by the model's own
/// output and not by a keep-alive. A `data:` line that is not `[DONE]` and not parseable JSON is
/// *not* tolerated: a chunk gg cannot read is a reply gg cannot assemble, and silently skipping it
/// would produce a confidently wrong answer.
pub struct StreamAccumulator {
    /// Bytes received but not yet forming a complete line.
    ///
    /// Raw bytes rather than a `String`, and this is the reason the accumulator takes `&[u8]` at
    /// all: a TCP read may split a multi-byte UTF-8 sequence, and decoding each chunk as it arrives
    /// would either fail or (worse, with a lossy decoder) replace half a character with `U+FFFD`
    /// and corrupt the reply. Lines are cut at `\n`, which cannot occur inside a multi-byte
    /// sequence, so every line handed on is a whole one and decodes cleanly.
    buffer: Vec<u8>,
    /// The assistant text assembled from every `delta.content` so far.
    text: String,
    /// Tool calls under assembly, keyed by the wire's `index` — the field that says which call a
    /// fragment belongs to, since a chunk carries a slice of one and providers interleave several.
    ///
    /// A `BTreeMap` so [`finish`](Self::finish) emits them in index order, which is the order the
    /// model asked for them in. A `Vec` indexed positionally would break the moment a provider sent index 1 before
    /// index 0.
    tool_calls: BTreeMap<u64, PartialToolCall>,
    /// The first non-null `finish_reason` any chunk carried. First rather than last because a
    /// provider states it once, on the chunk that stops, and anything after it is bookkeeping (the
    /// usage-only chunk) that must not overwrite it.
    finish_reason: Option<String>,
    /// The usage block, which OpenRouter attaches to the **final** chunk when the request asked for
    /// `stream_options.include_usage` — see [`build_request_body`]. Absent until then, which is why
    /// it cannot be read before the stream ends.
    usage: Option<WireUsage>,
    /// Whether the terminal `data: [DONE]` sentinel has been seen.
    done: bool,
    /// The upstream provider the chunks named, from the first chunk that carried one.
    provider: Option<String>,
    /// Whether the push currently being assembled carried a delta from the model — set by
    /// [`push_line`](Self::push_line) for a chunk whose `delta` held content, reasoning or
    /// tool-call arguments, and read by [`push_bytes`](Self::push_bytes) to answer its caller.
    saw_delta: bool,
}

/// What one [push](StreamAccumulator::push_bytes) delivered from the model.
///
/// The two halves answer two different questions, and neither can stand in for the other:
///
/// - [`text`](Self::text) is the assistant **text** the bytes carried, and exists for exactly one
///   caller — the [`LoopGuard`](crate::loopguard), which judges the reply the model is writing and
///   must not be shown the SSE framing, the JSON escaping or the tool-call arguments around it.
/// - [`progressed`](Self::progressed) is whether the bytes carried a **delta** at all: content,
///   reasoning or tool-call arguments. It is what the run's
///   [stream-idle bound](DEFAULT_MODEL_STREAM_IDLE) is measured against, so that a keep-alive
///   comment — which arrives repeatedly while a provider is thinking, or has stopped — does not
///   read as progress, while a model that is reasoning at length does however little *text* its
///   reasoning deltas carry.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Delta {
    /// The assistant text in the pushed bytes, for the detector.
    pub text: String,
    /// Whether any chunk in them carried a delta from the model.
    pub progressed: bool,
}

/// One tool call being assembled from the fragments of several chunks.
#[derive(Default)]
struct PartialToolCall {
    /// The provider-assigned id, from whichever chunk carried it (typically only the first).
    id: String,
    /// The function name, from whichever chunk carried it (typically only the first).
    name: String,
    /// The `arguments` JSON **string**, concatenated across every chunk that carried a fragment.
    /// It is not valid JSON until the last fragment lands, which is why it is parsed in
    /// [`finish`](StreamAccumulator::finish) and not on the way in.
    arguments: String,
}

impl Default for StreamAccumulator {
    fn default() -> Self {
        Self::new()
    }
}

impl StreamAccumulator {
    /// An accumulator holding nothing, ready for the first bytes off the wire.
    pub fn new() -> Self {
        Self {
            buffer: Vec::new(),
            text: String::new(),
            tool_calls: BTreeMap::new(),
            finish_reason: None,
            usage: None,
            done: false,
            provider: None,
            saw_delta: false,
        }
    }

    /// Feed raw bytes off the wire.
    ///
    /// Returns what they [delivered](Delta) from the model: the assistant **text** they carried,
    /// for the [`LoopGuard`](crate::loopguard) that judges the reply as it arrives, and whether any
    /// chunk in them carried a **delta**, for the run's
    /// [stream-idle bound](DEFAULT_MODEL_STREAM_IDLE). Everything else — tool-call fragments, the
    /// finish reason, usage, the sentinel — is recorded internally.
    ///
    /// Bytes that do not complete a line are held for the next call, so an event straddling two
    /// reads is assembled rather than truncated.
    ///
    /// **Tool-call arguments are deliberately excluded from the text**, and that is a real limit
    /// worth stating: a model that loops *inside* a tool call's `arguments` — a `write_file` whose
    /// contents repeat forever — is not caught by the window rule and is bounded only by the
    /// provider's own output cap. The exclusion is right anyway. Arguments arrive as a JSON string,
    /// so the detector would be judging escaped, quoted fragments rather than the model's words,
    /// and the defect this exists for is a responses-as-code program, which arrives as `content`.
    /// They **do** restart the idle clock, though: a fragment of a tool call is the model working,
    /// and it is the model's silence that [`DEFAULT_MODEL_STREAM_IDLE`] bounds, not the model's
    /// choice of output channel.
    pub fn push_bytes(&mut self, bytes: &[u8]) -> Result<Delta, ModelError> {
        self.buffer.extend_from_slice(bytes);
        let mut delta = Delta::default();
        self.saw_delta = false;

        while let Some(newline) = self.buffer.iter().position(|byte| *byte == b'\n') {
            let raw: Vec<u8> = self.buffer.drain(..=newline).collect();
            // Strip the terminator, and the `\r` of a CRLF peer. SSE permits either ending.
            let mut line: &[u8] = &raw;
            if let Some(rest) = line.strip_suffix(b"\n") {
                line = rest;
            }
            if let Some(rest) = line.strip_suffix(b"\r") {
                line = rest;
            }
            let line = std::str::from_utf8(line).map_err(|err| {
                ModelError::Parse(format!("stream carried a line that is not UTF-8: {err}"))
            })?;
            self.push_line(line, &mut delta)?;
        }

        if self.buffer.len() > MAX_SSE_LINE_BYTES {
            return Err(ModelError::Parse(format!(
                "stream sent {} bytes with no line break; giving up at {MAX_SSE_LINE_BYTES}",
                self.buffer.len()
            )));
        }

        delta.progressed = self.saw_delta;
        Ok(delta)
    }

    /// Whether the terminal `data: [DONE]` sentinel has been seen.
    pub fn done(&self) -> bool {
        self.done
    }

    /// The upstream provider the chunks have named so far, if any — read when a stalled stream is
    /// abandoned, so the [timeout](ModelError::Timeout) can say who was serving it.
    pub fn provider(&self) -> Option<&str> {
        self.provider.as_deref()
    }

    /// Take one complete SSE line, appending any assistant text it carried to `delta`.
    ///
    /// A line whose chunk carries a **delta** — content, reasoning or a tool-call fragment — sets
    /// [`saw_delta`](Self::saw_delta), which is the model's own progress as distinct from the
    /// framing around it.
    fn push_line(&mut self, line: &str, delta: &mut Delta) -> Result<(), ModelError> {
        // The event separator, and the keep-alive comment OpenRouter sends while a slow provider
        // is still thinking (`: OPENROUTER PROCESSING`). Both are framing, not content — and
        // neither sets `saw_delta`, which is why a provider can send them forever without ever
        // restarting the run's [stream-idle bound](DEFAULT_MODEL_STREAM_IDLE).
        if line.trim().is_empty() || line.starts_with(':') {
            return Ok(());
        }
        let Some(payload) = line.strip_prefix(SSE_DATA_PREFIX) else {
            // Some other field (`event:`, `id:`, `retry:`) — nothing gg reads.
            return Ok(());
        };
        let payload = payload.trim_start();
        if payload == SSE_DONE {
            self.done = true;
            return Ok(());
        }

        let chunk: WireStreamChunk = serde_json::from_str(payload).map_err(|err| {
            ModelError::Parse(format!("{err}; stream chunk: {}", truncate(payload)))
        })?;

        // A provider error arriving mid-stream, worded exactly as the buffered reply parser words
        // the same object in a `2xx` envelope: one failure, one sentence, whichever shape it came
        // in.
        if let Some(error) = chunk.error {
            return Err(ModelError::Parse(format!(
                "provider returned an error object: {}",
                error.message
            )));
        }
        if let Some(usage) = chunk.usage {
            self.usage = Some(usage);
        }
        if self.provider.is_none() {
            self.provider = chunk.provider.filter(|provider| !provider.is_empty());
        }

        // gg asks for one completion and reads one, exactly as the reply parser takes the first
        // choice. A chunk carrying none is the usage-only trailer.
        let Some(choice) = chunk.choices.into_iter().next() else {
            return Ok(());
        };
        if self.finish_reason.is_none() {
            self.finish_reason = choice.finish_reason;
        }
        // Whether this chunk carries a **delta from the model** is decided before anything is
        // moved out of it: the idle clock's restart is a property of the chunk as it arrived, not
        // of what gg did with its pieces. See [`WireDelta::progressed`] for what counts.
        let progressed = choice.delta.progressed();
        if let Some(content) = choice.delta.content {
            self.text.push_str(&content);
            delta.text.push_str(&content);
        }
        if progressed {
            self.saw_delta = true;
        }
        for fragment in choice.delta.tool_calls {
            let call = self.tool_calls.entry(fragment.index).or_default();
            if let Some(id) = fragment.id {
                call.id = id;
            }
            if let Some(function) = fragment.function {
                if let Some(name) = function.name {
                    call.name = name;
                }
                if let Some(arguments) = function.arguments {
                    call.arguments.push_str(&arguments);
                }
            }
        }
        Ok(())
    }

    /// The assembled response.
    ///
    /// Empty text becomes `None`, each call's concatenated `arguments` string goes through
    /// [`parse_arguments`], a `Stop` with tool calls becomes [`FinishReason::ToolCalls`], and usage
    /// goes through [`map_usage`].
    ///
    /// A stream that produced neither text nor tool calls is an error **only** if it also never
    /// carried a finish reason. A model that legitimately answers with nothing at all has given
    /// a reply, whose text is `None`; a stream that ended without saying anything, on the other
    /// hand, was cut off, and reporting that as an empty reply would hand
    /// the turn loop a silence the model never produced.
    pub fn finish(mut self) -> Result<ModelResponse, ModelError> {
        let has_calls = !self.tool_calls.is_empty();
        if self.text.is_empty() && !has_calls && self.finish_reason.is_none() {
            return Err(ModelError::Parse(
                "the stream ended without a reply or a finish reason".to_string(),
            ));
        }

        let mut tool_calls = Vec::with_capacity(self.tool_calls.len());
        for (index, call) in std::mem::take(&mut self.tool_calls) {
            let arguments = parse_arguments(&call.arguments).map_err(|err| {
                ModelError::Parse(format!(
                    "tool call #{index} ({}) had unparseable arguments: {err}",
                    call.name
                ))
            })?;
            tool_calls.push(ToolCall {
                id: call.id,
                name: call.name,
                arguments,
            });
        }

        let mut finish_reason = map_finish_reason(self.finish_reason.as_deref());
        // The same normalization the [reference parser](parse_response) applies, for the same
        // reason: a provider that omitted `finish_reason` but asked for tools still stopped to
        // call them.
        if finish_reason == FinishReason::Stop && has_calls {
            finish_reason = FinishReason::ToolCalls;
        }

        let text = (!self.text.is_empty()).then(|| std::mem::take(&mut self.text));
        let (usage, cost, wire, reconciled) = map_usage(
            self.usage.as_ref(),
            reply_size(text.as_deref(), &tool_calls),
        );

        Ok(ModelResponse {
            text,
            tool_calls,
            finish_reason,
            usage,
            cost,
            provider: self.provider,
            // The transport fills this in: the accumulator assembles one attempt and has no idea
            // how many earlier ones were thrown away.
            loop_aborts: LoopAborts::none(),
            usage_wire: wire,
            usage_reconciled: reconciled,
        })
    }
}

/// The reply's own estimated size in tokens: the floor [`map_usage`] bounds the recorded output
/// split by.
///
/// Measured with the default [`BpeTokenEstimator`] over the assistant message the reply becomes,
/// which is the estimate gg's context accounting charges that message. `None` for a reply with
/// neither text nor tool calls, which leaves the provider's split as reported.
fn reply_size(text: Option<&str>, tool_calls: &[ToolCall]) -> Option<u64> {
    if text.is_none() && tool_calls.is_empty() {
        return None;
    }
    let reply = Message::assistant(text.map(str::to_string), tool_calls.to_vec());
    Some(BpeTokenEstimator::new().estimate_message(&reply) as u64)
}

// ---------------------------------------------------------------------------
// Streamed wire types
// ---------------------------------------------------------------------------

/// One `chat.completion.chunk` object, as it arrives on a `data:` line.
#[derive(Debug, Deserialize)]
struct WireStreamChunk {
    #[serde(default)]
    choices: Vec<WireStreamChoice>,
    /// Present only on the final chunk, and only because the request asked for
    /// `stream_options.include_usage` — see [`build_request_body`].
    #[serde(default)]
    usage: Option<WireUsage>,
    /// A provider error delivered as a chunk rather than as a status.
    #[serde(default)]
    error: Option<WireError>,
    /// OpenRouter's name for the upstream provider, which it stamps on every chunk.
    #[serde(default)]
    provider: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WireStreamChoice {
    #[serde(default)]
    delta: WireDelta,
    #[serde(default)]
    finish_reason: Option<String>,
}

/// The incremental part of a choice. Every field is optional: a chunk carries whichever of them
/// changed, and the usage-only trailer carries none.
#[derive(Debug, Default, Deserialize)]
struct WireDelta {
    #[serde(default)]
    content: Option<String>,
    /// The model's own reasoning, which providers that expose thinking stream as it is produced.
    /// Read only as progress — it restarts the run's
    /// [stream-idle bound](DEFAULT_MODEL_STREAM_IDLE) — and deliberately not assembled into the
    /// reply, since it is the model's working rather than its answer.
    ///
    /// Two spellings, because the providers do not agree: OpenAI-compatible reasoning models
    /// write `reasoning`, and DeepSeek's family writes `reasoning_content`. Either one is the
    /// model thinking out loud; accepting both is what keeps a reasoning model from being read as
    /// a stalled stream by the providers that expose its thinking.
    #[serde(default)]
    reasoning: Option<String>,
    /// DeepSeek's spelling of [`reasoning`](Self::reasoning).
    #[serde(default)]
    reasoning_content: Option<String>,
    #[serde(default)]
    tool_calls: Vec<WireDeltaToolCall>,
}

impl WireDelta {
    /// Whether this chunk carries a delta from the model — content, reasoning, or a fragment of a
    /// tool call.
    ///
    /// This is what the run's [stream-idle bound](DEFAULT_MODEL_STREAM_IDLE) is measured against:
    /// a model that reasons at length emits reasoning deltas for the whole of that time, and a
    /// provider that has stopped emits nothing but the keep-alive comments OpenRouter uses, which
    /// never reach this predicate at all. An **empty** `content: ""`, an empty `reasoning: ""`
    /// and a fragment that names an `index` and nothing else are deliberately *not* progress:
    /// some providers send those on bookkeeping chunks, and a reader that counted them would let
    /// a stalled stream restart its clock forever.
    fn progressed(&self) -> bool {
        self.content.as_deref().is_some_and(|c| !c.is_empty())
            || self.reasoning.as_deref().is_some_and(|c| !c.is_empty())
            || self
                .reasoning_content
                .as_deref()
                .is_some_and(|c| !c.is_empty())
            || self
                .tool_calls
                .iter()
                .any(WireDeltaToolCall::carries_a_delta)
    }
}

/// A slice of one tool call. `index` is the only field guaranteed on every fragment — it is what
/// says which call this is part of.
#[derive(Debug, Deserialize)]
struct WireDeltaToolCall {
    #[serde(default)]
    index: u64,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    function: Option<WireDeltaFunction>,
}

impl WireDeltaToolCall {
    /// Whether this fragment carries a piece of the call — its id, its name, or a slice of its
    /// arguments — rather than the `{"index": 0}` form some providers send on a bookkeeping chunk.
    ///
    /// The distinction is what the run's [stream-idle bound](DEFAULT_MODEL_STREAM_IDLE) turns on:
    /// a fragment of a tool call is the model working, and a chunk that names an index and
    /// nothing else is framing that must leave the clock running.
    fn carries_a_delta(&self) -> bool {
        let named =
            |value: &Option<String>| value.as_deref().is_some_and(|value| !value.is_empty());
        named(&self.id)
            || self
                .function
                .as_ref()
                .is_some_and(|function| named(&function.name) || named(&function.arguments))
    }
}

#[derive(Debug, Deserialize)]
struct WireDeltaFunction {
    #[serde(default)]
    name: Option<String>,
    /// A **fragment** of the arguments JSON string, not the whole of it. Concatenated across
    /// chunks; parsed once, at the end.
    #[serde(default)]
    arguments: Option<String>,
}

// ---------------------------------------------------------------------------
// Mock client
// ---------------------------------------------------------------------------

/// A scripted, offline [`ModelClient`] for CI and local iteration.
///
/// It replays a fixed list of [`ModelResponse`]s, advancing one per
/// [`complete`](ModelClient::complete) call and **ignoring its inputs**. Once the
/// script is exhausted it returns a terminal [`FinishReason::Stop`] message so any
/// loop driving it always terminates.
pub struct MockClient {
    model_id: String,
    script: Vec<ModelResponse>,
    cursor: AtomicUsize,
    /// Whether this mock replays the [default script](Self::with_default_script), whose board turns
    /// must not run again inside an agent the board itself dispatched. See
    /// [`complete`](ModelClient::complete).
    default_script: bool,
    /// The tool names offered on the most recent [`complete`](ModelClient::complete) call.
    ///
    /// Recorded because *what a run offers* is as much a behaviour as what it does with the answer:
    /// a reviewer that is handed a `finish` it must not call, or a judge handed a reviewer's
    /// verdicts, is a bug no assertion about the returned ending would catch.
    offered_tools: Mutex<Vec<String>>,
}

impl MockClient {
    /// A mock bound to `model_id` that replays `script` in order.
    pub fn new(model_id: impl Into<String>, script: Vec<ModelResponse>) -> Self {
        Self {
            model_id: model_id.into(),
            script,
            cursor: AtomicUsize::new(0),
            default_script: false,
            offered_tools: Mutex::new(Vec::new()),
        }
    }

    /// How many turns this mock has actually been asked for — the script cursor, read live.
    ///
    /// Test-only, like [`component_bound_operations`](crate::sandbox) and for the same reason: no part of
    /// a run asks a client how many times it has been called, and a production affordance nothing
    /// produces is a claim about the design that is not true.
    ///
    /// It exists so a test can prove a loop **stopped** rather than merely recorded that it should
    /// have. A run that ends on an execution ceiling is otherwise indistinguishable, from telemetry
    /// alone, from one that carried on and reported the ceiling afterwards: both emit the breach.
    /// The number of times the model was called is the direct evidence, and this is the only place
    /// it exists.
    ///
    /// It counts scripted turns only. The off-script answers the message-driven mocks give (a
    /// reviewer's verdict) deliberately never touch the cursor, so those
    /// clients report zero — which is correct: they took no turn *of the script* they were built
    /// from.
    #[cfg(test)]
    pub fn turns_taken(&self) -> usize {
        self.cursor.load(Ordering::SeqCst)
    }

    /// The tool names offered on the most recent [`complete`](ModelClient::complete) call.
    ///
    /// Test-only for the same reason [`turns_taken`](Self::turns_taken) is: nothing in a run asks a
    /// client what it was offered.
    #[cfg(test)]
    pub fn last_tool_names(&self) -> Vec<String> {
        self.offered_tools.lock().expect("offered tools").clone()
    }

    /// The default script exercising every Phase 1 capability offline:
    ///
    /// 1. `read_skill` loads the [`DEFAULT_MOCK_SKILL`] guide (the skills capability's
    ///    pinned, compaction-retained read + its `SkillsState`);
    /// 2. `write_memory` records a [`DEFAULT_MOCK_MEMORY`] note (the memories capability's
    ///    bounded, model-curated, pinned memory + its `MemoryState`);
    /// 3. `add_task` adds the [`DEFAULT_MOCK_TASK_SCAFFOLD`] task;
    /// 4. `add_task` adds the [`DEFAULT_MOCK_TASK_MOVEMENT`] task **blocked by** the scaffold
    ///    task (the demonstrated blocked-by edge);
    /// 5. `set_blocked_by` tries to *also* block the scaffold task on the movement task — a
    ///    **cycle**, which gg refuses (the tool result comes back `ok: false`), demonstrating
    ///    the DAG's acyclicity guard;
    /// 6. `complete_task` marks the scaffold task done (so the movement task becomes ready);
    /// 7. `create_epic` opens the epic prefixed [`DEFAULT_MOCK_EPIC`] (the project-management
    ///    capability's grouping);
    /// 8. `create_issue` adds the [`DEFAULT_MOCK_ISSUE_RENDER`] issue (structured scope +
    ///    completion criteria), grouped under the epic;
    /// 9. `create_issue` adds the [`DEFAULT_MOCK_ISSUE_INPUT`] issue **blocked by** the render
    ///    issue (the demonstrated board blocked-by edge);
    /// 10. `set_issue_blocked_by` tries to *also* block the render issue on the input issue — a
    ///     **cycle**, which gg refuses (the tool result comes back `ok: false`), demonstrating the
    ///     board DAG's acyclicity guard;
    /// 11. `write_file` creates a minimal playable `index.html` (a tiny HTML5 canvas game);
    /// 12. a final tool-free turn reports completion and stops.
    ///
    /// This drives the whole loop + tools + telemetry deterministically with no key.
    ///
    /// The `read_skill`, `write_memory`, task, and board calls are harmless when the run offers
    /// the matching capability off — each simply comes back as an unknown/unavailable tool error
    /// and the script proceeds — so a workspace without a seeded `.gg/skills/`, or a run with
    /// memories, tasks, or the board switched off, still runs the remaining turns unchanged.
    pub fn with_default_script(model_id: impl Into<String>) -> Self {
        let read_skill_call = ModelResponse {
            text: Some("Reading the getting-started skill before building.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_read_skill".to_string(),
                name: "read_skill".to_string(),
                arguments: json!({ "name": DEFAULT_MOCK_SKILL }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts {
                uncached_input: Some(900),
                cached_input: None,
                output: Some(40),
                reasoning: None,
            },
            cost: Some(Cost {
                comparable: Some(0.0011),
                actual: Some(0.0011),
            }),
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        let write_memory_call = ModelResponse {
            text: Some("Noting the game plan as a memory before building.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_write_memory".to_string(),
                name: "write_memory".to_string(),
                arguments: json!({
                    "name": DEFAULT_MOCK_MEMORY,
                    "description": "The plan for the game I am building.",
                    "body": "Build a single-file HTML5 canvas game in index.html: an arrow-key \
                             player that must reach a goal. Keep it minimal and playable.",
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts {
                uncached_input: Some(1000),
                cached_input: None,
                output: Some(50),
                reasoning: None,
            },
            cost: Some(Cost {
                comparable: Some(0.0015),
                actual: Some(0.0015),
            }),
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        let add_scaffold_task = ModelResponse {
            text: Some("Planning the work: first, scaffold the page.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_add_scaffold".to_string(),
                name: "add_task".to_string(),
                arguments: json!({
                    "id": DEFAULT_MOCK_TASK_SCAFFOLD,
                    "title": "Scaffold index.html with a canvas and game loop",
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts {
                uncached_input: Some(1050),
                cached_input: None,
                output: Some(30),
                reasoning: None,
            },
            cost: Some(Cost {
                comparable: Some(0.0012),
                actual: Some(0.0012),
            }),
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        let add_movement_task = ModelResponse {
            text: Some("Then player movement, which is blocked by the scaffold.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_add_movement".to_string(),
                name: "add_task".to_string(),
                arguments: json!({
                    "id": DEFAULT_MOCK_TASK_MOVEMENT,
                    "title": "Add arrow-key player movement",
                    "blockedBy": [DEFAULT_MOCK_TASK_SCAFFOLD],
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts {
                uncached_input: Some(1080),
                cached_input: None,
                output: Some(30),
                reasoning: None,
            },
            cost: Some(Cost {
                comparable: Some(0.0012),
                actual: Some(0.0012),
            }),
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        // An intentionally cyclic edge: the movement task is already blocked by the scaffold
        // task, so also blocking the scaffold task on the movement task closes a loop. gg
        // refuses it (the result comes back `ok: false`), demonstrating the cycle guard.
        let cyclic_edge = ModelResponse {
            text: Some("Attempting to also block the scaffold on movement.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_cyclic_edge".to_string(),
                name: "set_blocked_by".to_string(),
                arguments: json!({
                    "id": DEFAULT_MOCK_TASK_SCAFFOLD,
                    "blockedBy": [DEFAULT_MOCK_TASK_MOVEMENT],
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts {
                uncached_input: Some(1100),
                cached_input: None,
                output: Some(30),
                reasoning: None,
            },
            cost: Some(Cost {
                comparable: Some(0.0012),
                actual: Some(0.0012),
            }),
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        let complete_scaffold_task = ModelResponse {
            text: Some("Scaffolding done — marking it complete to unblock movement.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_complete_scaffold".to_string(),
                name: "complete_task".to_string(),
                arguments: json!({ "id": DEFAULT_MOCK_TASK_SCAFFOLD }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts {
                uncached_input: Some(1120),
                cached_input: None,
                output: Some(30),
                reasoning: None,
            },
            cost: Some(Cost {
                comparable: Some(0.0012),
                actual: Some(0.0012),
            }),
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        let create_epic = ModelResponse {
            text: Some("Decomposing the build: opening an epic for the core loop.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_create_epic".to_string(),
                name: "create_epic".to_string(),
                arguments: json!({
                    "prefix": DEFAULT_MOCK_EPIC,
                    "title": "Core game loop",
                    "description": "Everything needed to render and drive the playable loop.",
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts {
                uncached_input: Some(1140),
                cached_input: None,
                output: Some(35),
                reasoning: None,
            },
            cost: Some(Cost {
                comparable: Some(0.0013),
                actual: Some(0.0013),
            }),
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        let create_render_issue = ModelResponse {
            text: Some("First issue: the render loop, with an explicit scope.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_create_render".to_string(),
                name: "create_issue".to_string(),
                arguments: json!({
                    "title": "Render loop on the canvas",
                    "inScope": "Clear the canvas each frame and draw the player and goal.",
                    "outOfScope": "Input handling and win detection (separate issues).",
                    "completionCriteria": "The player and goal are visible and redraw at ~60fps.",
                    "epicId": DEFAULT_MOCK_EPIC,
                    "agent": ROOT_PROFILE_ID,
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts {
                uncached_input: Some(1160),
                cached_input: None,
                output: Some(45),
                reasoning: None,
            },
            cost: Some(Cost {
                comparable: Some(0.0016),
                actual: Some(0.0016),
            }),
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        let create_input_issue = ModelResponse {
            text: Some("Second issue: input handling, blocked by the render loop.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_create_input".to_string(),
                name: "create_issue".to_string(),
                arguments: json!({
                    "title": "Arrow-key input handling",
                    "inScope": "Read arrow keys and move the player within the canvas bounds.",
                    "outOfScope": "Rendering (the render-loop issue owns drawing).",
                    "completionCriteria": "Arrow keys move the player smoothly without leaving the canvas.",
                    "blockedBy": [DEFAULT_MOCK_ISSUE_RENDER],
                    "epicId": DEFAULT_MOCK_EPIC,
                    "agent": ROOT_PROFILE_ID,
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts {
                uncached_input: Some(1180),
                cached_input: None,
                output: Some(45),
                reasoning: None,
            },
            cost: Some(Cost {
                comparable: Some(0.0016),
                actual: Some(0.0016),
            }),
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        // An intentionally cyclic edge: the input issue is already blocked by the render issue,
        // so also blocking the render issue on the input issue closes a loop. gg refuses it (the
        // result comes back `ok: false`), demonstrating the board's cycle guard.
        let cyclic_issue_edge = ModelResponse {
            text: Some("Attempting to also block the render issue on input.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_cyclic_issue".to_string(),
                name: "set_issue_blocked_by".to_string(),
                arguments: json!({
                    "id": DEFAULT_MOCK_ISSUE_RENDER,
                    "blockedBy": [DEFAULT_MOCK_ISSUE_INPUT],
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts {
                uncached_input: Some(1200),
                cached_input: None,
                output: Some(30),
                reasoning: None,
            },
            cost: Some(Cost {
                comparable: Some(0.0013),
                actual: Some(0.0013),
            }),
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        let write_call = ModelResponse {
            text: Some("Creating a minimal playable game in index.html.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_write_index".to_string(),
                name: "write_file".to_string(),
                arguments: json!({
                    "path": "index.html",
                    "contents": DEFAULT_GAME_HTML,
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts {
                uncached_input: Some(1200),
                cached_input: None,
                output: Some(180),
                reasoning: None,
            },
            cost: Some(Cost {
                comparable: Some(0.0042),
                actual: Some(0.0042),
            }),
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        let finish = ModelResponse {
            usage: TokenCounts {
                uncached_input: Some(1400),
                cached_input: None,
                output: Some(60),
                reasoning: None,
            },
            cost: Some(Cost {
                comparable: Some(0.0021),
                actual: Some(0.0021),
            }),
            ..done_turn("Done — index.html holds a minimal HTML5 canvas game; open it to play.")
        };
        Self {
            default_script: true,
            ..Self::new(
                model_id,
                vec![
                    read_skill_call,
                    write_memory_call,
                    add_scaffold_task,
                    add_movement_task,
                    cyclic_edge,
                    complete_scaffold_task,
                    create_epic,
                    create_render_issue,
                    create_input_issue,
                    cyclic_issue_edge,
                    write_call,
                    finish,
                ],
            )
        }
    }

    /// A script exercising [agent-managed context](crate::tools) offline end to end:
    ///
    /// 1. `write_file` creates a chunky `level.json` (working material to reclaim);
    /// 2. `read_file` reads it back — a [`FileView`](test_cabinet_core::gg::GgContextSource::FileView)
    ///    enters the window;
    /// 3. `archive_thread { ranges: [[1, 2]] }` moves those two turns out of the live window into
    ///    the searchable archive, naming them by the turn numbers on their results;
    /// 4. `read_file` reads the level back again — the window holds a file view once more;
    /// 5. `evict_file_view { path: "level.json" }` drops that file view, reclaiming its tokens
    ///    (the next context breakdown shows the file-view band fall to zero);
    /// 6. `search_archive { query: "level.json" }` recovers the archived read on demand, proving
    ///    the archived history is still reachable though out of the window;
    /// 7. a final tool-free turn stops.
    ///
    /// Used by the offline agent-managed-context e2e; requires a run with the
    /// [`agent-managed-context`](test_cabinet_core::gg::CAPABILITY_AGENT_MANAGED_CONTEXT) and
    /// filesystem capabilities enabled so every call resolves to a real tool.
    #[cfg(test)]
    pub fn with_agent_managed_context_script(model_id: impl Into<String>) -> Self {
        let usage = |input: u64, output: u64| TokenCounts {
            uncached_input: Some(input),
            cached_input: None,
            output: Some(output),
            reasoning: None,
        };
        let write_level = ModelResponse {
            text: Some("Writing a level file I will inspect.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_write_level".to_string(),
                name: "write_file".to_string(),
                arguments: json!({ "path": "level.json", "contents": AMC_LEVEL_JSON }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(900, 120),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        let read_level = ModelResponse {
            text: Some("Reading level.json to check the layout.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_read_level".to_string(),
                name: "read_file".to_string(),
                arguments: json!({ "path": "level.json" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(950, 40),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        let evict_level = ModelResponse {
            text: Some(
                "I have what I need from level.json; evicting it to reclaim context.".to_string(),
            ),
            tool_calls: vec![ToolCall {
                id: "call_evict_level".to_string(),
                name: "evict_file_view".to_string(),
                arguments: json!({ "path": "level.json" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(1200, 40),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        let reread_level = ModelResponse {
            text: Some("Pulling level.json back up to finish the layout pass.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_reread_level".to_string(),
                name: "read_file".to_string(),
                arguments: json!({ "path": "level.json" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(1100, 40),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        let archive = ModelResponse {
            text: Some("Archiving the earlier thread to keep my window lean.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_archive".to_string(),
                name: "archive_thread".to_string(),
                // The first two turns: the write and the read, whose numbers the model read off
                // the headers on their results.
                arguments: json!({ "ranges": [[1, 2]] }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(700, 30),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        let search = ModelResponse {
            text: Some("Recovering the archived level reference.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_search".to_string(),
                name: "search_archive".to_string(),
                arguments: json!({ "query": "level.json" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(400, 30),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        let finish = ModelResponse {
            usage: usage(500, 40),
            ..done_turn("Done — managed my context along the way.")
        };
        Self::new(
            model_id,
            vec![
                write_level,
                read_level,
                archive,
                reread_level,
                evict_level,
                search,
                finish,
            ],
        )
    }

    /// The **parent** side of the offline [subagents](crate::subagents) e2e: a script that
    /// delegates a piece of work, waits for the result, then finishes.
    ///
    /// 1. `spawn_subagent { prompt, slot: "subagent" }` schedules a child on the `subagent` slot;
    /// 2. `wait_for_subagents {}` blocks (freeing the parent's slot) until every outstanding child
    ///    returns, and receives their return values;
    /// 3. a final tool-free turn stops.
    ///
    /// Pairs with [`with_subagent_child_script`](Self::with_subagent_child_script) (bound to the
    /// `subagent` slot) so an offline run exercises spawn → schedule → run → return under the cap.
    /// Selected in production by a mock `model_id` naming `subagent-parent` (see
    /// [`mock_client_for`]), so the delegation path is drivable offline through the real binary and
    /// not only the in-crate tests.
    pub fn with_subagent_parent_script(model_id: impl Into<String>) -> Self {
        let usage = |input: u64, output: u64| TokenCounts {
            uncached_input: Some(input),
            cached_input: None,
            output: Some(output),
            reasoning: None,
        };
        let spawn = ModelResponse {
            text: Some("Delegating the greeting file to a subagent.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_spawn".to_string(),
                name: "spawn_subagent".to_string(),
                arguments: json!({
                    "prompt": "Create a file with a greeting in it.",
                    "agent": "subagent",
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(900, 40),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        let wait = ModelResponse {
            text: Some("Waiting for the subagent to finish.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_wait".to_string(),
                name: "wait_for_subagents".to_string(),
                arguments: json!({}),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(950, 30),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        let finish = ModelResponse {
            usage: usage(1000, 50),
            ..done_turn("The subagent finished; the game is assembled.")
        };
        Self::new(model_id, vec![spawn, wait, finish])
    }

    /// The **parent** side of the offline
    /// [issue reviews](https://docs.testcabinet.ai/gg/project-management/)
    /// e2e: a **message-driven** mock (its behavior lives in [`complete`](ModelClient::complete),
    /// keyed on an `issue-review-parent` model id) so one model can play all three roles the
    /// [auto-dispatch](https://docs.testcabinet.ai/gg/project-management/) model puts the primary
    /// slot in — since the root, the agent gg auto-dispatches to implement the issue, and each fix
    /// agent the review loop dispatches all resolve the primary slot:
    ///
    /// - **the root**: `create_epic` (prefix [`MOCK_ISSUE_REVIEW_PREFIX`]) + `create_issue`, which gg
    ///   numbers `RVIEW-1` (the call carries the scope
    ///   and completion criteria), then finish — submitting the issue auto-dispatches an agent to
    ///   implement it;
    /// - **the dispatched issue agent** (its brief is the issue's structured fields): do the initial
    ///   work ([`MOCK_REVIEW_WORKER_FILE`]) then finish, which sends the issue to its
    ///   [reviewer](Self::with_review_reviewer_script) — which requests one change;
    /// - **the same agent, re-dispatched** (its brief now carries the requested changes): write the
    ///   review fix marker ([`MOCK_REVIEW_FIX_FILE`]) and finish again, and the re-review
    ///   approves.
    ///
    /// Constructed with an empty script because it never consults one; the role is read from the
    /// brief in the messages (stable across the instance's turns) and the turn from the instance's
    /// own cursor. Selected in production by a mock `model_id` naming `issue-review-parent` (see
    /// [`mock_client_for`]), so the review → fix → approve cycle is drivable **offline through the
    /// real binary**: bind the primary slot to a `mock/…-issue-review-parent` model and a `reviewer`
    /// slot to a `mock/…-review-reviewer` model, with `project-management` enabled and the Root's
    /// roster naming an implementer and a reviewer.
    pub fn with_issue_review_parent_script(model_id: impl Into<String>) -> Self {
        Self::new(model_id, Vec::new())
    }

    /// The **reviewer** side of the offline issue-review e2e: a message-driven verdict (its behavior
    /// lives in [`complete`](ModelClient::complete), keyed on a `review-reviewer` model id, so a
    /// fresh instance per review round reads the diff it is given). Constructed with an empty script
    /// because it never consults one. Documented as a constructor for symmetry with the parent and
    /// worker; production selects it via [`mock_client_for`].
    pub fn with_review_reviewer_script(model_id: impl Into<String>) -> Self {
        Self::new(model_id, Vec::new())
    }

    /// The **worker** side of the offline issue-review e2e: a message-driven two-turn worker (its
    /// behavior lives in [`complete`](ModelClient::complete), keyed on a `review-worker` model id) —
    /// it writes its initial work, or the review fix marker on a fix pass, then finishes. Empty
    /// script for the same reason as the reviewer; production selects it via [`mock_client_for`].
    pub fn with_review_worker_script(model_id: impl Into<String>) -> Self {
        Self::new(model_id, Vec::new())
    }

    /// The **parent** side of the offline [memory scoping](crate::memories::MemoryScope) e2e: a
    /// script that records a memory, delegates, waits, and finishes.
    ///
    /// 1. `write_memory` records [`MOCK_MEMORY_PARENT`] — so the store is non-empty *before* the
    ///    child exists, which is what makes "the child started holding what its spawner held" an
    ///    observable rather than a coincidence;
    /// 2. `spawn_subagent { agent: "subagent" }` schedules the child;
    /// 3. `wait_for_subagents {}` blocks until it returns;
    /// 4. a final tool-free turn stops.
    ///
    /// Pairs with [`with_memory_child_script`](Self::with_memory_child_script) on the `subagent`
    /// slot. Between them the two scripts write one memory each, so what each agent's
    /// [`MemoryState`](test_cabinet_core::gg::GgTelemetryKind::MemoryState) reports is exactly the
    /// question the scope decides. Selected in production by a mock `model_id` naming
    /// `memory-parent` (see [`mock_client_for`]), so a scope is drivable **offline through the real
    /// binary**: bind the primary slot to a `mock/…-memory-parent` model, a `subagent` slot to a
    /// `mock/…-memory-child` one, and give both profiles a scoped `memories` capability.
    pub fn with_memory_parent_script(model_id: impl Into<String>) -> Self {
        let usage = |input: u64, output: u64| TokenCounts {
            uncached_input: Some(input),
            cached_input: None,
            output: Some(output),
            reasoning: None,
        };
        let remember = ModelResponse {
            text: Some("Recording the house style before delegating.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_parent_memory".to_string(),
                name: "write_memory".to_string(),
                arguments: json!({
                    "name": MOCK_MEMORY_PARENT,
                    "description": "how this codebase is written",
                    "body": "Comments explain why, never what.",
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(800, 40),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        let spawn = ModelResponse {
            text: Some("Delegating the investigation.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_spawn".to_string(),
                name: "spawn_subagent".to_string(),
                arguments: json!({
                    "prompt": "Look into the thing and record what you find.",
                    "agent": "subagent",
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(900, 40),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        let wait = ModelResponse {
            text: Some("Waiting for the subagent to finish.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_wait".to_string(),
                name: "wait_for_subagents".to_string(),
                arguments: json!({}),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(950, 30),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        let finish = ModelResponse {
            usage: usage(1000, 50),
            ..done_turn("The subagent reported back.")
        };
        Self::new(model_id, vec![remember, spawn, wait, finish])
    }

    /// The **child** side of the offline [memory scoping](crate::memories::MemoryScope) e2e: a
    /// script that records one memory of its own and finishes.
    ///
    /// Pairs with [`with_memory_parent_script`](Self::with_memory_parent_script). Its
    /// [`MemoryState`](test_cabinet_core::gg::GgTelemetryKind::MemoryState) is the assertion
    /// target: two memories when it inherited its spawner's store, one when it got its own.
    /// Selected in production by a mock `model_id` naming `memory-child` (see
    /// [`mock_client_for`]).
    pub fn with_memory_child_script(model_id: impl Into<String>) -> Self {
        let usage = |input: u64, output: u64| TokenCounts {
            uncached_input: Some(input),
            cached_input: None,
            output: Some(output),
            reasoning: None,
        };
        let remember = ModelResponse {
            text: Some("Recording what I found.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_child_memory".to_string(),
                name: "write_memory".to_string(),
                arguments: json!({
                    "name": MOCK_MEMORY_CHILD,
                    "description": "what the investigation turned up",
                    "body": "The renderer is the slow part.",
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(500, 30),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        let finish = ModelResponse {
            usage: usage(550, 40),
            ..done_turn(MOCK_SUBAGENT_RETURN)
        };
        Self::new(model_id, vec![remember, finish])
    }

    /// The **entry state** of the offline [FSM](crate::fsm) e2e: a script that builds a task list
    /// and then moves the machine on, handing what it built to the next state.
    ///
    /// 1. `add_task` twice — the state it produces, and the thing a transferring transition has to
    ///    carry across intact;
    /// 2. `transition_state` to `build`, with a note for the successor.
    ///
    /// It never calls `finish`: the machine ends in its terminal state, not here. Selected in
    /// production by a mock `model_id` naming `fsm-explore` (see [`mock_client_for`]), so a machine
    /// is drivable **offline through the real binary**: declare a shell profile with a `states`
    /// table and bind its states to `mock/…-fsm-explore`, `…-fsm-build` and `…-fsm-verify`.
    pub fn with_fsm_explore_script(model_id: impl Into<String>) -> Self {
        let usage = |input: u64, output: u64| TokenCounts {
            uncached_input: Some(input),
            cached_input: None,
            output: Some(output),
            reasoning: None,
        };
        let plan = |call: &str, id: &str, title: &str, tokens: u64| ModelResponse {
            text: Some(format!("Planning: {title}.")),
            tool_calls: vec![ToolCall {
                id: call.to_string(),
                name: "add_task".to_string(),
                arguments: json!({ "id": id, "title": title }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(tokens, 30),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        let advance = ModelResponse {
            text: Some("The plan is ready; handing it to the builder.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_transition_build".to_string(),
                name: "transition_state".to_string(),
                arguments: json!({
                    "state": "build",
                    "note": MOCK_FSM_HANDOFF_NOTE,
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(900, 40),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        Self::new(
            model_id,
            vec![
                plan("call_task_one", "t1", MOCK_FSM_TASK_ONE, 700),
                plan("call_task_two", "t2", MOCK_FSM_TASK_TWO, 800),
                advance,
            ],
        )
    }

    /// The **middle state** of the offline [FSM](crate::fsm) e2e: a script that first asks for a
    /// state the machine does not let it reach, and then takes the edge it actually has.
    ///
    /// The illegal move is the point of the first turn: a machine's refusal has to be a *tool
    /// result the model can recover from* — the agent stays where it is, is told the targets it may
    /// name, and the run continues — rather than a launch failure or a stopped session. Selected in
    /// production by a mock `model_id` naming `fsm-build` (see [`mock_client_for`]).
    pub fn with_fsm_build_script(model_id: impl Into<String>) -> Self {
        let usage = |input: u64, output: u64| TokenCounts {
            uncached_input: Some(input),
            cached_input: None,
            output: Some(output),
            reasoning: None,
        };
        let illegal = ModelResponse {
            text: Some("Shipping it.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_transition_ship".to_string(),
                name: "transition_state".to_string(),
                arguments: json!({ "state": MOCK_FSM_UNDECLARED_STATE }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(600, 30),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        let advance = ModelResponse {
            text: Some("Handing it to the verifier instead.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_transition_verify".to_string(),
                name: "transition_state".to_string(),
                arguments: json!({ "state": "verify" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(700, 40),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        Self::new(model_id, vec![illegal, advance])
    }

    /// The **terminal state** of the offline [FSM](crate::fsm) e2e: a script that finishes, which is
    /// how a machine ends. Selected in production by a mock `model_id` naming `fsm-verify` (see
    /// [`mock_client_for`]).
    pub fn with_fsm_verify_script(model_id: impl Into<String>) -> Self {
        Self::new(
            model_id,
            vec![ModelResponse {
                usage: TokenCounts {
                    uncached_input: Some(500),
                    cached_input: None,
                    output: Some(40),
                    reasoning: None,
                },
                ..done_turn(MOCK_FSM_RETURN)
            }],
        )
    }

    /// The **predecessor** of the offline `exec` e2e: a script that builds some state and then
    /// becomes a different agent.
    ///
    /// 1. `add_task` — state that only survives if the successor's own profile keeps a task list;
    /// 2. `exec` into `after`, with an opening message for it.
    ///
    /// It never calls `finish`: the session ends in the agent it became, which is the whole point.
    /// Selected in production by a mock `model_id` naming `exec-before` (see [`mock_client_for`]),
    /// so a succession is drivable **offline through the real binary**.
    pub fn with_exec_before_script(model_id: impl Into<String>) -> Self {
        let usage = |input: u64, output: u64| TokenCounts {
            uncached_input: Some(input),
            cached_input: None,
            output: Some(output),
            reasoning: None,
        };
        let plan = ModelResponse {
            text: Some("Writing down what to look at.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_exec_task".to_string(),
                name: "add_task".to_string(),
                arguments: json!({ "id": "t1", "title": MOCK_EXEC_TASK }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(600, 30),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        let succeed = ModelResponse {
            text: Some("This needs the other agent's toolset.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_exec".to_string(),
                name: "exec".to_string(),
                arguments: json!({ "agent": "after", "prompt": MOCK_EXEC_PROMPT }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(700, 40),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        Self::new(model_id, vec![plan, succeed])
    }

    /// The **predecessor** of the offline "compacted handoff" e2e: a script that condenses its own
    /// window and hands off **in the same turn**.
    ///
    /// The pair is the point. Both calls are deferred to the end of the turn — a window may not be
    /// rewritten, nor handed to anybody, between an assistant's tool calls and the results
    /// answering them — and the order they are applied in decides what the successor inherits. The
    /// compaction is what the model paid for; if the handoff were applied first the summary would
    /// be dropped on the floor and the successor would open on the very window its predecessor
    /// thought it had just condensed. Selected in production by a mock `model_id` naming
    /// `exec-compacting`.
    pub fn with_compacting_exec_script(model_id: impl Into<String>) -> Self {
        let usage = |input: u64, output: u64| TokenCounts {
            uncached_input: Some(input),
            cached_input: None,
            output: Some(output),
            reasoning: None,
        };
        let plan = ModelResponse {
            text: Some("Writing down what to look at.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_exec_task".to_string(),
                name: "add_task".to_string(),
                arguments: json!({ "id": "t1", "title": MOCK_EXEC_TASK }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(600, 30),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        let condense_and_succeed = ModelResponse {
            text: Some("Summarizing, then handing over.".to_string()),
            tool_calls: vec![
                ToolCall {
                    id: "call_compact".to_string(),
                    name: "compact".to_string(),
                    arguments: json!({ "summary": MOCK_EXEC_SUMMARY }),
                },
                ToolCall {
                    id: "call_exec".to_string(),
                    name: "exec".to_string(),
                    arguments: json!({ "agent": "after", "prompt": MOCK_EXEC_PROMPT }),
                },
            ],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(700, 40),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        Self::new(model_id, vec![plan, condense_and_succeed])
    }

    /// The **successor** of the offline `exec` e2e: a script that finishes, which is how a
    /// succession ends. Selected in production by a mock `model_id` naming `exec-after` (see
    /// [`mock_client_for`]).
    pub fn with_exec_after_script(model_id: impl Into<String>) -> Self {
        Self::new(
            model_id,
            vec![ModelResponse {
                usage: TokenCounts {
                    uncached_input: Some(500),
                    cached_input: None,
                    output: Some(40),
                    reasoning: None,
                },
                ..done_turn(MOCK_EXEC_RETURN)
            }],
        )
    }

    /// The offline `fork` e2e: a script that builds a little state, forks a copy of itself onto a
    /// second line of work, and finishes.
    ///
    /// 1. `add_task` — the state the copy must open **already holding**, having never written it;
    /// 2. `fork` — the copy, with instructions rather than a briefing;
    /// 3. `finish`.
    ///
    /// A copy runs its forker's own profile, so it replays *this same script*: its `add_task`
    /// duplicates an id it already has and its `fork` is refused at the depth cap, and it then
    /// finishes. That is deliberate — it is the honest shape of forking, and it makes the depth cap
    /// part of what the e2e covers. Selected in production by a mock `model_id` naming `fork` (see
    /// [`mock_client_for`]).
    pub fn with_fork_script(model_id: impl Into<String>) -> Self {
        let usage = |input: u64, output: u64| TokenCounts {
            uncached_input: Some(input),
            cached_input: None,
            output: Some(output),
            reasoning: None,
        };
        let plan = ModelResponse {
            text: Some("Noting what to reproduce.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_fork_task".to_string(),
                name: "add_task".to_string(),
                arguments: json!({ "id": "t1", "title": MOCK_FORK_TASK }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(600, 30),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        let split = ModelResponse {
            text: Some("Trying both fixes at once.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_fork".to_string(),
                name: "fork".to_string(),
                arguments: json!({ "prompt": MOCK_FORK_PROMPT }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(700, 40),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        Self::new(
            model_id,
            vec![
                plan,
                split,
                ModelResponse {
                    usage: usage(800, 40),
                    ..done_turn(MOCK_FORK_RETURN)
                },
            ],
        )
    }

    /// The **child** side of the offline [subagents](crate::subagents) e2e: a script that does a
    /// bit of work then returns a distinctive value.
    ///
    /// 1. `write_file` creates [`MOCK_SUBAGENT_FILE`] in the shared workspace (its "work");
    /// 2. a final tool-free turn stops with [`MOCK_SUBAGENT_RETURN`] as its message — the return
    ///    value its spawner collects.
    ///
    /// Pairs with [`with_subagent_parent_script`](Self::with_subagent_parent_script). Selected in
    /// production by a mock `model_id` naming `subagent-child` (see [`mock_client_for`]).
    pub fn with_subagent_child_script(model_id: impl Into<String>) -> Self {
        let usage = |input: u64, output: u64| TokenCounts {
            uncached_input: Some(input),
            cached_input: None,
            output: Some(output),
            reasoning: None,
        };
        let write = ModelResponse {
            text: Some("Writing the greeting file.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_child_write".to_string(),
                name: "write_file".to_string(),
                arguments: json!({ "path": MOCK_SUBAGENT_FILE, "contents": "hello from the subagent\n" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(500, 30),
            cost: None,
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        };
        let finish = ModelResponse {
            usage: usage(550, 40),
            ..done_turn(MOCK_SUBAGENT_RETURN)
        };
        Self::new(model_id, vec![write, finish])
    }

    /// The **responses-as-code** script: a run driven by emitting a program instead of discrete tool
    /// calls, exercising the code path end to end offline.
    ///
    /// The programs below are **TypeScript**, the one [program
    /// language](test_cabinet_core::gg::GgProgramLanguage) this mock is written against. A second language's offline script would be a second set of programs beside these,
    /// which is what makes the language the axis rather than a fact of the mock.
    ///
    /// 1. a first turn submitting a program — it calls `listDir`, then **loops** over
    ///    a list of names and, for each that ends in `.txt` (a **conditional**), calls `writeFile` —
    ///    which gg prepares for the guest, runs in the wasmtime
    ///    sandbox, and bridges its composed `list_dir`/`write_file` calls to the real toolset (the
    ///    [`MOCK_CODE_LEVEL_FILES`] appear in the workspace, the `.md` name is skipped); the program
    ///    opens a view of the files it wrote;
    /// 2. a second program that calls `finish`, which is the only thing that ends a code-mode
    ///    session — there is no prose turn gg would read as "done", because under this capability
    ///    a turn's work arrives only as a submitted program.
    ///
    /// Selected in production by a mock `model_id` naming `responses-as-code` (see
    /// [`mock_client_for`]), so the code path is drivable offline through the real binary with the
    /// `responses-as-code` capability enabled.
    /// A scripted **responses-as-code** reply: `program` submitted as the `submit_program` tool
    /// call the protocol requires, under the deterministic id `id`, with `usage`/`cost` as given.
    ///
    /// The scripts below build every code-mode turn through this, so a scripted run produces
    /// exactly the wire shape a real provider must: no assistant text, one required call.
    fn code_submission(
        id: &str,
        program: String,
        usage: TokenCounts,
        cost: Option<Cost>,
    ) -> ModelResponse {
        ModelResponse {
            text: None,
            tool_calls: vec![ToolCall {
                id: id.to_string(),
                name: crate::completion::SUBMIT_PROGRAM_TOOL.to_string(),
                arguments: serde_json::json!({ "program": program }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage,
            cost,
            provider: None,
            loop_aborts: LoopAborts::none(),
            usage_wire: None,
            usage_reconciled: false,
        }
    }

    pub fn with_responses_as_code_script(model_id: impl Into<String>) -> Self {
        let usage = |input: u64, output: u64| TokenCounts {
            uncached_input: Some(input),
            cached_input: None,
            output: Some(output),
            reasoning: None,
        };
        // A program with a loop, a conditional, a typed annotation (which only runs because the
        // types are stripped), and several composed tool calls: list the directory, then write a
        // file per `.txt` name, skipping the `.md` one.
        let program = Self::code_submission(
            "mock-code-work",
            format!(
                "import * as gg from \"gg\";\n\
                 const entries = gg.files.listDir(\".\");\n\
                 const names: string[] = [\"{}\", \"{}\", \"notes.md\", \"{}\"];\n\
                 const written: string[] = [];\n\
                 for (const name of names) {{\n\
                 \x20 if (name.endsWith(\".txt\")) {{\n\
                 \x20   gg.files.writeFile(name, \"level data\");\n\
                 \x20   written.push(name);\n\
                 \x20 }}\n\
                 }}\n\
                 console.log(`the workspace held ${{entries.length}} entr(ies) to begin with`);\n\
                 gg.views.openText(\"written\", written.join(\"\\n\"));\n",
                MOCK_CODE_LEVEL_FILES[0], MOCK_CODE_LEVEL_FILES[1], MOCK_CODE_LEVEL_FILES[2],
            ),
            usage(1200, 90),
            Some(Cost {
                comparable: Some(0.002),
                actual: Some(0.002),
            }),
        );
        let finish = Self::code_submission(
            "mock-code-finish",
            "import * as gg from \"gg\";\n\
             gg.session.finish(\"The level files are written; the game scaffold is complete.\");\n"
                .to_string(),
            usage(900, 30),
            None,
        );
        Self::new(model_id, vec![program, finish])
    }

    /// A **responses-as-code** script whose program is a **runaway loop** (`while (true) {}`), so
    /// the execution timeout stops it — proving a sandbox failure surfaces as the turn's outcome
    /// (a `CodeExecution { ok: false }`) and the run continues cleanly rather than crashing.
    ///
    /// 1. a first turn emitting the runaway program (the sandbox times it out);
    /// 2. a second program that calls `finish`, ending the session.
    ///
    /// Pair with a `responses-as-code` capability whose `timeoutSecs` param is set short enough to
    /// trip quickly, so the test costs a fraction of a second rather than the default thirty.
    pub fn with_responses_as_code_runaway_script(model_id: impl Into<String>) -> Self {
        let usage = TokenCounts {
            uncached_input: Some(800),
            cached_input: None,
            output: Some(40),
            reasoning: None,
        };
        let runaway = Self::code_submission(
            "mock-runaway",
            "let x = 0;\nwhile (true) {\n  x += 1;\n}\nconsole.log(String(x));\n".to_string(),
            usage,
            None,
        );
        let finish = Self::code_submission(
            "mock-runaway-finish",
            "import * as gg from \"gg\";\n\
             gg.session.finish(\"I kept the scaffold simple; the game is ready.\");\n"
                .to_string(),
            usage,
            None,
        );
        Self::new(model_id, vec![runaway, finish])
    }

    /// The **responses-as-code parent** side of the code-mode delegation e2e: a TypeScript program
    /// that spawns a subagent and waits for it, proving a program's delegation tool still goes
    /// through the scheduler.
    ///
    /// 1. a first turn emitting a program that calls `agents.spawnSubagent({ prompt, slot })`
    ///    then `agents.waitForSubagents()` (composed in one program) and returns the collected summaries;
    /// 2. a second program that calls `finish`, ending the session.
    ///
    /// Pairs with [`with_responses_as_code_child_script`](Self::with_responses_as_code_child_script)
    /// on the `subagent` slot.
    pub fn with_responses_as_code_parent_script(model_id: impl Into<String>) -> Self {
        let usage = |input: u64, output: u64| TokenCounts {
            uncached_input: Some(input),
            cached_input: None,
            output: Some(output),
            reasoning: None,
        };
        let program = Self::code_submission(
            "mock-parent-work",
            "import * as gg from \"gg\";\n\
             const child = gg.delegation.spawnSubagent({ agent: \"subagent\", prompt: \"Write the greeting file.\" });\n\
             const results = gg.delegation.waitForSubagents([child.id]);\n\
             gg.views.openText(\"summaries\", results.map((r) => r.summary).join(\"\\n\"));\n"
                .to_string(),
            usage(1000, 60),
            None,
        );
        let finish = Self::code_submission(
            "mock-parent-finish",
            "import * as gg from \"gg\";\n\
             gg.session.finish(\"The subagent finished; the greeting is in place.\");\n"
                .to_string(),
            usage(1000, 40),
            None,
        );
        Self::new(model_id, vec![program, finish])
    }

    /// The **responses-as-code child** side of the code-mode delegation e2e: a TypeScript program
    /// that writes [`MOCK_SUBAGENT_FILE`] (its observable work) then returns a distinctive
    /// value.
    ///
    /// 1. a first turn emitting a program that calls `gg.files.writeFile(..)`;
    /// 2. a second program that calls `finish` with [`MOCK_SUBAGENT_RETURN`] — the summary that ends
    ///    its session and is the value its spawner collects.
    pub fn with_responses_as_code_child_script(model_id: impl Into<String>) -> Self {
        let usage = |input: u64, output: u64| TokenCounts {
            uncached_input: Some(input),
            cached_input: None,
            output: Some(output),
            reasoning: None,
        };
        let program = Self::code_submission(
            "mock-child-work",
            format!(
                "import * as gg from \"gg\";\n\
                 gg.files.writeFile(\"{MOCK_SUBAGENT_FILE}\", \"hello from the subagent\\n\");\n"
            ),
            usage(500, 40),
            None,
        );
        let finish = Self::code_submission(
            "mock-child-finish",
            format!(
                "import * as gg from \"gg\";\ngg.session.finish({});\n",
                serde_json::json!(MOCK_SUBAGENT_RETURN)
            ),
            usage(520, 30),
            None,
        );
        Self::new(model_id, vec![program, finish])
    }
}

/// The level files the [responses-as-code script](MockClient::with_responses_as_code_script)'s
/// program writes (one per `.txt` name in its loop) — its observable work in the workspace.
pub const MOCK_CODE_LEVEL_FILES: &[&str] = &["level-1.txt", "level-2.txt", "level-3.txt"];

/// The file the [subagent child script](MockClient::with_subagent_child_script) writes — its
/// observable "work" in the shared workspace.
pub const MOCK_SUBAGENT_FILE: &str = "subagent-greeting.txt";

/// The distinctive final message the [subagent child script](MockClient::with_subagent_child_script)
/// returns, so a test can assert the return value reached the parent (via `AgentReturned`).
pub const MOCK_SUBAGENT_RETURN: &str = "Subagent done: wrote the greeting file.";

/// The agent-profile id the offline issue-review parent names as its issue's reviewer — the
/// `reviewer` roster entry a run driving this mock must declare (bound to a `mock/…-review-reviewer`
/// model).
pub const MOCK_REVIEWER_AGENT: &str = "reviewer";

/// The prefix of the epic the [issue-review parent script](MockClient::with_issue_review_parent_script)
/// creates — and so the stem of the one issue it files, which the board numbers `RVIEW-1`. The id
/// itself is not a constant here because it is **gg's** to assign, not the script's to declare.
pub const MOCK_ISSUE_REVIEW_PREFIX: &str = "RVIEW";

/// The file the issue-review offline **worker** writes on its initial pass (its ordinary "work").
pub const MOCK_REVIEW_WORKER_FILE: &str = "review-work.txt";

/// The file the issue-review offline **fixer** writes to record that the reviewer's requested change
/// was applied — the fixer is the issue's own agent on a re-dispatch. Its presence in the diff flips
/// the reviewer from CHANGES REQUESTED to APPROVED.
pub const MOCK_REVIEW_FIX_FILE: &str = "review-fix.txt";

/// The sentinel content the issue-review offline fixer writes into [`MOCK_REVIEW_FIX_FILE`]; the
/// reviewer approves once it appears in the diff it is given.
pub const MOCK_REVIEW_FIX_SENTINEL: &str = "REVIEW-FIX-APPLIED";

/// The stable marker a re-dispatched issue's brief carries (`build_fix_brief`'s heading), by which
/// the issue-review offline worker tells a fix pass from its initial pass.
const MOCK_REVIEW_FIX_BRIEF_MARKER: &str = "## Requested changes";

/// The heading every auto-dispatched issue agent's brief opens with (`BoardStore::issue_brief`'s
/// `` # Issue `<id>`: … ``), by which the offline issue-review parent mock tells a dispatched issue
/// agent (or a fix agent, which carries this too) from the root that files the issue.
const MOCK_ISSUE_BRIEF_HEADING: &str = "# Issue `";

#[async_trait::async_trait]
impl ModelClient for MockClient {
    async fn complete(
        &self,
        messages: &[Message],
        tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        *self.offered_tools.lock().expect("offered tools") =
            tools.iter().map(|tool| tool.name.clone()).collect();

        // A compaction summary request (recognized by the marker the summarizer embeds in
        // its system prompt) is answered with a deterministic canned summary and does
        // **not** advance the scripted cursor, so the mock's main script stays in step
        // across a compaction boundary.
        if is_summarization_request(messages) {
            return Ok(ModelResponse {
                text: Some(MOCK_COMPACTION_SUMMARY.to_string()),
                tool_calls: Vec::new(),
                finish_reason: FinishReason::Stop,
                usage: TokenCounts::default(),
                cost: None,
                provider: None,
                loop_aborts: LoopAborts::none(),
                usage_wire: None,
                usage_reconciled: false,
            });
        }

        // The one compaction request whose answer is a **tool call** rather than prose (a
        // [handoff compaction](crate::compaction::HandoffCompactor)). Answered with the same canned
        // summary in the shape that strategy reads, and — like the prose one — off-script, so a
        // handoff arm of a sweep crosses its boundaries offline without desyncing.
        if is_compact_call_request(messages) {
            return Ok(ModelResponse {
                text: None,
                tool_calls: vec![ToolCall {
                    id: "call_compact".to_string(),
                    name: crate::tools::COMPACT_TOOL.to_string(),
                    arguments: json!({ "summary": MOCK_COMPACTION_SUMMARY, "files": [] }),
                }],
                finish_reason: FinishReason::ToolCalls,
                usage: TokenCounts::default(),
                cost: None,
                provider: None,
                loop_aborts: LoopAborts::none(),
                usage_wire: None,
                usage_reconciled: false,
            });
        }

        // An agent the **board dispatched**, built from the default script: it reports the issue's
        // work done and stops, instead of replaying the script's board-authoring turns.
        //
        // This is not a convenience. Issue ids are gg's to assign, so re-running `create_epic` /
        // `create_issue` inside a dispatched agent no longer collides with what the root filed — it
        // files a *fresh* epic and two fresh issues, each of which dispatches another agent that
        // files another copy. A script whose whole point is to demonstrate the board offline must not
        // be the thing that recurses through it.
        if self.default_script && messages_contain(messages, MOCK_ISSUE_BRIEF_HEADING) {
            return Ok(done_turn(
                "The work described in the issue's brief is complete.",
            ));
        }

        // An issue-review **parent** (offline e2e): message-driven so one `issue-review-parent` model
        // plays all three roles the auto-dispatch model routes to the primary slot — the root that
        // files the issue, the agent gg auto-dispatches to implement it, and that same agent when a
        // review sends it back. The role is read from the brief in the messages (stable across the
        // instance's turns); the turn is the instance's own cursor. A fresh instance per agent means
        // each starts from turn zero. Checked before the scripted cursor, like the reviewer/worker.
        if self.model_id.contains("issue-review-parent") {
            // A re-dispatched agent's brief carries the requested-changes marker *and* the issue
            // heading, so test it first; a first dispatch carries only the issue heading; the root's
            // brief carries neither.
            let turn = self.cursor.fetch_add(1, Ordering::SeqCst);
            let response = if messages_contain(messages, MOCK_REVIEW_FIX_BRIEF_MARKER) {
                match turn {
                    0 => issue_review_tool_turn(
                        "call_fix",
                        "Applying the requested change.",
                        "write_file",
                        json!({
                            "path": MOCK_REVIEW_FIX_FILE,
                            "contents": format!("{MOCK_REVIEW_FIX_SENTINEL}\n"),
                        }),
                    ),
                    _ => issue_review_stop_turn("The requested fix is applied."),
                }
            } else if messages_contain(messages, MOCK_ISSUE_BRIEF_HEADING) {
                match turn {
                    0 => issue_review_tool_turn(
                        "call_work",
                        "Doing the initial work for the issue.",
                        "write_file",
                        json!({
                            "path": MOCK_REVIEW_WORKER_FILE,
                            "contents": "initial work by the dispatched issue agent\n",
                        }),
                    ),
                    _ => issue_review_stop_turn(
                        "The issue's work is finished and handed back for review.",
                    ),
                }
            } else {
                match turn {
                    0 => issue_review_tool_turn(
                        "call_epic",
                        "Setting up the board.",
                        "create_epic",
                        json!({
                            "prefix": MOCK_ISSUE_REVIEW_PREFIX,
                            "title": "The build",
                            "description": "The work for this session.",
                        }),
                    ),
                    1 => issue_review_tool_turn(
                        "call_issue",
                        "Filing the issue; gg will dispatch an agent to implement it.",
                        "create_issue",
                        json!({
                            "title": "Implement the feature",
                            "inScope": "Write the feature files.",
                            "outOfScope": "Anything unrelated to the feature.",
                            "completionCriteria": "The feature is implemented and the review fix marker is present.",
                            "epicId": MOCK_ISSUE_REVIEW_PREFIX,
                            "agent": ROOT_PROFILE_ID,
                            "reviewers": [MOCK_REVIEWER_AGENT],
                        }),
                    ),
                    _ => issue_review_stop_turn("The board is set up and the issue is enqueued."),
                }
            };
            return Ok(response);
        }

        // An issue-review **reviewer** (offline e2e): its verdict is driven by whether the diff in its
        // brief already shows the fix marker. First review (no marker yet) → CHANGES REQUESTED (ask
        // for the marker); re-review after the fixer wrote it → APPROVED. Stateless: the workspace
        // (via the diff embedded in the messages) carries the state, so a fresh reviewer instance per
        // dispatch behaves correctly. Answered off-script (the script cursor is never touched).
        if self.model_id.contains("review-reviewer") {
            let approved = messages_contain(messages, MOCK_REVIEW_FIX_SENTINEL);
            return Ok(if approved {
                ending_turn(
                    "approve",
                    "The requested change is present; the work meets the criteria.",
                    json!({}),
                )
            } else {
                ending_turn(
                    "request_changes",
                    "The work is missing the required marker.",
                    json!({
                        "items": [format!(
                            "Write `{MOCK_REVIEW_FIX_FILE}` containing `{MOCK_REVIEW_FIX_SENTINEL}` \
                             to record that the review fix was applied."
                        )],
                    }),
                )
            });
        }

        // An issue-review **worker** (offline e2e): on its first turn it writes a file, then finishes.
        // Which file depends on whether this is a fix pass — detected by the fix-brief marker in its
        // messages: an initial dispatch writes ordinary work; a fix dispatch writes the review fix
        // marker the reviewer approves on. It manages its own turn cursor so a fresh instance per
        // dispatch (initial vs fix) starts from turn zero.
        if self.model_id.contains("review-worker") {
            let turn = self.cursor.fetch_add(1, Ordering::SeqCst);
            if turn == 0 {
                let is_fix = messages_contain(messages, MOCK_REVIEW_FIX_BRIEF_MARKER);
                let (path, contents, text) = if is_fix {
                    (
                        MOCK_REVIEW_FIX_FILE,
                        format!("{MOCK_REVIEW_FIX_SENTINEL}\n"),
                        "Applying the requested change.",
                    )
                } else {
                    (
                        MOCK_REVIEW_WORKER_FILE,
                        "initial work by the review worker\n".to_string(),
                        "Doing the initial work for the issue.",
                    )
                };
                return Ok(ModelResponse {
                    text: Some(text.to_string()),
                    tool_calls: vec![ToolCall {
                        id: "call_review_worker".to_string(),
                        name: "write_file".to_string(),
                        arguments: json!({ "path": path, "contents": contents }),
                    }],
                    finish_reason: FinishReason::ToolCalls,
                    usage: TokenCounts::default(),
                    cost: None,
                    provider: None,
                    loop_aborts: LoopAborts::none(),
                    usage_wire: None,
                    usage_reconciled: false,
                });
            }
            return Ok(done_turn("Done with this pass."));
        }

        let index = self.cursor.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .script
            .get(index)
            .cloned()
            .unwrap_or_else(|| done_turn("(mock script exhausted)")))
    }

    fn model_id(&self) -> &str {
        &self.model_id
    }
}

/// A model turn that ends the agent's session by calling one of its
/// [ending tools](crate::completion), with `arguments`.
///
/// Every offline script ends its run through one of these three. Prose ends nothing — a reply with
/// no tool call is an error turn — so a mock that answered that way would loop to its ceiling
/// instead of demonstrating the capability it was written for.
fn ending_turn(name: &str, text: &str, arguments: Value) -> ModelResponse {
    ModelResponse {
        text: Some(text.to_string()),
        tool_calls: vec![ToolCall {
            id: format!("call_{name}"),
            name: name.to_string(),
            arguments,
        }],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts::default(),
        cost: None,
        provider: None,
        loop_aborts: LoopAborts::none(),
        usage_wire: None,
        usage_reconciled: false,
    }
}

/// A model turn that finishes with `summary` — what a
/// [standard](crate::ending::EndingRole::Standard) agent ends with.
fn done_turn(summary: &str) -> ModelResponse {
    ending_turn("finish", summary, json!({ "summary": summary }))
}

/// Whether `messages` is a [compaction](crate::compaction) summary request — detected by
/// the [`SUMMARIZATION_MARKER`](crate::compaction::SUMMARIZATION_MARKER) the summarizer
/// embeds in its system prompt. The mock answers these off-script so its scripted turns are
/// never consumed by a summarization call.
fn is_summarization_request(messages: &[Message]) -> bool {
    carries_marker(messages, crate::compaction::SUMMARIZATION_MARKER)
}

/// Whether `messages` is the one [compaction](crate::compaction) request answered with a
/// [`compact`](crate::tools::COMPACT_TOOL) **call** — detected by the
/// [`COMPACT_CALL_MARKER`](crate::compaction::COMPACT_CALL_MARKER) the handoff compactor embeds in
/// its system prompt. Answered off-script for the same reason a prose summary request is.
fn is_compact_call_request(messages: &[Message]) -> bool {
    carries_marker(messages, crate::compaction::COMPACT_CALL_MARKER)
}

/// Whether any of `messages` carries `marker` in its content — the shared test behind the two
/// off-script compaction requests, so a third would be one line rather than a fourth copy.
fn carries_marker(messages: &[Message], marker: &str) -> bool {
    messages.iter().any(|message| {
        message
            .content
            .as_deref()
            .is_some_and(|content| content.contains(marker))
    })
}

/// One tool-calling turn for the message-driven
/// [issue-review parent](MockClient::with_issue_review_parent_script)
/// mock: an assistant message plus a single tool call.
fn issue_review_tool_turn(
    call_id: &str,
    text: &str,
    tool: &str,
    arguments: serde_json::Value,
) -> ModelResponse {
    ModelResponse {
        text: Some(text.to_string()),
        tool_calls: vec![ToolCall {
            id: call_id.to_string(),
            name: tool.to_string(),
            arguments,
        }],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts::default(),
        cost: None,
        provider: None,
        loop_aborts: LoopAborts::none(),
        usage_wire: None,
        usage_reconciled: false,
    }
}

/// The ending turn for the message-driven issue-review parent mock.
fn issue_review_stop_turn(text: &str) -> ModelResponse {
    done_turn(text)
}

/// Whether any message's content contains `needle` — how the issue-review offline mocks read the
/// state carried in their brief (the diff, for the reviewer; the fix-brief marker, for the worker)
/// so a fresh mock instance per dispatch still behaves correctly.
fn messages_contain(messages: &[Message], needle: &str) -> bool {
    messages.iter().any(|message| {
        message
            .content
            .as_deref()
            .is_some_and(|c| c.contains(needle))
    })
}

/// The chunky level file the [agent-managed-context script](MockClient::with_agent_managed_context_script)
/// writes then reads, so its file view is worth evicting. Deliberately verbose so the reclaim
/// is visible in the token accounting.
#[cfg(test)]
const AMC_LEVEL_JSON: &str = r#"{
  "name": "level.json",
  "tiles": [
    "XXXXXXXXXXXXXXXXXXXXXXXX", "X....................g.X", "X..XXX...XXXX...XXX....X",
    "X..X..................X", "X..X..p....XXXX...XXX..X", "X..XXX...........XXX...X",
    "X..............XXXX....X", "XXXXXXXXXXXXXXXXXXXXXXXX"
  ],
  "spawns": [ { "x": 4, "y": 4, "kind": "player" }, { "x": 21, "y": 1, "kind": "goal" } ],
  "notes": "Reachable layout; player p spawns bottom-left and must reach the goal g top-right."
}
"#;

/// The minimal playable game the [default mock script](MockClient::with_default_script)
/// writes: a tiny arrow-key canvas game.
const DEFAULT_GAME_HTML: &str = r#"<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>gg mock game</title></head>
<body style="margin:0;background:#111">
<canvas id="c" width="480" height="320" style="display:block;margin:0 auto;background:#222"></canvas>
<script>
const cx = document.getElementById('c').getContext('2d');
const p = { x: 40, y: 160, s: 3 }, goal = { x: 420, y: 160 };
const keys = {};
addEventListener('keydown', e => keys[e.key] = true);
addEventListener('keyup', e => keys[e.key] = false);
function loop() {
  if (keys.ArrowUp) p.y -= p.s;
  if (keys.ArrowDown) p.y += p.s;
  if (keys.ArrowLeft) p.x -= p.s;
  if (keys.ArrowRight) p.x += p.s;
  const win = Math.hypot(p.x - goal.x, p.y - goal.y) < 16;
  cx.clearRect(0, 0, 480, 320);
  cx.fillStyle = '#4caf50'; cx.fillRect(goal.x - 8, goal.y - 8, 16, 16);
  cx.fillStyle = '#03a9f4'; cx.fillRect(p.x - 8, p.y - 8, 16, 16);
  cx.fillStyle = '#fff'; cx.font = '16px sans-serif';
  cx.fillText(win ? 'You win! Reach the goal with the arrow keys.' : 'Reach the green goal.', 12, 24);
  requestAnimationFrame(loop);
}
loop();
</script>
</body>
</html>
"#;

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------

/// Which provider a [`GgSlotBinding`] resolves to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderKind {
    /// The scripted, offline [`MockClient`].
    Mock,
    /// A live [`OpenRouterClient`].
    OpenRouter,
}

impl ProviderKind {
    /// Whether this provider runs without network or credentials.
    pub fn is_offline(self) -> bool {
        matches!(self, ProviderKind::Mock)
    }
}

/// Decide which provider a binding resolves to. `fake_model` is whether the
/// `TCAB_GG_FAKE_MODEL` override is active; passing it in keeps this pure and unit
/// testable. See [module docs](self) for the exact rule.
pub fn resolve_provider_kind(binding: &GgSlotBinding, fake_model: bool) -> ProviderKind {
    if fake_model {
        return ProviderKind::Mock;
    }
    if model_provider_prefix(&binding.model_id).eq_ignore_ascii_case(MOCK_PROVIDER) {
        return ProviderKind::Mock;
    }
    ProviderKind::OpenRouter
}

/// The provider prefix of a model id — the segment before the first `/` or `:`
/// (`"mock/echo"` → `"mock"`, `"anthropic/claude-opus-4-8"` → `"anthropic"`).
fn model_provider_prefix(model_id: &str) -> &str {
    model_id.split(['/', ':']).next().unwrap_or(model_id)
}

/// Whether the `TCAB_GG_FAKE_MODEL` override is set to a non-empty value.
fn fake_model_env() -> bool {
    std::env::var_os(FAKE_MODEL_ENV).is_some_and(|value| !value.is_empty())
}

/// Resolve `binding` to the provider it names (honoring the `TCAB_GG_FAKE_MODEL`
/// override), without constructing a client. The loop uses this to decide whether a
/// resolved client is offline before driving it.
pub fn provider_for(binding: &GgSlotBinding) -> ProviderKind {
    resolve_provider_kind(binding, fake_model_env())
}

/// Build the [`ModelClient`] a slot binds to, per the [selection rule](self). Returns
/// [`ModelError::MissingApiKey`] for a live OpenRouter binding with no credential.
///
/// `routing_key` is the run's [routing key](RoutingKey) a live client stamps on every request (the
/// mock client ignores it). Every agent's client carries the same key — see
/// [`OpenRouterClient::from_binding`]. The binding's
/// [prompt-cache lifetime](GgSlotBinding::prompt_cache_ttl), by contrast, is the *agent's* own
/// choice and differs from one profile to the next.
///
/// `model_call_timeout`, `model_stream_idle` and `retry_policy` are the run's resolved
/// [limits](crate::limits::RunLimits), run-wide like the routing key: every agent's client, and
/// the second client a [handoff compaction](crate::compaction) resolves, calls under the one
/// ceiling, cancels a stream on the one idle bound, and retries on the one schedule the launch
/// recorded.
///
/// `provider` is the OpenRouter provider the launch [pinned](OpenRouterClient::with_provider) the
/// binding's model to; `None` sends no pin.
///
/// `tool_choice` is the run's [record of refused tool-choice pins](ToolChoiceMemory), shared by
/// every client built for the run so a refusal is taken once per model rather than once per
/// client.
pub fn client_for_slot(
    binding: &GgSlotBinding,
    routing_key: &RoutingKey,
    model_call_timeout: Duration,
    model_stream_idle: Duration,
    retry_policy: RetryPolicy,
    provider: Option<&str>,
    tool_choice: &ToolChoiceMemory,
) -> Result<Box<dyn ModelClient>, ModelError> {
    match provider_for(binding) {
        ProviderKind::Mock => Ok(Box::new(mock_client_for(&binding.model_id))),
        ProviderKind::OpenRouter => {
            let mut client = OpenRouterClient::from_binding(binding, routing_key)?
                .with_model_call_timeout(model_call_timeout)
                .with_stream_idle(model_stream_idle)
                .with_retry_policy(retry_policy)
                .with_tool_choice_memory(tool_choice.clone());
            if let Some(provider) = provider {
                client = client.with_provider(provider);
            }
            Ok(Box::new(client))
        }
    }
}

/// Choose the offline [`MockClient`] script a mock `model_id` names.
///
/// Most ids get the [default script](MockClient::with_default_script). The `subagent-*` ids select
/// the paired [parent](MockClient::with_subagent_parent_script) /
/// [child](MockClient::with_subagent_child_script) delegation scripts. A
/// `issue-review-parent` id selects the
/// [issue-review parent](MockClient::with_issue_review_parent_script)
/// (create an issue with a reviewer and dispatch it; the implementer finishing triggers a
/// review → fix → approve cycle);
/// its `review-worker` and `review-reviewer` counterparts are message-driven (their behavior lives
/// in [`MockClient::complete`]). So the full spawn → wait → return path — and its issue-review
/// variant — can be driven **offline through the real binary**
/// (bind the primary slot to a `mock/…-subagent-parent` or `mock/…-issue-review-parent` model and
/// the role slots to the corresponding `mock/…-subagent-child` / `mock/…-review-worker` /
/// `mock/…-review-reviewer` models) and not
/// only the in-crate tests. The child/worker/reviewer scripts never spawn, so there is
/// no runaway recursion. This keys purely on the (offline) `model_id`, matching how
/// [`resolve_provider_kind`] already selects the mock provider by `model_id`.
fn mock_client_for(model_id: &str) -> MockClient {
    if model_id.contains("exec-compacting") {
        MockClient::with_compacting_exec_script(model_id)
    } else if model_id.contains("exec-before") {
        MockClient::with_exec_before_script(model_id)
    } else if model_id.contains("exec-after") {
        MockClient::with_exec_after_script(model_id)
    } else if model_id.contains("fork") {
        MockClient::with_fork_script(model_id)
    } else if model_id.contains("fsm-explore") {
        MockClient::with_fsm_explore_script(model_id)
    } else if model_id.contains("fsm-build") {
        MockClient::with_fsm_build_script(model_id)
    } else if model_id.contains("fsm-verify") {
        MockClient::with_fsm_verify_script(model_id)
    } else if model_id.contains("subagent-child") {
        MockClient::with_subagent_child_script(model_id)
    } else if model_id.contains("issue-review-parent") {
        MockClient::with_issue_review_parent_script(model_id)
    } else if model_id.contains("review-reviewer") {
        MockClient::with_review_reviewer_script(model_id)
    } else if model_id.contains("review-worker") {
        MockClient::with_review_worker_script(model_id)
    } else if model_id.contains("subagent-parent") {
        MockClient::with_subagent_parent_script(model_id)
    } else if model_id.contains("memory-child") {
        MockClient::with_memory_child_script(model_id)
    } else if model_id.contains("memory-parent") {
        MockClient::with_memory_parent_script(model_id)
    } else if model_id.contains("code-child") {
        MockClient::with_responses_as_code_child_script(model_id)
    } else if model_id.contains("code-parent") {
        MockClient::with_responses_as_code_parent_script(model_id)
    } else if model_id.contains("code-runaway") {
        MockClient::with_responses_as_code_runaway_script(model_id)
    } else if model_id.contains("responses-as-code") {
        MockClient::with_responses_as_code_script(model_id)
    } else {
        MockClient::with_default_script(model_id)
    }
}

/// Resolves a [slot binding](GgSlotBinding) to a **fresh** [`ModelClient`] each call — the seam
/// every agent (the root and each spawned subagent) resolves its own client through.
///
/// A subagent runs on its own model, possibly a different, cross-provider [slot](GgSlotBinding)
/// than its parent, and each agent needs its own client instance (the [`MockClient`] carries a
/// per-agent script cursor, and a real client its own connection state), so the factory returns a
/// new client per call rather than a shared one. Production uses [`DefaultClientFactory`]
/// (delegating to [`client_for_slot`]); tests inject a scripted factory so a parent and its
/// subagents can be driven by distinct offline scripts with no network.
pub trait ClientFactory: Send + Sync {
    /// Build a fresh client for `binding`, or a [`ModelError`] when it cannot be resolved (for
    /// example a live binding with no credential).
    ///
    /// The **anonymous** resolution: nothing about it says who is asking. Every one of gg's own
    /// resolutions goes through [`client_for_agent`](Self::client_for_agent) instead; this stays
    /// as the method an implementation writes, and as the answer for a resolution that is not an
    /// agent binding a client at all — the [`fork`](crate::tools::FORK_TOOL) tool re-resolving its
    /// forker's own binding purely to *name* a model in the answer it hands back.
    fn client_for(&self, binding: &GgSlotBinding) -> Result<Box<dyn ModelClient>, ModelError>;

    /// Build a fresh client for `binding` on behalf of `identity` — the resolution gg's turn loop
    /// actually makes.
    ///
    /// The identity is the whole reason this method exists. A scripted factory answers each agent's
    /// calls from *that agent's* script, and it cannot key on the agent id: ids come off a global
    /// counter in the order agents reach their spawn, so two concurrent agents interleave
    /// differently from run to run and an id-keyed lookup would hand agent A the replies written
    /// for agent B. So the caller states the agent's [provenance](AgentIdentity::origin) — which is
    /// a function of the run's own structure rather than of its scheduling — and which of gg's
    /// [two clients](GgClientRole) it is asking for.
    ///
    /// The default ignores it and delegates, which is exactly right for every factory that does
    /// not care who is asking ([`DefaultClientFactory`] and the test suite's scripted ones): the
    /// identity changes *which recorded queue* answers, never *what a live provider does*.
    fn client_for_agent(
        &self,
        binding: &GgSlotBinding,
        identity: &AgentIdentity,
    ) -> Result<Box<dyn ModelClient>, ModelError> {
        let _ = identity;
        self.client_for(binding)
    }
}

/// Who is asking a [`ClientFactory`] for a client, and for which of gg's two clients.
///
/// Not an agent *id*: see [`client_for_agent`](ClientFactory::client_for_agent) for why an id
/// cannot name an agent stably. Every field is a key that follows from the run's own structure —
/// a parent's ordered turn loop, or board state — rather than from its scheduling.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentIdentity {
    /// How the agent came to exist — the same value recorded on its
    /// [session-record row](test_cabinet_core::gg_session_record::GgSessionAgent::origin), so a
    /// live resolution and a recorded one name an agent the same way.
    pub origin: GgSessionAgentOrigin,
    /// Which of gg's two model clients is being resolved. A
    /// [handoff compaction](crate::compaction) resolves a *second* client for the same agent, and
    /// without this the summarizer's calls and the agent's own next turn would answer from one
    /// indistinguishable queue.
    pub role: GgClientRole,
}

impl AgentIdentity {
    /// The agent identified by `origin`, binding the client its own turn loop will call
    /// ([`Agent`](GgClientRole::Agent)).
    pub fn agent(origin: GgSessionAgentOrigin) -> Self {
        Self {
            origin,
            role: GgClientRole::Agent,
        }
    }

    /// The agent identified by `origin`, binding the second client its
    /// [handoff compaction](crate::compaction) summarizes on
    /// ([`Compaction`](GgClientRole::Compaction)).
    pub fn compaction(origin: GgSessionAgentOrigin) -> Self {
        Self {
            origin,
            role: GgClientRole::Compaction,
        }
    }
}

/// The production [`ClientFactory`]: resolves each binding through [`client_for_slot`], honoring
/// the `TCAB_GG_FAKE_MODEL` / `mock` selection rules.
///
/// It carries the run's [routing key](RoutingKey) and stamps it on every live client it builds, so
/// all of a run's agents — the root, every subagent the factory resolves, and the second client a
/// [handoff compaction](crate::compaction) resolves — share one key. That is what lets a subagent
/// reuse the cached opening prefix a sibling already warmed, instead of each agent paying for it
/// uncached.
pub struct DefaultClientFactory {
    routing_key: RoutingKey,
    /// The run's resolved per-call ceiling, stamped on every live client this factory builds.
    model_call_timeout: Duration,
    /// The run's resolved [stream-idle bound](crate::limits::RunLimits::model_stream_idle),
    /// stamped on every live client this factory builds beside the ceiling: how long a stream may
    /// go without a delta from the model before the attempt is cancelled and retried.
    model_stream_idle: Duration,
    /// The run's resolved [retry schedule](crate::limits::RunLimits::retry_policy), stamped on
    /// every live client this factory builds beside the ceiling.
    retry_policy: RetryPolicy,
    /// The pinned OpenRouter provider of each model this run binds, keyed by model id. A
    /// live client is stamped with its model's entry, so every request carries `provider.only`.
    model_providers: BTreeMap<String, String>,
    /// The run's [record of refused tool-choice pins](ToolChoiceMemory), shared by every live
    /// client this factory builds.
    tool_choice: ToolChoiceMemory,
}

impl DefaultClientFactory {
    /// A factory that stamps `routing_key` on every live client it builds.
    ///
    /// `model_call_timeout`, `model_stream_idle` and `retry_policy` are the run's resolved
    /// [limits](crate::limits::RunLimits): the ceiling every call every client it builds makes
    /// runs under, the idle bound a stalled stream is cancelled on, and the schedule each retries
    /// on before giving up.
    pub fn new(
        routing_key: RoutingKey,
        model_call_timeout: Duration,
        model_stream_idle: Duration,
        retry_policy: RetryPolicy,
        model_providers: BTreeMap<String, String>,
    ) -> Self {
        Self {
            routing_key,
            model_call_timeout,
            model_stream_idle,
            retry_policy,
            model_providers,
            tool_choice: ToolChoiceMemory::default(),
        }
    }

    /// The provider the launch pinned `model_id` to, stamped on every live client built for it.
    fn pin_for(&self, model_id: &str) -> Option<&str> {
        self.model_providers.get(model_id).map(String::as_str)
    }
}

impl ClientFactory for DefaultClientFactory {
    fn client_for(&self, binding: &GgSlotBinding) -> Result<Box<dyn ModelClient>, ModelError> {
        client_for_slot(
            binding,
            &self.routing_key,
            self.model_call_timeout,
            self.model_stream_idle,
            self.retry_policy,
            self.pin_for(&binding.model_id),
            &self.tool_choice,
        )
    }
}

#[cfg(test)]
#[path = "client.test.rs"]
mod tests;

#[cfg(test)]
#[path = "client.streaming.test.rs"]
mod streaming_tests;

#[cfg(test)]
#[path = "client.timeout.test.rs"]
mod timeout_tests;

#[cfg(test)]
#[path = "client.retry.test.rs"]
mod retry_tests;

#[cfg(test)]
#[path = "client.pin.test.rs"]
mod pin_tests;

#[cfg(test)]
#[path = "client.routing.test.rs"]
mod routing_tests;

#[cfg(test)]
#[path = "client.tool-choice.test.rs"]
mod tool_choice_tests;
