//! **The SDK a C# program is compiled against**, carried as source in gg's own binary and compiled
//! into one assembly by [`sdk_assembly`](super::compile::sdk_assembly).
//!
//! # Why the sources are carried rather than a built assembly
//!
//! Every other arm's SDK is a *built* artifact gg carries — a jar on a classpath, a header in a
//! precompiled prelude, a wasm object linked into the program. This one is twenty-six `.cs` files
//! gg carries and Roslyn turns into `Gg.dll` the first time a machine prepares anything. Two things
//! follow, and each of them is why:
//!
//! * **The SDK is reviewable.** What a reviewer reads in the diff is what a model compiles against,
//!   with no committed binary in between and no reproducible-build gate to keep green.
//! * **It costs nothing on a turn.** The assembly is content-keyed on these sources and built once
//!   per machine, so a turn's own compile is the model's program alone — see
//!   [`compile`](super::compile) for the numbers.
//!
//! # A reference is availability, and nothing more
//!
//! `-r:Gg.dll` is how `csc` is told the library exists, which is what an `--extern`, a classpath
//! entry or an include path is on the other arms — and what a code [skill](crate::skills)'s or
//! [memory](crate::memories)'s module is given, so the two are supplied by one mechanism. It puts no
//! name in a program's scope: `namespace Gg` is a namespace like any other, so a program reaches
//! `Gg.Views.OpenText` by writing the whole path and reaches `Views.OpenText` after writing
//! `using Gg;` of its own. That line is what each module's
//! [import](crate::sandbox::ModuleDoc::import) states, and a documentation view quotes it.
//!
//! # What holds this list to the directory
//!
//! Nothing about `include_str!` notices a file nobody added to the array, so
//! its test (`csharp.sdk.test.rs`) reads `packages/gg-sandbox-csharp/src/Gg/` and requires the two to be
//! equal. A new SDK file that is not embedded would otherwise be a file the reflector documents and
//! the compiler never sees — a catalogue describing functions a program cannot call.
//!
//! # What a model cannot reach
//!
//! `Gg.Internal` — the `extern` declarations and the lowering under them — is `internal` to the SDK's
//! own assembly, so a program cannot name it at all. It is not model-facing either way: it is absent
//! from the catalogue, absent from a module's directory, and documented with `//` rather than `///`
//! precisely so the reflector cannot pick it up.

/// One embedded SDK source: its path under `src/Gg/`, and its text.
///
/// The path is relative and is written into the SDK's own build tree **as it stands**, so a
/// diagnostic in gg's own SDK reads `./Files/Files.cs(12,9)` and names the file a reviewer would
/// open.
pub(super) struct SdkSource {
    /// Where the file goes, relative to [`SDK_DIRECTORY`].
    pub name: &'static str,
    /// The file's text.
    pub text: &'static str,
}

/// The directory the SDK's sources and the assembly built from them live in, inside the shared
/// toolchain directory [`sdk_assembly`](super::compile::sdk_assembly) keys.
pub(super) const SDK_DIRECTORY: &str = "sdk";

/// Every file of the SDK, in the order `csc` is given them.
///
/// The order is immaterial to C#, which resolves a whole compilation at once, and is kept
/// alphabetical so that the response file — and therefore the compile — is a function of this list
/// rather than of anyone's editing order.
pub(super) const SDK_SOURCES: &[SdkSource] = &[
    SdkSource {
        name: "Board/Board.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Board/Board.cs"),
    },
    SdkSource {
        name: "Board/Types.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Board/Types.cs"),
    },
    SdkSource {
        name: "Context/Context.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Context/Context.cs"),
    },
    SdkSource {
        name: "Context/Types.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Context/Types.cs"),
    },
    SdkSource {
        name: "Core/Errors.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Core/Errors.cs"),
    },
    SdkSource {
        name: "Delegation/Delegation.cs",
        text: include_str!(
            "../../../../../packages/gg-sandbox-csharp/src/Gg/Delegation/Delegation.cs"
        ),
    },
    SdkSource {
        name: "Delegation/Types.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Delegation/Types.cs"),
    },
    SdkSource {
        name: "Docs/Docs.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Docs/Docs.cs"),
    },
    SdkSource {
        name: "Docs/Types.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Docs/Types.cs"),
    },
    SdkSource {
        name: "Files/Files.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Files/Files.cs"),
    },
    SdkSource {
        name: "Files/Types.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Files/Types.cs"),
    },
    SdkSource {
        name: "Internal/Native.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Internal/Native.cs"),
    },
    SdkSource {
        name: "Internal/OperatorConsole.cs",
        text: include_str!(
            "../../../../../packages/gg-sandbox-csharp/src/Gg/Internal/OperatorConsole.cs"
        ),
    },
    SdkSource {
        name: "Internal/Wire.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Internal/Wire.cs"),
    },
    SdkSource {
        name: "Memories/Memories.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Memories/Memories.cs"),
    },
    SdkSource {
        name: "Memories/Types.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Memories/Types.cs"),
    },
    SdkSource {
        name: "Programs/Programs.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Programs/Programs.cs"),
    },
    SdkSource {
        name: "Programs/Types.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Programs/Types.cs"),
    },
    SdkSource {
        name: "Session/Session.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Session/Session.cs"),
    },
    SdkSource {
        name: "Shell/Shell.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Shell/Shell.cs"),
    },
    SdkSource {
        name: "Shell/Types.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Shell/Types.cs"),
    },
    SdkSource {
        name: "Skills/Skills.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Skills/Skills.cs"),
    },
    SdkSource {
        name: "Tasks/Tasks.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Tasks/Tasks.cs"),
    },
    SdkSource {
        name: "Tasks/Types.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Tasks/Types.cs"),
    },
    SdkSource {
        name: "Views/Types.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Views/Types.cs"),
    },
    SdkSource {
        name: "Views/Views.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Views/Views.cs"),
    },
];

#[cfg(test)]
#[path = "csharp.sdk.test.rs"]
mod tests;
