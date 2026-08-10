using System.Collections.Generic;

namespace Gg;

/// <summary>Read the authored skills this run offers.</summary>
/// <remarks>
/// A skill is a procedure somebody wrote down. The ones a run offers are named in the system
/// prompt, and reading one pins it into the session permanently.
/// </remarks>
/// <ggmodule>skills</ggmodule>
public static partial class Skills
{
    /// <inheritdoc cref="Internal.ModuleDirectory.List"/>
    public static IReadOnlyList<FunctionSummary> List() => Internal.ModuleDirectory.List(typeof(Skills));

    /// <summary>Read an authored skill by name, front matter stripped.</summary>
    /// <remarks>
    /// The skill is also pinned permanently into the session's context, so it survives a compaction
    /// and never has to be read twice. A skill that carries code binds that code at
    /// <c>lib.&lt;name&gt;</c> for every later program.
    /// </remarks>
    /// <param name="name">
    /// The skill's name, exactly as the system prompt lists it. An unknown one comes back with the
    /// full list of the skills this run has.
    /// </param>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.NotFound"/> for a name this run has no skill under.
    /// </exception>
    /// <ggop>skills.read_skill</ggop>
    public static string ReadSkill(string name)
    {
        Internal.Wire.Check(Internal.Native.ReadSkill(name, out var body));
        return body;
    }
}
