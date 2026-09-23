//! Tests for the compaction trigger, the policy it is derived from, and the pinned-state-retaining
//! rewrite every strategy converges on.
//!
//! The strategies themselves — how an implementation string resolves to one, what each asks the
//! agent for, and how a handoff transcript is built — are in `compaction.strategies.test.rs`.

use std::sync::Arc;

use serde_json::json;

use super::*;
use crate::client::{MOCK_COMPACTION_SUMMARY, MockClient};
use crate::context::{ContextModel, HeuristicTokenEstimator, Retention};
use crate::model::Message;
use test_cabinet_core::gg::{GgContextSource, GgContextSourceUsage};

/// The token count of one source band in a per-source usage vec (`0` if absent, though gg
/// always emits every band). Keeps the pre/post composition assertions readable.
fn band_tokens(usage: &[GgContextSourceUsage], source: GgContextSource) -> u64 {
    usage
        .iter()
        .find(|u| u.source == source)
        .map(|u| u.tokens)
        .unwrap_or(0)
}

/// A sink that **asserts nothing is reported**: every value read through it is one gg honours
/// exactly as written, so a defect arriving in one fails the test where it is written rather than
/// somewhere downstream.
fn honoured() -> LaunchReport {
    LaunchReport::Discarding
}

/// Everything `read` reports, for the cases whose subject is the refusal.
fn reported(read: impl FnOnce(&mut LaunchReport)) -> Vec<LaunchDefect> {
    let mut report = LaunchReport::collecting();
    read(&mut report);
    report.into_defects()
}

/// A context model measured with the deterministic heuristic estimator and the given window,
/// so fullness in these tests is exact and fast.
fn model(window_limit: u64) -> ContextModel {
    ContextModel::new(
        Arc::new(HeuristicTokenEstimator::new()),
        Some(window_limit),
        false,
    )
}

/// A model client for the summarizer: the scripted mock (which answers a marked
/// summarization request off-script).
fn mock() -> MockClient {
    MockClient::new("mock/x", Vec::new())
}

/// A setup for `strategy` whose trigger is `1 - summary_headroom`, with no handoff client (so an
/// out-of-band condensation runs on whatever client it is handed) and **no retry allowance** —
/// the figure an absent `maxRetries` gives every configuration that does not ask for one.
pub(super) fn setup(
    strategy: CompactionStrategy,
    summary_headroom: f64,
    enabled: bool,
) -> CompactionSetup {
    setup_with_retries(strategy, summary_headroom, enabled, 0)
}

/// [`setup`] with the retry allowance spelled out, for the cases whose subject is what happens to
/// an agent a compaction cannot relieve.
fn setup_with_retries(
    strategy: CompactionStrategy,
    summary_headroom: f64,
    enabled: bool,
    max_retries: u64,
) -> CompactionSetup {
    CompactionSetup {
        enabled,
        policy: CompactionPolicy {
            summary_headroom,
            max_retries,
        },
        strategy,
        summarizer: resolve_summarizer(strategy),
        handoff_client: None,
    }
}

/// The whole out-of-band boundary in one call — the trigger, the condensation and the rewrite —
/// which the loop itself drives as three separate steps. Returns the event, or `None` when the
/// trigger did not fire.
async fn compact_if_needed(
    context: &mut ContextModel,
    client: &dyn ModelClient,
    setup: &CompactionSetup,
    retained: RetainedCounts,
) -> Option<GgTelemetryKind> {
    if CompactionTrigger::default().judge(context, setup) != CompactionVerdict::Compact {
        return None;
    }
    let (request, fallback) = condense_out_of_band(context, client, setup)
        .await
        .expect("the mock serves no other provider");
    Some(apply_compaction(
        context,
        setup,
        retained,
        &request,
        Vec::new(),
        Vec::new(),
        fallback,
    ))
}

// ---------------------------------------------------------------------------
// Trigger policy resolution
// ---------------------------------------------------------------------------

#[test]
fn trigger_fullness_is_derived_from_the_headroom() {
    // The trigger is not a separate knob: it is defined as `1 - summaryHeadroom`.
    assert_eq!(
        CompactionPolicy::resolve(&json!({ "summaryHeadroom": 0.35 }), &mut honoured())
            .trigger_fullness(),
        1.0 - 0.35
    );
    assert_eq!(
        CompactionPolicy::resolve(&json!({ "summaryHeadroom": 0.2 }), &mut honoured())
            .trigger_fullness(),
        1.0 - 0.2
    );
}

#[test]
fn setup_resolves_from_the_capability_set() {
    use test_cabinet_core::gg::{CAPABILITY_COMPACTION, GgCapabilityConfig, GgCapabilitySet};

    // Absent: the setup that says so. Nothing is read, nothing is required, and the two
    // placeholders beside `enabled` are what the loop never looks at.
    let off = CompactionSetup::resolve(GgCapabilitySet::minimal("mock/x").root(), &mut honoured());
    assert!(!off.enabled);
    assert_eq!(off.policy, CompactionPolicy::NO_COMPACTION);
    assert_eq!(off.strategy, CompactionStrategy::NO_COMPACTION);
    assert!(off.summarizer.is_none());

    // Declared and switched off: the same answer. What it carries is the configuration the arm
    // would have used, and the run it configures is a run that does not compact.
    let mut disabled = GgCapabilitySet::minimal("mock/x");
    crate::tools::grant_configured(
        &mut disabled.agents[0],
        GgCapabilityConfig {
            id: CAPABILITY_COMPACTION.to_string(),
            enabled: false,
            implementation: Some("handoff-summarization".to_string()),
            params: json!({ "summaryHeadroom": 0.3 }),
        },
    );
    assert!(!CompactionSetup::resolve(disabled.root(), &mut honoured()).enabled);

    // Present + enabled: enabled, headroom read (and the trigger derived from it).
    let mut set = GgCapabilitySet::minimal("mock/x");
    crate::tools::grant_configured(
        &mut set.agents[0],
        GgCapabilityConfig {
            id: CAPABILITY_COMPACTION.to_string(),
            enabled: true,
            implementation: Some("self-summarization".to_string()),
            params: json!({ "summaryHeadroom": 0.3 }),
        },
    );
    let on = CompactionSetup::resolve(set.root(), &mut honoured());
    assert!(on.enabled);
    assert_eq!(on.policy.summary_headroom, 0.3);
    assert_eq!(on.policy.trigger_fullness(), 1.0 - 0.3);
    assert_eq!(on.strategy, CompactionStrategy::SelfSummarization);
}

/// Every fraction gg can withhold is honoured as written, including the two ends of the range.
#[test]
fn policy_honors_any_headroom_in_range() {
    for (params, expected) in [
        (json!({ "summaryHeadroom": 0.35 }), 0.35),
        // Zero headroom is a legitimate (if reckless) choice — the operator asking for the whole
        // window is honoured, unlike a negative or window-consuming value.
        (json!({ "summaryHeadroom": 0.0 }), 0.0),
        // A whole number is a perfectly ordinary way to write `0`, and JSON has no way to say it
        // is one rather than a float.
        (json!({ "summaryHeadroom": 0 }), 0.0),
        (json!({ "summaryHeadroom": 0.9 }), 0.9),
    ] {
        assert_eq!(
            CompactionPolicy::resolve(&params, &mut honoured()).summary_headroom,
            expected,
            "{params}"
        );
    }
}

/// **An enabled compaction writes its headroom.** The number sets the compaction trigger *and* the
/// window the agent is given for the whole run, so a run gg picked a fraction for would differ from
/// the configured arm in when it compacted and in how much window it ever had — and its record
/// would name a configuration nobody wrote.
#[test]
fn an_absent_summary_headroom_is_refused() {
    for params in [json!({}), json!({ "summaryHeadroom": null })] {
        let defects = reported(|report| {
            assert_eq!(
                CompactionPolicy::resolve(&params, report),
                CompactionPolicy::NO_COMPACTION,
                "the resolver stays total"
            );
        });
        assert_eq!(defects.len(), 1, "{params} -> {defects:?}");
        assert_eq!(defects[0].found, "", "{params}");
        assert!(
            defects[0].locus.ends_with("params.summaryHeadroom"),
            "{}",
            defects[0].locus
        );
    }
}

/// …and it refuses the whole launch, once, at that key's own locus.
#[test]
fn a_compaction_with_no_headroom_refuses_the_launch() {
    use test_cabinet_core::gg::{CAPABILITY_COMPACTION, GgCapabilityConfig, GgCapabilitySet};

    let mut set = GgCapabilitySet::minimal("mock/x");
    crate::tools::grant_configured(
        &mut set.agents[0],
        GgCapabilityConfig {
            id: CAPABILITY_COMPACTION.to_string(),
            enabled: true,
            implementation: Some("self-summarization".to_string()),
            params: json!({}),
        },
    );
    let refusal = crate::validate::refusal(&set).expect_err("the set is refused");
    assert!(refusal.contains("summaryHeadroom"), "{refusal}");
    // Named once, however many readers of the document noticed it: the params sweep and the policy
    // resolver both do.
    assert_eq!(refusal.lines().count(), 1, "{refusal}");
}

/// A **disabled** compaction is owed no headroom — it configures nothing, so there is nothing for
/// it to be short of — but a headroom it does carry is read on exactly the enabled arm's terms, so
/// a typo is heard about now rather than on the launch that flips the switch.
#[test]
fn a_disabled_compaction_requires_no_headroom_and_is_still_read() {
    assert!(reported(|report| CompactionPolicy::check_declared(&json!({}), report)).is_empty());
    assert!(
        reported(|report| CompactionPolicy::check_declared(
            &json!({ "summaryHeadroom": 0.4 }),
            report
        ))
        .is_empty()
    );

    let defects = reported(|report| {
        CompactionPolicy::check_declared(&json!({ "summaryHeadroom": 2 }), report)
    });
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert!(
        defects[0].locus.ends_with("params.summaryHeadroom"),
        "{}",
        defects[0].locus
    );
}

/// A headroom gg cannot honour is **refused**, and the resolver hands back the placeholder rather
/// than a fraction of its own choosing.
#[test]
fn a_summary_headroom_gg_cannot_honour_is_refused() {
    for (params, found) in [
        (json!({ "summaryHeadroom": 0.95 }), "0.95"),
        (json!({ "summaryHeadroom": -0.1 }), "-0.1"),
        (json!({ "summaryHeadroom": "0.35" }), "\"0.35\""),
        (json!({ "summaryHeadroom": true }), "true"),
    ] {
        let defects = reported(|report| {
            assert_eq!(
                CompactionPolicy::resolve(&params, report),
                CompactionPolicy::NO_COMPACTION,
                "the resolver stays total"
            );
        });
        assert_eq!(defects.len(), 1, "{params} -> {defects:?}");
        assert_eq!(defects[0].found, found);
        assert!(
            defects[0].locus.ends_with("params.summaryHeadroom"),
            "{}",
            defects[0].locus
        );
    }
}

/// The working window reserves the headroom, never returns zero, and never exceeds the
/// window it narrows.
#[test]
fn policy_working_window_reserves_the_headroom() {
    let fifth = CompactionPolicy {
        summary_headroom: 0.2,
        max_retries: 0,
    };
    assert_eq!(fifth.working_window(200_000), 160_000);
    // A tiny window still leaves the agent something to fill, rather than a zero
    // denominator that would make every fullness ratio infinite.
    assert_eq!(fifth.working_window(1), 1);
    assert_eq!(
        CompactionPolicy {
            summary_headroom: 0.0,
            max_retries: 0,
        }
        .working_window(200_000),
        200_000
    );
}

/// The window is only reduced when compaction is actually on: an off arm keeps the model's
/// whole window, since there is no summarization call to reserve for — and no headroom is read,
/// which is why an off arm may write none.
#[test]
fn working_window_only_reserves_when_compaction_is_on() {
    use test_cabinet_core::gg::{CAPABILITY_COMPACTION, GgCapabilityConfig, GgCapabilitySet};

    let off = GgCapabilitySet::minimal("mock/x");
    assert_eq!(
        working_window(off.root(), 200_000, &mut honoured()),
        200_000
    );

    let mut on = GgCapabilitySet::minimal("mock/x");
    crate::tools::grant(&mut on.agents[0], CAPABILITY_COMPACTION);
    assert_eq!(working_window(on.root(), 200_000, &mut honoured()), 160_000);

    // A disabled compaction capability that carries params is still an off arm.
    let mut disabled = GgCapabilitySet::minimal("mock/x");
    crate::tools::grant_configured(
        &mut disabled.agents[0],
        GgCapabilityConfig {
            id: CAPABILITY_COMPACTION.to_string(),
            enabled: false,
            implementation: None,
            params: json!({ "summaryHeadroom": 0.5 }),
        },
    );
    assert_eq!(
        working_window(disabled.root(), 200_000, &mut honoured()),
        200_000
    );

    // …and one that carries none: an off arm is short of nothing, so nothing is reported for it
    // here either.
    let mut bare = GgCapabilitySet::minimal("mock/x");
    crate::tools::grant_configured(
        &mut bare.agents[0],
        GgCapabilityConfig {
            id: CAPABILITY_COMPACTION.to_string(),
            enabled: false,
            implementation: None,
            params: json!({}),
        },
    );
    assert_eq!(
        working_window(bare.root(), 200_000, &mut honoured()),
        200_000
    );

    // The headroom param is honored on the enabled arm.
    let mut tuned = GgCapabilitySet::minimal("mock/x");
    crate::tools::grant_configured(
        &mut tuned.agents[0],
        GgCapabilityConfig {
            id: CAPABILITY_COMPACTION.to_string(),
            enabled: true,
            implementation: None,
            params: json!({ "summaryHeadroom": 0.5 }),
        },
    );
    assert_eq!(
        working_window(tuned.root(), 200_000, &mut honoured()),
        100_000
    );
}

/// The headroom is read off the **agent's own** profile, not the run's root.
///
/// Compaction is a per-agent capability, so the fraction that fires a compaction and the window it
/// is measured against have to come from one document. Read off the root instead, a worker
/// compacting at `1 - summaryHeadroom` of a window nothing reduced would reserve none of the room
/// its own summarization call needs — and a worker that compacts not at all would be measured
/// against a window its profile never narrowed.
#[test]
fn working_window_is_read_off_the_agents_own_profile() {
    use test_cabinet_core::gg::{
        CAPABILITY_COMPACTION, GgAgentConfig, GgCapabilityConfig, GgCapabilitySet,
    };

    let compacting = |headroom: f64| GgCapabilityConfig {
        id: CAPABILITY_COMPACTION.to_string(),
        enabled: true,
        implementation: None,
        params: json!({ "summaryHeadroom": headroom }),
    };

    // A root that reserves nothing at all and a worker that reserves a quarter.
    let mut set = GgCapabilitySet::minimal("mock/x");
    let mut worker = GgAgentConfig {
        slug: "worker".to_string(),
        name: "worker".to_string(),
        model_id: "mock/x".to_string(),
        ..GgAgentConfig::root()
    };
    crate::tools::grant_configured(&mut worker, compacting(0.25));
    set.agents.push(worker);

    assert_eq!(
        working_window(set.root(), 200_000, &mut honoured()),
        200_000
    );
    assert_eq!(
        working_window(&set.agents[1], 200_000, &mut honoured()),
        150_000
    );

    // …and the mirror: a root that reserves and a worker that does not compact at all is measured
    // against its model's whole window.
    let mut mirrored = GgCapabilitySet::minimal("mock/x");
    crate::tools::grant_configured(&mut mirrored.agents[0], compacting(0.4));
    mirrored.agents.push(GgAgentConfig {
        slug: "worker".to_string(),
        name: "worker".to_string(),
        model_id: "mock/x".to_string(),
        ..GgAgentConfig::root()
    });
    assert_eq!(
        working_window(mirrored.root(), 200_000, &mut honoured()),
        120_000
    );
    assert_eq!(
        working_window(&mirrored.agents[1], 200_000, &mut honoured()),
        200_000
    );
}

// ---------------------------------------------------------------------------
// The out-of-band summarizers, offline
// ---------------------------------------------------------------------------

/// The prose summarizer is answered offline by the mock's marker path, returning the
/// deterministic canned summary — and **without** consuming a scripted turn, so the mock's main
/// script stays in step across a compaction boundary. It is also what
/// [`resolve_summarizer`] hands back for that strategy, so the wiring is covered with it.
#[tokio::test]
async fn handoff_summarizer_answers_offline_without_consuming_the_script() {
    let client = MockClient::with_default_script("mock/echo");
    let summarizer = resolve_summarizer(CompactionStrategy::HandoffSummarization)
        .expect("a handoff strategy has an out-of-band summarizer");

    let history = vec![
        Message::user("build a game"),
        Message::assistant(Some("working on it".to_string()), Vec::new()),
    ];
    let summary = summarizer
        .summarize(SummaryRequest {
            history: &history,
            client: &client,
        })
        .await
        .expect("the mock serves no other provider");
    assert_eq!(summary.summary, MOCK_COMPACTION_SUMMARY);
    assert!(summary.files.is_empty());

    // The next ordinary (unmarked) turn returns the *first* scripted response — proof the
    // summarization call did not advance the cursor.
    let next = client
        .complete(&[Message::user("go")], &[])
        .await
        .expect("mock completes");
    assert_eq!(
        next.tool_calls.first().map(|c| c.name.as_str()),
        Some("read_skill")
    );
}

/// Only the two handoff strategies condense out of band, so only they resolve a summarizer; the
/// three in-loop ones have none at all, because the agent writes their summary in its own thread.
#[test]
fn only_the_handoff_strategies_resolve_a_summarizer() {
    for handoff in [
        CompactionStrategy::HandoffSummarization,
        CompactionStrategy::HandoffCompaction,
    ] {
        assert!(
            resolve_summarizer(handoff).is_some(),
            "{} condenses out of band",
            handoff.id()
        );
    }
    for in_loop in [
        CompactionStrategy::SelfSummarization,
        CompactionStrategy::SelfCompaction,
        CompactionStrategy::Memory,
    ] {
        assert!(
            resolve_summarizer(in_loop).is_none(),
            "{} is condensed by the agent itself",
            in_loop.id()
        );
    }
}

/// The handoff **compactor** is the one strategy whose out-of-band answer is a tool call, and the
/// mock answers it with one — off-script, like the prose requests, so a handoff-compaction arm of a
/// sweep also runs offline.
#[tokio::test]
async fn handoff_compactor_reads_the_mocks_compact_call() {
    let client = MockClient::with_default_script("mock/echo");
    let request = HandoffCompactor
        .summarize(SummaryRequest {
            history: &[Message::user("build a game")],
            client: &client,
        })
        .await
        .expect("the mock serves no other provider");
    assert_eq!(request.summary, MOCK_COMPACTION_SUMMARY);
    assert!(request.files.is_empty());

    let next = client
        .complete(&[Message::user("go")], &[])
        .await
        .expect("mock completes");
    assert_eq!(
        next.tool_calls.first().map(|c| c.name.as_str()),
        Some("read_skill")
    );
}

// ---------------------------------------------------------------------------
// The trigger: when it does and does not fire
// ---------------------------------------------------------------------------

#[tokio::test]
async fn does_not_compact_when_disabled() {
    let client = mock();
    // A headroom whose derived trigger (0.1) the over-full window easily clears — proving it is
    // `enabled: false`, not the threshold, that blocks the compaction here.
    let setup = setup(CompactionStrategy::HandoffSummarization, 0.9, false);
    let mut ctx = model(10);
    ctx.set_system("a system prompt that easily exceeds the tiny window budget here");
    ctx.push_assistant(Some("lots of ephemeral text ".repeat(4)), Vec::new());
    assert!(ctx.fullness().unwrap() >= 1.0, "the window is over-full");

    let event = compact_if_needed(&mut ctx, &client, &setup, RetainedCounts::default()).await;
    assert!(event.is_none(), "a disabled capability never compacts");
}

#[tokio::test]
async fn does_not_compact_below_the_threshold() {
    let client = mock();
    // Headroom 0.1 → trigger 0.9.
    let setup = setup(CompactionStrategy::HandoffSummarization, 0.1, true);
    let mut ctx = model(100_000);
    ctx.set_system("short");
    ctx.push_assistant(Some("a little work".to_string()), Vec::new());
    assert!(ctx.fullness().unwrap() < 0.9);

    let event = compact_if_needed(&mut ctx, &client, &setup, RetainedCounts::default()).await;
    assert!(event.is_none(), "below the threshold, nothing compacts");
}

#[tokio::test]
async fn does_not_compact_with_no_ephemeral_history() {
    let client = mock();
    // Headroom 0.9 → trigger 0.1.
    let setup = setup(CompactionStrategy::HandoffSummarization, 0.9, true);
    // Over the threshold, but every item is pinned — there is nothing to summarize.
    let mut ctx = model(20);
    ctx.set_system("a pinned system prompt with enough text to cross the low threshold");
    ctx.push_user_prompt("a pinned build prompt");
    assert!(ctx.fullness().unwrap() >= 0.1);
    assert!(!ctx.has_ephemeral());

    let event = compact_if_needed(&mut ctx, &client, &setup, RetainedCounts::default()).await;
    assert!(
        event.is_none(),
        "with no ephemeral history, compaction is a no-op"
    );
}

// ---------------------------------------------------------------------------
// The trigger's memory: a compaction that does not relieve the window
// ---------------------------------------------------------------------------

/// A window over the trigger with ephemeral history to reclaim.
fn stuck_window() -> ContextModel {
    // Headroom 0.5 → trigger 0.5, which this tiny window is far past.
    let mut ctx = model(20);
    ctx.set_system("a pinned system prompt");
    ctx.push_assistant(Some("ephemeral work ".repeat(4)), Vec::new());
    assert!(ctx.fullness().unwrap() >= 0.5);
    ctx
}

/// **A compaction that leaves the window where it found it fails the agent.**
///
/// The default allowance is none, so the boundary after the one that compacted has nothing left to
/// try — and it says so every time it is asked rather than starting the count over, since the loop
/// reads the verdict at a boundary it may reach more than once.
#[test]
fn a_compaction_that_does_not_relieve_the_window_fails_the_agent() {
    let setup = setup(CompactionStrategy::HandoffSummarization, 0.5, true);
    let stuck = stuck_window();
    let mut trigger = CompactionTrigger::default();

    assert_eq!(trigger.judge(&stuck, &setup), CompactionVerdict::Compact);
    assert_eq!(trigger.fired(), 1);
    assert_eq!(trigger.judge(&stuck, &setup), CompactionVerdict::Exhausted);
    assert_eq!(trigger.judge(&stuck, &setup), CompactionVerdict::Exhausted);
}

/// A written `maxRetries` buys exactly that many further attempts — three compactions for an
/// allowance of two — and then the agent fails on the same terms.
#[test]
fn an_armed_allowance_compacts_again_before_it_gives_up() {
    let setup = setup_with_retries(CompactionStrategy::HandoffSummarization, 0.5, true, 2);
    let stuck = stuck_window();
    let mut trigger = CompactionTrigger::default();

    for attempt in 1..=3 {
        assert_eq!(
            trigger.judge(&stuck, &setup),
            CompactionVerdict::Compact,
            "attempt {attempt}"
        );
        assert_eq!(trigger.fired(), attempt);
    }
    assert_eq!(trigger.judge(&stuck, &setup), CompactionVerdict::Exhausted);
}

/// **A compaction that worked clears the count.** Otherwise a long run whose backstop is doing its
/// job would spend its allowance on boundaries that each reclaimed the window honestly, and fail an
/// agent for filling its window up again.
#[test]
fn a_window_back_under_the_trigger_clears_the_count() {
    let setup = setup(CompactionStrategy::HandoffSummarization, 0.5, true);
    let stuck = stuck_window();
    // The window the same boundary leaves behind when the compaction did its job.
    let mut relieved = model(100_000);
    relieved.set_system("a pinned system prompt");
    relieved.push_assistant(Some("the summary".to_string()), Vec::new());
    assert!(relieved.fullness().unwrap() < 0.5);

    let mut trigger = CompactionTrigger::default();
    assert_eq!(trigger.judge(&stuck, &setup), CompactionVerdict::Compact);
    assert_eq!(trigger.judge(&relieved, &setup), CompactionVerdict::Idle);
    assert_eq!(trigger.fired(), 0);
    // So the next time the window fills up honestly, it is a first attempt again.
    assert_eq!(trigger.judge(&stuck, &setup), CompactionVerdict::Compact);
    assert_eq!(trigger.fired(), 1);
}

/// A window over the trigger with **nothing left to reclaim** is read two ways, and the count is
/// what tells them apart.
///
/// Before any compaction it is the opening window itself being too large for the model — a pinned
/// prefix no boundary was ever going to shrink — which is left exactly as it always was. After one,
/// it is a compaction that emptied the history and still could not get under the trigger, which is
/// the dead end the count exists to stop.
#[test]
fn nothing_left_to_reclaim_is_idle_before_a_compaction_and_a_failure_after_one() {
    // Headroom 0.9 → trigger 0.1, which the pinned prefix alone clears.
    let setup = setup(CompactionStrategy::HandoffSummarization, 0.9, true);
    let mut pinned_only = model(20);
    pinned_only.set_system("a pinned system prompt with enough text to cross the low threshold");
    pinned_only.push_user_prompt("a pinned build prompt");
    assert!(pinned_only.fullness().unwrap() >= 0.1);
    assert!(!pinned_only.has_ephemeral());

    let mut untouched = CompactionTrigger::default();
    assert_eq!(
        untouched.judge(&pinned_only, &setup),
        CompactionVerdict::Idle
    );

    let mut spent = CompactionTrigger::default();
    assert_eq!(
        spent.judge(&stuck_window(), &setup),
        CompactionVerdict::Compact
    );
    assert_eq!(
        spent.judge(&pinned_only, &setup),
        CompactionVerdict::Exhausted
    );
}

/// A capability that is **off** is never judged at all, however full the window is — and a boundary
/// that finds it off clears the count, since there is no backstop to have failed.
#[test]
fn a_disabled_compaction_is_always_idle() {
    let off = setup(CompactionStrategy::HandoffSummarization, 0.5, false);
    let mut trigger = CompactionTrigger::default();
    assert_eq!(
        trigger.judge(&stuck_window(), &off),
        CompactionVerdict::Idle
    );
    assert_eq!(trigger.fired(), 0);
}

// ---------------------------------------------------------------------------
// The retry allowance as configuration
// ---------------------------------------------------------------------------

/// **`maxRetries` is optional, and absent is none.** A compaction that reclaimed nothing is a run
/// that is over, so the figure every configuration which does not ask for a retry runs under is
/// zero — and that is the setting rather than a substitution.
#[test]
fn an_absent_max_retries_is_no_retries() {
    for params in [
        json!({ "summaryHeadroom": 0.2 }),
        json!({ "summaryHeadroom": 0.2, "maxRetries": null }),
    ] {
        assert_eq!(
            CompactionPolicy::resolve(&params, &mut honoured()).max_retries,
            0,
            "{params}"
        );
    }
    assert_eq!(
        CompactionPolicy::resolve(
            &json!({ "summaryHeadroom": 0.2, "maxRetries": 3 }),
            &mut honoured()
        )
        .max_retries,
        3
    );
}

/// A `maxRetries` gg cannot read as a count is **refused**, on the enabled arm and on the disabled
/// one alike — the same rule the headroom beside it is read by.
#[test]
fn a_max_retries_gg_cannot_read_is_refused() {
    let defects = reported(|report| {
        CompactionPolicy::resolve(
            &json!({ "summaryHeadroom": 0.2, "maxRetries": "two" }),
            report,
        );
    });
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert!(
        defects[0].locus.ends_with("params.maxRetries"),
        "{}",
        defects[0].locus
    );

    let declared = reported(|report| {
        CompactionPolicy::check_declared(&json!({ "maxRetries": -1 }), report);
    });
    assert_eq!(declared.len(), 1, "{declared:?}");
    assert!(
        declared[0].locus.ends_with("params.maxRetries"),
        "{}",
        declared[0].locus
    );
}

/// The heart of the retention contract: when compaction fires, the pinned prefix — a read
/// skill body, a memory, and the task list — survives **verbatim**, the ephemeral history
/// is replaced by a single summary item, `afterTokens < beforeTokens`, and the reported
/// retained counts are carried through.
#[tokio::test]
async fn compacts_and_retains_pinned_state_verbatim() {
    let client = mock();
    // Headroom 0.5 → trigger 0.5.
    let setup = setup(CompactionStrategy::HandoffSummarization, 0.5, true);

    const SKILL_BODY: &str = "SKILL BODY: scaffold an index.html with a canvas and a loop.";
    const MEMORY_BODY: &str = "MEMORY BODY: the game is an arrow-key maze runner.";
    const TASK_BODY: &str = "TASK BODY: [ ] scaffold; [ ] movement.";

    let mut ctx = model(200);
    // Pinned prefix.
    ctx.set_system("SYSTEM PROMPT");
    ctx.push_user_prompt("USER BUILD PROMPT");
    // A read skill is pinned as the tool result answering its read_skill call.
    ctx.push(
        GgContextSource::Skill,
        Retention::Pinned,
        Message::tool_result("call_skill", SKILL_BODY),
    );
    ctx.push(
        GgContextSource::Memory,
        Retention::Pinned,
        Message::user(MEMORY_BODY),
    );
    ctx.push(
        GgContextSource::TaskList,
        Retention::Pinned,
        Message::user(TASK_BODY),
    );
    // Ephemeral history (the part that gets summarized away).
    ctx.push_assistant(Some("ephemeral chatter ".repeat(10)), Vec::new());
    ctx.push_tool_result(
        GgContextSource::ToolOutput,
        "call_ls",
        "a directory listing ".repeat(10),
    );
    ctx.push_tool_result(
        GgContextSource::FileView,
        "call_read",
        "a file body ".repeat(10),
    );

    assert!(
        ctx.fullness().unwrap() >= 0.5,
        "the window is past the threshold"
    );
    let before = ctx.total_tokens();

    let event = compact_if_needed(
        &mut ctx,
        &client,
        &setup,
        RetainedCounts {
            skills: 1,
            tasks: 2,
            memories: 1,
        },
    )
    .await
    .expect("compaction fired at the threshold");

    // The telemetry: reclaimed window, the retention proof, and the strategy/summary/pre-post
    // composition the console's Compaction view reads.
    match event {
        GgTelemetryKind::Compaction {
            strategy,
            trigger_fullness,
            before_tokens,
            after_tokens,
            summary_tokens,
            retained,
            before_by_source,
            after_by_source,
            summary,
            summary_fallback,
        } => {
            assert_eq!(strategy, "handoff-summarization");
            assert_eq!(trigger_fullness, 0.5);
            assert_eq!(before_tokens, before);
            assert!(after_tokens < before_tokens, "compaction reclaimed window");
            assert!(summary_tokens > 0);
            assert_eq!(retained.skills, 1);
            assert_eq!(retained.tasks, 2);
            assert_eq!(retained.memories, 1);
            // The mock answered the summarization request off-script, so it is a real summary,
            // not the fallback note.
            assert_eq!(summary, MOCK_COMPACTION_SUMMARY);
            assert!(!summary_fallback);
            // The pre/post composition straddles the boundary: the ephemeral bands are present
            // before and collapsed after, while the pinned bands persist. Both carry every band.
            let before_tok = |src| band_tokens(&before_by_source, src);
            let after_tok = |src| band_tokens(&after_by_source, src);
            assert_eq!(before_by_source.len(), GgContextSource::ALL.len());
            assert_eq!(after_by_source.len(), GgContextSource::ALL.len());
            assert!(before_tok(GgContextSource::Assistant) > 0);
            assert!(before_tok(GgContextSource::ToolOutput) > 0);
            assert!(before_tok(GgContextSource::FileView) > 0);
            assert_eq!(after_tok(GgContextSource::Assistant), 0);
            assert_eq!(after_tok(GgContextSource::ToolOutput), 0);
            assert_eq!(after_tok(GgContextSource::FileView), 0);
            // The summary lands in the History band, and the pinned bands survive the boundary
            // (their exact token counts can shift slightly — a dangling tool-role skill message
            // is re-framed to a user message — but the bodies are retained verbatim, asserted
            // below).
            assert!(after_tok(GgContextSource::History) > 0);
            assert!(before_tok(GgContextSource::Skill) > 0);
            assert!(after_tok(GgContextSource::Skill) > 0);
        }
        other => panic!("expected a Compaction event, got {other:?}"),
    }

    // The window now: the pinned bands are unchanged, the ephemeral bands are gone, and a
    // single History (summary) item exists.
    assert!(ctx.total_tokens() < before);
    assert_eq!(ctx.tokens_for(GgContextSource::Assistant), 0);
    assert_eq!(ctx.tokens_for(GgContextSource::ToolOutput), 0);
    assert_eq!(ctx.tokens_for(GgContextSource::FileView), 0);
    assert!(
        ctx.tokens_for(GgContextSource::History) > 0,
        "the summary is present"
    );
    assert!(
        ctx.tokens_for(GgContextSource::Skill) > 0,
        "the skill band survives"
    );
    assert!(ctx.tokens_for(GgContextSource::Memory) > 0);
    assert!(ctx.tokens_for(GgContextSource::TaskList) > 0);

    // The pinned bodies are retained verbatim (byte-identical) in the rendered messages, and
    // no `tool`-role message dangles (the skill was re-framed to a valid standalone message).
    let messages = ctx.messages();
    let contents: Vec<String> = messages.iter().filter_map(|m| m.content.clone()).collect();
    assert!(
        contents.iter().any(|c| c.contains(SKILL_BODY)),
        "the read skill body survives verbatim"
    );
    assert!(contents.iter().any(|c| c == MEMORY_BODY));
    assert!(contents.iter().any(|c| c == TASK_BODY));
    assert!(
        contents.iter().any(|c| c.contains(MOCK_COMPACTION_SUMMARY)),
        "the ephemeral history was replaced by the summary"
    );
    assert!(
        messages.iter().all(|m| m.role != crate::model::Role::Tool),
        "no dangling tool message remains after compaction"
    );
    // The summarized ephemeral content is gone from the live window.
    assert!(!contents.iter().any(|c| c.contains("ephemeral chatter")));
}

// ---------------------------------------------------------------------------
// The rewrite: restored files
// ---------------------------------------------------------------------------

/// A `compact`-tool strategy carries files across the boundary: each named path is seeded back as a
/// fresh, evictable file view **tagged with its path**, and — the reason they are `user` messages —
/// no `tool`-role message is left dangling behind the assistant turn the drop removed.
#[test]
fn restored_files_are_seeded_as_tagged_user_file_views() {
    let setup = setup(CompactionStrategy::SelfCompaction, 0.5, true);
    let mut ctx = model(400);
    ctx.set_system("SYSTEM PROMPT");
    ctx.push_user_prompt("USER BUILD PROMPT");
    ctx.push_assistant(Some("ephemeral chatter ".repeat(10)), Vec::new());

    let event = apply_compaction(
        &mut ctx,
        &setup,
        RetainedCounts::default(),
        &CompactionRequest {
            summary: "the recap".to_string(),
            files: vec!["src/main.ts".to_string()],
        },
        vec![RestoredFile {
            path: "src/main.ts".to_string(),
            body: "FILE BODY: export function main() {}".to_string(),
            images: Vec::new(),
        }],
        Vec::new(),
        false,
    );
    assert!(matches!(event, GgTelemetryKind::Compaction { .. }));

    let messages = ctx.messages();
    let contents: Vec<String> = messages.iter().filter_map(|m| m.content.clone()).collect();
    assert!(
        contents.iter().any(|c| c.contains("FILE BODY")),
        "the re-read file is in the restarted window"
    );
    assert!(
        contents.iter().any(|c| c.contains("the recap")),
        "the summary is in the restarted window"
    );
    assert!(
        messages.iter().all(|m| m.role != crate::model::Role::Tool),
        "a restored file view must not dangle as a tool message"
    );
    // Tagged with its path, so agent-managed context can evict it by name like any other view.
    let reclaimed = ctx.evict_file_views(Some("src/main.ts"));
    assert_eq!(reclaimed.items, 1);
    assert_eq!(reclaimed.paths, vec!["src/main.ts".to_string()]);
}

/// **The documentation an agent had open crosses the boundary, re-derived from its keys.**
///
/// It is the one thing carried across without the model naming it, and the reason is that
/// documentation is neither the agent's material nor the workspace's: it is the description of the
/// surface the agent is working through, and with on-demand lookup as the only route to it, an agent
/// that compacted would come back holding no reference to the API it was in the middle of using.
///
/// The keys are read from the window **before** the reset, exactly as the file paths are, and the
/// bodies are rendered again from *this* agent's own documentation runtime rather than replayed —
/// which is what [`restore_docviews`] is for, and what the second half of this asserts by checking
/// the body against what the runtime says now.
#[test]
fn the_documentation_an_agent_had_open_crosses_the_boundary() {
    let setup = setup(CompactionStrategy::SelfCompaction, 0.5, true);
    let mut ctx = model(400);
    ctx.set_system("SYSTEM PROMPT");
    ctx.push_assistant(Some("ephemeral chatter ".repeat(10)), Vec::new());

    let docs = DocsRuntime::new(
        vec![test_cabinet_core::gg::CAPABILITY_READ_FILE.to_string()],
        crate::ending::EndingRole::Standard,
        &crate::sandbox::capability_operations([test_cabinet_core::gg::CAPABILITY_READ_FILE]),
        test_cabinet_core::gg::GgProgramLanguage::TypeScript,
    );
    ctx.open_docview(
        "readFile".to_string(),
        docs.read("readFile").expect("readFile is bound"),
    );
    ctx.open_docview(
        "FileRead".to_string(),
        docs.read_type("FileRead").expect("FileRead is catalogued"),
    );

    // Read before the rewrite, because the reset is about to empty the band the keys are in.
    let carried = restore_docviews(&ctx, &docs);
    assert_eq!(
        carried.iter().map(|d| d.key.as_str()).collect::<Vec<_>>(),
        vec!["readFile", "FileRead"]
    );

    apply_compaction(
        &mut ctx,
        &setup,
        RetainedCounts::default(),
        &CompactionRequest {
            summary: "the recap".to_string(),
            files: Vec::new(),
        },
        Vec::new(),
        carried,
        false,
    );

    let open = ctx.open_docviews();
    assert_eq!(
        open.iter().map(|d| d.key.as_str()).collect::<Vec<_>>(),
        vec!["readFile", "FileRead"],
        "both are back, in first-open order"
    );
    assert_eq!(
        open[0].body,
        docs.read("readFile").expect("readFile is bound"),
        "and the body is what the runtime renders now, not a stored copy"
    );
    // The summary still lands last, behind the documentation.
    let contents: Vec<String> = ctx
        .messages()
        .iter()
        .filter_map(|m| m.content.clone())
        .collect();
    assert!(
        contents
            .last()
            .is_some_and(|last| last.contains("the recap")),
        "{contents:?}"
    );
}

/// The summary is the **last** thing in the restarted window, after any restored files: it is the
/// note that tells the model where to continue, and a model reads the end of its context as the
/// most recent thing said to it.
#[test]
fn the_summary_is_the_last_item_in_the_restarted_window() {
    let setup = setup(CompactionStrategy::SelfCompaction, 0.5, true);
    let mut ctx = model(400);
    ctx.set_system("SYSTEM PROMPT");
    ctx.push_assistant(Some("chatter".to_string()), Vec::new());
    apply_compaction(
        &mut ctx,
        &setup,
        RetainedCounts::default(),
        &CompactionRequest {
            summary: "THE RECAP".to_string(),
            files: vec!["a.ts".to_string()],
        },
        vec![RestoredFile {
            path: "a.ts".to_string(),
            body: "FILE BODY".to_string(),
            images: Vec::new(),
        }],
        Vec::new(),
        false,
    );
    let last = ctx
        .messages()
        .last()
        .and_then(|message| message.content.clone())
        .unwrap_or_default();
    assert!(last.contains("THE RECAP"), "got {last}");
}

/// **Text views do not survive a compaction, and that is deliberate.**
///
/// A text view is an ordinary [`Ephemeral`](Retention::Ephemeral) item, so `clear_ephemeral` drops
/// it with everything else the boundary drops, and the `compact` request's `files` list re-seeds
/// **files only** — there is no way for a model to name a view it wants carried across, on purpose:
/// extending the request to name views is a separate feature, and until it exists a model that wants
/// composed material to outlive a boundary must write it to a file (and re-open it by path) or to a
/// memory.
///
/// Asserted through the whole rewrite rather than against `clear_ephemeral` alone, because it is the
/// conjunction that matters: the file comes back, the view does not.
#[test]
fn a_text_view_does_not_survive_a_compaction_but_a_named_file_does() {
    let setup = setup(CompactionStrategy::SelfCompaction, 0.5, true);
    let mut ctx = model(400);
    ctx.set_system("SYSTEM PROMPT");
    ctx.push_assistant(Some("ephemeral chatter ".repeat(10)), Vec::new());
    ctx.open_file_view_deduped(
        "src/main.ts".to_string(),
        None,
        None,
        "FILE BODY".to_string(),
        Vec::new(),
    );
    ctx.open_text_view("plan".to_string(), "COMPOSED PLAN".to_string());
    assert_eq!(ctx.open_text_views().len(), 1);

    let event = apply_compaction(
        &mut ctx,
        &setup,
        RetainedCounts::default(),
        &CompactionRequest {
            summary: "the recap".to_string(),
            // The request names a file. There is no view field to name a view with.
            files: vec!["src/main.ts".to_string()],
        },
        vec![RestoredFile {
            path: "src/main.ts".to_string(),
            body: "FILE BODY".to_string(),
            images: Vec::new(),
        }],
        Vec::new(),
        false,
    );

    assert!(
        ctx.open_text_views().is_empty(),
        "the boundary dropped the text view"
    );
    assert_eq!(ctx.tokens_for(GgContextSource::TextView), 0);
    let all: String = ctx
        .messages()
        .iter()
        .filter_map(|m| m.content.clone())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(!all.contains("COMPOSED PLAN"), "{all}");
    assert!(
        all.contains("FILE BODY"),
        "the file the request named came back: {all}"
    );

    // And the event says so, so an analysis reading the band composition sees the view band emptied
    // rather than having to infer it.
    match event {
        GgTelemetryKind::Compaction {
            before_by_source,
            after_by_source,
            ..
        } => {
            assert!(band_tokens(&before_by_source, GgContextSource::TextView) > 0);
            assert_eq!(band_tokens(&after_by_source, GgContextSource::TextView), 0);
            assert!(band_tokens(&after_by_source, GgContextSource::FileView) > 0);
        }
        other => panic!("expected a Compaction event, got {other:?}"),
    }
}

/// A failed condensation is recorded as one. The fallback note is a real summary as far as the
/// window is concerned — the compaction still happens, because the window is full either way — but
/// the event says it fell back, so a study reads it as the failure it is rather than as a terse
/// strategy.
#[test]
fn a_fallback_summary_is_flagged_on_the_event() {
    let setup = setup(CompactionStrategy::SelfSummarization, 0.5, true);
    let mut ctx = model(400);
    ctx.set_system("SYSTEM PROMPT");
    ctx.push_assistant(Some("chatter".to_string()), Vec::new());

    let request = fallback_request();
    assert!(is_fallback(&request.summary));
    match apply_compaction(
        &mut ctx,
        &setup,
        RetainedCounts::default(),
        &request,
        Vec::new(),
        Vec::new(),
        is_fallback(&request.summary),
    ) {
        GgTelemetryKind::Compaction {
            summary_fallback,
            strategy,
            ..
        } => {
            assert!(summary_fallback);
            assert_eq!(strategy, "self-summarization");
        }
        other => panic!("expected a Compaction event, got {other:?}"),
    }
}

#[cfg(test)]
#[path = "compaction.strategies.test.rs"]
mod strategies;

/// A client every call of which the gateway answered from a provider other than the pin.
struct MismatchedClient;

#[async_trait::async_trait]
impl ModelClient for MismatchedClient {
    async fn complete(
        &self,
        _messages: &[Message],
        _tools: &[crate::model::ToolDefinition],
    ) -> Result<crate::model::ModelResponse, ModelError> {
        Err(ModelError::ProviderMismatch {
            pinned: "OpenAI".to_string(),
            served: "Azure".to_string(),
        })
    }

    fn model_id(&self) -> &str {
        "openai/gpt-5.4-mini"
    }
}

/// A provider mismatch on the summarizer's call is not degraded to the fixed note like any other
/// failure: both handoff summarizers return it, so the run ends on it.
#[tokio::test]
async fn a_summarizer_returns_a_provider_mismatch_rather_than_degrading() {
    let history = [Message::user("build a game")];
    for summarizer in [
        &HandoffSummarizer as &dyn Summarizer,
        &HandoffCompactor as &dyn Summarizer,
    ] {
        let err = summarizer
            .summarize(SummaryRequest {
                history: &history,
                client: &MismatchedClient,
            })
            .await
            .expect_err("a mismatch ends the run");
        assert!(matches!(err, ModelError::ProviderMismatch { .. }), "{err}");
    }
}
