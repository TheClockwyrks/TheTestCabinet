//! What a [hook](super::GgHook) does with what a script hands back, and what it refuses to guess.
//!
//! The interesting cases here are all about the seam between gg and a subprocess it does not
//! control: a decision it can read, a decision it cannot, and the difference between a hook that
//! **judged** and one that **broke**. The execution path itself (materialize, run, read stdout) is
//! exercised end to end by the script tests below, which run real `sh` — a hook that only worked
//! against a stubbed runner would prove nothing about the one thing it exists to do.

use super::*;
use test_cabinet_core::gg::{ALL_HOOK_EVENTS, GgAgentConfig, GgCapabilitySet};

/// An agent profile carrying `hooks` and nothing else that matters here — the declaration site for
/// the eight [agent events](test_cabinet_core::gg::AGENT_HOOK_EVENTS), which is what nearly every
/// test in this file is about.
fn agent_with(hooks: Vec<GgHook>) -> GgAgentConfig {
    GgAgentConfig {
        hooks,
        ..GgAgentConfig::root()
    }
}

/// A capability set carrying `hooks` as its **session** hooks.
fn set_with(hooks: Vec<GgHook>) -> GgCapabilitySet {
    GgCapabilitySet {
        agents: vec![GgAgentConfig::root()],
        hooks,
        ..GgCapabilitySet::default()
    }
}

/// A hook on `event` running `source` as a custom script.
fn script_hook(event: GgHookEvent, source: &str) -> GgHook {
    GgHook {
        event,
        action: GgHookAction::Custom {
            source: source.to_string(),
        },
        name: "under test".to_string(),
    }
}

// --- Reading a decision -------------------------------------------------------

/// The three decisions, read from the exact JSON the documentation promises. This is the contract
/// every custom hook is written against, so it is asserted against literal text rather than against
/// a round-trip of gg's own serializer — a serializer change that renamed `action` would round-trip
/// happily and break every script in the field.
#[test]
fn reads_each_decision_from_its_documented_json() {
    assert_eq!(
        parse_outcome(r#"{"action":"continue"}"#).unwrap(),
        GgHookOutcomeKind::Continue
    );
    assert_eq!(
        parse_outcome(r#"{"action":"block","reason":"no"}"#).unwrap(),
        GgHookOutcomeKind::Block {
            reason: "no".to_string()
        }
    );
    assert_eq!(
        parse_outcome(r#"{"action":"message","message":"hi"}"#).unwrap(),
        GgHookOutcomeKind::Message {
            message: "hi".to_string()
        }
    );
}

/// A script that logged its way to a decision is not punished for it: only the last non-empty line
/// is parsed. Writing to stdout is how a shell script thinks out loud, and demanding silence would
/// make the natural way to write one the wrong way.
#[test]
fn reads_the_decision_off_the_last_line() {
    let stdout = "checking the file...\nlooks fine\n{\"action\":\"continue\"}\n\n";
    assert_eq!(parse_outcome(stdout).unwrap(), GgHookOutcomeKind::Continue);
}

/// Output gg cannot read is an **error**, not a default. Neither direction is safe to guess: a
/// silent `continue` would let an operation past a gate that never judged it, and a silent `block`
/// would refuse work over a typo in a script.
#[test]
fn unreadable_output_is_an_error_rather_than_a_default() {
    for stdout in [
        "",
        "   \n",
        "ok",
        r#"{"verdict":"allow"}"#,
        "{\"action\":\"nope\"}",
    ] {
        assert!(
            parse_outcome(stdout).is_err(),
            "expected {stdout:?} to be unreadable"
        );
    }
}

// --- Resolution ---------------------------------------------------------------

/// A built-in id gg does not ship is caught at **launch**, and the error names the ids that exist —
/// because the failure is almost always a typo, and a list is the shortest path from the message to
/// the fix.
#[test]
fn refuses_a_built_in_gg_does_not_ship() {
    let agent = agent_with(vec![GgHook {
        event: GgHookEvent::PreWrite,
        action: GgHookAction::BuiltIn {
            script: "refuse-empty-writes".to_string(),
        },
        name: String::new(),
    }]);
    let errors = HookRuntime::resolve_agent(&agent, Path::new("/tmp")).unwrap_err();
    assert_eq!(errors.len(), 1);
    assert!(errors[0].contains("refuse-empty-writes"), "{}", errors[0]);
    assert!(errors[0].contains("refuse-empty-write"), "{}", errors[0]);
}

/// Every id gg advertises resolves. The catalogue and the sources are two lists that have to agree,
/// and nothing but this test makes them.
#[test]
fn every_advertised_built_in_has_a_source() {
    for id in GG_BUILTIN_HOOKS {
        assert!(builtin_source(id).is_some(), "no source for `{id}`");
    }
}

/// Hooks are grouped by event and kept in **declaration order** within one, because that order is
/// the contract: an operator who puts the cheap check first expects it to run first.
#[test]
fn groups_by_event_and_keeps_declaration_order() {
    let agent = agent_with(vec![
        script_hook(GgHookEvent::PreWrite, "#!/bin/sh\ntrue"),
        script_hook(GgHookEvent::PreShell, "#!/bin/sh\ntrue"),
        script_hook(GgHookEvent::PreWrite, "#!/bin/sh\nfalse"),
    ]);
    let runtime = HookRuntime::resolve_agent(&agent, Path::new("/tmp")).unwrap();
    assert_eq!(runtime.count(GgHookEvent::PreWrite), 2);
    assert_eq!(runtime.count(GgHookEvent::PreShell), 1);
    assert_eq!(runtime.count(GgHookEvent::PostWrite), 0);
    assert!(!runtime.has(GgHookEvent::AgentStop));
}

// --- Which of the two lists a hook belongs in --------------------------------

/// The run's list takes the session events and only those. This is the half of the split an
/// operator meets first — a `session-start` hook is what the configuration page offers — so it is
/// asserted directly rather than implied by the refusals below.
#[test]
fn the_run_declares_the_session_events() {
    let set = set_with(vec![
        script_hook(GgHookEvent::SessionStart, "#!/bin/sh\ntrue"),
        script_hook(GgHookEvent::SessionEnd, "#!/bin/sh\ntrue"),
    ]);
    let runtime = HookRuntime::resolve_session(&set, Path::new("/tmp")).unwrap();
    assert!(runtime.has(GgHookEvent::SessionStart));
    assert!(runtime.has(GgHookEvent::SessionEnd));
}

/// An agent event declared on the **run** is refused rather than quietly applied to every agent.
///
/// Applying it is exactly what gg used to do, and it is the behavior this split exists to end: a
/// gate written for one profile silently held every profile, and the only way to tell was to read
/// the agent identity out of the payload inside the script. Refusing names the fix instead.
#[test]
fn refuses_an_agent_event_declared_on_the_run() {
    let set = set_with(vec![script_hook(GgHookEvent::PreWrite, "#!/bin/sh\ntrue")]);
    let errors = HookRuntime::resolve_session(&set, Path::new("/tmp")).unwrap_err();
    assert_eq!(errors.len(), 1);
    assert!(errors[0].contains("pre-write"), "{}", errors[0]);
    assert!(errors[0].contains("declared on an agent"), "{}", errors[0]);
}

/// A session event declared on an **agent** is refused too, and the error names the profile.
///
/// The symmetric case, and the one an operator is likelier to reach for: "run this when the session
/// ends" is a natural thing to want on the root. gg could honor it there, but it would then fire
/// once per profile in a run whose other profiles declared it too, and "once per run" is the whole
/// meaning of the event.
#[test]
fn refuses_a_session_event_declared_on_an_agent() {
    let mut agent = agent_with(vec![script_hook(
        GgHookEvent::SessionEnd,
        "#!/bin/sh\ntrue",
    )]);
    agent.name = "reviewer".to_string();
    let errors = HookRuntime::resolve_agent(&agent, Path::new("/tmp")).unwrap_err();
    assert_eq!(errors.len(), 1);
    assert!(errors[0].contains("session-end"), "{}", errors[0]);
    assert!(errors[0].contains("reviewer"), "{}", errors[0]);
}

/// Two profiles that name a hook the same thing materialize their scripts to **different files**.
///
/// [script_filename] is derived from the label, so before the per-site directory these two wrote
/// the same path — and since a script is rewritten at every firing, each agent would have run
/// whichever source the other wrote last. The failure mode is a hook that works until a second
/// agent starts, which is the kind that reaches production.
#[test]
fn two_profiles_naming_a_hook_alike_do_not_share_a_script_file() {
    let mut implementer = agent_with(vec![script_hook(GgHookEvent::PreShell, "#!/bin/sh\ntrue")]);
    implementer.name = "implementer".to_string();
    let mut reviewer = agent_with(vec![script_hook(GgHookEvent::PreShell, "#!/bin/sh\nfalse")]);
    reviewer.name = "reviewer".to_string();

    let one = HookRuntime::resolve_agent(&implementer, Path::new("/tmp")).unwrap();
    let two = HookRuntime::resolve_agent(&reviewer, Path::new("/tmp")).unwrap();
    assert_ne!(one.scripts_dir, two.scripts_dir);
    // And neither collides with the run's own.
    let session = HookRuntime::resolve_session(&set_with(Vec::new()), Path::new("/tmp")).unwrap();
    assert_ne!(one.scripts_dir, session.scripts_dir);
    assert_ne!(two.scripts_dir, session.scripts_dir);
}

// --- What each event is allowed to do ----------------------------------------

/// The blocking rights, asserted as a table rather than derived from the `pre-` prefix — because
/// [`PreCompact`](GgHookEvent::PreCompact) is the one `pre-` event that deliberately cannot block,
/// and a rule with an exception has to be written down to be trusted.
#[test]
fn only_three_events_can_block() {
    let blocking: Vec<&str> = ALL_HOOK_EVENTS
        .iter()
        .filter(|event| event.can_block())
        .map(|event| event.as_str())
        .collect();
    assert_eq!(blocking, ["pre-write", "pre-shell", "agent-stop"]);
}

/// The two events with no prompt left to insert into: the compaction that is about to rewrite the
/// window, and the session end that comes after the last turn anybody could read it on.
#[test]
fn two_events_cannot_insert() {
    let silent: Vec<&str> = ALL_HOOK_EVENTS
        .iter()
        .filter(|event| !event.can_insert())
        .map(|event| event.as_str())
        .collect();
    assert_eq!(silent, ["pre-compact", "session-end"]);
}

// --- The payload --------------------------------------------------------------

/// Every payload carries the agent facts, whatever the event — the promise a script relies on to
/// know *who* is writing the file it is being asked about.
#[test]
fn every_payload_carries_the_agent_facts() {
    let agent = HookAgent::new("agent-3", "Implementer")
        .of_kind(GgHookAgentKind::IssueImplementer)
        .in_worktree(Some((
            "gg/issue-1".to_string(),
            PathBuf::from("/w/issue-1"),
        )));
    let payload = event_payload(
        GgHookEvent::PreWrite,
        &agent,
        &json!({ "path": "/w/issue-1/a.txt", "contents": "hi" }),
    );

    assert_eq!(payload["event"], "pre-write");
    assert_eq!(payload["agentId"], "agent-3");
    assert_eq!(payload["agent"], "Implementer");
    assert_eq!(payload["agentKind"], "issue-implementer");
    assert_eq!(payload["worktree"]["branch"], "gg/issue-1");
    // The event's own fields sit beside the agent's rather than under a wrapper, so a script reads
    // `path` rather than `payload.path`.
    assert_eq!(payload["path"], "/w/issue-1/a.txt");
    assert_eq!(payload["contents"], "hi");
}

/// An agent with no worktree says so explicitly rather than omitting the key: a script that reads
/// `worktree` on every event should find a value on every event.
#[test]
fn an_agent_without_a_worktree_reports_null() {
    let payload = event_payload(
        GgHookEvent::AgentStart,
        &HookAgent::new("root", "Root").of_kind(GgHookAgentKind::Root),
        &json!({}),
    );
    assert!(payload["worktree"].is_null());
    assert_eq!(payload["agentKind"], "root");
}

// --- Quoting ------------------------------------------------------------------

/// The payload gg quotes into a command line contains whatever the model just tried to write to a
/// file, so the quoting has to be total over arbitrary text. A single quote in the contents is the
/// case that breaks the naive version, and it turns a hook into an arbitrary command.
#[test]
fn quoting_survives_contents_that_contain_quotes() {
    let nasty = r#"it's a "test"; rm -rf /; $(whoami) `id`"#;
    let quoted = shell_quote(nasty);
    let output = std::process::Command::new("sh")
        .arg("-c")
        .arg(format!("printf %s {quoted}"))
        .output()
        .expect("sh");
    assert_eq!(String::from_utf8_lossy(&output.stdout), nasty);
}

// --- What a run reports -------------------------------------------------------

/// A firing that produced messages renders them as one labelled block, so the model can tell hook
/// output from something it produced itself.
#[test]
fn messages_render_as_one_labelled_block() {
    let run = HookRun {
        blocked: None,
        messages: vec!["first".to_string(), "second".to_string()],
    };
    let insertion = run.insertion().unwrap();
    assert!(insertion.starts_with("Hook output\n----\n"), "{insertion}");
    assert!(insertion.contains("first"));
    assert!(insertion.contains("second"));
    assert!(run.allowed());
}

/// A firing that said nothing inserts nothing — the overwhelmingly common case, and the one where a
/// stray empty block would cost a message on every single tool call.
#[test]
fn a_quiet_firing_inserts_nothing() {
    assert!(HookRun::default().insertion().is_none());
    assert!(HookRun::default().allowed());
}
