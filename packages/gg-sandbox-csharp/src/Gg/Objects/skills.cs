using System.Collections.Generic;

namespace Gg;

/// <summary>
/// read authored skills
/// </summary>
/// <remarks>
/// A skill is a procedure somebody wrote down for you. The ones this run offers are named in your
/// system prompt; reading one pins it into your session permanently.
/// </remarks>
public static class skills
{
    /// <inheritdoc cref="Internal.ObjectDirectory.List"/>
    public static IReadOnlyList<FunctionSummary> List() => Internal.ObjectDirectory.List("skills");

    /// <summary>Read an authored skill by name and hand back its body, front matter stripped.</summary>
    /// <remarks>
    /// Reading a skill also pins it permanently into your session's context, so it survives a
    /// compaction and you never have to read it twice. A skill that carries code binds that code at
    /// <c>lib.&lt;name&gt;</c> for every later program of yours.
    /// </remarks>
    /// <param name="name">
    /// The skill's name, exactly as your system prompt lists it. An unknown one comes back with the
    /// full list of the ones you have.
    /// </param>
    /// <returns>the skill's body.</returns>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.NotFound"/> for a name this run has no skill under.
    /// </exception>
    public static string ReadSkill(string name)
    {
        Internal.Wire.Check(Internal.Native.ReadSkill(name, out var body));
        return body;
    }
}
