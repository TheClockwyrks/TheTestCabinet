//! The attribution of a session's end, pinned without a container behind it.

use super::*;
use crate::run_record::{RunState, RunStateExt};

const GG_OK: SessionAccount = SessionAccount::Gg {
    session_ended: true,
};
const LOG_CLOSED: SessionAccount = SessionAccount::SessionLog {
    unfinished: 0,
    total: 1,
};

fn end<'a>(
    slug: &'a str,
    sandbox_state: &'a SandboxState,
    account: SessionAccount,
    exit_code: i32,
) -> SessionEnd<'a> {
    SessionEnd {
        slug,
        sandbox: "tcab-run-abc",
        sandbox_state,
        account,
        exit_code,
    }
}

fn state(err: &Option<Error>) -> Option<RunState> {
    err.as_ref().map(RunState::classify_failure)
}

fn gone() -> SandboxState {
    SandboxState::Gone {
        reason: "deleted".to_string(),
    }
}

fn disrupted() -> SandboxState {
    SandboxState::Disrupted {
        reason: "EvictionByEvictionAPI: Eviction API: evicting".to_string(),
    }
}

#[test]
fn a_signal_exit_or_a_lost_stream_is_infrastructure_for_every_harness() {
    for sandbox_state in [SandboxState::Running, SandboxState::Unknown] {
        for (slug, account) in [
            ("gg", GG_OK),
            ("claude", LOG_CLOSED),
            ("codex", SessionAccount::Unread),
        ] {
            for code in [137, 143, -1] {
                let found = platform_end(&end(slug, &sandbox_state, account, code));
                assert_eq!(
                    state(&found),
                    Some(RunState::Infrastructure),
                    "{slug} exit {code} with {sandbox_state:?}: {found:?}"
                );
            }
        }
    }
}

#[test]
fn a_signal_exit_names_the_signal_and_the_code() {
    let running = SandboxState::Running;
    let found = platform_end(&end("gg", &running, GG_OK, 137)).unwrap();
    assert_eq!(
        found.to_string(),
        "gg harness session ended by the platform (signal 9, exit code 137)"
    );
    let found = platform_end(&end("claude", &running, LOG_CLOSED, 143)).unwrap();
    assert_eq!(
        found.to_string(),
        "claude harness session ended by the platform (signal 15, exit code 143)"
    );
    let found = platform_end(&end("claude", &running, LOG_CLOSED, -1)).unwrap();
    assert_eq!(
        found.to_string(),
        "claude harness session ended by the platform (exec stream lost, exit code -1)"
    );
}

#[test]
fn a_harness_exit_with_a_live_sandbox_is_the_harness_own() {
    // With the sandbox running and the session's account complete, the end is the
    // harness's: the caller classifies the code itself.
    let running = SandboxState::Running;
    for (slug, account) in [("gg", GG_OK), ("claude", LOG_CLOSED)] {
        for code in [0, 1, 2, 3, 128] {
            assert!(
                platform_end(&end(slug, &running, account, code)).is_none(),
                "{slug} exit {code}"
            );
        }
    }
}

#[test]
fn a_harness_exit_with_a_live_sandbox_keeps_its_own_classification() {
    // The issue's pairs, end to end: exit 1 with a live pod is a harness error, and
    // gg's exit 3 a breached ceiling, because the attribution leaves both to the
    // harness's own classification.
    let running = SandboxState::Running;
    assert!(platform_end(&end("claude", &running, LOG_CLOSED, 1)).is_none());
    assert_eq!(
        RunState::classify_failure(&Error::HarnessInvocation {
            slug: "claude".to_string(),
            detail: "code 1".to_string(),
        }),
        RunState::HarnessError
    );
    assert!(platform_end(&end("gg", &running, GG_OK, 3)).is_none());
    assert_eq!(
        RunState::classify_failure(&Error::HarnessLimitExceeded {
            slug: "gg".to_string(),
            detail: "code 3".to_string(),
        }),
        RunState::LimitExceeded
    );
}

#[test]
fn a_gone_or_disrupted_sandbox_is_infrastructure_whatever_the_exit_status() {
    for sandbox_state in [gone(), disrupted()] {
        for (slug, account) in [("gg", GG_OK), ("claude", LOG_CLOSED)] {
            for code in [0, 1] {
                let found = platform_end(&end(slug, &sandbox_state, account, code));
                assert_eq!(
                    state(&found),
                    Some(RunState::Infrastructure),
                    "{slug} exit {code} with {sandbox_state:?}: {found:?}"
                );
            }
        }
    }
}

#[test]
fn a_sandbox_end_names_the_sandbox_its_reason_and_the_code() {
    let found = platform_end(&end("gg", &gone(), GG_OK, 0)).unwrap();
    assert_eq!(
        found.to_string(),
        "gg harness session ended by the platform (sandbox `tcab-run-abc` gone: deleted, exit \
         code 0)"
    );
    // The sandbox is read first, so its reason is the one reported over a signal exit, and
    // the sessions the log leaves open are kept as a figure.
    let account = SessionAccount::SessionLog {
        unfinished: 1,
        total: 2,
    };
    let found = platform_end(&end("claude", &disrupted(), account, 143)).unwrap();
    assert_eq!(
        found.to_string(),
        "claude harness session ended by the platform (sandbox `tcab-run-abc` disrupted: \
         EvictionByEvictionAPI: Eviction API: evicting, 1 of 2 logged sessions unclosed, exit \
         code 143)"
    );
}

#[test]
fn a_session_the_log_leaves_open_is_lost_whatever_the_exit_status() {
    // The log is believed over the exit status: a clean exit included.
    let running = SandboxState::Running;
    for code in [0, 1, 137, -1] {
        let account = SessionAccount::SessionLog {
            unfinished: 1,
            total: 2,
        };
        let found = platform_end(&end("claude", &running, account, code));
        assert!(
            matches!(
                &found,
                Some(Error::HarnessSessionLost { slug, unfinished: 1, total: 2, exit_code })
                    if slug == "claude" && *exit_code == code
            ),
            "exit {code}: {found:?}"
        );
        assert_eq!(state(&found), Some(RunState::Infrastructure));
    }
    let found = platform_end(&end(
        "claude",
        &running,
        SessionAccount::SessionLog {
            unfinished: 1,
            total: 1,
        },
        0,
    ))
    .unwrap();
    assert_eq!(
        found.to_string(),
        "claude harness session lost before the harness exited (1 of 1 logged sessions \
         unclosed, exit code 0)"
    );
}

#[test]
fn a_gg_exit_zero_without_session_ended_is_infrastructure() {
    let running = SandboxState::Running;
    let account = SessionAccount::Gg {
        session_ended: false,
    };
    let found = platform_end(&end("gg", &running, account, 0));
    assert_eq!(state(&found), Some(RunState::Infrastructure));
    assert_eq!(
        found.unwrap().to_string(),
        "gg harness session ended by the platform (exit code 0 with no `session_ended` event)"
    );
    // A non-zero exit without the event is gg's own: a launch fatal exits `1` before it
    // has a session to end.
    assert!(platform_end(&end("gg", &running, account, 1)).is_none());
    // The rule is gg's alone: a third-party harness has no `session_ended` to miss.
    assert!(platform_end(&end("claude", &running, SessionAccount::Unread, 0)).is_none());
}
