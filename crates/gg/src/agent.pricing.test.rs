//! The session-end **pricing of the replies [loop detection](crate::loopguard) abandoned**,
//! through the live session frame.
//!
//! A stream gg drops mid-reply never delivers its usage, so the price of its output exists only on
//! the gateway's generation ledger. What these guard is the whole of the pricing pass: that an
//! answered lookup lands in the run's **total** cost and its token counts and never its work cost,
//! that a lookup the ledger never answers leaves the reply unpriced and counted on the summary,
//! and that the lookups run once at session end rather than on the turn.
//!
//! They are separate from `agent.limits.test.rs` (which pins that the *turn's* figures never see
//! abandoned output) because the pass lives in the session frame — above `Agent::drive` — and only
//! [`run_with_factory`] reaches it.

use super::*;

/// A client whose turns are a script, whose abandoned replies and ledger answers are the ones it
/// is handed, and whose every `complete` and generation lookup is pushed onto one log in order —
/// so a test can prove the lookups ran at session end and never on a turn.
struct PricingClient {
    /// The scripted turns.
    turns: MockClient,
    /// The replies loop detection abandoned, as the shared record would carry them.
    abandoned: Vec<AbandonedReply>,
    /// What the generation ledger answers per generation id: `Some` prices the reply, `None` is a
    /// lookup that never answers. A generation id absent from this map is never looked up.
    answers: BTreeMap<String, Option<ReplySpend>>,
    /// Every `complete` and `price` call, in order.
    calls: Mutex<Vec<&'static str>>,
}

impl PricingClient {
    fn new(turns: Vec<ModelResponse>) -> Self {
        Self {
            turns: MockClient::new("mock/primary", turns),
            abandoned: Vec::new(),
            answers: BTreeMap::new(),
            calls: Mutex::new(Vec::new()),
        }
    }

    /// This client reporting `reply` as abandoned by loop detection.
    fn abandoning(mut self, reply: AbandonedReply) -> Self {
        self.abandoned.push(reply);
        self
    }

    /// This client's ledger answering `spend` for `generation_id`.
    fn answering(mut self, generation_id: &str, spend: Option<ReplySpend>) -> Self {
        self.answers.insert(generation_id.to_string(), spend);
        self
    }

    /// The `complete`/`price` log, in order.
    fn calls(&self) -> Vec<&'static str> {
        self.calls
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    fn called(&self, call: &'static str) {
        self.calls
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(call);
    }
}

#[async_trait::async_trait]
impl ModelClient for PricingClient {
    async fn complete(
        &self,
        messages: &[Message],
        tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        self.called("complete");
        self.turns.complete(messages, tools).await
    }

    fn model_id(&self) -> &str {
        self.turns.model_id()
    }

    fn abandoned_replies(&self) -> Vec<AbandonedReply> {
        self.abandoned.clone()
    }

    async fn price_generation(&self, generation_id: &str) -> Option<ReplySpend> {
        self.called("price");
        self.answers.get(generation_id).cloned().flatten()
    }
}

/// A newtype handing out handles to one shared [`PricingClient`], so a test can read its call log
/// after the run — the same shape [`SharedMockClient`] takes.
struct SharedPricingClient(Arc<PricingClient>);

#[async_trait::async_trait]
impl ModelClient for SharedPricingClient {
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

    fn abandoned_replies(&self) -> Vec<AbandonedReply> {
        self.0.abandoned_replies()
    }

    async fn price_generation(&self, generation_id: &str) -> Option<ReplySpend> {
        self.0.price_generation(generation_id).await
    }
}

/// An [abandoned reply](AbandonedReply) record: the size the detector counted, the generation id
/// its price is read back under, and the slot that generated it.
fn abandoned(generation_id: Option<&str>, chars: u64) -> AbandonedReply {
    AbandonedReply {
        generation_id: generation_id.map(str::to_string),
        words: chars / 5,
        chars,
        profile_id: ROOT_PROFILE_ID.to_string(),
        model_id: "mock/primary".to_string(),
    }
}

/// What the generation ledger answers for one abandoned reply — its `total_cost`, its token
/// counts, and who served it, exactly as [`generation_spend`](crate::client) maps a real answer.
fn ledger_answer(cost: f64, output: u64) -> ReplySpend {
    ReplySpend {
        tokens: TokenCounts {
            uncached_input: Some(1_200),
            cached_input: None,
            output: Some(output),
            reasoning: None,
        },
        cost: Some(Cost {
            comparable: Some(cost),
            actual: Some(cost),
        }),
        provider: Some("Z.AI".to_string()),
        wire: Some(json!({ "id": "gen-1", "cancelled": true })),
        reconciled: false,
    }
}

/// One tool-calling turn that does work and costs `dollars` — the turn the run's work cost is
/// made of, so the two figures can be read apart.
fn working_turn(dollars: f64, output: u64) -> ModelResponse {
    let mut response = tool_call_response(
        "call_1",
        "write_file",
        json!({ "path": "notes.md", "contents": "hello" }),
    );
    response.usage = TokenCounts {
        uncached_input: Some(300),
        cached_input: None,
        output: Some(output),
        reasoning: None,
    };
    response.cost = Some(Cost {
        comparable: Some(dollars),
        actual: Some(dollars),
    });
    response
}

/// Drive a whole session on `client` and answer with the summary it recorded and the client's own
/// call log.
async fn run_priced(client: &Arc<PricingClient>) -> (GgSessionSummary, Vec<&'static str>) {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-pricing".to_string()), Box::new(sink.clone()));
    let shared = Arc::clone(client);
    let outcome = run_with_factory(
        &invocation(dir.path(), GgCapabilitySet::minimal("mock/primary")),
        &emitter,
        Arc::new(ScriptedFactory::new().slot(ROOT_PROFILE_ID, move |_| {
            Box::new(SharedPricingClient(Arc::clone(&shared)))
        })),
    )
    .await;
    assert_eq!(outcome, SessionOutcome::Ran);
    let summary = session_summary(&sink.events()).expect("a session summary");
    (summary, client.calls())
}

/// **An abandoned reply's price lands in the run's total cost, and only there.**
///
/// Three replies were abandoned. The generation ledger answered for one (`$0.35` plus its token
/// counts), never answered for a second, and the third streamed no generation id to look up. The
/// answered price is added to the slot's `slotCosts` entry and the run-wide `cost` — the total
/// figure — and its tokens beside them; the work cost is the working turn's alone, since an
/// abandoned reply produced no program and no tool call. The two the ledger never priced are
/// counted on the summary beside the two cost figures, so the recorded total can still be compared
/// against the key's billing.
#[tokio::test]
async fn an_abandoned_replies_price_lands_in_the_run_s_total_cost() {
    let client = Arc::new(
        PricingClient::new(vec![working_turn(0.25, 80), stop_response()])
            .abandoning(abandoned(Some("gen-priced"), 38_900))
            .abandoning(abandoned(Some("gen-unanswered"), 250_000))
            .abandoning(abandoned(None, 12_000))
            .answering("gen-priced", Some(ledger_answer(0.35, 5_000)))
            .answering("gen-unanswered", None),
    );

    let (summary, _) = run_priced(&client).await;

    let total = summary.cost.and_then(|cost| cost.actual).expect("a total");
    assert!(
        (total - 0.60).abs() < 1e-9,
        "the priced reply is in the run's total cost: {total}"
    );
    assert_eq!(
        summary.work_cost.and_then(|cost| cost.actual),
        Some(0.25),
        "the work cost is the working turn's alone"
    );
    assert_eq!(summary.slot_costs.len(), 1);
    let slot_total = summary.slot_costs[0]
        .cost
        .and_then(|cost| cost.actual)
        .expect("the slot's total cost");
    assert!(
        (slot_total - 0.60).abs() < 1e-9,
        "and the slot's own total figure says the same: {slot_total}"
    );
    assert_eq!(
        summary.slot_costs[0].tokens.output,
        Some(80 + 5_000),
        "the priced reply's token counts land beside its price"
    );
    assert_eq!(
        summary.loop_abort_unpriced, 2,
        "the lookup that never answered and the reply with no generation id both stayed unpriced"
    );
    assert_eq!(
        summary.terminal_status, "completed",
        "a lookup that never answered leaves the run's ending as the root left it"
    );
}

/// **The pricing lookups run at session end, never on the turn.**
///
/// One abandoned reply, priced on the first lookup. The client's call log is the evidence: every
/// `complete` precedes the lookup, so a looping model never adds the lookup's delay to its own
/// retry — the delay is paid once, at the end, by nobody's turn.
#[tokio::test]
async fn the_generation_lookups_run_at_session_end_and_never_on_the_turn() {
    let client = Arc::new(
        PricingClient::new(vec![working_turn(0.25, 80), stop_response()])
            .abandoning(abandoned(Some("gen-1"), 38_900))
            .answering("gen-1", Some(ledger_answer(0.35, 5_000))),
    );

    let (summary, calls) = run_priced(&client).await;

    assert_eq!(
        calls,
        vec!["complete", "complete", "price"],
        "the lookup runs once, after the last turn has finished: {calls:?}"
    );
    assert_eq!(
        summary.loop_abort_unpriced, 0,
        "and its answer priced the one abandoned reply"
    );
}
