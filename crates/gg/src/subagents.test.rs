use std::sync::atomic::Ordering;

use test_cabinet_core::gg::{CAPABILITY_SUBAGENTS, GgCapabilityConfig, GgCapabilitySet};

use super::*;

// ---------------------------------------------------------------------------
// The grant policy: select_grant_index (pure, exhaustive)
// ---------------------------------------------------------------------------

/// No slot is free when running has reached the cap: nothing is granted regardless of the queue.
#[test]
fn select_grant_none_when_at_capacity() {
    // A ready fresh waiter, but the cap is full.
    let waiters = [(false, true, 0)];
    assert_eq!(select_grant_index(&waiters, 1, 1), None);
    assert_eq!(select_grant_index(&waiters, 4, 4), None);
}

/// With a free slot and a single fresh waiter, it is granted.
#[test]
fn select_grant_picks_the_lone_fresh_waiter() {
    let waiters = [(false, true, 7)];
    assert_eq!(select_grant_index(&waiters, 0, 1), Some(0));
}

/// A blocked-and-ready waiter takes priority over a not-yet-started (fresh) one for a free slot —
/// the blocked-frees-slot-with-priority rule.
#[test]
fn select_grant_blocked_ready_beats_fresh() {
    // Index 0 is fresh (older ticket), index 1 is blocked-and-ready (newer ticket). Despite the
    // older ticket, the blocked-ready waiter wins on class priority.
    let waiters = [(false, true, 0), (true, true, 5)];
    assert_eq!(select_grant_index(&waiters, 0, 4), Some(1));
}

/// A blocked waiter whose condition is NOT yet met is ineligible even with a free slot, so a fresh
/// waiter is granted instead — a blocked agent cannot resume until its wait condition is met.
#[test]
fn select_grant_blocked_not_ready_is_ineligible() {
    // Index 0 is blocked-but-not-ready (ineligible), index 1 is fresh.
    let waiters = [(true, false, 0), (false, true, 3)];
    assert_eq!(select_grant_index(&waiters, 0, 4), Some(1));

    // With only a not-ready blocked waiter, nothing is eligible even though a slot is free.
    let only_blocked = [(true, false, 0)];
    assert_eq!(select_grant_index(&only_blocked, 0, 4), None);
}

/// Among waiters of equal priority, the oldest ticket wins (first-come, first-served).
#[test]
fn select_grant_fcfs_within_a_class() {
    // Two fresh waiters: the smaller ticket (older) is granted.
    let fresh = [(false, true, 9), (false, true, 2)];
    assert_eq!(select_grant_index(&fresh, 0, 4), Some(1));

    // Two blocked-ready waiters: likewise oldest first.
    let blocked = [(true, true, 8), (true, true, 4)];
    assert_eq!(select_grant_index(&blocked, 0, 4), Some(1));
}

// ---------------------------------------------------------------------------
// SubagentConfig resolution
// ---------------------------------------------------------------------------

/// A set without the subagents capability resolves to the defaults.
#[test]
fn config_defaults_without_the_capability() {
    let config = SubagentConfig::resolve(&GgCapabilitySet::minimal("mock/x"));
    assert_eq!(config.max_parallel, DEFAULT_MAX_PARALLEL);
    assert_eq!(config.max_depth, DEFAULT_MAX_DEPTH);
}

/// Explicit params override the defaults; a zero/absent value keeps the default; `max_parallel` is
/// clamped to at least 1.
#[test]
fn config_reads_params_and_clamps_parallel() {
    let mut set = GgCapabilitySet::minimal("mock/x");
    let mut cap = GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS);
    cap.params = serde_json::json!({ "maxParallel": 2, "maxDepth": 5 });
    set.agents[0].capabilities.push(cap);
    let config = SubagentConfig::resolve(&set);
    assert_eq!(config.max_parallel, 2);
    assert_eq!(config.max_depth, 5);

    // A zero maxParallel is ignored (keeps the default), and any value is clamped to >= 1.
    let mut set = GgCapabilitySet::minimal("mock/x");
    let mut cap = GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS);
    cap.params = serde_json::json!({ "maxParallel": 0 });
    set.agents[0].capabilities.push(cap);
    assert_eq!(
        SubagentConfig::resolve(&set).max_parallel,
        DEFAULT_MAX_PARALLEL
    );
}

// ---------------------------------------------------------------------------
// The scheduler, end to end (async, deterministic)
// ---------------------------------------------------------------------------

/// A free slot is granted immediately: the first acquire under a positive cap does not block.
#[tokio::test]
async fn acquire_start_grants_immediately_when_a_slot_is_free() {
    let scheduler = Scheduler::new(2);
    scheduler.acquire_start().await;
    assert_eq!(scheduler.running(), 1);
    assert_eq!(scheduler.waiter_count(), 0);
    scheduler.acquire_start().await;
    assert_eq!(scheduler.running(), 2);
}

/// A cap of 1 serializes: a second acquire blocks (recorded as a waiter) until the first slot is
/// released, then is granted.
#[tokio::test]
async fn cap_of_one_serializes_a_second_acquire() {
    let scheduler = Scheduler::new(1);
    scheduler.acquire_start().await;
    assert_eq!(scheduler.running(), 1);

    // A second acquirer must block — the cap is full.
    let started = Arc::new(AtomicBool::new(false));
    let started_task = Arc::clone(&started);
    let scheduler_task = Arc::clone(&scheduler);
    let handle = tokio::spawn(async move {
        scheduler_task.acquire_start().await;
        started_task.store(true, Ordering::SeqCst);
    });

    // Let the task run up to its blocked acquire.
    tokio::task::yield_now().await;
    assert!(
        !started.load(Ordering::SeqCst),
        "the second acquire must block while the cap is full"
    );
    assert_eq!(scheduler.waiter_count(), 1, "it is queued as a waiter");
    assert_eq!(scheduler.running(), 1);

    // Freeing the first slot grants it to the waiter.
    scheduler.release();
    handle.await.unwrap();
    assert!(
        started.load(Ordering::SeqCst),
        "releasing a slot unblocks the queued acquire"
    );
    assert_eq!(scheduler.running(), 1);
    assert_eq!(scheduler.waiter_count(), 0);
}

/// `block_and_release` frees the caller's slot (so other work can run) and, once the blocked
/// waiter is marked ready via `finish_and_ready`, resumes it — even though the freed slot was
/// available, the blocked waiter only resumes when its condition is met.
#[tokio::test]
async fn block_and_release_frees_the_slot_then_resumes_when_ready() {
    let scheduler = Scheduler::new(1);
    scheduler.acquire_start().await; // the "parent" holds the only slot.
    assert_eq!(scheduler.running(), 1);

    // The parent blocks on a child: it frees its slot and registers a not-yet-ready waiter.
    let (token, rx) = scheduler.block_and_release();
    assert_eq!(scheduler.running(), 0, "blocking frees the slot");
    assert_eq!(scheduler.waiter_count(), 1);

    // Await the resume on a task so we can observe it is still pending until the condition is met.
    let resumed = Arc::new(AtomicBool::new(false));
    let resumed_task = Arc::clone(&resumed);
    let handle = tokio::spawn(async move {
        let _ = rx.await;
        resumed_task.store(true, Ordering::SeqCst);
    });
    tokio::task::yield_now().await;
    assert!(
        !resumed.load(Ordering::SeqCst),
        "a blocked waiter cannot resume until its condition is met, even with a free slot"
    );

    // The child finishes: it releases (a notional) slot and marks the parent ready together.
    // (Model the child having held the freed slot by re-acquiring it first.)
    scheduler.acquire_start().await; // child takes the free slot (running -> 1).
    scheduler.finish_and_ready(token); // child done + parent ready, in one step.
    handle.await.unwrap();
    assert!(
        resumed.load(Ordering::SeqCst),
        "the parent resumes once its wait condition is met and a slot is free"
    );
    assert_eq!(scheduler.running(), 1, "the resumed parent holds a slot");
}
