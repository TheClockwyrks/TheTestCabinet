//! **Gate — a module rebuilt beside a program is gg's own failure, on every arm.**
//!
//! A code module is compiled at the read that binds it, so its author reads the compiler's
//! diagnostic on the call that loaded it, located in the module's own file. A program's preparation
//! rebuilds that module when this agent's workspace holds no build made from those bytes, which a
//! rewritten memory re-loaded under the same key really produces. The bytes were accepted once, so
//! an arm refusing them now is that arm disagreeing with itself about a file the program's author
//! never wrote.
//!
//! What that costs when it is handed back as [`PrepareError::Compile`] is three things at once: a
//! model rewrites a program nothing was wrong with, gg's own defect is charged to that model's
//! transpile ceiling, and the published record says the model could not write compiling code. So a
//! rebuild an arm refuses is a [lowering failure](PrepareFailure::Lowering), whatever band that
//! arm's compiler would otherwise have put it in.
//!
//! # The table is the audit
//!
//! [`ROWS`] answers the same question for every registered arm and is checked to cover all of them,
//! so a twelfth arm fails here until it has said which of the two it is. An arm that compiles a
//! module at prepare time is driven through its real compiler with a module that does not compile,
//! and must answer with a lowering failure naming the binding. An arm that compiles no module hands
//! its guest whatever source it was given, and must prepare the program.
//!
//! # Why one test per arm rather than one loop
//!
//! Because a loop over the compiling arms is one test holding two JVM starts, a Swift compile, a
//! Roslyn compile and a `purs` build, and a per-test timeout is what would report that as a hang.
//! Each arm calls [`gate`] from beside the compiler it measures, the way every other real-toolchain
//! cell in this crate is arranged.

use test_cabinet_core::gg::GgProgramLanguage;

use super::{PrepareFailure, compile::AgentWorkspace};

/// What one arm's program step does with a code module it holds no build of.
pub(super) enum Rebuilds {
    /// The arm compiles the module beside the program, so a refusal is gg's own.
    Compiling,
    /// The arm compiles no module at prepare time, with the reason.
    Nothing(&'static str),
}

/// What the module the gate loads is called, before each arm spells it as a binding key.
const MODULE_NAME: &str = "gg-rebuild-marker";

/// What is appended to an arm's own [gate module](super::ProgramLanguage::gate_module) to make it a
/// module no compiler accepts.
///
/// Appended to the arm's own module rather than written per arm, so what is measured is one arm's
/// treatment of a refusal rather than eleven guesses at what each compiler rejects. It is a line
/// that parses in none of the eleven languages, and it sits after everything the module declares so
/// an arm's export scan still reads the exports it would have read.
const BROKEN: &str = "\n!!! gg gate: this module does not compile !!!\n";

/// One row per registered arm.
const ROWS: &[(GgProgramLanguage, Rebuilds)] = &[
    (
        GgProgramLanguage::TypeScript,
        Rebuilds::Nothing(
            "a program's compile declares every `lib:` specifier ambiently, so a module is compiled \
             at the read that binds it and never beside a program",
        ),
    ),
    (
        GgProgramLanguage::JavaScript,
        Rebuilds::Nothing(
            "a module is source the guest binds at run time, and nothing reads it on the host",
        ),
    ),
    (
        GgProgramLanguage::Python,
        Rebuilds::Nothing(
            "a module is source the guest binds at run time, and nothing reads it on the host",
        ),
    ),
    (
        GgProgramLanguage::Ruby,
        Rebuilds::Nothing(
            "a module is source the guest binds at run time, and nothing reads it on the host",
        ),
    ),
    (GgProgramLanguage::PureScript, Rebuilds::Compiling),
    (GgProgramLanguage::Java, Rebuilds::Compiling),
    (GgProgramLanguage::Kotlin, Rebuilds::Compiling),
    (GgProgramLanguage::Rust, Rebuilds::Compiling),
    (GgProgramLanguage::Swift, Rebuilds::Compiling),
    (GgProgramLanguage::Cpp, Rebuilds::Compiling),
    (GgProgramLanguage::CSharp, Rebuilds::Compiling),
];

/// Hold `arm` to its [row](ROWS): hand its program step a code module this workspace holds no build
/// of and that its compiler refuses, and read the band of what comes back.
pub(super) fn gate(arm: GgProgramLanguage) {
    let language = crate::sandbox::language(arm);
    let row = ROWS
        .iter()
        .find(|(named, _)| *named == arm)
        .map(|(_, rebuilds)| rebuilds)
        .unwrap_or_else(|| panic!("{arm} has no row in this gate's table"));

    let key = language.binding_name(MODULE_NAME);
    let modules = [crate::sandbox::CodeModule {
        name: key.clone(),
        source: format!("{}{BROKEN}", language.gate_module(MODULE_NAME)),
    }];
    // A whole program of this arm's own, and one that compiles: what is being measured is the band
    // a module's refusal arrives in, so a program with a fault of its own would answer a different
    // question.
    let prepared = crate::sandbox::prepare_program(
        language,
        &language.open_docs_views_statement(&[MODULE_NAME]),
        &modules,
        &AgentWorkspace::new(),
    );

    let Rebuilds::Compiling = row else {
        assert!(
            prepared.is_ok(),
            "{arm} compiles no module at prepare time and refused a program over one: {:?}",
            prepared.err()
        );
        return;
    };

    let refusal = prepared.err().unwrap_or_else(|| {
        panic!("{arm}: a program prepared beside a module that does not compile")
    });
    let PrepareFailure::Lowering(message) = &refusal else {
        panic!(
            "{arm} hands a model the diagnostic of a module gg rebuilt beside its program: \
             {refusal:?}. The program compiles, the file the diagnostic names is one the model \
             never wrote, and the band charges gg's own defect to that model's transpile ceiling."
        );
    };
    assert!(
        message.contains(&key),
        "{arm} does not tell an operator which binding gg could not rebuild: {message}"
    );
}

#[cfg(test)]
#[path = "rebuilds.test.rs"]
mod tests;
