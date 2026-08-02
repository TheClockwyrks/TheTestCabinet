//! The recorded model seam: what binds a client to a recorded queue, what happens when nothing
//! does, and the staleness check that is the second, independent defence against a mis-binding.
//!
//! The binding tests deliberately give the live resolution an ordinal the record's *ids* do not
//! line up with. That is the whole hazard: subagent ids come off a global counter and a playback
//! removes model latency, so a reconstruction's `agent-3` is the record's `agent-1` about as often
//! as not. A test that bound agents whose ids happened to agree would pass with an id-keyed lookup
//! and prove nothing.

use serde_json::json;
use test_cabinet_core::gg::{GgCapabilitySet, GgSlotBinding};
use test_cabinet_core::gg_replay::{
    GgReplayAgent, GgReplayEntry, GgReplayEntryKind, GgReplayRecord,
};
use test_cabinet_core::metrics::TokenCounts;

use super::*;
use crate::model::FinishReason;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/// A record assembled through the real [interner](GgReplayPools), so a request this factory folds
/// on the live side is folded by exactly the code that folded the recorded one.
#[derive(Default)]
struct Builder {
    pools: GgReplayPools,
    agents: Vec<GgReplayAgent>,
    entries: Vec<GgReplayEntry>,
}

impl Builder {
    /// A row in the record's [provenance table](GgReplayRecord::agents) — the table a live
    /// resolution is matched against.
    fn agent(mut self, agent_id: &str, profile: &str, origin: GgReplayAgentOrigin) -> Self {
        self.agents.push(GgReplayAgent {
            agent_id: agent_id.to_string(),
            profile: profile.to_string(),
            origin,
            terminal_status: None,
            limit_hit: None,
        });
        self
    }

    /// One recorded model turn on `agent`'s queue: the request that was sent, and the reply.
    fn model(mut self, agent: &str, seq: u64, turn: Turn<'_>) -> Self {
        let request = self
            .pools
            .intern_request(turn.role, turn.shape, turn.messages, turn.tools);
        self.entries.push(GgReplayEntry {
            agent_id: agent.to_string(),
            seq,
            kind: GgReplayEntryKind::ModelIo {
                request,
                response: serde_json::to_value(response(turn.text)).unwrap(),
                duration_ms: None,
            },
        });
        self
    }

    /// The common case: an agent's own turn, offering no tools.
    fn turn(self, agent: &str, seq: u64, messages: &[Value], text: &str) -> Self {
        self.model(agent, seq, Turn::new(messages, text))
    }

    /// One recorded turn that **failed**, so the branch the live loop took on it is reconstructed
    /// rather than flattened into a generic error.
    fn model_error(mut self, agent: &str, seq: u64, error: GgReplayModelError) -> Self {
        let request = self.pools.intern_request(
            GgClientRole::Agent,
            GgReplayRequestShape::Complete,
            &[user("hello")],
            None,
        );
        self.entries.push(GgReplayEntry {
            agent_id: agent.to_string(),
            seq,
            kind: GgReplayEntryKind::ModelError {
                request,
                error,
                duration_ms: None,
            },
        });
        self
    }

    fn build(self) -> GgReplayRecord {
        let pools = self.pools.into_parts();
        let mut record = GgReplayRecord::new("run-playback", GgCapabilitySet::minimal("mock/echo"));
        record.agents = self.agents;
        record.messages = pools.messages;
        record.toolsets = pools.toolsets;
        record.texts = pools.texts;
        record.clips = pools.clips;
        record.blobs = pools.blobs;
        record.entries = self.entries;
        record
    }
}

/// One turn as the recorder pinned it — the four things that make a request *this* question, plus
/// the answer that came back.
///
/// A struct rather than five parameters because the two discriminators
/// ([`role`](Self::role) and [`shape`](Self::shape)) are exactly what a mis-served turn gets wrong,
/// and a positional call site that had them adjacent would make swapping them invisible.
struct Turn<'a> {
    /// Which of gg's two clients issued it.
    role: GgClientRole,
    /// Whether the toolset was offered or required.
    shape: GgReplayRequestShape,
    /// The conversation, as the recorder interned it.
    messages: &'a [Value],
    /// The offered toolset, when there was one.
    tools: Option<&'a Value>,
    /// The reply's text.
    text: &'a str,
}

impl<'a> Turn<'a> {
    /// An agent's own, tool-free turn — the shape most of these tests need.
    fn new(messages: &'a [Value], text: &'a str) -> Self {
        Self {
            role: GgClientRole::Agent,
            shape: GgReplayRequestShape::Complete,
            messages,
            tools: None,
            text,
        }
    }

    /// The same, offering `tools`.
    fn offering(mut self, tools: &'a Value) -> Self {
        self.tools = Some(tools);
        self
    }

    /// The same, issued by `role`.
    fn from(mut self, role: GgClientRole) -> Self {
        self.role = role;
        self
    }

    /// The same, made as a **required** tool call.
    fn requiring(mut self) -> Self {
        self.shape = GgReplayRequestShape::CompleteRequiring;
        self
    }
}

fn response(text: &str) -> ModelResponse {
    ModelResponse {
        text: Some(text.to_string()),
        tool_calls: Vec::new(),
        finish_reason: FinishReason::Stop,
        usage: TokenCounts::default(),
        cost: None,
    }
}

/// A `user` message body, as the recorder interned it — the serialization of [`Message::user`].
fn user(content: &str) -> Value {
    serde_json::to_value(Message::user(content)).unwrap()
}

/// A `system` message body, as the recorder interned it.
fn system(content: &str) -> Value {
    serde_json::to_value(Message::system(content)).unwrap()
}

/// A tool definition a live request offers.
fn tool(name: &str) -> ToolDefinition {
    ToolDefinition::new(name, "", json!({ "type": "object" }))
}

/// The recorded toolset the live `tools` slice above interns to.
fn toolset(names: &[&str]) -> Value {
    let tools: Vec<ToolDefinition> = names.iter().map(|name| tool(name)).collect();
    serde_json::to_value(tools).unwrap()
}

fn binding(slot: &str, model_id: &str) -> GgSlotBinding {
    GgSlotBinding::new(slot, model_id)
}

/// A factory over `record`, with the ledger it reports into so a test can read both.
fn factory(
    record: GgReplayRecord,
    strictness: Strictness,
) -> (RecordedClientFactory, Arc<DriftLedger>) {
    // A short stall ceiling, because these tests drive **one** agent's client by hand while the
    // record holds entries for others: the [barrier](ReplayInputs::await_turn) correctly waits for
    // agents nobody is running here, and the default half-minute would be spent on every one of
    // them. Nothing about what is asserted depends on the number.
    let inputs = Arc::new(
        ReplayInputs::new(record)
            .expect("the record indexes")
            .with_stall_timeout(std::time::Duration::from_millis(20)),
    );
    let ledger = Arc::new(DriftLedger::new());
    let bindings = Arc::new(crate::playback::binding::AgentBindings::new(
        Arc::clone(&inputs),
        Arc::clone(&ledger),
    ));
    (
        RecordedClientFactory::new(inputs, bindings, Arc::clone(&ledger), strictness),
        ledger,
    )
}

// ---------------------------------------------------------------------------
// The unbound client
// ---------------------------------------------------------------------------

/// The anonymous resolution yields a client that **names** its model and cannot call one — and it
/// is `Ok`, not `Err`.
///
/// This is the [`fork`](crate::tools::FORK_TOOL) tool's resolution, which re-resolves the forker's
/// own binding purely to name a model in the answer it hands back. An `Err` there would make every
/// fork fail under playback while the recorded success was fed forward, and the parent's
/// reconstructed context would claim a fork that does not exist.
#[tokio::test]
async fn the_anonymous_resolution_names_a_model_and_cannot_call_one() {
    let (factory, ledger) = factory(Builder::default().build(), Strictness::Exact);

    let client = factory
        .client_for(&binding("primary", "anthropic/claude-opus-4-8"))
        .expect("naming a model is not a resolution failure");
    assert_eq!(
        client.model_id(),
        "anthropic/claude-opus-4-8",
        "the fork tool's answer names this",
    );

    let err = client
        .complete(&[Message::user("hi")], &[])
        .await
        .expect_err("no live call is possible under playback");
    assert!(
        matches!(err, ModelError::Playback(_)),
        "a playback error, not a provider one: {err}",
    );
    assert!(
        ledger.drifts().is_empty(),
        "naming a model is not a divergence",
    );
}

// ---------------------------------------------------------------------------
// Binding through the provenance table
// ---------------------------------------------------------------------------

/// A live agent is bound through the record's **provenance table**, not through its id: the two
/// recorded agents carry deliberately different answers, and the spawn origin picks the right one.
#[tokio::test]
async fn an_agent_is_bound_by_provenance_and_not_by_its_id() {
    let spawned = GgReplayAgentOrigin::Spawn {
        parent: "root".to_string(),
        ordinal: 1,
    };
    let record = Builder::default()
        .agent("root", "Root", GgReplayAgentOrigin::Root)
        .agent("agent-0", "Worker", spawned.clone())
        .turn("root", 0, &[user("hello")], "the root's answer")
        .turn("agent-0", 1, &[user("hello")], "the child's answer")
        .build();
    let (factory, ledger) = factory(record, Strictness::Exact);

    // Nothing here mentions `agent-0`. The reconstruction's own counter has long since moved past
    // it — which is exactly the case an id-keyed lookup gets catastrophically wrong.
    let client = factory
        .client_for_agent(
            &binding("worker", "mock/echo"),
            &AgentIdentity::agent(spawned),
        )
        .expect("a bound client");
    let answered = client
        .complete(&[Message::user("hello")], &[])
        .await
        .expect("the recorded turn");

    assert_eq!(
        answered.text.as_deref(),
        Some("the child's answer"),
        "bound to the recorded agent-0's queue, not to whatever shares its live id",
    );
    assert!(ledger.drifts().is_empty(), "{:?}", ledger.drifts());
}

/// A board-dispatched agent — created with no parent, so a parent-keyed scheme could never bind it
/// — is bound by the board state it was dispatched for.
#[tokio::test]
async fn a_board_dispatched_agent_is_bound_by_board_state() {
    let attempt = GgReplayAgentOrigin::IssueAttempt {
        issue: "AUTH-1".to_string(),
        attempt: 2,
    };
    let record = Builder::default()
        .agent("root", "Root", GgReplayAgentOrigin::Root)
        .agent("agent-4", "Worker", attempt.clone())
        .turn("root", 0, &[user("hello")], "the root's answer")
        .turn(
            "agent-4",
            1,
            &[user("hello")],
            "the second attempt's answer",
        )
        .build();
    let (factory, _ledger) = factory(record, Strictness::Exact);

    let client = factory
        .client_for_agent(
            &binding("worker", "mock/echo"),
            &AgentIdentity::agent(attempt),
        )
        .expect("a bound client");
    assert_eq!(
        client
            .complete(&[Message::user("hello")], &[])
            .await
            .expect("the recorded turn")
            .text
            .as_deref(),
        Some("the second attempt's answer"),
    );
}

/// An origin the record's table has no row for yields an **unbound** client — never an `Err`,
/// which the loop would report as a dispatch failure the recorded run never had.
///
/// The *divergence* is reported by the [binding table](super::binding), at the agent's creation,
/// which is the one place that also knows the live id. Deliberately not here as well: a resolution
/// and a creation are the same event twice, and two ledger entries for one agent would make a
/// divergence count depend on how many clients that agent happened to resolve (a handoff compaction
/// resolves a second).
#[tokio::test]
async fn an_origin_the_table_does_not_know_is_unbound_rather_than_an_error() {
    let record = Builder::default()
        .agent("root", "Root", GgReplayAgentOrigin::Root)
        .turn("root", 0, &[user("hello")], "the root's answer")
        .build();
    let (factory, ledger) = factory(record, Strictness::Exact);

    let client = factory
        .client_for_agent(
            &binding("merge", "mock/echo"),
            &AgentIdentity::agent(GgReplayAgentOrigin::Merge {
                issue: "AUTH-1".to_string(),
                ordinal: 0,
            }),
        )
        .expect("an unbindable agent is not a resolution failure");
    assert_eq!(client.model_id(), "mock/echo");
    assert!(
        ledger.drifts().is_empty(),
        "the binding table reports it once, at the agent's creation — not once per resolution: \
         {:?}",
        ledger.drifts(),
    );

    // And the client it got can still name a model, and still cannot call one.
    assert!(matches!(
        client.complete(&[Message::user("hi")], &[]).await,
        Err(ModelError::Playback(_)),
    ));
}

/// A recorded row a live agent already holds is **not handed to a second one**: the later
/// resolution is unbound, and the recorded queue keeps answering only the agent that took it.
///
/// The [binding table](super::binding) has always refused the second binding and said in as many
/// words that "the later one is unbound" — but that was a statement about the *table*, and this
/// seam resolved through the record's static agent list without consulting it. Both live agents got
/// a real client on one queue and interleaved each other's turns: agent A served agent B's
/// responses, which is the single failure the provenance scheme exists to eliminate, reached
/// through the one seam that was not asking.
///
/// The claim is made here, at resolution, rather than at creation, because the two happen in that
/// order: a dispatch resolves the client and only then mints the child's id, so "is this the agent
/// the row is bound to?" has no answer yet and "has anybody taken it?" does.
#[tokio::test]
async fn a_recorded_row_a_live_agent_already_holds_is_not_handed_to_a_second_one() {
    let record = Builder::default()
        .agent("root", "Root", GgReplayAgentOrigin::Root)
        .turn("root", 0, &[user("hello")], "the root's answer")
        .build();
    let (factory, ledger) = factory(record, Strictness::Exact);

    let first = factory
        .client_for_agent(
            &binding("primary", "mock/echo"),
            &AgentIdentity::agent(GgReplayAgentOrigin::Root),
        )
        .expect("a bound client");
    let second = factory
        .client_for_agent(
            &binding("primary", "mock/echo"),
            &AgentIdentity::agent(GgReplayAgentOrigin::Root),
        )
        .expect("a contested row is not a resolution failure either");

    // The second agent cannot call at all — it did not take the row.
    assert!(
        matches!(
            second.complete(&[Message::user("hello")], &[]).await,
            Err(ModelError::Playback(_)),
        ),
        "the later agent draws from nothing rather than from somebody else's queue",
    );
    // And the recorded turn is still there for the agent that did take it, which is the half a
    // naive "unbind them both" would have got wrong.
    assert_eq!(
        first
            .complete(&[Message::user("hello")], &[])
            .await
            .expect("the recorded turn")
            .text
            .as_deref(),
        Some("the root's answer"),
    );
    assert!(
        ledger.drifts().is_empty(),
        "reported once by the table at the second agent's creation, not once per resolution: {:?}",
        ledger.drifts(),
    );
}

/// A [compaction](GgClientRole::Compaction) summarizer is a *second* client for an agent that
/// already holds its row, so it resolves bound — an agent must not be able to contest itself.
#[tokio::test]
async fn the_compaction_client_does_not_contest_its_own_agents_row() {
    let record = Builder::default()
        .agent("root", "Root", GgReplayAgentOrigin::Root)
        .turn("root", 0, &[user("hello")], "the root's answer")
        .build();
    let (factory, _ledger) = factory(record, Strictness::Exact);

    let _agent = factory
        .client_for_agent(
            &binding("primary", "mock/echo"),
            &AgentIdentity::agent(GgReplayAgentOrigin::Root),
        )
        .expect("a bound client");
    let summarizer = factory
        .client_for_agent(
            &binding("primary", "mock/echo"),
            &AgentIdentity::compaction(GgReplayAgentOrigin::Root),
        )
        .expect("a bound client");

    // It draws from the same queue, and the *role* mismatch — not a binding failure — is what the
    // ledger has to say about it. See the test below for that reporting.
    assert_eq!(
        summarizer
            .complete(&[Message::user("hello")], &[])
            .await
            .expect("the recorded turn")
            .text
            .as_deref(),
        Some("the root's answer"),
    );
}

/// The compaction summarizer and the agent's own turn loop are told apart: a recorded call issued
/// by the other client is reported, so one queue serving both is auditable.
#[tokio::test]
async fn a_call_from_the_other_client_is_reported() {
    let record = Builder::default()
        .agent("root", "Root", GgReplayAgentOrigin::Root)
        .turn("root", 0, &[user("hello")], "answered")
        .build();
    let (factory, ledger) = factory(record, Strictness::Exact);

    let client = factory
        .client_for_agent(
            &binding("primary", "mock/echo"),
            // The record's entry was pinned by the `Agent` client; this resolution is the
            // summarizer's.
            &AgentIdentity::compaction(GgReplayAgentOrigin::Root),
        )
        .expect("a bound client");
    client
        .complete(&[Message::user("hello")], &[])
        .await
        .expect("the recorded turn is still served");

    let drifts = ledger.drifts();
    assert!(
        drifts
            .iter()
            .any(|drift| drift.kind == DriftKind::ClientRole),
        "the role discriminator is reported: {drifts:?}",
    );
    assert!(
        drifts.iter().all(|drift| !drift.fatal),
        "reported, not fatal — the fingerprint is the authority on whether the question moved",
    );
}

// ---------------------------------------------------------------------------
// The staleness check
// ---------------------------------------------------------------------------

/// A moved system prompt is fatal under `Exact`, ends the turn on a playback error, and renders the
/// **first differing region** of the two prompts — which is the answer to *"what did I break?"*.
#[tokio::test]
async fn a_moved_system_prompt_is_fatal_under_exact_and_renders_a_diff() {
    let record = Builder::default()
        .agent("root", "Root", GgReplayAgentOrigin::Root)
        .turn(
            "root",
            0,
            &[system("you are gg\nline two\nline three"), user("hello")],
            "answered",
        )
        .build();
    let (factory, ledger) = factory(record, Strictness::Exact);
    let client = factory
        .client_for_agent(
            &binding("primary", "mock/echo"),
            &AgentIdentity::agent(GgReplayAgentOrigin::Root),
        )
        .expect("a bound client");

    let err = client
        .complete(
            &[
                Message::system("you are gg\nline two (edited)\nline three"),
                Message::user("hello"),
            ],
            &[],
        )
        .await
        .expect_err("the recorded response is no longer an answer to this question");
    assert!(matches!(err, ModelError::Playback(_)), "{err}");

    let stopped = ledger.stopped_on().expect("a fatal divergence");
    assert_eq!(
        stopped.kind,
        DriftKind::Fingerprint(GgFingerprintComponent::System),
        "the first component that moved, which is the informative one",
    );
    let diff = stopped.diff.expect("a system drift renders the region");
    assert!(diff.contains("line two"), "the recorded side: {diff}");
    assert!(diff.contains("line two (edited)"), "the live side: {diff}");
}

/// The same prompt edit under `Shape`: reported, the recorded answer is still served, and the loop
/// carries on — which is the whole (and only) reason the relaxation exists.
#[tokio::test]
async fn a_moved_system_prompt_is_served_under_shape() {
    let record = Builder::default()
        .agent("root", "Root", GgReplayAgentOrigin::Root)
        .turn(
            "root",
            0,
            &[system("you are gg"), user("hello")],
            "answered",
        )
        .build();
    let (factory, ledger) = factory(record, Strictness::Shape);
    let client = factory
        .client_for_agent(
            &binding("primary", "mock/echo"),
            &AgentIdentity::agent(GgReplayAgentOrigin::Root),
        )
        .expect("a bound client");

    let answered = client
        .complete(
            &[
                Message::system("you are GG, rewritten"),
                Message::user("hello"),
            ],
            &[],
        )
        .await
        .expect("Shape feeds the recorded answer to a question that moved");
    assert_eq!(answered.text.as_deref(), Some("answered"));

    let drifts = ledger.drifts();
    assert_eq!(
        drifts.len(),
        1,
        "the message count and the toolset did not move: {drifts:?}",
    );
    assert!(!drifts[0].fatal);
    assert!(
        ledger.stopped_on().is_none(),
        "a session that did not happen, but one that finishes",
    );
}

/// A **mis-bound** agent is caught on its very first request, because the profile it is answering
/// for carries a different system prompt and a different toolset. This is the second, independent
/// defence — and it does not depend on the binding table being right.
#[tokio::test]
async fn a_mis_binding_is_caught_on_the_first_request() {
    let attempt = GgReplayAgentOrigin::IssueAttempt {
        issue: "AUTH-1".to_string(),
        attempt: 1,
    };
    let record = Builder::default()
        .agent("root", "Root", GgReplayAgentOrigin::Root)
        .agent("agent-0", "Worker", attempt.clone())
        .model(
            "root",
            0,
            Turn::new(
                &[system("you are the root"), user("build the game")],
                "the root's answer",
            )
            .offering(&toolset(&["write_file", "spawn"])),
        )
        .model(
            "agent-0",
            1,
            Turn::new(
                &[system("you are a worker"), user("do the issue")],
                "the worker's answer",
            )
            .offering(&toolset(&["write_file"])),
        )
        .build();
    let (factory, ledger) = factory(record, Strictness::Exact);

    // The mis-binding, in the shape it actually takes: the *root's* turn, answered from the
    // worker's queue.
    let client = factory
        .client_for_agent(
            &binding("worker", "mock/echo"),
            &AgentIdentity::agent(attempt),
        )
        .expect("a bound client");
    let err = client
        .complete(
            &[
                Message::system("you are the root"),
                Message::user("build the game"),
            ],
            &[tool("write_file"), tool("spawn")],
        )
        .await
        .expect_err("the worker's recorded answer is not an answer to the root's question");
    assert!(matches!(err, ModelError::Playback(_)), "{err}");
    assert!(
        ledger.stopped_on().is_some(),
        "caught on the first request, before a single wrong answer was fed forward",
    );
}

/// A `complete_requiring` call is compared as the **required** shape it is, rather than falling
/// through to the trait default and being compared as an offered one.
#[tokio::test]
async fn a_required_call_is_compared_as_a_required_call() {
    let record = Builder::default()
        .agent("root", "Root", GgReplayAgentOrigin::Root)
        .model(
            "root",
            0,
            Turn::new(&[system("summarize")], "summarized")
                .from(GgClientRole::Compaction)
                .requiring()
                .offering(&toolset(&["handoff"])),
        )
        .build();
    let (factory, ledger) = factory(record, Strictness::Exact);
    let client = factory
        .client_for_agent(
            &binding("primary", "mock/echo"),
            &AgentIdentity::compaction(GgReplayAgentOrigin::Root),
        )
        .expect("a bound client");

    let answered = client
        .complete_requiring(&[Message::system("summarize")], &tool("handoff"))
        .await
        .expect("the recorded summary");
    assert_eq!(answered.text.as_deref(), Some("summarized"));
    assert!(
        ledger.drifts().is_empty(),
        "the role and the shape both matched, so nothing moved: {:?}",
        ledger.drifts(),
    );
}

/// The same call routed through `complete` instead reports the shape it was recorded under — the
/// discriminator exists so *"a required tool call and an offered one are not the same question"*
/// is a finding rather than a silent substitution.
#[tokio::test]
async fn a_call_made_under_the_other_shape_is_reported() {
    let record = Builder::default()
        .agent("root", "Root", GgReplayAgentOrigin::Root)
        .model(
            "root",
            0,
            Turn::new(&[system("summarize")], "summarized")
                .requiring()
                .offering(&toolset(&["handoff"])),
        )
        .build();
    let (factory, ledger) = factory(record, Strictness::None);
    let client = factory
        .client_for_agent(
            &binding("primary", "mock/echo"),
            &AgentIdentity::agent(GgReplayAgentOrigin::Root),
        )
        .expect("a bound client");

    client
        .complete(&[Message::system("summarize")], &[tool("handoff")])
        .await
        .expect("still served");
    assert!(
        ledger
            .drifts()
            .iter()
            .any(|drift| drift.kind == DriftKind::RequestShape),
        "{:?}",
        ledger.drifts(),
    );
}

/// A recorded **failure** is served as a failure, in the variant the loop branches on — a vision
/// refusal in particular, which gg recovers from by denying images and re-running the same turn.
#[tokio::test]
async fn a_recorded_vision_refusal_is_served_as_one() {
    let record = Builder::default()
        .agent("root", "Root", GgReplayAgentOrigin::Root)
        .model_error(
            "root",
            0,
            GgReplayModelError {
                kind: GgReplayModelErrorKind::VisionUnsupported,
                message: "no image input".to_string(),
                status: None,
                attempts: None,
                model_id: Some("mock/blind".to_string()),
            },
        )
        .build();
    let (factory, _ledger) = factory(record, Strictness::Exact);
    let client = factory
        .client_for_agent(
            &binding("primary", "mock/echo"),
            &AgentIdentity::agent(GgReplayAgentOrigin::Root),
        )
        .expect("a bound client");

    let err = client
        .complete(&[Message::user("hello")], &[])
        .await
        .expect_err("the recorded call failed");
    match err {
        ModelError::VisionUnsupported { model_id, message } => {
            assert_eq!(model_id, "mock/blind");
            assert_eq!(message, "no image input");
        }
        other => panic!("the one error gg recovers from must survive the round trip, got {other}"),
    }
}

/// Asking for a turn the record does not have is **fatal** and says why — the shape a run that
/// ended on its wall-clock deadline takes under a playback, which takes seconds.
#[tokio::test]
async fn an_exhausted_queue_is_fatal_and_explains_the_deadline() {
    let record = Builder::default()
        .agent("root", "Root", GgReplayAgentOrigin::Root)
        .turn("root", 0, &[user("hello")], "the only recorded turn")
        .build();
    let (factory, ledger) = factory(record, Strictness::Exact);
    let client = factory
        .client_for_agent(
            &binding("primary", "mock/echo"),
            &AgentIdentity::agent(GgReplayAgentOrigin::Root),
        )
        .expect("a bound client");

    client
        .complete(&[Message::user("hello")], &[])
        .await
        .expect("the one recorded turn");
    let err = client
        .complete(&[Message::user("hello")], &[])
        .await
        .expect_err("there is no second one");
    assert!(matches!(err, ModelError::Playback(_)), "{err}");

    let stopped = ledger.stopped_on().expect("exhaustion is fatal");
    assert_eq!(stopped.kind, DriftKind::RecordExhausted);
    assert!(
        stopped.detail.contains("wall-clock deadline"),
        "the likeliest cause is named rather than left to be guessed: {}",
        stopped.detail,
    );
}
