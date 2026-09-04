//! **Gate — an unresolved import is answered with the candidates that match it, on every arm.**
//!
//! A compile failure carries [supporting material](super::supporting) drawn from the arm's library
//! set, and which of the set it carries is decided from what the diagnostic said. That decision runs
//! on eight different compilers' wordings, so the one thing that can go wrong quietly is an arm
//! whose compiler rephrased its sentence: the arm recovers no name, every rejection falls back to
//! the whole inventory, and nothing anywhere reports it.
//!
//! This is the assertion that stops that. One row per registered arm, each either a **program** that
//! names a library the arm does not carry — driven through the arm's real preparation, against its
//! real compiler — or a statement that this arm's host-side preparation reads no import at all.
//!
//! # The table is the audit
//!
//! [`ROWS`] answers the same question for all eleven arms and is checked to cover every one of them,
//! so a twelfth arm fails here until it has said which of the two it is. An arm that reads an import
//! must recover the name its own program wrote and must answer with a module of its own catalogue;
//! an arm that reads none must recover nothing from any other arm's wording, which is what catches a
//! parser copied between arms.
//!
//! # Why one test per arm rather than one loop
//!
//! Because a loop over eleven real compilers is one test holding two JVM starts, a Swift compile and
//! a Roslyn compile, and a per-test timeout is what would report that as a hang. Each arm calls
//! [`gate`] from beside the compiler it measures, the way every other real-toolchain cell in this
//! crate is arranged.

use test_cabinet_core::gg::GgProgramLanguage;

use super::{PrepareError, PrepareFailure};

/// What one arm's host-side preparation does with an import it cannot resolve.
pub(super) enum Reads {
    /// The arm's compiler names the unresolved import, so a rejection is answered with the modules
    /// that match it.
    Import {
        /// A whole program in this arm's own syntax, importing a near-miss of a module the arm's
        /// catalogue declares. Near rather than absurd, because what the gate measures is the
        /// ordinary mistake: one letter, on a name the arm really carries.
        program: &'static str,
        /// The name the arm must recover from its own compiler's diagnostic, spelt as the compiler
        /// reports it rather than as the program wrote it.
        name: &'static str,
        /// A module of this arm's own catalogue the answer must offer back.
        candidate: &'static str,
    },
    /// The arm's host-side preparation never sees an import, with the reason.
    Nothing(&'static str),
}

/// The PureScript program: a module header, an import one letter off `Data.Array`, and a `main`.
const PURESCRIPT: &str = r#"module Main where

import Prelude

import Data.Arary (head)
import Effect (Effect)
import Gg.Views as Gg.Views

main :: Effect Unit
main = Gg.Views.openDocsView (head ["docs"])
"#;

/// The Java program: a whole compilation unit whose first import names no package.
const JAVA: &str = r#"import java.utl.List;

public final class Program {
    public static void main(String[] args) {
        List<String> functions = List.of();
        for (String name : functions) {
            gg.views.Views.openDocsView(name);
        }
    }
}
"#;

/// The Kotlin program: a whole file whose import reaches through a package `kotlin` does not have.
const KOTLIN: &str = r#"import kotlin.mathh.abs

fun main() {
    gg.views.openDocsView(abs(-1).toString())
}
"#;

/// The Rust program: a `use` of a crate one letter off the one the library set carries.
const RUST: &str = r#"use itertool::Itertools;

fn main() -> Result<(), gg::Failure> {
    let functions: [&str; 0] = [];
    for name in functions.iter().unique() {
        gg::views::open_docs_view(name)?;
    }
    Ok(())
}
"#;

/// The Swift program: an `import` of a module one letter off a vendored one.
const SWIFT: &str = r#"import gg
import Algorithm

let functions: [String] = []
for name in functions {
    try gg.views.openDocsView(name)
}
"#;

/// The C++ program: an `#include` of a header one letter off `<vector>`.
const CPP: &str = r#"#include <vectr>

#include <gg/views.hpp>

int main() {
  const std::vectr<int> values{};
  (void)values;
  gg::views::open_docs_view("docs");
  return 0;
}
"#;

/// The C# program: a `using` reaching into a namespace one letter off `System.Text.Json`.
const CSHARP: &str = r#"using System.Text.Jsn;

string[] functions = [];
foreach (var name in functions)
{
    Gg.Views.OpenDocsView(name);
}
"#;

/// One row per registered arm.
const ROWS: &[(GgProgramLanguage, Reads)] = &[
    (
        GgProgramLanguage::TypeScript,
        Reads::Nothing(
            "the catalogue declares no library set, so a rejection carries the diagnostic alone",
        ),
    ),
    (
        GgProgramLanguage::JavaScript,
        Reads::Nothing("nothing reads a program on the host, and no library set is declared"),
    ),
    (
        GgProgramLanguage::Python,
        Reads::Nothing(
            "nothing reads a program on the host, so an import of anything outside the set raises \
             the guest's own `ModuleNotFoundError` at run time",
        ),
    ),
    (
        GgProgramLanguage::Ruby,
        Reads::Nothing(
            "Opal reports one thrown `SyntaxError`, and a `require` of anything outside the set \
             raises a `LoadError` at run time",
        ),
    ),
    (
        GgProgramLanguage::PureScript,
        Reads::Import {
            program: PURESCRIPT,
            name: "Data.Arary",
            candidate: "Data.Array",
        },
    ),
    (
        GgProgramLanguage::Java,
        Reads::Import {
            program: JAVA,
            name: "java.utl",
            candidate: "java.util",
        },
    ),
    (
        GgProgramLanguage::Kotlin,
        Reads::Import {
            program: KOTLIN,
            name: "mathh",
            candidate: "kotlin.math",
        },
    ),
    (
        GgProgramLanguage::Rust,
        Reads::Import {
            program: RUST,
            name: "itertool",
            candidate: "itertools",
        },
    ),
    (
        GgProgramLanguage::Swift,
        Reads::Import {
            program: SWIFT,
            name: "Algorithm",
            candidate: "Algorithms",
        },
    ),
    (
        GgProgramLanguage::Cpp,
        Reads::Import {
            program: CPP,
            name: "vectr",
            candidate: "<vector>",
        },
    ),
    (
        GgProgramLanguage::CSharp,
        Reads::Import {
            program: CSHARP,
            name: "System.Text.Jsn",
            candidate: "System.Text.Json",
        },
    ),
];

/// Every reading arm's wording, verbatim from the diagnostic its own compiler produced for the
/// [program its row carries](ROWS), so a row that reads nothing can be shown to read nothing at all
/// rather than merely nothing of its own.
const WORDINGS: &[&str] = &[
    "error[E0432]: unresolved import `itertool`\n  --> line 1, column 5\n  use of unresolved \
     module or unlinked crate `itertool`",
    "program.purs:5:1: ModuleNotFound\n  Module Data.Arary was not found.",
    "Program.java:1:16: package java.utl does not exist",
    "Program.kt:1:15: Unresolved reference 'mathh'.",
    "main.swift:2:8: error: no such module 'Algorithm'",
    "main.cpp:1:10: fatal error: 'vectr' file not found",
    "program.cs(1,19): error CS0234: The type or namespace name 'Jsn' does not exist in the \
     namespace 'System.Text' (are you missing an assembly reference?)",
];

/// Hold `arm` to its [row](ROWS): drive its program through its real compiler, and hold what the
/// rejection is answered with to the name the program wrote and to the [bound](super::diagnostics::SUPPORTING).
pub(super) fn gate(arm: GgProgramLanguage) {
    let language = crate::sandbox::language(arm);
    let row = ROWS
        .iter()
        .find(|(named, _)| *named == arm)
        .map(|(_, reads)| reads)
        .unwrap_or_else(|| panic!("{arm} has no row in this gate's table"));
    let Reads::Import {
        program,
        name,
        candidate,
    } = row
    else {
        for wording in WORDINGS {
            assert!(
                language.unresolved_imports(wording).is_empty(),
                "{arm} reads no import on the host, and recovered a name out of another arm's \
                 wording: {wording:?}"
            );
        }
        return;
    };

    let refusal = crate::sandbox::prepare_program(
        language,
        program,
        &[],
        &crate::sandbox::AgentWorkspace::new(),
    )
    .err()
    .unwrap_or_else(|| panic!("{arm}: a program importing `{name}` compiled"));
    let diagnostic = match &refusal {
        PrepareFailure::Program(error @ (PrepareError::Compile(_) | PrepareError::Syntax(_))) => {
            error.to_string()
        }
        other => {
            panic!("{arm}: an unresolved import is the model's own compile failure: {other:?}")
        }
    };

    let recovered = language.unresolved_imports(&diagnostic);
    assert!(
        recovered.iter().any(|read| read == name),
        "{arm} did not recover `{name}` from its own compiler's diagnostic, which is what has every \
         rejection on this arm answered with the whole inventory. Recovered {recovered:?} from:\n\
         {diagnostic}"
    );

    let answered = crate::sandbox::supporting(language.catalogue(), &recovered)
        .unwrap_or_else(|| panic!("{arm} declares a library set and answered with nothing"));
    assert!(
        answered.contains(candidate),
        "{arm} recovered `{name}` and did not offer `{candidate}` back:\n{answered}"
    );
    assert!(
        answered.len() <= super::diagnostics::SUPPORTING,
        "{arm} answered `{name}` with {} bytes, over the {} every arm holds to",
        answered.len(),
        super::diagnostics::SUPPORTING
    );
    let whole = crate::sandbox::supporting(language.catalogue(), &[])
        .expect("this arm declares a library set");
    assert!(
        answered.len() < whole.len(),
        "{arm} recovered `{name}` and answered with the whole inventory anyway:\n{answered}"
    );
}

#[cfg(test)]
#[path = "imports.test.rs"]
mod tests;
