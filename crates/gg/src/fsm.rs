//! The gg **FSM engine** and its built-in machine library.
//!
//! An [FSM-driven process](https://docs.testcabinet.ai/gg/fsms/) is a **fixed, named finite state
//! machine** the agent is *driven through*, so the *order* of the work is a property of the process
//! rather than the model's discretion. Unlike a [workflow](crate::agent) (a fan-out the agent
//! assembles), a machine is **authored as part of the harness** — this module ships the built-in
//! library — and which one (if any) drives a run is part of the
//! [capability set](test_cabinet_core::gg::CAPABILITY_FSM).
//!
//! # What the engine does
//!
//! The engine ([`FsmRuntime`], driven by the [loop](crate::agent)) keeps the agent in the current
//! [state](FsmState) until that state's transition condition holds. Enforcement is three-fold, and
//! the agent **cannot skip ahead**:
//!
//! 1. **Per-state guidance** — the state's [`guidance`](FsmState::guidance) is injected into the
//!    context so the model knows what it must do *now* (write tests first, plan before building, …).
//! 2. **A controlled transition** — the only way forward is the `advance_state` tool, which the loop
//!    routes here; the engine refuses the advance until the state's [exit](StateExit) condition is
//!    met (for `tdd`, [test files must exist](AdvanceGuard::TestsExist) before the machine will move
//!    to `implement`). A skip is impossible: `advance_state` only ever moves to the *next* state, and
//!    only when its guard passes.
//! 3. **Per-state toolset gating** — a state may restrict the offered toolset ([`ToolPolicy`]),
//!    mirroring how [plan mode](crate::planning) goes read-only; the `plan-first` `plan` state is
//!    read-only.
//!
//! # The built-in machines
//!
//! - [`MACHINE_TDD`] — `write_tests → implement → verify`, order enforced by evidence guards.
//! - [`MACHINE_PLAN_FIRST`] — `plan → implement`, reusing the [planning](crate::planning)
//!   plan→implement flow (a read-only plan pass, then a fresh-context implementation pass) as the
//!   two states.
//!
//! Each [transition](FsmRuntime) is streamed as
//! [`FsmState`](test_cabinet_core::gg::GgTelemetryKind::FsmState) telemetry so the console shows the
//! run's path through the machine.

use std::path::Path;
use std::sync::Arc;

use test_cabinet_core::gg::{CAPABILITY_FSM, GgAgentConfig, GgCapabilitySet};

use crate::planning::{Planner, resolve_planner};
use crate::tools::{ADVANCE_STATE_TOOL, is_read_only_tool};

/// The `machine` param (on the [`fsm`](CAPABILITY_FSM) capability) that names which built-in
/// machine drives the run. Absent or unrecognized ⇒ no FSM.
pub const PARAM_MACHINE: &str = "machine";

/// The **TDD** machine: `write_tests → implement → verify`. The order is enforced — the machine will
/// not leave `write_tests` until [test files exist](AdvanceGuard::TestsExist), nor leave `implement`
/// until [an implementation file exists](AdvanceGuard::ImplementationExists) — so the agent cannot
/// jump to implementing before it has written tests.
pub const MACHINE_TDD: &str = "tdd";

/// The **plan-first** machine: `plan → implement`. It reuses the [planning](crate::planning)
/// plan→implement flow — the `plan` state is a read-only planning pass, and advancing it performs
/// the same fresh-context reset (via the [`Planner`]) that `submit_plan` does before the `implement`
/// state.
pub const MACHINE_PLAN_FIRST: &str = "plan-first";

/// The names of the built-in machines, for validating a configured `machine` param.
pub const BUILTIN_MACHINES: [&str; 2] = [MACHINE_TDD, MACHINE_PLAN_FIRST];

/// The offered-toolset restriction a [state](FsmState) imposes while the agent is in it — the FSM's
/// per-state analogue of [plan mode](crate::planning)'s read-only restriction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolPolicy {
    /// The full offered toolset is available (the state gates nothing).
    All,
    /// Only [read-only tools](is_read_only_tool) are available (plus the state's `advance_state`
    /// exit) — the state cannot mutate the workspace or gg's state. Mirrors plan mode.
    ReadOnly,
}

/// How the agent **leaves** a [state](FsmState) — the transition mechanism the engine enforces.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StateExit {
    /// Leave by calling `advance_state`; the [guard](AdvanceGuard) must hold (its evidence must be
    /// present) or the advance is refused and the agent stays in this state.
    Advance(AdvanceGuard),
    /// Leave by the plan → implement **reset** (`plan-first`'s `plan` state): advancing performs the
    /// same context reset + plan framing (via the [`Planner`]) that
    /// [`submit_plan`](crate::planning) does. Reuses the planning flow. `advance_state` is the exit.
    PlanReset,
    /// The terminal state: the run finishes here (the agent stops when its work is done). No exit
    /// tool is offered.
    Terminal,
}

impl StateExit {
    /// Whether a state with this exit is one the agent leaves by calling `advance_state` — i.e.
    /// whether the `advance_state` tool is offered while resting in it. [`Advance`](Self::Advance)
    /// and [`PlanReset`](Self::PlanReset) are agent-driven; [`Terminal`](Self::Terminal) has no
    /// exit.
    pub fn is_advanceable(&self) -> bool {
        matches!(self, StateExit::Advance(_) | StateExit::PlanReset)
    }
}

/// The evidence an [`Advance`](StateExit::Advance) transition requires before the engine will let the
/// machine move to the next state — how the order is made *enforced* rather than merely suggested.
///
/// The guard is evaluated against the run's workspace (the agent's rooted tree), so it is concrete
/// and flake-free: the machine literally checks the filesystem for the required artifacts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdvanceGuard {
    /// No evidence required — the agent decides the state's work is done.
    #[allow(dead_code)]
    Unconditional,
    /// At least one **test file** must exist in the workspace — the guard that keeps `tdd` in
    /// `write_tests` until tests have actually been written, so the agent cannot implement first.
    TestsExist,
    /// At least one **non-test source file** must exist — the guard that keeps `tdd` in `implement`
    /// until there is an implementation to verify.
    ImplementationExists,
}

impl AdvanceGuard {
    /// Evaluate the guard against `workspace`, returning `Ok(())` when the transition is allowed or a
    /// model-facing explanation of what is still missing when it is refused.
    pub fn evaluate(&self, workspace: &Path) -> Result<(), String> {
        match self {
            AdvanceGuard::Unconditional => Ok(()),
            AdvanceGuard::TestsExist => {
                if workspace_has(workspace, &mut is_test_file) {
                    Ok(())
                } else {
                    Err("you cannot advance to `implement` yet: no test file exists in the \
                         workspace. Write your tests first (a file whose name marks it as a test — \
                         for example `*.test.*`, `*_test.*`, `*.spec.*`, or a file under a `tests/` \
                         or `spec/` directory), then advance."
                        .to_string())
                }
            }
            AdvanceGuard::ImplementationExists => {
                if workspace_has(workspace, &mut is_impl_file) {
                    Ok(())
                } else {
                    Err("you cannot advance to `verify` yet: no implementation file exists in the \
                         workspace (only tests, or nothing). Implement the code your tests exercise, \
                         then advance to verify it."
                        .to_string())
                }
            }
        }
    }
}

/// One state of a built-in [`Machine`]: its name, the guidance shown while the agent is in it, the
/// toolset it restricts, and how the agent leaves it.
#[derive(Clone)]
pub struct FsmState {
    /// The state's stable name (the [`state`](test_cabinet_core::gg::GgTelemetryKind::FsmState) in
    /// telemetry).
    pub name: &'static str,
    /// The guidance injected into the context on entering this state — what the model must do now.
    pub guidance: String,
    /// The offered-toolset restriction while in this state.
    pub tool_policy: ToolPolicy,
    /// How the agent leaves this state.
    pub exit: StateExit,
}

/// A built-in finite state machine: an ordered list of [states](FsmState).
#[derive(Clone)]
pub struct Machine {
    /// The machine's name (the [`machine`](test_cabinet_core::gg::GgTelemetryKind::FsmState) in
    /// telemetry).
    pub name: &'static str,
    /// The machine's states, in order — index `0` is the entry state.
    pub states: Vec<FsmState>,
}

/// The loop's live view of the FSM capability: the [machine](Machine) driving the run (if any) and
/// the current state index.
///
/// Resolved once for the run's root agent ([`resolve`](Self::resolve)); [`disabled`](Self::disabled)
/// for every other agent and for a run with no machine. The [loop](crate::agent) drives it: it reads
/// the [current state](Self::current_state)'s guidance and [tool policy](Self::offers), and
/// [advances](Self::advance) / [reverts](Self::revert_to) it as transitions fire, emitting
/// [`FsmState`](test_cabinet_core::gg::GgTelemetryKind::FsmState) telemetry each time.
#[derive(Clone)]
pub struct FsmRuntime {
    /// The machine driving the run, or `None` when no FSM is active.
    machine: Option<Machine>,
    /// The index of the current state within [`machine`](Self::machine)'s states.
    current: usize,
    /// The planner backing a [`PlanReset`](StateExit::PlanReset) transition (`plan-first` only) — the
    /// same [`Planner`] the [planning](crate::planning) capability uses, so the plan → implement
    /// reset is the identical flow. `None` for machines with no plan state.
    planner: Option<Arc<dyn Planner>>,
}

impl FsmRuntime {
    /// A disabled runtime — no machine drives the agent (the FSM feature vanishes: no guidance, no
    /// `advance_state` handling, no telemetry). Used for every non-root agent and for a run whose
    /// capability set selects no machine.
    pub fn disabled() -> Self {
        Self {
            machine: None,
            current: 0,
            planner: None,
        }
    }

    /// Resolve the runtime from a run's capability set: when the [`fsm`](CAPABILITY_FSM) capability
    /// is enabled and its [`machine`](PARAM_MACHINE) param names a built-in, build that machine at
    /// its entry state; otherwise (absent capability, no `machine`, or an unrecognized name)
    /// [disabled](Self::disabled). The `implementation` selects the [`Planner`] for `plan-first`
    /// (the same seam the planning capability uses).
    pub fn resolve(set: &GgAgentConfig) -> Self {
        let Some(cap) = set.capability(CAPABILITY_FSM).filter(|cap| cap.enabled) else {
            return Self::disabled();
        };
        let machine_name = cap
            .params
            .get(PARAM_MACHINE)
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|name| !name.is_empty());
        match machine_name {
            Some(MACHINE_TDD) => Self::of(tdd_machine(), None),
            Some(MACHINE_PLAN_FIRST) => {
                // The planner backs the plan → implement reset (its `frame_plan`), so `plan-first`
                // reuses the planning capability's flow even when that capability is off.
                let planner = resolve_planner(cap.implementation.as_deref());
                Self::of(plan_first_machine(), Some(planner))
            }
            // Absent or unrecognized machine name: no FSM drives the run.
            _ => Self::disabled(),
        }
    }

    /// An enabled runtime driving `machine` from its entry state, optionally carrying a `planner`.
    fn of(machine: Machine, planner: Option<Arc<dyn Planner>>) -> Self {
        Self {
            machine: Some(machine),
            current: 0,
            planner,
        }
    }

    /// Whether a machine is driving the run.
    pub fn is_active(&self) -> bool {
        self.machine.is_some()
    }

    /// The active machine's name, or `""` when no machine is driving the run.
    pub fn machine_name(&self) -> &str {
        self.machine.as_ref().map(|m| m.name).unwrap_or("")
    }

    /// The current state, or `None` when no machine is active.
    pub fn current_state(&self) -> Option<&FsmState> {
        self.machine
            .as_ref()
            .and_then(|m| m.states.get(self.current))
    }

    /// The current state's index.
    pub fn current_index(&self) -> usize {
        self.current
    }

    /// Advance to the next state (index `current + 1`), returning the state just entered — or `None`
    /// when there is no next state (already at the last state, or no machine). The caller emits the
    /// [`FsmState`](test_cabinet_core::gg::GgTelemetryKind::FsmState) telemetry and injects the new
    /// state's guidance.
    pub fn advance(&mut self) -> Option<&FsmState> {
        let machine = self.machine.as_ref()?;
        if self.current + 1 >= machine.states.len() {
            return None;
        }
        self.current += 1;
        self.machine.as_ref()?.states.get(self.current)
    }

    /// Whether the tool `name` is offered this turn given the current state's [policy](ToolPolicy)
    /// and exit — the FSM's contribution to the loop's per-turn toolset filter (intersected with any
    /// [plan-mode](crate::planning) filter). `advance_state` is offered iff the state is advanceable;
    /// otherwise a [`ReadOnly`](ToolPolicy::ReadOnly) state offers only read-only tools and an
    /// [`All`](ToolPolicy::All) state offers everything. A run with no machine offers everything.
    pub fn offers(&self, name: &str) -> bool {
        let Some(state) = self.current_state() else {
            // No machine drives the run: `advance_state` (only the FSM offers it) is meaningless, so
            // withhold it; every other tool is unaffected.
            return name != ADVANCE_STATE_TOOL;
        };
        if name == ADVANCE_STATE_TOOL {
            return state.exit.is_advanceable();
        }
        match state.tool_policy {
            ToolPolicy::All => true,
            ToolPolicy::ReadOnly => is_read_only_tool(name),
        }
    }

    /// The [`Planner`] backing this machine's [plan reset](StateExit::PlanReset), when it has one.
    pub fn planner(&self) -> Option<&dyn Planner> {
        self.planner.as_deref()
    }
}

/// Build the [TDD](MACHINE_TDD) machine: `write_tests → implement → verify`, order enforced by
/// evidence guards so the agent cannot implement before tests exist nor verify before implementing.
fn tdd_machine() -> Machine {
    Machine {
        name: MACHINE_TDD,
        states: vec![
            FsmState {
                name: "write_tests",
                guidance: "# Test-driven development: write the tests first\n\nYou are following a \
                    strict test-driven process. **Before writing any implementation, write the \
                    tests** that specify the behavior you are about to build — put them in clearly \
                    named test files (for example `*.test.*`, `*_test.*`, `*.spec.*`, or under a \
                    `tests/` directory). When your tests are in place, call `advance_state` to move \
                    on to implementing. You will not be allowed to advance to `implement` until at \
                    least one test file exists."
                    .to_string(),
                tool_policy: ToolPolicy::All,
                exit: StateExit::Advance(AdvanceGuard::TestsExist),
            },
            FsmState {
                name: "implement",
                guidance: "# Implement to satisfy the tests\n\nYour tests are written. Now implement \
                    the code that makes them pass — keep the tests as your specification and do not \
                    weaken them to fit the implementation. When the implementation is in place, call \
                    `advance_state` to move on to verifying it against the tests."
                    .to_string(),
                tool_policy: ToolPolicy::All,
                exit: StateExit::Advance(AdvanceGuard::ImplementationExists),
            },
            FsmState {
                name: "verify",
                guidance: "# Verify with the tests\n\nRun the tests and confirm they pass against \
                    your implementation. Fix any failures until the suite is green, then give a \
                    short summary and stop. This is the final step of the process."
                    .to_string(),
                tool_policy: ToolPolicy::All,
                exit: StateExit::Terminal,
            },
        ],
    }
}

/// Build the [plan-first](MACHINE_PLAN_FIRST) machine: `plan → implement`. The `plan` state is
/// read-only (mirroring plan mode), and advancing it performs the same plan → implement reset the
/// [planning](crate::planning) capability does — clearing the exploration and seeding the framed plan
/// via the [`Planner`] — before the `implement` state, so it reuses that flow.
fn plan_first_machine() -> Machine {
    Machine {
        name: MACHINE_PLAN_FIRST,
        states: vec![
            FsmState {
                name: "plan",
                guidance: "# Plan first (read-only)\n\nYou are in a read-only planning pass: your \
                    tools are restricted to exploration (read_file, list_dir, read_skill, \
                    search_archive) — you cannot write, edit, or run commands yet. Understand the \
                    workspace and think the work through, then call `advance_state` with your \
                    implementation plan in the `note` (the files to create or change, the order of \
                    work, and the key decisions). Advancing clears this exploration and starts you \
                    fresh with just the original request and your plan, so make the plan \
                    self-contained."
                    .to_string(),
                // Read-only, mirroring plan mode: the agent can only explore while planning.
                tool_policy: ToolPolicy::ReadOnly,
                exit: StateExit::PlanReset,
            },
            FsmState {
                name: "implement",
                guidance:
                    "# Implement your plan\n\nImplement the plan you just submitted. You have \
                    your full toolset back and a clean window; adapt the plan if you discover it \
                    needs to change. When the build is complete, give a short summary and stop."
                        .to_string(),
                tool_policy: ToolPolicy::All,
                exit: StateExit::Terminal,
            },
        ],
    }
}

/// The `machine` name a capability set configures (when the [`fsm`](CAPABILITY_FSM) capability is
/// enabled with a non-empty `machine` param), regardless of whether it names a built-in — so the
/// [announce](crate::agent) path can warn about an unrecognized name.
pub fn configured_machine(set: &GgCapabilitySet) -> Option<&str> {
    set.capability(CAPABILITY_FSM)
        .filter(|cap| cap.enabled)?
        .params
        .get(PARAM_MACHINE)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
}

/// Whether `name` is a recognized built-in machine.
pub fn is_builtin_machine(name: &str) -> bool {
    BUILTIN_MACHINES.contains(&name)
}

/// Whether `name` (a file name, lowercased for matching) marks a **test** file — used by the
/// [`TestsExist`](AdvanceGuard::TestsExist) guard.
fn name_marks_test(lower: &str) -> bool {
    lower.contains(".test.")
        || lower.contains("_test.")
        || lower.contains(".spec.")
        || lower.contains("-test.")
        || lower.starts_with("test_")
        || lower.starts_with("test.")
        || lower == "tests.rs"
}

/// Whether a directory component name (lowercased) is a conventional **test directory**.
fn dir_marks_test(lower: &str) -> bool {
    matches!(lower, "tests" | "test" | "spec" | "specs" | "__tests__")
}

/// Whether a directory component name (lowercased) should never be descended into when scanning the
/// workspace for evidence (VCS/dependency/build noise that could hold a stray "test" file).
fn is_ignored_dir(lower: &str) -> bool {
    matches!(
        lower,
        ".git" | "node_modules" | "target" | ".gg-worktrees" | "dist" | "build" | ".venv"
    )
}

/// Whether the file at `path` (with `in_test_dir` recording whether any ancestor within the
/// workspace is a test directory) is a **test file** for the [`TestsExist`](AdvanceGuard::TestsExist)
/// guard: a test-marked file name, or any file living under a test directory.
fn is_test_file(path: &Path, in_test_dir: bool) -> bool {
    if in_test_dir {
        return true;
    }
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name_marks_test(&name.to_ascii_lowercase()))
}

/// Whether the file at `path` is an **implementation** file for the
/// [`ImplementationExists`](AdvanceGuard::ImplementationExists) guard: an ordinary source file that
/// is **not** a test (not test-marked, not under a test directory) and not a hidden dotfile.
fn is_impl_file(path: &Path, in_test_dir: bool) -> bool {
    if is_test_file(path, in_test_dir) {
        return false;
    }
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| !name.starts_with('.'))
}

/// Walk `workspace` (bounded, skipping [ignored dirs](is_ignored_dir)) and report whether any file
/// satisfies `matches`. The predicate is told, per file, whether it lives under a
/// [test directory](dir_marks_test), so the guards need no second walk. A missing or unreadable
/// workspace reports `false` (the guard then refuses, which is the safe default). Bounded in depth so
/// a pathological tree cannot hang the transition check.
fn workspace_has(workspace: &Path, matches: &mut dyn FnMut(&Path, bool) -> bool) -> bool {
    /// A generous depth ceiling: real game workspaces are shallow; this only guards against a
    /// runaway symlink/tree.
    const MAX_DEPTH: usize = 24;
    fn walk(
        dir: &Path,
        in_test_dir: bool,
        depth: usize,
        matches: &mut dyn FnMut(&Path, bool) -> bool,
    ) -> bool {
        if depth > MAX_DEPTH {
            return false;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return false;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            let name_lower = entry.file_name().to_string_lossy().to_ascii_lowercase();
            if file_type.is_dir() {
                if is_ignored_dir(&name_lower) {
                    continue;
                }
                let child_in_test_dir = in_test_dir || dir_marks_test(&name_lower);
                if walk(&path, child_in_test_dir, depth + 1, matches) {
                    return true;
                }
            } else if file_type.is_file() && matches(&path, in_test_dir) {
                return true;
            }
        }
        false
    }
    walk(workspace, false, 0, matches)
}

#[cfg(test)]
#[path = "fsm.test.rs"]
mod tests;
