use super::*;
use serde_json::json;
use test_cabinet_core::gg::{
    GgAgentConfig, GgCapabilityConfig, GgCapabilitySet, GgDispatchError, GgSubagentRef,
    GgSubagentScope, ROOT_AGENT,
};

/// An ordinary (non-shell) agent profile bound to the mock model.
fn agent(name: &str) -> GgAgentConfig {
    GgAgentConfig {
        name: name.to_string(),
        model_id: "mock/echo".to_string(),
        ..GgAgentConfig::root()
    }
}

/// The `fsm` capability declaring `states`.
fn fsm_capability(states: Value) -> GgCapabilityConfig {
    GgCapabilityConfig {
        params: json!({ FSM_PARAM_STATES: states }),
        ..GgCapabilityConfig::enabled(CAPABILITY_FSM)
    }
}

/// A capability set whose root is an FSM shell driving `states`, plus one ordinary profile per
/// name in `agents`.
fn machine_set(states: Value, agents: &[&str]) -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal("mock/echo");
    // A **bare** shell: the machine and nothing else — no model binding, no other capability. This
    // is the shape the editor writes, and anything more would earn the "what it declares is
    // ignored" warning in every test here, which is the one this file checks for on purpose.
    set.agents[0].capabilities.clear();
    crate::tools::grant_configured(&mut set.agents[0], fsm_capability(states));
    set.agents[0].model_id = String::new();
    for name in agents {
        set.agents.push(agent(name));
    }
    set
}

/// The two-state machine most of these tests are about: `explore → build`, carrying the window and
/// the task list.
fn two_state() -> Value {
    json!([
        {
            "name": "explore",
            "agent": "Explorer",
            "transitions": [
                { "to": "build", "transfer": ["history", "tasks"], "description": "when you have a plan" }
            ]
        },
        { "name": "build", "agent": "Builder" }
    ])
}

/// The machine is read off the shell's `states` param: its entry state is the first declared, and
/// every state's agent and edges come through intact.
#[test]
fn a_machine_is_resolved_from_the_states_param() {
    let set = machine_set(two_state(), &["Explorer", "Builder"]);
    let spec = FsmSpec::resolve(&set.agents[0])
        .expect("the root declares a machine")
        .expect("it parses");
    assert_eq!(spec.fsm, "Root");
    assert_eq!(spec.entry, "explore");
    assert_eq!(spec.states.len(), 2);
    let explore = spec.state("explore").expect("the entry state");
    assert_eq!(explore.agent, "Explorer");
    assert_eq!(
        explore.transitions,
        vec![FsmTransitionSpec {
            to: "build".to_string(),
            transfer: vec![ModuleKind::History, ModuleKind::Tasks],
            description: "when you have a plan".to_string(),
        }]
    );
    assert!(
        spec.state("build")
            .expect("the second state")
            .transitions
            .is_empty(),
        "a state with no declared transitions is terminal"
    );
}

/// A profile without the capability declares no machine at all — the overwhelmingly common case,
/// and the one that must cost nothing.
#[test]
fn a_profile_without_the_capability_declares_no_machine() {
    let set = GgCapabilitySet::minimal("mock/echo");
    assert!(FsmSpec::resolve(&set.agents[0]).is_none());
    assert!(machines(&set).expect("no machines to build").is_empty());
}

/// A run with the capability off asks for nothing, so it gets nothing — not an error.
#[test]
fn a_disabled_capability_declares_no_machine() {
    let mut set = GgCapabilitySet::minimal("mock/echo");
    set.agents[0]
        .capabilities
        .push(GgCapabilityConfig::disabled(CAPABILITY_FSM));
    assert!(FsmSpec::resolve(&set.agents[0]).is_none());
}

/// An enabled capability with no `states` is the shape a set written against the removed built-in
/// machines has. It is a **launch failure**, not a silent degradation to an ordinary agent.
#[test]
fn an_enabled_capability_without_states_is_a_launch_failure() {
    let mut set = GgCapabilitySet::minimal("mock/echo");
    crate::tools::grant_configured(
        &mut set.agents[0],
        GgCapabilityConfig {
            params: json!({ "machine": "tdd" }),
            ..GgCapabilityConfig::enabled(CAPABILITY_FSM)
        },
    );
    let error = validate(&set).expect_err("a machine-less FSM agent cannot run");
    assert!(error.contains(FSM_PARAM_STATES), "{error}");
    assert!(error.contains("Root"), "{error}");
}

/// An empty table has nothing to enter.
#[test]
fn an_empty_states_list_is_a_launch_failure() {
    let set = machine_set(json!([]), &[]);
    let error = validate(&set).expect_err("a machine with no states cannot run");
    assert!(error.contains("empty"), "{error}");
}

/// A `states` value that is not a list of state objects is reported as the unreadable param it is,
/// naming the shape gg expects.
#[test]
fn an_unparseable_states_value_is_a_launch_failure() {
    let set = machine_set(json!("tdd"), &[]);
    let error = validate(&set).expect_err("a string is not a state table");
    assert!(error.contains("could not read"), "{error}");
}

/// A transition addresses a state by name, so a state without one cannot be addressed.
#[test]
fn an_unnamed_state_is_a_launch_failure() {
    let set = machine_set(
        json!([{ "name": "  ", "agent": "Explorer" }]),
        &["Explorer"],
    );
    let error = validate(&set).expect_err("an unnamed state cannot run");
    assert!(error.contains("empty name"), "{error}");
}

/// Two states of one name would leave a transition to that name with no single answer.
#[test]
fn a_duplicated_state_name_is_a_launch_failure() {
    let set = machine_set(
        json!([
            { "name": "build", "agent": "Explorer" },
            { "name": "build", "agent": "Builder" }
        ]),
        &["Explorer", "Builder"],
    );
    let error = validate(&set).expect_err("a duplicated state cannot run");
    assert!(error.contains("more than once"), "{error}");
}

/// Every state runs an agent profile, so a state that names none cannot run.
#[test]
fn a_state_with_no_agent_is_a_launch_failure() {
    let set = machine_set(json!([{ "name": "explore" }]), &[]);
    let error = validate(&set).expect_err("a state with no agent cannot run");
    assert!(error.contains("names no agent"), "{error}");
}

/// A state pointing at a profile the set does not declare is the same class of error as a roster
/// reference that does.
#[test]
fn a_state_naming_an_undeclared_agent_is_a_launch_failure() {
    let set = machine_set(json!([{ "name": "explore", "agent": "Ghost" }]), &[]);
    let error = validate(&set).expect_err("an undeclared agent cannot run a state");
    assert!(error.contains("Ghost"), "{error}");
    assert!(error.contains("not a declared agent profile"), "{error}");
}

/// A transition has to lead somewhere the machine actually declares.
#[test]
fn a_transition_to_an_undeclared_state_is_a_launch_failure() {
    let set = machine_set(
        json!([{ "name": "explore", "agent": "Explorer", "transitions": [{ "to": "ship" }] }]),
        &["Explorer"],
    );
    let error = validate(&set).expect_err("a transition to nowhere cannot run");
    assert!(error.contains("ship"), "{error}");
    assert!(error.contains("not a state it declares"), "{error}");
}

/// A shell has no turns of its own, so entering one as a state would enter a second machine inside
/// the first with no way to say which a transition addressed.
#[test]
fn a_state_running_another_shell_is_a_launch_failure() {
    let mut set = machine_set(json!([{ "name": "explore", "agent": "Inner" }]), &["Inner"]);
    let inner = set.agents.len() - 1;
    set.agents[inner]
        .capabilities
        .push(fsm_capability(json!([{ "name": "a", "agent": "Root" }])));
    let error = validate(&set).expect_err("a shell cannot be a state");
    assert!(error.contains("itself an FSM shell"), "{error}");
}

/// A well-formed machine passes, and so does a set with no machine in it.
#[test]
fn a_well_formed_machine_validates() {
    assert!(validate(&machine_set(two_state(), &["Explorer", "Builder"])).is_ok());
    assert!(validate(&GgCapabilitySet::minimal("mock/echo")).is_ok());
}

/// A state nothing can reach is kept — an author mid-edit should not be refused — but it is named,
/// because a state that never runs is almost never what was meant.
#[test]
fn an_unreachable_state_warns() {
    let set = machine_set(
        json!([
            { "name": "explore", "agent": "Explorer" },
            { "name": "orphan", "agent": "Builder" }
        ]),
        &["Explorer", "Builder"],
    );
    let warnings = launch_warnings(&set);
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert!(warnings[0].contains("orphan"), "{}", warnings[0]);
    assert!(warnings[0].contains("unreachable"), "{}", warnings[0]);
}

/// A transfer list is a list of *values*, so a name gg does not know falls back — the entry carries
/// nothing — and is reported rather than failing the launch.
#[test]
fn an_unknown_transfer_kind_warns_and_is_dropped() {
    let set = machine_set(
        json!([
            {
                "name": "explore",
                "agent": "Explorer",
                "transitions": [{ "to": "build", "transfer": ["history", "plan"] }]
            },
            { "name": "build", "agent": "Builder" }
        ]),
        &["Explorer", "Builder"],
    );
    assert!(validate(&set).is_ok(), "a typo is not a launch failure");
    let spec = FsmSpec::resolve(&set.agents[0]).unwrap().unwrap();
    assert_eq!(
        spec.state("explore").unwrap().transitions[0].transfer,
        vec![ModuleKind::History],
        "the unknown kind is dropped and the known one survives"
    );
    let warnings = launch_warnings(&set);
    assert!(
        warnings.iter().any(|warning| warning.contains("`plan`")),
        "{warnings:?}"
    );
}

/// A shell's own configuration is never read, so anything else it declares is named at launch.
#[test]
fn a_shell_declaring_other_capabilities_warns() {
    let mut set = machine_set(two_state(), &["Explorer", "Builder"]);
    crate::tools::grant(&mut set.agents[0], "memories");
    let warnings = launch_warnings(&set);
    assert!(
        warnings.iter().any(|warning| warning.contains("memories")),
        "{warnings:?}"
    );
}

/// The whole of a worker's configuration is dead weight on a shell, so a hand-written set that
/// carries any of it is told which parts gg will not read — by name, in one warning.
#[test]
fn a_shell_declaring_a_workers_configuration_warns_about_each_part() {
    let mut set = machine_set(two_state(), &["Explorer", "Builder"]);
    set.agents[0].model_id = "mock/echo".to_string();
    set.agents[0].custom_instructions = Some("be brief".to_string());
    set.agents[0].subagents = vec![GgSubagentRef {
        agent: "Builder".to_string(),
        description: String::new(),
        scopes: vec![GgSubagentScope::Subagent],
    }];
    let warnings = launch_warnings(&set);
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    for part in ["model binding", "system prompt", "roster"] {
        assert!(warnings[0].contains(part), "{}", warnings[0]);
    }
}

/// A dispatch onto a machine resolves the profile its **entry state** runs — the one whose turns
/// the agent is about to take. An ordinary profile resolves as itself.
#[test]
fn a_dispatch_onto_a_shell_resolves_the_entry_states_agent() {
    let set = machine_set(two_state(), &["Explorer", "Builder"]);
    assert_eq!(
        set.dispatched_agent(ROOT_AGENT).map(|a| a.name.as_str()),
        Ok("Explorer")
    );
    assert_eq!(
        set.dispatched_agent("Builder").map(|a| a.name.as_str()),
        Ok("Builder")
    );
}

/// A machine whose entry agent this set does not declare is **reported by that agent's name**,
/// never answered with the shell — which `validate` refuses on the line below, and which is the
/// same fault seen from the two ends of it.
///
/// Both halves matter because both are what an operator reads. The refusal is what stops the run;
/// the resolution is what every other caller of it would otherwise be told, and a shell is the one
/// profile in a set that is *meant* to carry no model, so answering with it would send each of them
/// off to report the only agent whose empty binding is correct.
#[test]
fn a_machine_entering_an_undeclared_agent_is_reported_by_that_name() {
    let set = machine_set(two_state(), &["Builder"]);
    assert_eq!(
        set.dispatched_agent(ROOT_AGENT),
        Err(GgDispatchError::UndeclaredEntryAgent {
            shell: ROOT_AGENT,
            entry: "Explorer",
        })
    );
    assert!(validate(&set).unwrap_err().contains("Explorer"));
}

/// A duplicated transfer entry carries the module once — the transfer is a set, and a repeated
/// name should not produce two diagnostics either.
#[test]
fn a_repeated_transfer_kind_is_carried_once() {
    let set = machine_set(
        json!([
            {
                "name": "explore",
                "agent": "Explorer",
                "transitions": [{ "to": "build", "transfer": ["tasks", "tasks", "history"] }]
            },
            { "name": "build", "agent": "Builder" }
        ]),
        &["Explorer", "Builder"],
    );
    let spec = FsmSpec::resolve(&set.agents[0]).unwrap().unwrap();
    assert_eq!(
        spec.state("explore").unwrap().transitions[0].transfer,
        vec![ModuleKind::Tasks, ModuleKind::History]
    );
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

/// A position built from the machine's entry runs the entry state's agent and offers its edges.
#[test]
fn an_entry_position_names_the_entry_state() {
    let set = machine_set(two_state(), &["Explorer", "Builder"]);
    let spec = Arc::new(FsmSpec::resolve(&set.agents[0]).unwrap().unwrap());
    let position = spec.entry_position();
    assert_eq!(position.fsm(), "Root");
    assert_eq!(position.state(), "explore");
    assert_eq!(position.agent(), "Explorer");
    assert_eq!(position.outgoing().len(), 1);
}

/// A declared target resolves to its edge; the successor's position is the target state.
#[test]
fn a_declared_target_resolves_and_moves() {
    let set = machine_set(two_state(), &["Explorer", "Builder"]);
    let spec = Arc::new(FsmSpec::resolve(&set.agents[0]).unwrap().unwrap());
    let position = spec.entry_position();
    let transition = position.transition_to(" build ").expect("a declared edge");
    assert_eq!(
        transition.transfer,
        vec![ModuleKind::History, ModuleKind::Tasks]
    );
    let moved = position.moved_to(transition);
    assert_eq!(moved.state(), "build");
    assert_eq!(moved.agent(), "Builder");
    assert!(moved.outgoing().is_empty());
}

/// An undeclared target is refused in the model's own vocabulary, listing what it may name — the
/// whole of the recovery from a mistyped state.
#[test]
fn an_undeclared_target_is_refused_with_the_legal_targets() {
    let set = machine_set(two_state(), &["Explorer", "Builder"]);
    let spec = Arc::new(FsmSpec::resolve(&set.agents[0]).unwrap().unwrap());
    let refusal = spec
        .entry_position()
        .transition_to("verify")
        .expect_err("`verify` is not declared");
    assert!(refusal.contains("verify"), "{refusal}");
    assert!(refusal.contains("`build`"), "{refusal}");
    assert!(refusal.contains("when you have a plan"), "{refusal}");
}

/// A terminal state says so, rather than listing an empty menu the model would have to interpret.
#[test]
fn a_terminal_state_refuses_every_target() {
    let set = machine_set(two_state(), &["Explorer", "Builder"]);
    let spec = Arc::new(FsmSpec::resolve(&set.agents[0]).unwrap().unwrap());
    let position = spec.entry_position();
    let terminal = position.moved_to(position.transition_to("build").unwrap());
    let refusal = terminal
        .transition_to("explore")
        .expect_err("a terminal state has nowhere to go");
    assert!(refusal.contains("terminal state"), "{refusal}");
    assert_eq!(
        terminal.legal_targets(),
        "(none — this is a terminal state)"
    );
}

/// A machine that loops back is legal and reaches every state — a `build → explore` edge is how a
/// machine says "this turned out to need more understanding".
#[test]
fn a_cyclic_machine_reaches_every_state() {
    let set = machine_set(
        json!([
            { "name": "explore", "agent": "Explorer", "transitions": [{ "to": "build" }] },
            { "name": "build", "agent": "Builder", "transitions": [{ "to": "explore" }, { "to": "verify" }] },
            { "name": "verify", "agent": "Verifier" }
        ]),
        &["Explorer", "Builder", "Verifier"],
    );
    assert!(validate(&set).is_ok());
    assert!(
        launch_warnings(&set).is_empty(),
        "every state is reachable: {:?}",
        launch_warnings(&set)
    );
}
