//! **An agent profile the run does not declare**, at each of the five sites that resolve one.
//!
//! Every one of these is unreachable through the production launch path, and that is the point:
//! [`crate::validate::validate_launch`] rejects a roster reference to an undeclared profile, [`crate::fsm::validate`]
//! rejects a state that names one, the board holds an issue's assignee and its reviewers to the
//! filer's own roster, and a succession's target is checked against the roster before it is
//! accepted. So the only thing that can put an undeclared name in front of a resolver is a **gg
//! defect** — and these tests reproduce one the only way it can be reproduced, by building the
//! [`Orchestrator`] directly and skipping the launch checks that stand between a configuration and
//! this state.
//!
//! A succession resolves more than a name — it also resolves the successor's model client — so two
//! more failures reach the same site: a profile with no model bound, which launch validation
//! rejects exactly as firmly, and a refused credential, which is nobody's defect. The first ends
//! the agent as gg's fault and the second as the operator's, and neither ends it as the model's.
//! Every site that resolves a client draws that same split, so each of them is tested both ways
//! round: a run must never be disqualified over a missing key, and a defect must never hide behind
//! one.
//!
//! One of those two needs no defect at all — a provider that will not build for a profile launch
//! validation accepted is a runtime failure, not a configuration one — so it is the single member of
//! this family that a **whole session** can reach through the real entry point. Three tests take it
//! there, because the rest of the file can only observe half of what these sites owe: an agent's own
//! ending, and the [fault](crate::fault) it latched. What the latch is *for* is spent in the session
//! epilogue, and that is where the run stops being scored. Two of the three are the succession's,
//! either way round; the third is the **board's** dispatch, which is the site with nothing else
//! watching it — no spawner holds a handle to an issue's agent, so a latch the epilogue stopped
//! reading would leave every other test here green and still hand `core` a tree to score with an
//! issue's whole work missing from it.
//!
//! What they guard is that gg then says so. The tempting alternative is to substitute the
//! [root](GgCapabilitySet::root), and it is far worse than it sounds: the substitute is a different
//! agent — other capabilities, another model, possibly another execution mode — and the record
//! still attributes every turn of it to the profile that was asked for. A run like that does not
//! read as broken, it reads as an answer, and gg exists to produce answers about which
//! configuration did what. So each site must end its work loudly, naming the profile.

use std::path::Path;
use std::sync::Arc;

use serde_json::json;
use tempfile::TempDir;

use super::*;
use crate::board::{IssueStatus, NewIssue};
use crate::client::MockClient;
use crate::telemetry::{CollectingSink, Emitter};
use test_cabinet_core::gg::{
    ALL_SUBAGENT_SCOPES, CAPABILITY_EXEC, CAPABILITY_PROJECT_MANAGEMENT, CAPABILITY_SUBAGENTS,
    CAPABILITY_TASKS, GgCapabilityConfig, GgCapabilitySet, GgSubagentRef, GgTelemetryEvent,
    ROOT_AGENT, ROOT_PROFILE_ID,
};

use super::{ScriptedFactory, error_messages, invocation};

/// Build the run's [`Orchestrator`] over `set` **without** the launch checks.
///
/// This is the whole trick of the file: the production entry point ([`run_with_seams`]) validates
/// the profiles before it builds anything, so a set carrying an undeclared reference never reaches
/// an orchestrator through it. Reaching in here is the closest a test can stand to the defect being
/// guarded against — gg holding a name nothing declares — without inventing a fake one.
fn orchestrator(dir: &Path, set: GgCapabilitySet, emitter: &Emitter) -> Arc<Orchestrator> {
    orchestrator_with(dir, set, Arc::new(ScriptedFactory::new()), emitter)
}

/// [`orchestrator`] over a chosen [factory](ClientFactory), for the two cases whose failure is the
/// **resolution** rather than the name: a client resolution is the factory's answer to give.
fn orchestrator_with(
    dir: &Path,
    set: GgCapabilitySet,
    factory: Arc<dyn ClientFactory>,
    emitter: &Emitter,
) -> Arc<Orchestrator> {
    let mut warnings = Vec::new();
    Arc::new(
        Orchestrator::build(
            &invocation(dir, set),
            emitter,
            SessionSeams::substituted(factory, crate::tools::real_shell()),
            // No git isolation: none of these tests reaches a worktree, and every one of them
            // fails before an agent could ask for one.
            WorktreesSetup {
                baseline_commit: None,
                root: None,
            },
            &mut warnings,
            &mut crate::validate::LaunchReport::Discarding,
        )
        // None of these sets declares a machine, so the one thing building an orchestrator can
        // fail on is not in play here — see `a_machine_that_will_not_build_refuses_the_launch`.
        .expect("every machine in these sets parses, so an orchestrator builds"),
    )
}

/// Drive one agent under the profile `profile_id` to its ending, with `client` as its first
/// incarnation's model.
///
/// The orchestrator is **borrowed** rather than consumed so each test can read the run's
/// [fault latch](crate::fault) afterwards: how an agent's own loop ended is only half of what these
/// sites owe, and the half that ends the *run* is recorded there.
async fn drive_profile(
    orch: &Arc<Orchestrator>,
    profile_id: &str,
    client: Box<dyn ModelClient>,
) -> LoopEnd {
    let (_inbox_tx, inbox_rx) = mpsc::unbounded_channel();
    run_agent(
        Arc::clone(orch),
        Agent {
            profile_id: profile_id.to_string(),
            ..Agent::root(ROOT_PROFILE_ID)
        },
        AgentRole::Root,
        client.into(),
        inbox_rx,
        GgSessionAgentOrigin::Root,
    )
    .await
}

/// An agent whose own profile the run does not declare takes **no** turn: the loop ends on its
/// first pass with `internal_error`, one step ahead of the client resolution that ends a session
/// the same way for the same reason, and the diagnostic names the profile.
///
/// Running it as the root instead would have produced a complete, plausible, wholly fictional
/// session recorded under the name `ghost`.
#[tokio::test]
async fn an_undeclared_incarnation_profile_ends_the_session_with_internal_error() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-ghost".to_string()), Box::new(sink.clone()));
    let orch = orchestrator(
        dir.path(),
        GgCapabilitySet::minimal("mock/primary"),
        &emitter,
    );

    let end = drive_profile(
        &orch,
        "ghost",
        Box::new(MockClient::new("mock/primary".to_string(), Vec::new())),
    )
    .await;

    assert_eq!(
        end.status, STATUS_INTERNAL_ERROR,
        "an undeclared profile is gg's own defect, not a model or credential fault"
    );
    assert_eq!(
        end.turns, 0,
        "the agent must not take a turn as somebody else"
    );
    assert!(
        end.status.is_failure(),
        "a run stopped by a gg defect is a failure, not a ceiling"
    );
    let errors = error_messages(&sink.events());
    assert!(
        errors
            .iter()
            .any(|message| message.contains("`ghost`")
                && message.contains("not declared by this run")),
        "the diagnostic must name the profile that is missing: {errors:?}"
    );
    // ...and the run ends with this agent. Ending only *this* loop under `internal_error` would
    // leave a session whose other agents run on to a `completed` ending — a tree with a whole
    // agent's work missing from it, and nothing in the record to say the agent was ever asked for.
    let fault = orch
        .fault
        .raised()
        .expect("an agent gg cannot stand up ends the run, not only itself");
    assert!(
        fault.contains("`ghost`") && fault.contains(&format!("`{ROOT_AGENT_ID}`")),
        "the run-level diagnostic must name the agent and the profile it was asked to run as: \
         {fault}"
    );
}

/// The base every `exec` case here builds on: a root that may `exec` into the profile `After`,
/// which this set leaves for the caller to declare (or not).
fn exec_roster_set() -> GgCapabilitySet {
    let mut root = GgAgentConfig {
        name: ROOT_AGENT.to_string(),
        model_id: "mock/exec-before".to_string(),
        subagents: vec![GgSubagentRef {
            agent_id: "after".to_string(),
            description: String::new(),
            scopes: ALL_SUBAGENT_SCOPES.to_vec(),
        }],
        ..GgAgentConfig::root()
    };
    root.capabilities = vec![
        GgCapabilityConfig::enabled(CAPABILITY_EXEC),
        GgCapabilityConfig::enabled(CAPABILITY_TASKS),
    ];
    // The profile replaces its capabilities wholesale, so it replaces the allowlists the default
    // came with: those name the *defaults'* calls, which this agent no longer has.
    crate::tools::grant_all(&mut root);
    GgCapabilitySet {
        agents: vec![root],
        ..GgCapabilitySet::default()
    }
}

/// [`exec_roster_set`] with `After` declared as an **FSM shell** whose entry state runs a profile
/// the set does not declare.
///
/// This is how the undeclared-successor site is reached now that a resolved roster is resolved: an
/// entry pointing at nothing is dropped before the model is offered it, so the target the model
/// names always resolves. What can still come apart is the hop *after* it — an `exec` onto a shell
/// enters the machine, and the profile the successor actually runs is the entry state's, which is a
/// second reference and a second thing launch validation is the only guard on.
fn undeclared_entry_state_set() -> GgCapabilitySet {
    let mut set = exec_roster_set();
    set.agents.push(GgAgentConfig {
        slug: "after".to_string(),
        name: "The Successor".to_string(),
        model_id: String::new(),
        capabilities: vec![GgCapabilityConfig {
            params: json!({ "states": [{ "name": "only", "agentId": "ghost" }] }),
            ..GgCapabilityConfig::enabled(test_cabinet_core::gg::CAPABILITY_FSM)
        }],
        ..GgAgentConfig::root()
    });
    set
}

/// A succession into a profile the run does not declare ends the session rather than succeeding
/// into whichever profile happens to be first.
///
/// The `exec` itself is accepted — its target is a declared profile on the spawner's roster, which
/// is all a handoff is checked against — and the machine that target names then enters a state
/// whose own profile resolves to nothing. So this is the exact shape the defect takes in the wild:
/// a reference that looked legal all the way to the point of standing an agent up.
#[tokio::test]
async fn an_undeclared_successor_profile_ends_the_session_with_internal_error() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-exec-ghost".to_string()), Box::new(sink.clone()));
    let orch = orchestrator(dir.path(), undeclared_entry_state_set(), &emitter);

    let end = drive_profile(
        &orch,
        ROOT_PROFILE_ID,
        Box::new(MockClient::with_exec_before_script("mock/exec-before")),
    )
    .await;

    assert_eq!(end.status, STATUS_INTERNAL_ERROR);
    assert!(
        end.handoff.is_none(),
        "a succession that cannot be resolved is not a succession the run performed"
    );
    let errors = error_messages(&sink.events());
    assert!(
        errors
            .iter()
            .any(|message| message.contains("`ghost`")
                && message.contains("not declared by this run")),
        "the diagnostic must name the successor that is missing: {errors:?}"
    );
    // The predecessor's work is in the tree and the successor's is not, so the run this would leave
    // is the shape the latch exists for: half a lineage, scored as though it were a whole one.
    assert!(
        orch.fault
            .raised()
            .is_some_and(|fault| fault.contains("`ghost`")),
        "a succession gg cannot resolve ends the run, not only the agent that tried to make it"
    );
}

/// The [`exec_roster_set`] with `After` **declared** and left unbound: the name resolves, and
/// there is still no model to run the successor on.
///
/// [`crate::validate::validate_launch`] rejects this set as firmly as it rejects the undeclared state agent above — a
/// profile that is not an FSM shell must have a model — so an agent reaching it has been handed a
/// configuration gg promised could not exist.
fn modelless_successor_set() -> GgCapabilitySet {
    let mut set = exec_roster_set();
    set.agents.push(GgAgentConfig {
        slug: "after".to_string(),
        name: "The Successor".to_string(),
        model_id: String::new(),
        ..GgAgentConfig::root()
    });
    set
}

/// A client factory that refuses every resolution the way a run with no credential does.
///
/// The one failure at these sites that is **not** gg's: it needs no defect to happen, since a run
/// whose root binds a mock model launches without a credential at all and only meets the refusal
/// when an agent binds a live model.
struct KeylessFactory;

impl ClientFactory for KeylessFactory {
    fn client_for(&self, _binding: &GgSlotBinding) -> Result<Box<dyn ModelClient>, ModelError> {
        Err(ModelError::MissingApiKey)
    }
}

/// A succession into a profile that is declared but has **no model bound** ends the session as gg's
/// own defect, exactly as an undeclared one does.
///
/// The two are one failure wearing two faces — a name that resolves to nothing runnable — and
/// launch validation rejects both, so both are evidence about gg. Ending here on `model_error`
/// would file our accepted-then-unrunnable configuration against a model that was never asked for a
/// turn.
#[tokio::test]
async fn a_successor_with_no_model_bound_ends_the_session_with_internal_error() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-exec-unbound".to_string()), Box::new(sink.clone()));
    let orch = orchestrator(dir.path(), modelless_successor_set(), &emitter);

    let end = drive_profile(
        &orch,
        ROOT_PROFILE_ID,
        Box::new(MockClient::with_exec_before_script("mock/exec-before")),
    )
    .await;

    assert_eq!(
        end.status, STATUS_INTERNAL_ERROR,
        "a profile launch validation promised was runnable is gg's defect, not the model's failure"
    );
    let errors = error_messages(&sink.events());
    assert!(
        errors
            .iter()
            .any(|message| message.contains("`after`") && message.contains("no model bound")),
        "the diagnostic must name the successor and what is missing from it: {errors:?}"
    );
    assert!(
        orch.fault
            .raised()
            .is_some_and(|fault| fault.contains("`after`")),
        "and it ends the run, on the same terms as the undeclared name it is a face of"
    );
}

/// A succession whose client is refused for want of a **credential** ends the session on the
/// operator's status, not on gg's and not on the model's.
///
/// The counterpart that keeps the rule from collapsing into "anything that is not the model is gg":
/// nothing here is a defect, and the run has to say so, because a refused key is fixed by supplying
/// one.
#[tokio::test]
async fn a_successor_whose_credential_is_refused_ends_the_session_with_auth_error() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-exec-keyless".to_string()), Box::new(sink.clone()));
    let mut set = exec_roster_set();
    set.agents.push(GgAgentConfig {
        slug: "after".to_string(),
        name: "The Successor".to_string(),
        model_id: "openrouter/live".to_string(),
        ..GgAgentConfig::root()
    });
    let orch = orchestrator_with(dir.path(), set, Arc::new(KeylessFactory), &emitter);

    let end = drive_profile(
        &orch,
        ROOT_PROFILE_ID,
        Box::new(MockClient::with_exec_before_script("mock/exec-before")),
    )
    .await;

    assert_eq!(
        end.status, STATUS_AUTH_ERROR,
        "a refused credential is the operator's to fix, and gg must not report it as its own defect"
    );
    assert_eq!(
        orch.fault.raised(),
        None,
        "and nothing about it is a defect, so no fault is latched and no other agent winds down"
    );
}

/// The set the two **whole-session** cases below run on: the [exec roster](exec_roster_set)
/// with `after` declared and bound to a live model, so nothing about it is a configuration a launch
/// would refuse.
fn live_successor_set() -> GgCapabilitySet {
    let mut set = exec_roster_set();
    set.agents.push(GgAgentConfig {
        slug: "after".to_string(),
        name: "The Successor".to_string(),
        model_id: "openrouter/live".to_string(),
        ..GgAgentConfig::root()
    });
    set
}

/// A factory that stands the **root** up on the exec script and answers every other profile with
/// `refusal`.
///
/// The session's own launch resolves the root's client through this too, which is why the root is
/// answered rather than refused: a refusal there would fail the launch, and what these cases are
/// about is a resolution that fails once the run is already under way.
struct RefusingFactory {
    /// What every non-root resolution meets. A function rather than a value because
    /// [`ModelError`] is not `Clone` and one factory answers as many resolutions as the run makes.
    refusal: fn() -> ModelError,
}

impl ClientFactory for RefusingFactory {
    fn client_for(&self, binding: &GgSlotBinding) -> Result<Box<dyn ModelClient>, ModelError> {
        if binding.slot == ROOT_PROFILE_ID {
            return Ok(Box::new(MockClient::with_exec_before_script(
                &binding.model_id,
            )));
        }
        Err((self.refusal)())
    }
}

/// The status of the session's terminal [`SessionEnded`](GgTelemetryKind::SessionEnded) — what
/// `core` reads to decide whether the run is a result or a harness error.
fn terminal_status(events: &[GgTelemetryEvent]) -> Option<String> {
    events.iter().rev().find_map(|event| match &event.kind {
        GgTelemetryKind::SessionEnded { status } => Some(status.clone()),
        _ => None,
    })
}

/// **A succession whose client gg cannot build takes the whole session down with it** — driven
/// through the real entry point, with the launch checks in force.
///
/// The one failure in this family a validated configuration can still reach: `After` is declared,
/// bound and accepted at launch, and the provider for it cannot be built when the exec asks for it.
/// So this is the case that proves the rest of the chain the tests above stop short of — the latch
/// is read by the session epilogue, the terminal status is gg's, and the process exits non-zero so
/// the host records a harness error instead of collecting a tree.
///
/// Without that chain the run ends exactly as this one does *for the agent* and `completed` for the
/// session: a root that got two turns in, an `exec` that silently did not happen, and a tree scored
/// against the model as if the configuration had run.
#[tokio::test]
async fn a_session_whose_succession_cannot_be_built_ends_as_gg_s_defect() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-exec-broken".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), live_successor_set());

    let outcome = run_with_factory(
        &inv,
        &emitter,
        Arc::new(RefusingFactory {
            refusal: || ModelError::parse("no provider could be built".to_string()),
        }),
    )
    .await;

    assert_eq!(
        outcome,
        SessionOutcome::HarnessError,
        "a run gg broke exits non-zero so `core` records a harness error instead of scoring it"
    );
    let events = sink.events();
    assert_eq!(
        terminal_status(&events).as_deref(),
        Some(STATUS_INTERNAL_ERROR),
        "the session says whose fault it was, and a provider gg could not build is ours"
    );
    let errors = error_messages(&events);
    assert!(
        errors.iter().any(|message| message.contains("`after`")
            && message.contains(&format!("`{STATUS_INTERNAL_ERROR}`"))),
        "the run-level diagnostic must name the profile gg could not resolve: {errors:?}"
    );
}

/// **The same session, refused a credential instead, is not gg's defect.**
///
/// The negative half, and the one that decides whether the rule is a rule or a catch-all. A missing
/// key is the operator's to supply: the session still ends — the root cannot succeed into an agent
/// it has no client for — but it ends `auth_error`, with no fault raised and nothing in the record
/// claiming gg broke. A run disqualified as our defect over an unset environment variable is a bug
/// report nobody can act on.
#[tokio::test]
async fn a_session_whose_succession_has_no_credential_is_not_gg_s_defect() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-exec-nokey".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), live_successor_set());

    run_with_factory(
        &inv,
        &emitter,
        Arc::new(RefusingFactory {
            refusal: || ModelError::MissingApiKey,
        }),
    )
    .await;

    let events = sink.events();
    assert_eq!(
        terminal_status(&events).as_deref(),
        Some(STATUS_AUTH_ERROR),
        "the operator's missing key is reported as theirs, whatever it stopped"
    );
    assert!(
        !error_messages(&events)
            .iter()
            .any(|message| message.contains(STATUS_INTERNAL_ERROR)),
        "nothing in the record may say gg broke, because nothing did"
    );
}

/// A spawner whose own profile is undeclared has no roster to spawn from, and the delegation call
/// fails naming the defect instead of borrowing the root's allowlist — which would let one profile
/// spawn on another profile's authority.
#[test]
fn an_undeclared_spawner_profile_fails_the_delegation_call() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-spawn-ghost".to_string()), Box::new(sink.clone()));
    let mut set = GgCapabilitySet::minimal("mock/primary");
    set.agents[0].capabilities = vec![GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS)];
    let orch = orchestrator(dir.path(), set, &emitter);

    let spawner = Agent {
        profile_id: "ghost".to_string(),
        ..Agent::root(ROOT_PROFILE_ID)
    };
    let outcome = resolve_delegation_target(&orch, &spawner, &json!({ "agent": ROOT_PROFILE_ID }))
        .expect_err("a spawner with no declared profile has no roster to check against");

    let rendered = format!("{outcome:?}");
    assert!(
        rendered.contains("`ghost`") && rendered.contains("not declared by this run"),
        "the refusal must name the profile that is missing: {rendered}"
    );
}

/// A client factory that refuses every resolution for a reason that is **not** a credential.
///
/// The other side of [`KeylessFactory`]: a provider gg could not build for a profile launch
/// validation accepted is gg's defect, so it must be told apart from a key the operator has not
/// supplied — at every site that resolves a client, not only at the ones that noticed first.
struct BrokenFactory;

impl ClientFactory for BrokenFactory {
    fn client_for(&self, _binding: &GgSlotBinding) -> Result<Box<dyn ModelClient>, ModelError> {
        Err(ModelError::parse("no provider could be built".to_string()))
    }
}

/// A root that may spawn `unbound`, with `unbound` declared and left with no model.
///
/// The spawn path's version of [`modelless_successor_set`]: the name is on the spawner's roster, so
/// `can_spawn` accepts it and the dispatch gets as far as binding a model that is not there.
fn modelless_spawnee_set() -> GgCapabilitySet {
    let mut root = GgAgentConfig {
        name: ROOT_AGENT.to_string(),
        model_id: "mock/primary".to_string(),
        subagents: vec![GgSubagentRef {
            agent_id: "unbound".to_string(),
            description: String::new(),
            scopes: ALL_SUBAGENT_SCOPES.to_vec(),
        }],
        ..GgAgentConfig::root()
    };
    root.capabilities = vec![GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS)];
    crate::tools::grant_all(&mut root);
    GgCapabilitySet {
        agents: vec![
            root,
            GgAgentConfig {
                slug: "unbound".to_string(),
                name: "The Unbound One".to_string(),
                model_id: String::new(),
                ..GgAgentConfig::root()
            },
        ],
        ..GgCapabilitySet::default()
    }
}

/// Dispatch one child of `spawner_profile_id` under the profile `profile`, the way a `spawn_subagent`
/// call does, and hand back the refusal.
///
/// Built here rather than driven through a model script because what these cases are about is the
/// dispatch's own resolution: the call that reaches it has already passed the roster check, which is
/// precisely why a failure past that point is gg's rather than the model's.
fn dispatch_refusal(
    orch: &Arc<Orchestrator>,
    spawner_profile_id: &str,
    profile: &str,
) -> DispatchError {
    let (_inbox_tx, inbox_rx) = mpsc::unbounded_channel();
    let mut sub = SubagentContext {
        orch: Arc::clone(orch),
        ctx: AgentCtx::new(inbox_rx, None, SlotHold::default()),
        inherited: InheritedModules::default(),
    };
    let spawner = Agent {
        profile_id: spawner_profile_id.to_string(),
        ..Agent::root(ROOT_PROFILE_ID)
    };
    dispatch_child(&mut sub, &spawner, ChildSpec::new(profile, "Do the thing."))
        .err()
        .expect("the dispatch cannot resolve a model for this profile")
}

/// **A spawn of a declared profile gg cannot bind is gg's defect, not a bad argument.**
///
/// By the time a dispatch resolves a binding the name has passed the spawner's own roster, and
/// launch validation has already rejected both a roster reference to an undeclared profile and a
/// profile bound to an empty model id. So this state is gg reading one configuration two ways —
/// and the model, which chose the name out of the roster this run handed it, has nothing better to
/// pass. Telling it `agent` was invalid would file gg's defect in the model's tool-error record and
/// leave the run to be scored around a subagent that never existed.
#[test]
fn a_spawn_of_an_unbindable_profile_ends_the_run_rather_than_blaming_the_argument() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(
        Some("run-spawn-unbound".to_string()),
        Box::new(sink.clone()),
    );
    let orch = orchestrator(dir.path(), modelless_spawnee_set(), &emitter);

    let refusal = dispatch_refusal(&orch, ROOT_PROFILE_ID, "unbound");

    assert_ne!(
        refusal.failure,
        ToolFailure::InvalidArgument,
        "a name the run's own roster offered is not an argument the model got wrong"
    );
    assert_eq!(refusal.failure, ToolFailure::Refused);
    let message = refusal.to_string();
    assert!(
        message.contains("`unbound`") && message.contains("gg defect"),
        "the refusal must name the profile and whose failure it is: {message}"
    );
    let fault = orch
        .fault
        .raised()
        .expect("a subagent gg could not stand up ends the run");
    assert!(
        fault.contains("`unbound`"),
        "the run-level diagnostic must name the profile gg could not stand up: {fault}"
    );
}

/// **A spawn whose client will not build for a reason other than a credential is gg's too.**
///
/// The binding resolved, so the profile is declared and has a model; what failed is building a
/// provider for it. That is the same accepted-then-unrunnable configuration one step later, and it
/// was reported as an I/O failure the spawner recovered from while the run carried on being scored.
#[test]
fn a_spawn_whose_client_cannot_be_built_ends_the_run() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-spawn-broken".to_string()), Box::new(sink.clone()));
    let mut set = modelless_spawnee_set();
    set.agents[1].model_id = "mock/secondary".to_string();
    let orch = orchestrator_with(dir.path(), set, Arc::new(BrokenFactory), &emitter);

    let refusal = dispatch_refusal(&orch, ROOT_PROFILE_ID, "unbound");

    assert_eq!(refusal.failure, ToolFailure::Refused);
    assert!(
        orch.fault
            .raised()
            .is_some_and(|fault| fault.contains("`unbound`")),
        "a provider gg could not build for a profile it validated is gg's defect"
    );
}

/// **A spawn whose credential is refused fails the call and leaves the run alone.**
///
/// The half of the split that keeps the rule honest. Nothing is broken: a key is supplied rather
/// than fixed, the child simply took no turns, and the run around it is still a run the model
/// produced. Reporting this as gg's defect would discard a whole run over a missing environment
/// variable.
#[test]
fn a_spawn_whose_credential_is_refused_does_not_end_the_run() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(
        Some("run-spawn-keyless".to_string()),
        Box::new(sink.clone()),
    );
    let mut set = modelless_spawnee_set();
    set.agents[1].model_id = "openrouter/live".to_string();
    let orch = orchestrator_with(dir.path(), set, Arc::new(KeylessFactory), &emitter);

    let refusal = dispatch_refusal(&orch, ROOT_PROFILE_ID, "unbound");

    assert_eq!(
        refusal.failure,
        ToolFailure::IoError,
        "a refused key is an I/O failure the spawner can report and recover from"
    );
    assert_eq!(
        orch.fault.raised(),
        None,
        "a missing credential must never disqualify a run gg was working correctly"
    );
}

/// The set the board case runs on: project management enabled, so the run has a live board.
fn board_set() -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal("mock/primary");
    set.agents[0].capabilities = vec![GgCapabilityConfig::enabled(CAPABILITY_PROJECT_MANAGEMENT)];
    crate::tools::grant_all(&mut set.agents[0]);
    set
}

/// File one issue **straight into the store**, assigned to `agent` and gated by `reviewers`.
///
/// Which is where the defect would have to originate: the board *tools* hold a filer to its own
/// implementers and its own reviewers, so no model can write either of the issues below.
fn file_issue(orch: &Orchestrator, agent: &str, reviewers: &[String]) -> String {
    orch.board
        .store()
        .lock()
        .expect("board store lock")
        .create_issue(NewIssue {
            title: "Wire the thing",
            description: None,
            in_scope: "the thing",
            out_of_scope: "everything else",
            completion_criteria: "the thing is wired",
            blocked_by: &[],
            epic_id: None,
            agent,
            reviewers,
        })
        .expect("the store files an issue whoever it names")
}

/// An issue assigned to a profile the run does not declare is **failed**, not dispatched under the
/// root.
///
/// Failing it is what an operator can act on: the issue turns red on the board they are watching,
/// its dependents are woken instead of hanging on it forever, and the reason names both the issue
/// and the assignee. Dispatching it under the root would have produced a green issue implemented by
/// an agent nobody asked for, which is the one outcome no one can detect.
#[tokio::test]
async fn an_issue_assigned_to_an_undeclared_profile_fails_rather_than_dispatching() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-issue-ghost".to_string()), Box::new(sink.clone()));
    let orch = orchestrator(dir.path(), board_set(), &emitter);
    let issue_id = file_issue(&orch, "ghost", &[]);

    orch.spawn_issue_agent(
        "agent-ghost-1".to_string(),
        issue_id.clone(),
        "Implement it.".to_string(),
        0,
        &emitter,
    );

    assert_eq!(
        orch.board.issue_status(&issue_id),
        Some(IssueStatus::Failed),
        "an issue nobody declared can implement is failed, not quietly reassigned"
    );
    let errors = error_messages(&sink.events());
    assert!(
        errors
            .iter()
            .any(|message| message.contains(&issue_id) && message.contains("`ghost`")),
        "the diagnostic must name both the issue and the assignee: {errors:?}"
    );
    // ...and the run ends with it. A red issue on the board is visible, but the tree this run would
    // leave is missing whatever that issue was for, and scoring it would report gg's defect as the
    // model's shortfall.
    let fault = orch
        .fault
        .raised()
        .expect("a dispatch gg's own defect stopped ends the run");
    assert!(
        fault.contains(&issue_id) && fault.contains("`ghost`"),
        "the run-level diagnostic must name the issue and the assignee: {fault}"
    );
}

/// **An issue agent whose credential is refused fails its issue and leaves the run alone.**
///
/// The board dispatch draws the same split every other site that resolves a client draws, and this
/// is the half that costs a *healthy* run when it goes wrong. A missing API key is the operator's
/// to supply: gg read its configuration correctly, the issue is honestly failed because nobody
/// worked it, and the run around it is still a run the model produced. Filing it as gg's defect
/// instead would latch the run's [fault](crate::fault), end the session on `internal_error` and
/// exit non-zero — discarding a whole run over an environment variable, and telling the operator
/// their key is our bug.
///
/// Its opposite number — a provider that will not build, which *is* gg's — is driven through the
/// real entry point further down this file. Both directions have to be held or the split survives
/// as a coin toss that happens to be landing the right way up.
#[tokio::test]
async fn an_issue_agent_with_no_credential_fails_the_issue_alone() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(
        Some("run-issue-keyless".to_string()),
        Box::new(sink.clone()),
    );
    // Assigned to the root's own profile, which is declared and bound: the name resolves and the
    // model binds, so the credential is the only thing left to refuse — the arm the undeclared and
    // unbindable cases above can never reach.
    let orch = orchestrator_with(dir.path(), board_set(), Arc::new(KeylessFactory), &emitter);
    let issue_id = file_issue(&orch, ROOT_PROFILE_ID, &[]);

    orch.spawn_issue_agent(
        "agent-keyless-1".to_string(),
        issue_id.clone(),
        "Implement it.".to_string(),
        0,
        &emitter,
    );

    assert_eq!(
        orch.board.issue_status(&issue_id),
        Some(IssueStatus::Failed),
        "an issue gg could not stand an agent up for is not an issue somebody worked"
    );
    assert_eq!(
        orch.fault.raised(),
        None,
        "a refused credential is the operator's to supply, and must never disqualify a run gg was \
         working correctly"
    );
    let errors = error_messages(&sink.events());
    assert!(
        errors.iter().any(|message| message.contains(&issue_id)),
        "the operator is still told which issue went unworked: {errors:?}"
    );
    assert!(
        !errors.iter().any(|message| message.contains("gg defect")),
        "and told it in gg's words for somebody else's problem, not for one of ours: {errors:?}"
    );
}

/// An issue whose reviewer is a profile the run does not declare is **failed**, not merged.
///
/// The assignee case one step further along the same board path, and the more dangerous half of it.
/// An assignee that cannot be resolved stalls an issue, which is visible; a reviewer that cannot be
/// resolved would simply vanish from it, and the issue its filer gated on a review would be
/// accepted and merged without one — carrying no review telemetry to say a gate was ever asked for.
#[tokio::test]
async fn an_issue_whose_reviewer_is_undeclared_fails_rather_than_merging() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-review-ghost".to_string()), Box::new(sink.clone()));
    let orch = orchestrator(dir.path(), board_set(), &emitter);
    let issue_id = file_issue(&orch, ROOT_PROFILE_ID, &["Auditor".to_string()]);

    // The agent working the issue finished: everything from here is gg reconciling the board, which
    // is where the review it demanded either happens or is silently skipped.
    reconcile_issue(&orch, &issue_id, 0, true, &emitter).await;

    assert_eq!(
        orch.board.issue_status(&issue_id),
        Some(IssueStatus::Failed),
        "work whose gate resolves to nobody is not work that passed its gate"
    );
    let errors = error_messages(&sink.events());
    assert!(
        errors
            .iter()
            .any(|message| message.contains(&issue_id) && message.contains("`Auditor`")),
        "the diagnostic must name both the issue and the missing reviewer: {errors:?}"
    );
    assert!(
        orch.fault
            .raised()
            .is_some_and(|fault| fault.contains(&issue_id)),
        "a review gg could not dispatch ends the run: a run missing a gate it was configured to \
         apply cannot be compared with one that applied it"
    );
}

/// [`board_set`] with `unbound` declared as a second profile carrying no model, and named on the
/// root's roster as a reviewer.
///
/// The reviewer path's version of [`modelless_spawnee_set`]: the name is declared, so the check
/// that guards the reviewer roster passes, and the dispatch one step later is where the missing
/// model is met.
fn modelless_reviewer_set() -> GgCapabilitySet {
    let mut set = board_set();
    set.agents[0].subagents = vec![GgSubagentRef {
        agent_id: "unbound".to_string(),
        description: String::new(),
        scopes: ALL_SUBAGENT_SCOPES.to_vec(),
    }];
    set.agents.push(GgAgentConfig {
        slug: "unbound".to_string(),
        name: "The Unbound One".to_string(),
        model_id: String::new(),
        ..GgAgentConfig::root()
    });
    set
}

/// **A reviewer the run declares but cannot bind a model to ends the run**, exactly as an
/// undeclared one does.
///
/// The name check one step earlier catches only the reviewer nothing declares. A reviewer that is
/// declared and unbindable reaches the dispatch, where the failure used to fail the issue and leave
/// the run to be scored — with the gate the issue was filed under never applied, and nothing in the
/// tree to say a review was ever attempted.
#[tokio::test]
async fn an_issues_unbindable_reviewer_ends_the_run() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(
        Some("run-review-unbound".to_string()),
        Box::new(sink.clone()),
    );
    let orch = orchestrator(dir.path(), modelless_reviewer_set(), &emitter);
    let issue_id = file_issue(&orch, ROOT_PROFILE_ID, &["unbound".to_string()]);

    reconcile_issue(&orch, &issue_id, 0, true, &emitter).await;

    assert_eq!(
        orch.board.issue_status(&issue_id),
        Some(IssueStatus::Failed),
        "work whose gate could not be dispatched is not work that passed its gate"
    );
    let fault = orch
        .fault
        .raised()
        .expect("a review gg could not dispatch ends the run");
    assert!(
        fault.contains(&issue_id) && fault.contains("`unbound`"),
        "the run-level diagnostic must name the issue and the reviewer: {fault}"
    );
}

/// **A reviewer gg can bind but cannot build a client for ends the run too.**
///
/// One step further along the same dispatch than the case above, and the step the spawn path is
/// tested at but this one was not: the profile is declared *and* has a model, so the binding
/// resolves, and building a provider for it is what fails. The three resolutions a
/// [detached dispatch](run_detached_agent) makes — the name, the binding, the client — must all be
/// gg's when they fail for gg's reasons, or the rule holds at whichever of them somebody happened to
/// write a test for.
///
/// The consequence is what makes it worth the third test: the issue was filed with a review gate,
/// the review never happened, and a run whose gate was silently skipped is not comparable with one
/// where it was applied.
#[tokio::test]
async fn an_issues_reviewer_whose_client_cannot_be_built_ends_the_run() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(
        Some("run-review-broken".to_string()),
        Box::new(sink.clone()),
    );
    let mut set = modelless_reviewer_set();
    // Bound to a model, so the failure is the *provider* rather than the binding — the arm the
    // unbindable case above can never reach.
    set.agents[1].model_id = "mock/secondary".to_string();
    let orch = orchestrator_with(dir.path(), set, Arc::new(BrokenFactory), &emitter);
    let issue_id = file_issue(&orch, ROOT_PROFILE_ID, &["unbound".to_string()]);

    reconcile_issue(&orch, &issue_id, 0, true, &emitter).await;

    assert_eq!(
        orch.board.issue_status(&issue_id),
        Some(IssueStatus::Failed),
        "work whose gate could not be dispatched is not work that passed its gate"
    );
    let fault = orch
        .fault
        .raised()
        .expect("a review gg could not dispatch ends the run");
    assert!(
        fault.contains(&issue_id) && fault.contains("`unbound`"),
        "the run-level diagnostic must name the issue and the reviewer: {fault}"
    );
    assert!(
        fault.contains("mock/secondary"),
        "and the model it could not build a provider for, which is what tells this failure from a \
         profile that had no model at all: {fault}"
    );
}

/// **A reviewer whose credential is refused fails its issue and leaves the run alone.**
///
/// The counterpart that keeps the reviewer split from collapsing into "any reviewer that did not
/// run is gg's fault". The issue still fails, because an ungated issue must not be merged as though
/// it had passed, and the run around it is still a run the model produced.
#[tokio::test]
async fn an_issues_reviewer_with_no_credential_fails_the_issue_alone() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(
        Some("run-review-keyless".to_string()),
        Box::new(sink.clone()),
    );
    let mut set = modelless_reviewer_set();
    set.agents[1].model_id = "openrouter/live".to_string();
    let orch = orchestrator_with(dir.path(), set, Arc::new(KeylessFactory), &emitter);
    let issue_id = file_issue(&orch, ROOT_PROFILE_ID, &["unbound".to_string()]);

    reconcile_issue(&orch, &issue_id, 0, true, &emitter).await;

    assert_eq!(
        orch.board.issue_status(&issue_id),
        Some(IssueStatus::Failed),
        "an issue whose gate never ran is not accepted"
    );
    assert_eq!(
        orch.fault.raised(),
        None,
        "a refused credential is the operator's to supply, not a defect that disqualifies the run"
    );
}

/// An issue that named no reviewers at all is accepted the moment its agent finishes.
///
/// The other half of the distinction above: naming nobody is a legitimate way to file an issue, so
/// the check on the reviewers an issue *did* name must not turn a board run without reviewers into
/// a board run that fails everything.
#[tokio::test]
async fn an_issue_that_named_no_reviewers_is_accepted_without_review() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-review-none".to_string()), Box::new(sink.clone()));
    let orch = orchestrator(dir.path(), board_set(), &emitter);
    let issue_id = file_issue(&orch, ROOT_PROFILE_ID, &[]);

    reconcile_issue(&orch, &issue_id, 0, true, &emitter).await;

    assert_eq!(
        orch.board.issue_status(&issue_id),
        Some(IssueStatus::Done),
        "an issue with nobody to gate it is accepted as soon as its agent finishes"
    );
    assert!(
        error_messages(&sink.events()).is_empty(),
        "an issue that named no reviewers reports no defect"
    );
    assert_eq!(
        orch.fault.raised(),
        None,
        "and no defect means no fault: this run is still a run the model produced"
    );
}

// ---------------------------------------------------------------------------------------------
// The board's dispatch, through the real entry point
// ---------------------------------------------------------------------------------------------

/// A factory that stands the **root** up on `script` and refuses every other profile with a failure
/// that is not a credential.
///
/// The board's version of [`RefusingFactory`], and it exists for the same reason: the session
/// resolves the root's client at launch, so a factory that refused everything would fail the launch
/// instead of the dispatch the case is about. The script is cloned per resolution because a factory
/// answers as many times as the run asks and [`ModelResponse`] carries no shared handle.
struct RefusingBelowRoot {
    /// What the root is driven by.
    script: Vec<ModelResponse>,
}

impl ClientFactory for RefusingBelowRoot {
    fn client_for(&self, binding: &GgSlotBinding) -> Result<Box<dyn ModelClient>, ModelError> {
        if binding.slot == ROOT_PROFILE_ID {
            return Ok(Box::new(MockClient::new(
                &binding.model_id,
                self.script.clone(),
            )));
        }
        Err(ModelError::parse("no provider could be built".to_string()))
    }
}

/// **An issue gg could not stand an agent up for ends the whole session, and the record says so.**
///
/// The board dispatch is the one site in this family whose failure nobody is holding a handle to:
/// there is no spawner to report to and no agent to end, only a red issue on a board. Every other
/// test of it reads the [latch](crate::fault) directly, which proves the fault was *raised* and
/// nothing about what the fault is **for** — and what it is for is spent in the session epilogue,
/// hundreds of lines away, on a value read once. A raised latch that the epilogue stopped reading
/// would leave every one of those tests green while gg handed `core` a tree to score with an issue's
/// whole work missing from it.
///
/// So this drives the real entry point: the root files the issue, gg cannot build a provider for the
/// assignee it validated, and the session must end under gg's own status with a run-level line
/// naming the issue.
#[tokio::test]
async fn a_session_whose_issue_agent_cannot_be_built_ends_as_gg_s_defect() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-issue-broken".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), split_project_set());

    let outcome = run_with_factory(
        &inv,
        &emitter,
        Arc::new(RefusingBelowRoot {
            // Files the work, then finishes — the shape that used to leave a session `completed`
            // with the filed work never attempted.
            script: vec![create_issue_for_coder(), stop_response()],
        }),
    )
    .await;

    assert_eq!(
        outcome,
        SessionOutcome::HarnessError,
        "a run gg broke exits non-zero so `core` records a harness error instead of scoring it"
    );
    let events = sink.events();
    assert_eq!(
        terminal_status(&events).as_deref(),
        Some(STATUS_INTERNAL_ERROR),
        "the session's status comes from the latch, whatever the root's own loop went on to do"
    );
    assert_eq!(
        last_issue_status(&events, UNGROUPED_ISSUE_ID),
        Some(GgIssueStatus::Failed),
        "the board says the work did not happen, which is the operator's half of the same fact"
    );
    let errors = error_messages(&events);
    assert!(
        errors
            .iter()
            .any(|message| message.contains(UNGROUPED_ISSUE_ID)
                && message.contains(&format!("`{CODER_PROFILE_ID}`"))
                && message.contains(&format!("`{STATUS_INTERNAL_ERROR}`"))),
        "the run-level diagnostic must name the issue and the assignee gg could not stand up: \
         {errors:?}"
    );
}
