//! **The compile-count gate**: a loaded code module is compiled once per session, and a turn's
//! compile covers the response.
//!
//! The property is a *count*, so it is asserted by counting rather than by timing: the agent's
//! [compile workspace](crate::sandbox::AgentWorkspace) records a module build every time an arm
//! registers what it produced for a key, and what this file asserts is that the figure after a
//! session's last program is the figure after its loads.
//!
//! It is driven through the [fixture language](crate::sandbox::language::fixture), which does what a
//! compiled arm does with the modules in scope — names each out of the
//! [band](crate::sandbox::Workspace::open_module), and builds only one this workspace holds no build
//! of — in the smallest shape that has the property. A registered arm doing otherwise is caught by
//! the same figure in its own suite, on its own toolchain.

use super::*;
use crate::sandbox::{AgentWorkspace, fixture, prepare_program};

/// One module's source, distinguishable by its name so a build for one key is not a build for
/// another.
fn module(name: &str) -> String {
    format!("def {name}()\n  1\n")
}

/// A registry driven on `workspace`, with `count` modules loaded.
fn loaded(workspace: &AgentWorkspace, count: usize) -> KnowledgeModules {
    let mut registry = KnowledgeModules::new(workspace.clone());
    for n in 0..count {
        let name = format!("helper{n}");
        registry
            .load(
                fixture::fixture_language(),
                KnowledgeOrigin::Skill,
                &name,
                Some(&module(&name)),
                None,
            )
            .expect("a valid module loads");
    }
    registry
}

/// **The count a session pays is the count of its loads**, however many turns follow them.
///
/// Three modules and nine programs, which is the shape the issue this gate exists for names: turn
/// cost must not grow with the size of the loaded set. A run that rebuilt every loaded module per
/// program would record twenty-seven here.
#[test]
fn a_loaded_module_is_compiled_once_however_many_turns_follow() {
    let workspace = AgentWorkspace::new();
    let registry = loaded(&workspace, 3);
    let after_loads = workspace.module_builds();
    assert_eq!(after_loads, 3, "one build per module loaded");

    let modules = registry.code_modules();
    assert_eq!(modules.len(), 3);
    for _ in 0..9 {
        prepare_program(
            fixture::fixture_language(),
            "def turn()\n  1\n",
            &modules,
            &workspace,
        )
        .expect("a program of the fixture's own dialect prepares");
    }

    assert_eq!(
        workspace.module_builds(),
        after_loads,
        "a turn's compile covers the response: no loaded module was built again"
    );
}

/// **A module loaded mid-session is compiled once too**, and costs the turns before it nothing.
#[test]
fn a_module_loaded_mid_session_adds_one_build_and_no_more() {
    let workspace = AgentWorkspace::new();
    let mut registry = loaded(&workspace, 1);
    let program = "def turn()\n  1\n";

    for _ in 0..3 {
        let modules = registry.code_modules();
        prepare_program(fixture::fixture_language(), program, &modules, &workspace)
            .expect("a program prepares");
    }
    assert_eq!(workspace.module_builds(), 1);

    registry
        .load(
            fixture::fixture_language(),
            KnowledgeOrigin::Skill,
            "later",
            Some(&module("later")),
            None,
        )
        .expect("a second module loads");
    assert_eq!(workspace.module_builds(), 2);

    for _ in 0..3 {
        let modules = registry.code_modules();
        prepare_program(fixture::fixture_language(), program, &modules, &workspace)
            .expect("a program prepares");
    }
    assert_eq!(
        workspace.module_builds(),
        2,
        "the second module was compiled at its load and named by every turn after it"
    );
}

/// **Reading the same thing again costs no compiler.**
///
/// A read is a use and a use is answered every time, so an agent that reaches for a code skill on
/// every turn reaches for it twenty times in twenty turns. What that must cost is a queued on-use
/// script and nothing else: the module bound at the key is the same bytes it was, and a compiled
/// arm's module step opens by clearing that key's build out of the workspace, so preparing it again
/// would throw away the build every later program names before paying to make it a second time.
///
/// The exports the repeat read hands back are the first preparation's, which is what keeps the
/// documentation a use opens describing the module actually bound.
#[test]
fn a_repeat_read_of_the_same_module_costs_no_compiler() {
    let workspace = AgentWorkspace::new();
    let mut registry = KnowledgeModules::new(workspace.clone());
    let source = module("helper");
    let read = |registry: &mut KnowledgeModules| {
        registry
            .load(
                fixture::fixture_language(),
                KnowledgeOrigin::Skill,
                "helper",
                Some(&source),
                None,
            )
            .expect("a valid module loads")
    };

    let first = read(&mut registry);
    assert_eq!(workspace.module_builds(), 1);

    for _ in 0..5 {
        let again = read(&mut registry);
        assert_eq!(again.key, first.key, "a repeat read keeps the key");
        assert_eq!(
            again.exports, first.exports,
            "a repeat read describes the module that is bound"
        );
    }
    assert_eq!(
        workspace.module_builds(),
        1,
        "five more reads of the same bytes compiled the module again"
    );

    let modules = registry.code_modules();
    assert_eq!(modules.len(), 1);
    prepare_program(
        fixture::fixture_language(),
        "def turn()\n  1\n",
        &modules,
        &workspace,
    )
    .expect("a program prepares");
    assert_eq!(
        workspace.module_builds(),
        1,
        "and the build the first read made is what the program named"
    );
}

/// **A rewritten module is compiled again**, because the build recorded for its key was made from
/// bytes the memory no longer carries.
///
/// The other half of the count: reuse that could not tell one version of a key from another would be
/// a program linked against the source its author replaced.
#[test]
fn a_module_rewritten_under_the_same_key_is_compiled_again() {
    let workspace = AgentWorkspace::new();
    let mut registry = KnowledgeModules::new(workspace.clone());
    let load = |registry: &mut KnowledgeModules, source: &str| {
        registry
            .load(
                fixture::fixture_language(),
                KnowledgeOrigin::Memory,
                "notes",
                Some(source),
                None,
            )
            .expect("the memory's code loads")
    };

    let first = load(&mut registry, "def one()\n  1\n");
    let second = load(&mut registry, "def two()\n  2\n");
    assert_eq!(first.key, second.key, "a re-load keeps the key");
    assert_eq!(workspace.module_builds(), 2);

    let modules = registry.code_modules();
    prepare_program(
        fixture::fixture_language(),
        "def turn()\n  1\n",
        &modules,
        &workspace,
    )
    .expect("a program prepares");
    assert_eq!(
        workspace.module_builds(),
        2,
        "the program named the build made from the bytes it was handed"
    );
}

/// **A module that fails to prepare burns no key.**
///
/// The key is minted before the preparation now, because a compiled arm builds the module under the
/// name a program will reach it by. What must not follow is a key claimed by a module that never
/// loaded: the next thing to want it would be offered `notes2` for no reason the model can see.
#[test]
fn a_module_that_does_not_prepare_claims_no_key() {
    let workspace = AgentWorkspace::new();
    let mut registry = KnowledgeModules::new(workspace.clone());
    registry
        .load(
            fixture::fixture_language(),
            KnowledgeOrigin::Skill,
            "notes",
            Some("def broken() ??\n"),
            None,
        )
        .expect_err("the fixture refuses `??`");

    let loaded = registry
        .load(
            fixture::fixture_language(),
            KnowledgeOrigin::Memory,
            "notes",
            Some("def fine()\n  1\n"),
            None,
        )
        .expect("a valid module loads");
    assert_eq!(
        loaded.key.as_deref(),
        Some("notes"),
        "the refused read left the key unclaimed"
    );
}
