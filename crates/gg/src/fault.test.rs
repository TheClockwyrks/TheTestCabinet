//! **The run-wide fault latch**: that it latches, that it keeps the *first* fault, and that what
//! it keeps names the agent an operator has to go and look at.
//!
//! The escalation these back — a gg defect in any agent ending the whole run — is proved through
//! the live loop in `agent.faults.test.rs`. What is here is the property that escalation rests on:
//! one raise is visible to every other agent, and the sentence it leaves behind is the cause
//! rather than the consequence.
//!
//! The last two are about the *awaitable* half, which an agent gg has suspended reads instead of a
//! turn boundary. The consequence of it failing is a run that never ends at all, so it is proved
//! here as a property of the latch and again through the loop in `agent.waits.test.rs`.

use super::*;

/// A healthy run has no fault, and that is the state every run starts in.
#[test]
fn an_unfaulted_latch_reports_nothing() {
    assert_eq!(FaultLatch::default().raised(), None);
}

/// A raised fault is visible through **every** clone of the latch, which is what makes one agent's
/// defect the run's decision: the agents winding down hold clones, not the original.
#[test]
fn a_raised_fault_is_visible_through_every_clone() {
    let latch = FaultLatch::default();
    let elsewhere = latch.clone();

    latch.in_agent("agent-3", "Reviewer", "the code sandbox host fell over");

    let raised = elsewhere.raised().expect("a clone reads the run's fault");
    assert!(
        raised.contains("`agent-3`") && raised.contains("`Reviewer`"),
        "the diagnostic must name the instance and the profile: {raised}"
    );
    assert!(
        raised.contains("the code sandbox host fell over"),
        "and what the site actually met: {raised}"
    );
}

/// The **first** fault is the one kept. Everything gg reports after a run starts winding down is
/// downstream of the fault that started it, so a latch that took the latest would hand the
/// operator a consequence and discard the cause.
#[test]
fn the_first_fault_wins() {
    let latch = FaultLatch::default();

    latch.in_agent(
        "agent-1",
        "Coder",
        "the guest artifact would not instantiate",
    );
    latch.in_agent("root", "Root", "stopped because the run had faulted");

    let raised = latch.raised().expect("the latch holds the first fault");
    assert!(
        raised.contains("`agent-1`") && raised.contains("would not instantiate"),
        "the cause is kept, not the consequence: {raised}"
    );
}

/// A dispatch that never stood an agent up names the **issue**, since that is what an operator is
/// looking at on the board and there is no instance to point them at.
#[test]
fn a_dispatch_fault_names_the_issue_it_could_not_dispatch() {
    let latch = FaultLatch::default();

    latch.in_dispatch(
        "ISSUE-1",
        Some("Coder"),
        "the `Coder` agent profile has no model bound",
    );

    let raised = latch.raised().expect("a dispatch fault is a run fault");
    assert!(
        raised.contains("`ISSUE-1`") && raised.contains("`Coder`"),
        "the diagnostic must name the issue and the agent it was reaching for: {raised}"
    );
}

/// An issue that named no assignee at all has no profile to name, and the sentence must not invent
/// one.
#[test]
fn a_dispatch_fault_with_no_assignee_names_only_the_issue() {
    let latch = FaultLatch::default();

    latch.in_dispatch("ISSUE-2", None, "it names no assignee to dispatch it to");

    let raised = latch.raised().expect("a dispatch fault is a run fault");
    assert!(
        raised.contains("`ISSUE-2`") && !raised.contains("agent ``"),
        "an absent assignee leaves no empty slot behind: {raised}"
    );
}

/// A fault raised **before** anybody asks resolves the wait immediately. An agent that suspended
/// itself while the run was healthy, and only reads the latch once released, would otherwise sit
/// waiting for a second fault that a one-shot latch can never produce.
#[tokio::test]
async fn awaiting_an_already_raised_fault_resolves_at_once() {
    let latch = FaultLatch::default();
    latch.in_agent("agent-2", "Coder", "the wasm host would not start");

    tokio::time::timeout(std::time::Duration::from_secs(5), latch.until_raised())
        .await
        .expect("a latch that already holds a fault answers without waiting");
}

/// A fault raised **while** an agent is awaiting the latch releases it, through a clone — which is
/// the shape every real release has, since the agent that breaks is never the agent that is
/// suspended.
#[tokio::test]
async fn awaiting_the_latch_is_released_by_a_later_fault() {
    let latch = FaultLatch::default();
    let waiter = latch.clone();
    let awaiting = tokio::spawn(async move { waiter.until_raised().await });

    // One yield is enough on the single-threaded test runtime to run the spawned task up to its
    // await, so what follows releases a registered waiter rather than answering it on arrival.
    tokio::task::yield_now().await;
    latch.in_agent("agent-4", "Reviewer", "its task panicked");

    tokio::time::timeout(std::time::Duration::from_secs(5), awaiting)
        .await
        .expect("the waiter is released by the fault rather than left for the run's deadline")
        .expect("the awaiting task ran to completion");
}
