using System;

namespace Gg;

/// <summary>Why a gg call failed, in the vocabulary a <c>catch</c> branches on.</summary>
/// <remarks>
/// A code is never derived from the wording of a message: every gg tool classifies its own failures
/// where it raises them, and this is that classification. Branching on it is stable in a way that
/// branching on <see cref="Exception.Message"/> is not.
/// </remarks>
/// <ggmodule>core</ggmodule>
public enum ApiErrorCode
{
    /// <summary>The arguments were malformed, ill-typed, or out of range.</summary>
    InvalidArgument,

    /// <summary>The named file, skill, memory, task, epic, issue, subagent or program is not there.</summary>
    NotFound,

    /// <summary>Well-formed, and in conflict with how things stand.</summary>
    /// <remarks>
    /// An ambiguous edit, a dependency cycle, a duplicate id, a child agent that has already
    /// returned.
    /// </remarks>
    Conflict,

    /// <summary>gg refused the call because of a rule about the agent's own state.</summary>
    /// <remarks>
    /// A read-only memory, a call a pending compaction does not admit, a second succession in one
    /// turn, or a hook that blocked it. A ceiling that was reached is
    /// <see cref="LimitExceeded"/> instead.
    /// </remarks>
    Refused,

    /// <summary>The call exists and this run does not offer it to this agent.</summary>
    /// <remarks>
    /// A tool outside the run's capability set, an ending the agent's role does not declare, or a
    /// program library this agent does not keep. The recovery is to stop asking for it.
    /// </remarks>
    Unavailable,

    /// <summary>A gg-side ceiling was reached.</summary>
    /// <remarks>
    /// A shell timeout, a memory, task or board cap, the delegation depth cap, a view cap a program
    /// spends, or the run's wall-clock budget running out mid-program.
    /// </remarks>
    LimitExceeded,

    /// <summary>The underlying input, output or process failed.</summary>
    IOError,

    /// <summary>The failure was not classified.</summary>
    /// <remarks>No tool produces it; it is reserved for outcomes raised outside a tool implementation.</remarks>
    Other,
}

/// <summary>The exception every gg call throws when it fails.</summary>
/// <remarks>
/// <para>
/// A failure is thrown rather than returned because C# is an exception language: the common path
/// reads as a straight line, and only the calls expected to fail are wrapped.
/// </para>
/// <code>
/// try
/// {
///     Views.OpenText("notes", Files.ReadTextFile("NOTES.md"));
/// }
/// catch (ApiException failure) when (failure.Code == ApiErrorCode.NotFound)
/// {
///     Views.OpenText("notes", "there are no notes yet");
/// }
/// </code>
/// <para>
/// An unexpected one is best left to escape: gg reports which call failed, with the managed stack,
/// and the turn is recoverable.
/// </para>
/// </remarks>
/// <ggmodule>core</ggmodule>
public sealed class ApiException : Exception
{
    /// <summary>Build a failure, which gg raises and a program has no reason to.</summary>
    /// <param name="code">The failure class.</param>
    /// <param name="operation">The call that failed, by the operation's key.</param>
    /// <param name="message">The model-facing guidance.</param>
    public ApiException(ApiErrorCode code, string operation, string message)
        : base(message)
    {
        Code = code;
        Operation = operation;
    }

    /// <summary>The failure class, so a catch site branches on a value rather than on prose.</summary>
    public ApiErrorCode Code { get; }

    /// <summary>The call that failed, by the key of the operation this program reached for.</summary>
    /// <remarks>
    /// <c>read_file</c> for <c>Files.ReadFile</c>, <c>read_text_file</c> for
    /// <c>Files.ReadTextFile</c>.
    /// </remarks>
    public string Operation { get; }
}

// WHERE THE `core` MODULE'S OWN DOCUMENTATION IS WRITTEN, AND WHY IT IS WRITTEN ON A CLASS.
//
// Every other module of this arm is a `static class`, and its two model-facing lines are the
// `<summary>` and `<remarks>` on that class. `core` is not a class: it is the types and the exception
// declared directly in `namespace Gg`, which is what every other module's signatures name. C# has no
// second place to put a module's prose — an XML comment on a `namespace` declaration is CS1587, "not
// placed on a valid language element", and this SDK compiles with every warning fatal — so Java's
// answer, a `package-info.java`, has no C# spelling. So it is written on a class after all: the
// `NamespaceDoc` convention C#'s own documentation tooling settled on for exactly this.
//
// WHAT MAKES IT HARMLESS is that it is `internal` and EMPTY. It reaches no model: the reflector walks
// the module classes the table names for functions and emits only the types a signature references,
// and this is neither. And there is nothing here to call — a static class with no members is a name,
// not a capability — which is the whole of the objection an empty marker class used to draw.
//
// WHY NOT `file`, WHICH WOULD HAVE MADE IT UNNAMEABLE. Because it would have cost this arm its
// determinism. The SDK is compiled in the SAME COMPILATION as the model's program (see
// `crates/gg/src/sandbox/language/csharp.sdk.rs`), in a workspace whose path differs from
// preparation to preparation, and Roslyn mangles a checksum OF THE FILE'S PATH into a file-local
// type's metadata name. Measured: one program compiled twice under `-deterministic`, from two
// directories, produced two different assemblies with a `file` class present and identical ones with
// this. `csharp.substrate.test.rs` says why that matters — a recorded program has to re-prepare to
// the assembly that ran.
//
// The alternative all of this replaces was two string literals inside `tools/Signatures.cs`. They
// were the only prose in all eleven catalogues with no declaration behind them, which made this arm
// the one place a reviewer reading the SDK could not see what a model would be shown.

/// <summary>The types and the failure vocabulary every other module's signatures name.</summary>
/// <remarks>
/// They are declared directly in <c>namespace Gg</c>, which the SDK brings into every program's
/// scope, so <see cref="ApiException"/> and <see cref="ApiErrorCode"/> are written without a
/// module prefix.
/// </remarks>
/// <ggmodule>core</ggmodule>
internal static class NamespaceDoc { }
