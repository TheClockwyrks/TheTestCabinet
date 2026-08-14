use std::sync::atomic::Ordering;

use test_cabinet_core::gg::{CAPABILITY_SUBAGENTS, GgCapabilityConfig, GgCapabilitySet};

use crate::validate::{LaunchDefect, LaunchReport};

use super::*;

/// The bounds `set` resolves to, asserting gg honoured both of them exactly as written.
fn config(set: &GgCapabilitySet) -> SubagentConfig {
    let mut report = LaunchReport::collecting();
    let config = SubagentConfig::resolve(set, &mut report);
    let defects = report.into_defects();
    assert!(defects.is_empty(), "unexpected refusals: {defects:?}");
    config
}

/// Everything `set` earns a refusal for, for the cases whose subject is the refusal.
fn refusals(set: &GgCapabilitySet) -> Vec<LaunchDefect> {
    let mut report = LaunchReport::collecting();
    check_launch(set, &mut report);
    report.into_defects()
}

/// No [exclusivity key](ExclusiveKey) held — the state every case that is not about persistence
/// exercises the grant policy under.
fn none() -> BTreeSet<String> {
    BTreeSet::new()
}

/// The [exclusivity keys](ExclusiveKey) in `keys`, held by running agents.
fn held(keys: &[&str]) -> BTreeSet<String> {
    keys.iter().map(|key| key.to_string()).collect()
}

/// A fresh [hold](SlotHold) for one agent, for the cases that are about the scheduler's own count
/// rather than about the bit.
///
/// Every acquire in the cases below stands for a *different* agent, so each is given its own rather
/// than sharing one: a shared hold would read as one agent holding the slots of several, which is
/// the state [`the_hold_follows_the_slot`] exists to say is impossible.
fn fresh_hold() -> SlotHold {
    SlotHold::default()
}

// ---------------------------------------------------------------------------
// The grant policy: select_grant_index (pure, exhaustive)
// ---------------------------------------------------------------------------

/// No slot is free when running has reached the cap: nothing is granted regardless of the queue.
#[test]
fn select_grant_none_when_at_capacity() {
    // A ready fresh waiter, but the cap is full.
    let waiters = [(false, true, 0, None)];
    assert_eq!(select_grant_index(&waiters, 1, 1, &none()), None);
    assert_eq!(select_grant_index(&waiters, 4, 4, &none()), None);
}

/// With a free slot and a single fresh waiter, it is granted.
#[test]
fn select_grant_picks_the_lone_fresh_waiter() {
    let waiters = [(false, true, 7, None)];
    assert_eq!(select_grant_index(&waiters, 0, 1, &none()), Some(0));
}

/// A blocked-and-ready waiter takes priority over a not-yet-started (fresh) one for a free slot —
/// the blocked-frees-slot-with-priority rule.
#[test]
fn select_grant_blocked_ready_beats_fresh() {
    // Index 0 is fresh (older ticket), index 1 is blocked-and-ready (newer ticket). Despite the
    // older ticket, the blocked-ready waiter wins on class priority.
    let waiters = [(false, true, 0, None), (true, true, 5, None)];
    assert_eq!(select_grant_index(&waiters, 0, 4, &none()), Some(1));
}

/// A blocked waiter whose condition is NOT yet met is ineligible even with a free slot, so a fresh
/// waiter is granted instead — a blocked agent cannot resume until its wait condition is met.
#[test]
fn select_grant_blocked_not_ready_is_ineligible() {
    // Index 0 is blocked-but-not-ready (ineligible), index 1 is fresh.
    let waiters = [(true, false, 0, None), (false, true, 3, None)];
    assert_eq!(select_grant_index(&waiters, 0, 4, &none()), Some(1));

    // With only a not-ready blocked waiter, nothing is eligible even though a slot is free.
    let only_blocked = [(true, false, 0, None)];
    assert_eq!(select_grant_index(&only_blocked, 0, 4, &none()), None);
}

/// Among waiters of equal priority, the oldest ticket wins (first-come, first-served).
#[test]
fn select_grant_fcfs_within_a_class() {
    // Two fresh waiters: the smaller ticket (older) is granted.
    let fresh = [(false, true, 9, None), (false, true, 2, None)];
    assert_eq!(select_grant_index(&fresh, 0, 4, &none()), Some(1));

    // Two blocked-ready waiters: likewise oldest first.
    let blocked = [(true, true, 8, None), (true, true, 4, None)];
    assert_eq!(select_grant_index(&blocked, 0, 4, &none()), Some(1));
}

/// A waiter whose exclusivity key is already held by a running agent is ineligible however old its
/// ticket and whichever class it is in — the rule that caps a persistent profile at one instance.
#[test]
fn select_grant_skips_a_waiter_whose_key_is_held() {
    // The oldest waiter wants `Owner`, which is already running; the younger keyless one is granted.
    let waiters = [(false, true, 0, Some("Owner")), (false, true, 9, None)];
    assert_eq!(
        select_grant_index(&waiters, 0, 4, &held(&["Owner"])),
        Some(1)
    );

    // Even blocked-and-ready — normally the top priority — does not outrank a held key.
    let blocked_wants_held = [(true, true, 0, Some("Owner")), (false, true, 9, None)];
    assert_eq!(
        select_grant_index(&blocked_wants_held, 0, 4, &held(&["Owner"])),
        Some(1)
    );

    // With nothing else eligible, a free slot goes unused rather than running a second instance.
    let only_held = [(false, true, 0, Some("Owner"))];
    assert_eq!(
        select_grant_index(&only_held, 0, 4, &held(&["Owner"])),
        None
    );

    // A different key contends with nothing.
    assert_eq!(
        select_grant_index(&only_held, 0, 4, &held(&["Reviewer"])),
        Some(0)
    );
}

// ---------------------------------------------------------------------------
// SubagentConfig resolution
// ---------------------------------------------------------------------------

/// A set without the subagents capability resolves to the defaults.
#[test]
fn config_defaults_without_the_capability() {
    let config = config(&GgCapabilitySet::minimal("mock/x"));
    assert_eq!(config.max_parallel, DEFAULT_MAX_PARALLEL);
    assert_eq!(config.max_depth, DEFAULT_MAX_DEPTH);
}

/// An explicit `maxDepth` overrides the default; an absent one keeps it. The capability's params
/// bound its own recursion and nothing else — the parallelism cap is not read from here.
#[test]
fn config_reads_the_depth_param() {
    let mut set = GgCapabilitySet::minimal("mock/x");
    let mut cap = GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS);
    cap.params = serde_json::json!({ "maxDepth": 5 });
    crate::tools::grant_configured(&mut set.agents[0], cap);
    let config = config(&set);
    assert_eq!(config.max_depth, 5);
    assert_eq!(
        config.max_parallel, DEFAULT_MAX_PARALLEL,
        "the capability's params do not carry the run's parallelism cap"
    );
}

/// A depth of zero is a tree the root may not spawn into: the capability switched off by
/// arithmetic, with all three of its tools still offered. Refused rather than quietly defaulted.
#[test]
fn a_depth_of_zero_is_refused() {
    let mut set = GgCapabilitySet::minimal("mock/x");
    let mut cap = GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS);
    cap.params = serde_json::json!({ "maxDepth": 0 });
    crate::tools::grant_configured(&mut set.agents[0], cap);

    let defects = refusals(&set);
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert_eq!(defects[0].locus, "subagents.params.maxDepth");
}

/// The parallelism cap is readable off the run's own limits — no subagents capability needed, which
/// is what makes it settable for a run that delegates only through the board.
#[test]
fn config_reads_the_run_level_parallelism_cap() {
    let mut set = GgCapabilitySet::minimal("mock/x");
    set.limits.max_parallel = Some(3);
    assert_eq!(config(&set).max_parallel, 3);
}

/// A parallelism cap of zero would be a run in which no agent may run at all, so it could not
/// start. It is refused rather than read as "no declaration".
#[test]
fn a_parallelism_cap_of_zero_is_refused() {
    let mut set = GgCapabilitySet::minimal("mock/x");
    set.limits.max_parallel = Some(0);

    let defects = refusals(&set);
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert_eq!(defects[0].locus, "limits.maxParallel");
    assert_eq!(
        SubagentConfig::resolve(&set, &mut LaunchReport::collecting()).max_parallel,
        DEFAULT_MAX_PARALLEL,
        "the resolver stays total; the launch is over by the time this matters"
    );
}

// ---------------------------------------------------------------------------
// The scheduler, end to end (async, deterministic)
// ---------------------------------------------------------------------------

/// A free slot is granted immediately: the first acquire under a positive cap does not block.
#[tokio::test]
async fn acquire_start_grants_immediately_when_a_slot_is_free() {
    let scheduler = Scheduler::new(2);
    scheduler.acquire_start(None, &fresh_hold()).await;
    assert_eq!(scheduler.running(), 1);
    assert_eq!(scheduler.waiter_count(), 0);
    scheduler.acquire_start(None, &fresh_hold()).await;
    assert_eq!(scheduler.running(), 2);
}

/// A cap of 1 serializes: a second acquire blocks (recorded as a waiter) until the first slot is
/// released, then is granted.
#[tokio::test]
async fn cap_of_one_serializes_a_second_acquire() {
    let scheduler = Scheduler::new(1);
    scheduler.acquire_start(None, &fresh_hold()).await;
    assert_eq!(scheduler.running(), 1);

    // A second acquirer must block — the cap is full.
    let started = Arc::new(AtomicBool::new(false));
    let started_task = Arc::clone(&started);
    let scheduler_task = Arc::clone(&scheduler);
    let handle = tokio::spawn(async move {
        scheduler_task.acquire_start(None, &fresh_hold()).await;
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
    scheduler.release(None);
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
    scheduler.acquire_start(None, &fresh_hold()).await; // the "parent" holds the only slot.
    assert_eq!(scheduler.running(), 1);

    // The parent blocks on a child: it frees its slot and registers a not-yet-ready waiter.
    let (token, rx) = scheduler.block_and_release(None, &fresh_hold());
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
    scheduler.acquire_start(None, &fresh_hold()).await; // child takes the free slot (running -> 1).
    scheduler.finish_and_ready(token, None); // child done + parent ready, in one step.
    handle.await.unwrap();
    assert!(
        resumed.load(Ordering::SeqCst),
        "the parent resumes once its wait condition is met and a slot is free"
    );
    assert_eq!(scheduler.running(), 1, "the resumed parent holds a slot");
}

/// **The hold follows the slot**, through an acquire, a wait, and the grant that ends it.
///
/// The bit exists for a reader that is not the scheduler: an agent's [teardown](crate::agent), which
/// on a [panic](crate::fault) has to decide whether to give a slot back and cannot ask the agent,
/// because the agent is the thing that died. Every wrong answer it can be given is a real defect —
/// `false` while running leaks the slot for the rest of the run, and `true` while suspended returns
/// a slot the agent it is waiting for is running on, over-filling the pool and freeing an
/// [exclusivity key](ExclusiveKey) a second instance of a persistent profile holds.
///
/// So the assertions here are about the *instants*: the hold must be set by the grant and cleared by
/// the release, never by the waiting task noticing afterwards.
#[tokio::test]
async fn the_hold_follows_the_slot() {
    let scheduler = Scheduler::new(1);
    let parent = fresh_hold();
    assert!(
        !parent.held(),
        "an agent that has not acquired holds nothing"
    );

    scheduler.acquire_start(None, &parent).await;
    assert!(parent.held(), "the grant is what sets it");

    // The parent suspends on a child. Its slot is gone the moment the scheduler takes it, not when
    // the parent's task next runs — so the bit is read here, before anything awaits.
    let (token, rx) = scheduler.block_and_release(None, &parent);
    assert!(
        !parent.held(),
        "a suspended agent holds nothing: the slot it gave up is the one the child is about to run \
         on"
    );

    // The child runs on that slot and finishes, which readies the parent and hands the slot back.
    let child = fresh_hold();
    scheduler.acquire_start(None, &child).await;
    assert!(child.held() && !parent.held(), "one slot, one holder");
    scheduler.finish_and_ready(token, None);
    assert!(
        parent.held(),
        "the resumed agent holds its slot from the grant, not from the wake it has yet to read"
    );
    let _ = rx.await;
    assert!(parent.held());
}

/// A **succession** onto a contended profile gives the slot up like any other wait, and the hold
/// with it.
///
/// The case the bit is least obviously needed for and most easily got wrong: the agent is running
/// throughout, its turn loop never blocks, and it is nevertheless queued behind another instance of
/// its own profile with no slot of its own. A teardown that believed otherwise would return the slot
/// the instance ahead of it is using.
#[tokio::test]
async fn a_rekey_that_queues_gives_up_the_hold_until_it_is_granted_again() {
    let scheduler = Arc::new(Scheduler::new(4));
    scheduler.acquire_start(Some("Owner"), &fresh_hold()).await;
    let successor = fresh_hold();
    scheduler.acquire_start(Some("Explorer"), &successor).await;
    assert!(successor.held());

    let handle = tokio::spawn({
        let scheduler = Arc::clone(&scheduler);
        let successor = successor.clone();
        async move {
            scheduler
                .rekey(Some("Explorer"), Some("Owner"), &successor)
                .await;
        }
    });
    tokio::task::yield_now().await;
    assert!(
        !successor.held(),
        "a succession waiting for its profile is not running on a slot"
    );

    scheduler.release(Some("Owner"));
    handle.await.unwrap();
    assert!(successor.held(), "and holds one again once it is granted");
}

/// A succession that does **not** contend keeps its slot throughout, so it keeps its hold.
///
/// The negative half: the same call, one condition different, and a bit that flipped here would
/// leak the slot of every FSM transition in every run.
#[tokio::test]
async fn a_rekey_that_does_not_queue_never_lets_go() {
    let scheduler = Scheduler::new(2);
    let agent = fresh_hold();
    scheduler.acquire_start(Some("Explorer"), &agent).await;

    scheduler
        .rekey(Some("Explorer"), Some("Builder"), &agent)
        .await;
    assert!(agent.held(), "the slot never moved, so neither did the bit");

    scheduler.rekey(Some("Builder"), None, &agent).await;
    assert!(agent.held());
}

/// An exclusivity key serializes two agents that share it **even with slots to spare** — the whole
/// mechanism behind a persistent profile's cap of one — while an agent holding a different key (or
/// none) runs alongside them.
#[tokio::test]
async fn an_exclusivity_key_serializes_its_holders_within_a_roomy_pool() {
    let scheduler = Scheduler::new(4);
    scheduler.acquire_start(Some("Owner"), &fresh_hold()).await;
    assert_eq!(scheduler.running(), 1);
    assert!(scheduler.holds("Owner"));

    // A second instance of the same profile must queue, though three slots are free.
    let started = Arc::new(AtomicBool::new(false));
    let started_task = Arc::clone(&started);
    let scheduler_task = Arc::clone(&scheduler);
    let handle = tokio::spawn(async move {
        scheduler_task
            .acquire_start(Some("Owner"), &fresh_hold())
            .await;
        started_task.store(true, Ordering::SeqCst);
    });
    tokio::task::yield_now().await;
    assert!(
        !started.load(Ordering::SeqCst),
        "a second instance of a persistent profile must wait for the first"
    );
    assert_eq!(scheduler.waiter_count(), 1);

    // Meanwhile an agent under a different profile runs immediately: the key contends with its own
    // holders and nothing else.
    scheduler
        .acquire_start(Some("Reviewer"), &fresh_hold())
        .await;
    assert_eq!(scheduler.running(), 2);
    scheduler.acquire_start(None, &fresh_hold()).await;
    assert_eq!(scheduler.running(), 3);
    assert!(!started.load(Ordering::SeqCst));

    // The first instance finishing hands the profile to the queued one.
    scheduler.release(Some("Owner"));
    handle.await.unwrap();
    assert!(started.load(Ordering::SeqCst));
    assert!(scheduler.holds("Owner"), "the resumed instance re-takes it");
    assert_eq!(scheduler.running(), 3);
}

/// A persistent agent that **suspends** releases its profile with its slot, so a queued instance may
/// run while it waits — and re-takes the key when it resumes. This is what keeps a persistent agent
/// blocked on a child of its own profile from deadlocking against itself.
#[tokio::test]
async fn suspending_releases_the_exclusivity_key_and_resuming_re_takes_it() {
    let scheduler = Scheduler::new(4);
    scheduler.acquire_start(Some("Owner"), &fresh_hold()).await;

    // The instance blocks on a child: slot and key are both freed.
    let (token, rx) = scheduler.block_and_release(Some("Owner"), &fresh_hold());
    assert_eq!(scheduler.running(), 0);
    assert!(
        !scheduler.holds("Owner"),
        "a suspended instance is not running, so it does not hold its profile"
    );

    // Which is exactly what lets another instance of the same profile — its own child, say — run.
    scheduler.acquire_start(Some("Owner"), &fresh_hold()).await;
    assert!(scheduler.holds("Owner"));

    // That child finishing frees the key and marks the parent ready, so the parent resumes under it.
    scheduler.finish_and_ready(token, Some("Owner"));
    let _ = rx.await;
    assert!(scheduler.holds("Owner"), "the resumed parent re-takes it");
    assert_eq!(scheduler.running(), 1);
}

/// A **succession** into a persistent profile takes that profile's key without ever giving up the
/// running slot it already holds. A machine transition is the continuation of work in progress, and
/// making it re-queue behind unrelated agents would stall a machine mid-stride.
#[tokio::test]
async fn a_rekey_exchanges_the_profile_without_giving_up_the_slot() {
    let scheduler = Scheduler::new(2);
    scheduler
        .acquire_start(Some("Explorer"), &fresh_hold())
        .await;
    assert_eq!(scheduler.running(), 1);

    scheduler
        .rekey(Some("Explorer"), Some("Builder"), &fresh_hold())
        .await;
    assert!(!scheduler.holds("Explorer"), "the old profile is freed");
    assert!(scheduler.holds("Builder"), "and the new one taken");
    assert_eq!(scheduler.running(), 1, "the slot never moved");

    // A successor whose profile is not persistent contends with nothing and simply drops the key.
    scheduler.rekey(Some("Builder"), None, &fresh_hold()).await;
    assert!(!scheduler.holds("Builder"));
    assert_eq!(scheduler.running(), 1);
}

/// A succession into a profile **another running agent already holds** is not exempt from the
/// one-instance rule: it gives its slot up and re-queues under the new key, blocked-and-ready, so it
/// outranks every not-yet-started agent and resumes the moment the key frees.
#[tokio::test]
async fn a_rekey_onto_a_held_profile_queues_rather_than_deadlocking() {
    let scheduler = Arc::new(Scheduler::new(4));
    // Somebody else is running as `Owner`.
    scheduler.acquire_start(Some("Owner"), &fresh_hold()).await;
    // Our agent is running as something else, and is about to become an `Owner`.
    scheduler
        .acquire_start(Some("Explorer"), &fresh_hold())
        .await;
    assert_eq!(scheduler.running(), 2);

    let moved = Arc::new(AtomicBool::new(false));
    let handle = tokio::spawn({
        let scheduler = Arc::clone(&scheduler);
        let moved = Arc::clone(&moved);
        async move {
            scheduler
                .rekey(Some("Explorer"), Some("Owner"), &fresh_hold())
                .await;
            moved.store(true, Ordering::SeqCst);
        }
    });
    tokio::task::yield_now().await;
    assert!(
        !moved.load(Ordering::SeqCst),
        "the succession waits for the profile rather than running two of it"
    );
    assert_eq!(
        scheduler.running(),
        1,
        "and gave its slot up while it waits"
    );

    // The instance ahead of it finishing hands the profile over.
    scheduler.release(Some("Owner"));
    handle.await.unwrap();
    assert!(moved.load(Ordering::SeqCst));
    assert!(scheduler.holds("Owner"));
    assert_eq!(scheduler.running(), 1);
}
