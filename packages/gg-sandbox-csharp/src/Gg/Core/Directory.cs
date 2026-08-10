namespace Gg;

/// <summary>One function in a module's directory.</summary>
/// <param name="Name">The name a program calls it by — <c>ReadFile</c> in <c>Files.ReadFile(...)</c>.</param>
/// <param name="Summary">A one-line description of what it does.</param>
/// <ggmodule>core</ggmodule>
public sealed record FunctionSummary(string Name, string Summary);
