//! **The SDK a C# program is compiled against**, carried as source in gg's own binary.
//!
//! # Why it is source rather than an assembly
//!
//! Every other arm's SDK is a *built* artifact — a jar on a classpath, a header in a precompiled
//! prelude, a wasm object linked into the program. This one is twenty-two `.cs` files written into
//! the preparation's own workspace and handed to `csc` beside `program.cs`, so the model's program
//! and gg's SDK are **one compilation**. Three things follow, and each of them is why:
//!
//! * **There is no second assembly for the guest to find.** The committed guest holds a Mono
//!   interpreter and a bundled class library, and it loads exactly one assembly per run — the
//!   program's. An SDK compiled separately would have to be bundled *into* the 34.9 MB component,
//!   which would mean rebuilding and re-committing that component every time a doc comment changed.
//! * **The SDK is reviewable.** What a reviewer reads in the diff is what a model compiles against,
//!   with no committed binary in between and no reproducible-build gate to keep green.
//! * **It costs almost nothing.** Roslyn compiles these files and the program together in ~0.4 s
//!   warm, against ~0.3 s for the program alone — see [`compile`](super::compile) for the numbers.
//!
//! # What holds this list to the directory
//!
//! Nothing about `include_str!` notices a file nobody added to the array, so
//! [`its test`](self::tests) reads `packages/gg-sandbox-csharp/src/Gg/` and requires the two to be
//! equal. A new SDK file that is not embedded would otherwise be a file the reflector documents and
//! the compiler never sees — a catalogue describing functions a program cannot call.
//!
//! # The one thing a model may notice
//!
//! Everything here is in the program's own assembly, so `Gg.Internal` — the `extern` declarations and
//! the lowering under them — is `internal` *to the model's code too*. It is not model-facing: it is
//! absent from the catalogue, absent from `object.list()`, and documented with `//` rather than
//! `///` precisely so the reflector cannot pick it up. A program that went looking could call it; it
//! would reach the same host that checks every call regardless.

/// One embedded SDK source: its path under `src/Gg/`, and its text.
///
/// The path is relative and is written into the workspace **as it stands**, so a diagnostic in gg's
/// own SDK reads `sdk/Objects/fs.cs(12,9)` — which is what tells
/// [`classify`](super::compile) that the fault is gg's rather than the model's.
pub(super) struct SdkSource {
    /// Where the file goes, relative to [`SDK_DIRECTORY`].
    pub name: &'static str,
    /// The file's text.
    pub text: &'static str,
}

/// The directory the SDK is written into, inside the preparation's own workspace.
pub(super) const SDK_DIRECTORY: &str = "sdk";

/// Every file of the SDK, in the order `csc` is given them.
///
/// The order is immaterial to C#, which resolves a whole compilation at once, and is kept
/// alphabetical so that the response file — and therefore the compile — is a function of this list
/// rather than of anyone's editing order.
pub(super) const SDK_SOURCES: &[SdkSource] = &[
    SdkSource {
        name: "GlobalUsings.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/GlobalUsings.cs"),
    },
    SdkSource {
        name: "Internal/Native.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Internal/Native.cs"),
    },
    SdkSource {
        name: "Internal/ObjectDirectory.cs",
        text: include_str!(
            "../../../../../packages/gg-sandbox-csharp/src/Gg/Internal/ObjectDirectory.cs"
        ),
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
        name: "Objects/agents.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Objects/agents.cs"),
    },
    SdkSource {
        name: "Objects/context.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Objects/context.cs"),
    },
    SdkSource {
        name: "Objects/fs.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Objects/fs.cs"),
    },
    SdkSource {
        name: "Objects/harness.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Objects/harness.cs"),
    },
    SdkSource {
        name: "Objects/memory.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Objects/memory.cs"),
    },
    SdkSource {
        name: "Objects/programs.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Objects/programs.cs"),
    },
    SdkSource {
        name: "Objects/project.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Objects/project.cs"),
    },
    SdkSource {
        name: "Objects/review.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Objects/review.cs"),
    },
    SdkSource {
        name: "Objects/skills.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Objects/skills.cs"),
    },
    SdkSource {
        name: "Objects/system.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Objects/system.cs"),
    },
    SdkSource {
        name: "Objects/tasks.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Objects/tasks.cs"),
    },
    SdkSource {
        name: "Objects/view.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Objects/view.cs"),
    },
    SdkSource {
        name: "ToolException.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/ToolException.cs"),
    },
    SdkSource {
        name: "Types.Agents.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Types.Agents.cs"),
    },
    SdkSource {
        name: "Types.Files.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Types.Files.cs"),
    },
    SdkSource {
        name: "Types.Session.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Types.Session.cs"),
    },
    SdkSource {
        name: "Types.Work.cs",
        text: include_str!("../../../../../packages/gg-sandbox-csharp/src/Gg/Types.Work.cs"),
    },
];

#[cfg(test)]
#[path = "csharp.sdk.test.rs"]
mod tests;
