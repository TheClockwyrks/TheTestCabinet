use super::*;
use test_cabinet_core::gg::{GgCapabilityConfig, GgCapabilitySet};

/// A capability set whose root agent enables the `fsm` capability.
fn fsm_set() -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal("mock/echo");
    set.agents[0]
        .capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_FSM));
    set
}

/// gg ships **no** built-in machines: the capability is inert, so a set that enables it is warned
/// about by name rather than quietly running as an ordinary agent under a machine's name.
#[test]
fn an_enabled_fsm_capability_warns_that_it_drives_nothing() {
    let warnings = launch_warnings(&fsm_set());
    assert_eq!(warnings.len(), 1, "one warning per enabling profile");
    let warning = &warnings[0];
    assert!(
        warning.contains("Root"),
        "the warning names the profile: {warning}"
    );
    assert!(
        warning.contains(CAPABILITY_FSM),
        "the warning names the capability: {warning}"
    );
}

/// The overwhelmingly common case — no FSM capability at all — is silent. A warning every run
/// carried would be a warning nobody read.
#[test]
fn a_set_without_the_capability_warns_about_nothing() {
    assert!(launch_warnings(&GgCapabilitySet::minimal("mock/echo")).is_empty());
}

/// A capability that is *present but off* is an ablation's off arm, not a misconfiguration: it
/// asks for nothing, so there is nothing to report.
#[test]
fn a_disabled_fsm_capability_warns_about_nothing() {
    let mut set = GgCapabilitySet::minimal("mock/echo");
    set.agents[0]
        .capabilities
        .push(GgCapabilityConfig::disabled(CAPABILITY_FSM));
    assert!(launch_warnings(&set).is_empty());
}
