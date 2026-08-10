// Reflect the C# arm's signature catalogue out of the SDK's own XML documentation comments.
//
// WHY ROSLYN. Everything a model reads about this surface is written on the declaration it
// describes — a function's brief in its `<summary>`, its detail in its `<remarks>`, an argument's in
// that argument's `<param>`, a record component's in the `<param>` on the record, an enum constant's
// in the `<summary>` above it, a module's on the `static class` that is the module — and Roslyn is
// what reads all of it. It is also the compiler this arm already runs on every turn, so the
// catalogue is reflected by the same reading of the same sources that the model's program is
// compiled against.
//
// WHY ROSLYN AND NOT A TEXT SCAN, restated for the second schema: a catalogue now records **resolved
// type references**, and a resolution is something only a type system has. `Files.FileRead` written
// in one file and `FileRead` written in another are one type, and the name a documentation view is
// opened by is `Gg.Files.FileRead` whichever of the two the signature spelled. Roslyn hands that
// over natively, and nothing that reads source as text can.
//
// WHAT IT REFUSES. A blank is an error rather than a gap a model discovers: a public member with no
// `<summary>`, a parameter with no `<param>`, a type with no documentation, a member of one with
// none. A brief that is not one line is an error too, since the whole model rests on the first line
// being a standalone brief. A `<returns>` is NOT required: the signature already writes the return
// type, so an element that had to be filled in would manufacture a detail where none was earned. `DocumentationMode.Diagnose` is
// on and Roslyn's own documentation diagnostics are errors as well, so a `<param>` naming an
// argument that is not there, or a `<see cref>` pointing at nothing, fails here rather than reaching
// a model. Two independent readings therefore have to agree before anything a model reads is
// written — and the check this adds over Roslyn's own is the one Roslyn does not make: `CS1573`
// fires only when SOME parameters are documented, so a function with a summary and no `<param>` at
// all compiles clean and is rejected below.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Xml.Linq;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace Tools;

internal static class Signatures
{
    private static CSharpCompilation compilation = null!;
    private static INamespaceSymbol gg = null!;

    internal static int Main(string[] args)
    {
        var options = ParseArguments(args);
        var sdkRoot = options["--sdk"];
        var trees = Directory
            .EnumerateFiles(sdkRoot, "*.cs", SearchOption.AllDirectories)
            .OrderBy(path => path, StringComparer.Ordinal)
            .Select(path => CSharpSyntaxTree.ParseText(
                SourceTextOf(path),
                new CSharpParseOptions(LanguageVersion.Preview, DocumentationMode.Diagnose),
                path))
            .ToArray();
        var references = Directory
            .EnumerateFiles(options["--references"], "*.dll", SearchOption.AllDirectories)
            .OrderBy(path => path, StringComparer.Ordinal)
            .Select(path => (MetadataReference)MetadataReference.CreateFromFile(path))
            .ToArray();
        compilation = CSharpCompilation.Create(
            "GgSdk",
            trees,
            references,
            new CSharpCompilationOptions(
                OutputKind.DynamicallyLinkedLibrary,
                nullableContextOptions: NullableContextOptions.Enable));

        var complaints = compilation
            .GetDiagnostics()
            .Where(diagnostic => diagnostic.Severity >= DiagnosticSeverity.Warning)
            .ToArray();
        if (complaints.Length > 0)
        {
            foreach (var complaint in complaints)
            {
                Console.Error.WriteLine(complaint.ToString());
            }
            Console.Error.WriteLine("error: the C# SDK does not read cleanly, so nothing was written");
            return 1;
        }

        gg = compilation.GlobalNamespace.GetNamespaceMembers().Single(space => space.Name == "Gg");

        var document = Build(options["--libraries"]);
        File.WriteAllText(options["--out"], document);
        Console.WriteLine($"wrote {options["--out"]} ({document.Length} bytes)");
        return 0;
    }

    private static Microsoft.CodeAnalysis.Text.SourceText SourceTextOf(string path) =>
        Microsoft.CodeAnalysis.Text.SourceText.From(File.ReadAllText(path), Encoding.UTF8);

    private static Dictionary<string, string> ParseArguments(string[] args)
    {
        var parsed = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var index = 0; index + 1 < args.Length; index += 2)
        {
            parsed[args[index]] = args[index + 1];
        }
        foreach (var required in new[] { "--sdk", "--references", "--libraries", "--out" })
        {
            if (!parsed.ContainsKey(required))
            {
                throw new ArgumentException($"missing {required}");
            }
        }
        return parsed;
    }

    // ------------------------------------------------------------------------------------------
    // The model, built before a byte of it is written
    // ------------------------------------------------------------------------------------------

    /// One catalogued call: the operation it binds, and the declarations it was reflected from.
    ///
    /// An overload group is ONE entry with several shapes, because two overloads are one capability
    /// written twice. The documentation is the first shape's, which is what a reader wants: a second
    /// paragraph explaining the same thing is a second place for it to drift.
    private sealed record Call(
        string Operation,
        bool IsAlias,
        Module Module,
        INamedTypeSymbol? Receiver,
        IMethodSymbol[] Overloads);

    /// Every catalogued call, in the order the modules are presented in.
    private static readonly List<Call> calls = [];

    /// Every type a catalogued signature reaches, keyed by its fully-qualified name so that the
    /// order it is emitted in is the order it was first reached in.
    private static readonly List<INamedTypeSymbol> referenced = [];

    private static readonly HashSet<string> referencedNames = new(StringComparer.Ordinal);

    private static string Build(string librariesPath)
    {
        var modules = ResolveModules();
        CollectCalls(modules);
        // A member function hangs off a type, so it can only be found once the types the module
        // functions reach are known — and its own signature may reach further types still, which is
        // why this runs to a fixed point rather than once.
        CollectMemberFunctions();

        var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Indented = true }))
        {
            writer.WriteStartObject();
            writer.WriteNumber("schema", 2);
            writer.WriteString("language", "csharp");
            writer.WriteString(
                "generatedFrom",
                "packages/gg-sandbox-csharp/src/Gg/ (Roslyn, Microsoft.CodeAnalysis.CSharp)");

            WriteLibraries(writer, librariesPath);
            WriteModules(writer, modules);
            WriteMeta(writer, modules);
            WriteFunctions(writer);
            WriteTypes(writer);

            writer.WriteEndObject();
        }
        return Encoding.UTF8.GetString(stream.ToArray()) + "\n";
    }

    private static void WriteLibraries(Utf8JsonWriter writer, string path)
    {
        writer.WriteStartArray("libraries");
        string? group = null;
        var members = new List<string>();
        void Flush()
        {
            if (group is null)
            {
                return;
            }
            writer.WriteStartObject();
            writer.WriteString("group", group);
            writer.WriteStartArray("modules");
            foreach (var member in members)
            {
                writer.WriteStringValue(member);
            }
            writer.WriteEndArray();
            writer.WriteEndObject();
            members.Clear();
        }
        foreach (var raw in File.ReadAllLines(path))
        {
            var line = raw.Trim();
            if (line.StartsWith("# --- ", StringComparison.Ordinal))
            {
                Flush();
                group = line[6..].TrimEnd(' ', '-');
                continue;
            }
            if (line.Length == 0 || line.StartsWith('#'))
            {
                continue;
            }
            if (group is null)
            {
                throw new InvalidOperationException($"the library `{line}` is under no heading");
            }
            members.Add(line);
        }
        Flush();
        writer.WriteEndArray();
    }

    // ------------------------------------------------------------------------------------------
    // Modules
    // ------------------------------------------------------------------------------------------

    /// The module class each row of the table names, checked against what the SDK actually declares
    /// in both directions.
    ///
    /// A class that carries a `<ggmodule>` no row names, and a row naming a class that does not
    /// exist, are both failures here: the table decides the order and the path, and the class decides
    /// which row it is, so the two disagreeing means one of them is describing a module nobody has.
    private static Dictionary<string, INamedTypeSymbol> ResolveModules()
    {
        var resolved = new Dictionary<string, INamedTypeSymbol>(StringComparer.Ordinal);
        foreach (var module in Catalogue.Classed())
        {
            var symbol = gg.GetTypeMembers().SingleOrDefault(type => type.Name == module.Class)
                ?? throw new InvalidOperationException(
                    $"the module `{module.Id}` names the class `{module.Class}`, which "
                        + "`namespace Gg` does not declare");
            var tag = TagOf(symbol, "ggmodule");
            if (tag != module.Id)
            {
                throw new InvalidOperationException(
                    $"`{module.Class}` says it is the module `{tag}` and the table files it under "
                        + $"`{module.Id}`");
            }
            resolved[module.Id] = symbol;
        }
        // The other direction: every `<ggmodule>` written anywhere in `namespace Gg` names a row of
        // the table. On a top-level TYPE that is how the `core` module is spelled, and on anything
        // else it would be a module nobody put in the table — so an id the table does not carry is a
        // name gg cannot resolve a fully-qualified name's prefix through.
        foreach (var type in gg.GetTypeMembers())
        {
            var id = TagOf(type, "ggmodule");
            if (id is not null && !Catalogue.Modules.Any(module => module.Id == id))
            {
                throw new InvalidOperationException(
                    $"`{type.Name}` declares itself part of the module `{id}`, which "
                        + "tools/Catalogue.cs does not name");
            }
        }
        return resolved;
    }

    private static void WriteModules(Utf8JsonWriter writer, Dictionary<string, INamedTypeSymbol> modules)
    {
        writer.WriteStartArray("modules");
        foreach (var module in Catalogue.Modules)
        {
            writer.WriteStartObject();
            writer.WriteString("id", module.Id);
            writer.WriteString("path", module.Path);
            if (modules.TryGetValue(module.Id, out var symbol))
            {
                WriteProse(writer, symbol, $"the module `{module.Id}`");
            }
            else
            {
                // `core` has no class to hang a doc comment on, so its own two lines are the one
                // piece of model-facing prose this arm cannot write on a declaration. They are here
                // rather than on an empty marker class, because a class that existed only to be
                // documented would be a class a program could try to call.
                writer.WriteString(
                    "brief",
                    "The types and the failure vocabulary every other module's signatures name.");
                writer.WriteString(
                    "detail",
                    "They are declared directly in `namespace Gg`, which the SDK brings into every "
                        + "program's scope, so `ToolException` and `FunctionSummary` are written "
                        + "without a module prefix.");
            }
            // Nothing is imported: the SDK declares a `global using Gg;` of its own, in the same
            // compilation as the program, so every module is in scope before the first line. A
            // program that wants the shorter call site writes `using static Gg.Files;` for itself,
            // which is its choice rather than a line gg requires.
            writer.WriteNull("import");
            writer.WriteEndObject();
        }
        writer.WriteEndArray();
    }

    // ------------------------------------------------------------------------------------------
    // Calls
    // ------------------------------------------------------------------------------------------

    /// Every public static method on every module class, filed under the operation it says it binds.
    ///
    /// Both directions, which is what stops a function from being added to the surface and never
    /// described: a method with no `<ggop>` is a call a model could make and no catalogue names, and
    /// it fails here rather than reaching a run.
    private static void CollectCalls(Dictionary<string, INamedTypeSymbol> modules)
    {
        foreach (var module in Catalogue.Classed())
        {
            var symbol = modules[module.Id];
            var grouped = new Dictionary<string, List<IMethodSymbol>>(StringComparer.Ordinal);
            var order = new List<string>();
            foreach (var method in symbol
                .GetMembers()
                .OfType<IMethodSymbol>()
                .Where(method =>
                    method.DeclaredAccessibility == Accessibility.Public
                    && method.MethodKind == MethodKind.Ordinary))
            {
                if (method.Name == Catalogue.Meta[0].Name)
                {
                    continue;
                }
                if (TagOf(method, "ggop") is null)
                {
                    throw new InvalidOperationException(
                        $"`{module.Path}.{method.Name}` is public on a module class and its "
                            + "declaration names no gg operation — add a `<ggop>` to it");
                }
                if (!grouped.TryGetValue(method.Name, out var overloads))
                {
                    overloads = [];
                    grouped[method.Name] = overloads;
                    order.Add(method.Name);
                }
                overloads.Add(method);
            }

            foreach (var name in order)
            {
                var overloads = grouped[name].OrderBy(method => method.Parameters.Length).ToArray();
                var operation = TagOf(overloads[0], "ggop")!;
                foreach (var overload in overloads)
                {
                    if (TagOf(overload, "ggop") != operation)
                    {
                        throw new InvalidOperationException(
                            $"the overloads of `{module.Path}.{name}` name different gg operations, "
                                + "and an overload group is one capability written twice");
                    }
                }
                calls.Add(new Call(operation, IsAlias(overloads[0]), module, null, overloads));
                Reach(overloads);
            }
        }
    }

    /// Every member function on a type a catalogued signature reaches — the one shape this arm binds
    /// that hangs off a value rather than off a module.
    ///
    /// It is walked to a fixed point rather than once, because a member function's own signature may
    /// name a type nothing else reaches, and that type may itself carry a member function. Built
    /// deliberately and separately from the type's *members*, which are its fields and its variants:
    /// a renderer that swept up every public method of a record would have swept up the compiler's
    /// own `Equals`, `Deconstruct` and `ToString` and called them capabilities.
    private static void CollectMemberFunctions()
    {
        var walked = new HashSet<string>(StringComparer.Ordinal);
        bool found;
        do
        {
            found = false;
            foreach (var type in referenced.ToArray())
            {
                if (!walked.Add(Fqn(type)))
                {
                    continue;
                }
                foreach (var method in MemberFunctionsOf(type))
                {
                    calls.Add(new Call(
                        TagOf(method, "ggop")!,
                        IsAlias(method),
                        ModuleOf(type),
                        type,
                        [method]));
                    Reach([method]);
                    found = true;
                }
            }
        } while (found);
    }

    /// The public instance methods of `type` that declare a gg operation, in source order.
    private static IMethodSymbol[] MemberFunctionsOf(INamedTypeSymbol type) =>
        type
            .GetMembers()
            .OfType<IMethodSymbol>()
            .Where(method =>
                method.DeclaredAccessibility == Accessibility.Public
                && method.MethodKind == MethodKind.Ordinary
                && !method.IsStatic
                && TagOf(method, "ggop") is not null)
            .ToArray();

    private static void WriteFunctions(Utf8JsonWriter writer)
    {
        writer.WriteStartArray("functions");
        foreach (var call in calls)
        {
            var first = call.Overloads[0];
            var qualified = call.Receiver is null
                ? $"{call.Module.Path}.{first.Name}"
                : $"{call.Module.Path}.{call.Receiver.Name}.{first.Name}";
            writer.WriteStartObject();
            writer.WriteString("operation", call.Operation);
            if (call.IsAlias)
            {
                writer.WriteString("aliasOf", call.Operation);
            }
            else
            {
                writer.WriteNull("aliasOf");
            }
            writer.WriteString("module", call.Module.Id);
            // C# has no free functions, so what every other arm spells as one is spelled here as a
            // static method whose owning class IS the module — which is why it has no receiver, and
            // why its name is the same one-segment shape a free function's is.
            writer.WriteString("kind", call.Receiver is null ? "static-method" : "method");
            if (call.Receiver is null)
            {
                writer.WriteNull("receiver");
            }
            else
            {
                writer.WriteString("receiver", call.Receiver.Name);
            }
            writer.WriteString("name", first.Name);
            writer.WriteString("fqn", qualified);
            // The fully-qualified name is what a program writes, so there is no second spelling for
            // a call site to need. A member function is written on the value instead, and that is
            // the receiver rather than a different name.
            writer.WriteNull("call");
            WriteProse(writer, first, $"`{qualified}`");
            WriteSignatures(writer, call.Overloads);
            WriteTypeReferences(writer, "returns", ReturnTypesOf(call.Overloads));
            WriteTypeReferences(writer, "types", ClosureOf(call.Overloads));
            writer.WriteEndObject();
        }
        writer.WriteEndArray();
    }

    // The one function that belongs to every module. Its SIGNATURE is a module's own `List()`,
    // because that is the call a program writes; its DOCUMENTATION is the one declaration the eleven
    // `<inheritdoc>` at, which is checked here rather than assumed.
    //
    // TRANSITIONAL. `list` is the one call in this surface gg has no operation for, because the
    // guest seeds it onto every module rather than declaring it on one — so it has nowhere to go in
    // the flat function array, and it keeps the section it has always had until it is deleted.
    private static void WriteMeta(Utf8JsonWriter writer, Dictionary<string, INamedTypeSymbol> modules)
    {
        var parts = Catalogue.MetaDocumentation.Split('.');
        var shared = gg
            .GetNamespaceMembers()
            .Single(space => space.Name == parts[1])
            .GetTypeMembers()
            .Single(type => type.Name == parts[2])
            .GetMembers(parts[3])
            .OfType<IMethodSymbol>()
            .Single();

        foreach (var module in Catalogue.Classed())
        {
            var declared = Method(modules[module.Id], Catalogue.Meta[0].Name).Single();
            var inherited = InheritDocTarget(declared);
            if (inherited is null || !SymbolEqualityComparer.Default.Equals(inherited, shared))
            {
                throw new InvalidOperationException(
                    $"`{module.Path}.{Catalogue.Meta[0].Name}` does not inherit its documentation "
                        + $"from {Catalogue.MetaDocumentation}");
            }
            RequireOwnDirectory(modules[module.Id], declared, module.Path);
        }

        var written = Method(modules[Catalogue.Classed().First().Id], Catalogue.Meta[0].Name).Single();
        Reach([written]);
        writer.WriteStartArray("meta");
        foreach (var entry in Catalogue.Meta)
        {
            writer.WriteStartObject();
            writer.WriteString("key", entry.Key);
            writer.WriteString("name", entry.Name);
            WriteSignatures(writer, [written]);
            writer.WriteString("doc", Paragraph(shared, $"the meta function `{entry.Key}`"));
            WriteTypeReferences(writer, "types", ClosureOf([written]));
            writer.WriteEndObject();
        }
        writer.WriteEndArray();
    }

    /// Refuse a module whose `List()` reports a **different** module's functions.
    ///
    /// The host filters a directory on the module path it is handed, so a path naming another module
    /// returns that module's functions rather than failing — a model would be shown a directory of
    /// calls it is reading under the wrong heading, and nothing downstream could tell. The lowering
    /// takes the module as a type argument so there is no string to mistype, and this holds each of
    /// the eleven expansions to naming the class it is written in.
    private static void RequireOwnDirectory(
        INamedTypeSymbol module,
        IMethodSymbol declared,
        string path)
    {
        var named = declared
            .DeclaringSyntaxReferences
            .Select(reference => reference.GetSyntax())
            .SelectMany(syntax => syntax.DescendantNodes().OfType<TypeOfExpressionSyntax>())
            .Select(expression => compilation
                .GetSemanticModel(expression.SyntaxTree)
                .GetSymbolInfo(expression.Type)
                .Symbol)
            .FirstOrDefault();
        if (named is null)
        {
            throw new InvalidOperationException(
                $"`{path}.{declared.Name}` names no module to read the directory of");
        }
        if (!SymbolEqualityComparer.Default.Equals(named, module))
        {
            throw new InvalidOperationException(
                $"`{path}.{declared.Name}` reports the directory of "
                    + $"`{named.ToDisplayString()}` rather than its own");
        }
    }

    // ------------------------------------------------------------------------------------------
    // Signatures
    // ------------------------------------------------------------------------------------------

    private static void WriteSignatures(Utf8JsonWriter writer, IMethodSymbol[] overloads)
    {
        writer.WriteStartArray("signatures");
        foreach (var method in overloads)
        {
            writer.WriteStartObject();
            writer.WriteString("signature", Render(method));
            writer.WriteStartArray("parameters");
            foreach (var parameter in method.Parameters)
            {
                WriteParameter(writer, method, parameter);
            }
            writer.WriteEndArray();
            writer.WriteEndObject();
        }
        writer.WriteEndArray();
    }

    // `Name(string path, uint? offset = null) -> Files.FileRead`.
    //
    // The name comes first and the return type last, which is not how C# declares a method — but a
    // catalogue entry's signature must begin with the name a program calls, and every other arm of
    // this seam whose language puts the type first renders it the same way.
    private static string Render(IMethodSymbol method)
    {
        var parameters = string.Join(", ", method.Parameters.Select(RenderParameter));
        return $"{method.Name}({parameters}) -> {TypeName(method.ReturnType)}";
    }

    private static string RenderParameter(IParameterSymbol parameter)
    {
        var rendered = $"{TypeName(parameter.Type)} {parameter.Name}";
        if (parameter.IsParams)
        {
            rendered = $"params {rendered}";
        }
        var written = DefaultOf(parameter);
        return written is null ? rendered : $"{rendered} = {written}";
    }

    /// The default exactly as the SDK wrote it, read off the declaration rather than reconstructed
    /// from the constant — `default` and `null` are different words for the same value on a struct,
    /// and the one a model should copy is the one the signature says.
    private static string? DefaultOf(IParameterSymbol parameter)
    {
        if (!parameter.HasExplicitDefaultValue)
        {
            return null;
        }
        var syntax = parameter.DeclaringSyntaxReferences
            .Select(reference => reference.GetSyntax())
            .OfType<ParameterSyntax>()
            .FirstOrDefault();
        return syntax?.Default?.Value.ToString();
    }

    private static void WriteParameter(
        Utf8JsonWriter writer,
        IMethodSymbol method,
        IParameterSymbol parameter)
    {
        writer.WriteStartObject();
        writer.WriteString("name", parameter.Name);
        writer.WriteString("type", TypeName(parameter.Type));
        var optional = parameter.HasExplicitDefaultValue;
        writer.WriteBoolean("optional", optional);
        // An optional argument in C# is written at the call site with its own name — that is what a
        // default is for, and what keeps a call readable when only the third of five is given. A
        // required one, and a `params` list, are positional.
        writer.WriteString("kind", optional ? "keyword" : "positional");
        var written = DefaultOf(parameter);
        if (written is null)
        {
            writer.WriteNull("default");
        }
        else
        {
            writer.WriteString("default", written);
        }
        writer.WriteString(
            "doc",
            Brief(
                Require(ParameterDocumentation(method, parameter.Name), Where(method, parameter)),
                Where(method, parameter)));
        // No fields: every structured argument on this arm is typed BY NAME, and its members carry
        // their own documentation in the `types` section. Filling both would be two copies of one
        // sentence with nothing keeping them equal.
        writer.WriteStartArray("fields");
        writer.WriteEndArray();
        writer.WriteEndObject();
    }

    private static string Where(IMethodSymbol method, IParameterSymbol parameter) =>
        $"`{method.ContainingType.Name}.{method.Name}`'s `{parameter.Name}`";

    // ------------------------------------------------------------------------------------------
    // Types
    // ------------------------------------------------------------------------------------------

    /// The SDK types in the **return** position of any of `overloads`.
    private static SortedDictionary<string, INamedTypeSymbol> ReturnTypesOf(IMethodSymbol[] overloads)
    {
        var found = new SortedDictionary<string, INamedTypeSymbol>(StringComparer.Ordinal);
        foreach (var method in overloads)
        {
            Gather(method.ReturnType, found);
        }
        return found;
    }

    /// Every SDK type any of `overloads` names, return position and arguments alike — plus the
    /// exception every gg call can throw, whose enum a catch site branches on.
    private static SortedDictionary<string, INamedTypeSymbol> ReferencedTypesOf(IMethodSymbol[] overloads)
    {
        var found = ReturnTypesOf(overloads);
        foreach (var method in overloads)
        {
            foreach (var parameter in method.Parameters)
            {
                Gather(parameter.Type, found);
            }
        }
        Gather(GgType("ToolException"), found);
        return found;
    }

    /// Every SDK type `overloads` reach, **transitively closed** — what an entry's `types` array
    /// carries.
    ///
    /// The closure rather than the one level the signature writes, because the array answers *which
    /// declarations does this call put within reach*, and that is what decides whether a type may be
    /// opened at all: gg gates a type view on reachability from a bound call, so a variant of a
    /// returned union or a field of a returned record has to be in here or the model is refused the
    /// declaration of something it is holding. What a documentation view opens *beside* a function is
    /// a depth-one question, and gg narrows this list itself to answer it.
    private static SortedDictionary<string, INamedTypeSymbol> ClosureOf(IMethodSymbol[] overloads)
    {
        var found = ReferencedTypesOf(overloads);
        var pending = new Queue<INamedTypeSymbol>(found.Values);
        while (pending.Count > 0)
        {
            foreach (var (fqn, next) in NeighboursOf(pending.Dequeue()))
            {
                if (found.TryAdd(fqn, next))
                {
                    pending.Enqueue(next);
                }
            }
        }
        return found;
    }

    /// Note that `overloads` reach every type they name, so that the `types` section declares them.
    private static void Reach(IMethodSymbol[] overloads)
    {
        foreach (var (_, type) in ReferencedTypesOf(overloads))
        {
            Transitively(type);
        }
    }

    /// The SDK types `type` itself names, one level deep — a container is walked into and then
    /// dropped, so `IReadOnlyList<DirEntry>`, `TurnRange[]` and `uint?` all name a type this
    /// catalogue declares, wrapped in one the language declares.
    private static void Gather(ITypeSymbol type, SortedDictionary<string, INamedTypeSymbol> into)
    {
        if (type is IArrayTypeSymbol array)
        {
            Gather(array.ElementType, into);
            return;
        }
        if (type is not INamedTypeSymbol named)
        {
            return;
        }
        foreach (var argument in named.TypeArguments)
        {
            Gather(argument, into);
        }
        if (!IsCatalogued(named))
        {
            return;
        }
        into[Fqn(named)] = named;
    }

    /// The SDK types `type`'s own declaration names: its members' types, its arms, and the signatures
    /// of the member functions hanging off it. One step, so that both walks over the type graph —
    /// the global one and the per-entry closure — take the same step and cannot come to disagree
    /// about what is reachable from what.
    private static SortedDictionary<string, INamedTypeSymbol> NeighboursOf(INamedTypeSymbol type)
    {
        var reachable = new SortedDictionary<string, INamedTypeSymbol>(StringComparer.Ordinal);
        foreach (var member in Members(type))
        {
            if (member.Type is not null)
            {
                Gather(member.Type, reachable);
            }
        }
        foreach (var arm in Arms(type))
        {
            Gather(arm, reachable);
        }
        foreach (var method in MemberFunctionsOf(type))
        {
            Gather(method.ReturnType, reachable);
            foreach (var parameter in method.Parameters)
            {
                Gather(parameter.Type, reachable);
            }
        }
        return reachable;
    }

    /// Record `type` and everything it transitively refers to as declared by this catalogue.
    private static void Transitively(INamedTypeSymbol type)
    {
        if (!referencedNames.Add(Fqn(type)))
        {
            return;
        }
        referenced.Add(type);
        foreach (var (_, next) in NeighboursOf(type))
        {
            Transitively(next);
        }
    }

    /// Whether `type` is one this catalogue declares: an SDK type, and not a module class, which is
    /// a namespace made of a class rather than a value anything holds.
    private static bool IsCatalogued(INamedTypeSymbol type) =>
        SymbolEqualityComparer.Default.Equals(type.ContainingNamespace, gg) && !type.IsStatic;

    private static void WriteTypeReferences(
        Utf8JsonWriter writer,
        string field,
        SortedDictionary<string, INamedTypeSymbol> types)
    {
        writer.WriteStartArray(field);
        foreach (var (fqn, type) in types)
        {
            // Both halves, recorded separately because they differ: a signature writes the name a
            // program types (`Files.FileRead`, which resolves under the SDK's own `global using`),
            // and a documentation view is opened by the resolved one (`Gg.Files.FileRead`).
            writer.WriteStartObject();
            writer.WriteString("spelled", TypeName(type));
            writer.WriteString("fqn", fqn);
            writer.WriteEndObject();
        }
        writer.WriteEndArray();
    }

    private static void WriteTypes(Utf8JsonWriter writer)
    {
        writer.WriteStartArray("types");
        foreach (var symbol in referenced.OrderBy(Fqn, StringComparer.Ordinal))
        {
            var fqn = Fqn(symbol);
            writer.WriteStartObject();
            writer.WriteString("fqn", fqn);
            writer.WriteString("module", ModuleOf(symbol).Id);
            writer.WriteString("name", symbol.Name);
            writer.WriteString("declaration", Declaration(symbol));
            WriteProse(writer, symbol, $"the type `{fqn}`");
            writer.WriteStartArray("members");
            foreach (var member in Members(symbol))
            {
                writer.WriteStartObject();
                writer.WriteString("name", member.Name);
                if (member.Type is null)
                {
                    writer.WriteNull("type");
                }
                else
                {
                    writer.WriteString("type", TypeName(member.Type));
                }
                writer.WriteString("kind", member.Kind);
                writer.WriteString(
                    "brief",
                    Brief(Require(member.Brief, $"`{fqn}.{member.Name}`"), $"`{fqn}.{member.Name}`"));
                if (member.Detail is null)
                {
                    writer.WriteNull("detail");
                }
                else
                {
                    writer.WriteString("detail", member.Detail);
                }
                writer.WriteEndObject();
            }
            writer.WriteEndArray();
            // One line per member function, and the name its own documentation view is opened by:
            // a type view is a menu of what a value can do, and every entry on it is one call away
            // from being read in full.
            writer.WriteStartArray("memberFunctions");
            foreach (var method in MemberFunctionsOf(symbol))
            {
                var member = $"{ModuleOf(symbol).Path}.{symbol.Name}.{method.Name}";
                writer.WriteStartObject();
                writer.WriteString("operation", TagOf(method, "ggop")!);
                writer.WriteString("name", method.Name);
                writer.WriteString("fqn", member);
                writer.WriteString(
                    "brief",
                    Brief(Require(Summary(method), $"`{member}`"), $"`{member}`"));
                writer.WriteEndObject();
            }
            writer.WriteEndArray();
            writer.WriteEndObject();
        }
        writer.WriteEndArray();
    }

    /// One member of a catalogued type, in whichever of the four shapes it has.
    private sealed record Member(string Name, ITypeSymbol? Type, string Kind, string? Brief, string? Detail);

    private static Member[] Members(INamedTypeSymbol type)
    {
        if (type.TypeKind == TypeKind.Enum)
        {
            return type
                .GetMembers()
                .OfType<IFieldSymbol>()
                .Where(field => field.ConstantValue is not null)
                .Select(field => new Member(
                    field.Name,
                    null,
                    "variant",
                    Summary(field),
                    Remarks(field)))
                .ToArray();
        }
        if (type.IsRecord)
        {
            var arms = Arms(type);
            if (arms.Length > 0)
            {
                // A union: its members are its arms, so a lookup that shows the parent shows what it
                // may actually be.
                return arms
                    .Select(arm => new Member(arm.Name, arm, "variant", Summary(arm), null))
                    .ToArray();
            }
            return PrimaryParameters(type)
                .Select(parameter => new Member(
                    parameter.Name,
                    parameter.Type,
                    "field",
                    ParameterDocumentation(type, parameter.Name),
                    null))
                .ToArray();
        }
        // What is left is a struct with named factories — `TextEdit.Keep`, `Brief.Issue(id)`, which
        // are what a program writes to MAKE one — and the exception class, whose members are what a
        // catch site READS off one. Both are public members either way.
        var members = new List<Member>();
        foreach (var member in type.GetMembers())
        {
            if (member.DeclaredAccessibility != Accessibility.Public)
            {
                continue;
            }
            switch (member)
            {
                case IPropertySymbol property:
                    members.Add(new Member(
                        property.Name,
                        property.Type,
                        "field",
                        Summary(property),
                        Remarks(property)));
                    break;
                case IMethodSymbol method when method.MethodKind == MethodKind.Ordinary && method.IsStatic:
                    var arguments = string.Join(", ", method.Parameters.Select(RenderParameter));
                    members.Add(new Member(
                        $"{method.Name}({arguments})",
                        method.ReturnType,
                        "field",
                        Summary(method),
                        Remarks(method)));
                    break;
            }
        }
        return members.ToArray();
    }

    /// A record's POSITIONAL parameters — the ones it declares between brackets, which become its
    /// properties.
    ///
    /// Read off the declaration rather than off the constructor list, because a record has a
    /// synthesized copy constructor taking one parameter of its own type, and an abstract record with
    /// no positional parameters at all has that and nothing else. Asking the symbol for "its longest
    /// constructor" reported `abstract record FileRead(FileRead original)`, which is a declaration the
    /// SDK does not contain and a model cannot write.
    private static IParameterSymbol[] PrimaryParameters(INamedTypeSymbol type)
    {
        var declared = type.DeclaringSyntaxReferences
            .Select(reference => reference.GetSyntax())
            .OfType<RecordDeclarationSyntax>()
            .Select(syntax => syntax.ParameterList?.Parameters.Count ?? 0)
            .FirstOrDefault();
        if (declared == 0)
        {
            return [];
        }
        return type.InstanceConstructors
            .First(constructor => constructor.Parameters.Length == declared)
            .Parameters
            .ToArray();
    }

    /// The types that derive from `type`, for a closed hierarchy the SDK uses as a union.
    ///
    /// Searched inside the module class that contains `type`, because that is where this arm's types
    /// live: a union and its arms are nested together in the module that produces them.
    private static INamedTypeSymbol[] Arms(INamedTypeSymbol type)
    {
        var siblings = type.ContainingType?.GetTypeMembers() ?? gg.GetTypeMembers();
        return siblings
            .Where(candidate => SymbolEqualityComparer.Default.Equals(candidate.BaseType, type))
            .OrderBy(candidate => candidate.Name, StringComparer.Ordinal)
            .ToArray();
    }

    private static string Declaration(INamedTypeSymbol type)
    {
        if (type.TypeKind == TypeKind.Enum)
        {
            var constants = string.Join(
                ", ",
                type.GetMembers()
                    .OfType<IFieldSymbol>()
                    .Where(field => field.ConstantValue is not null)
                    .Select(field => field.Name));
            return $"enum {type.Name} {{ {constants} }}";
        }
        if (type.IsRecord)
        {
            var head = type.IsAbstract ? "abstract record" : "sealed record";
            var basis = type.BaseType is { SpecialType: SpecialType.None } b
                && SymbolEqualityComparer.Default.Equals(b.ContainingNamespace, gg)
                ? $" : {TypeName(b)}"
                : "";
            var primary = PrimaryParameters(type);
            if (primary.Length == 0)
            {
                return $"{head} {type.Name}{basis}";
            }
            var parameters = string.Join(
                ", ",
                primary.Select(parameter => $"{TypeName(parameter.Type)} {parameter.Name}"));
            return $"{head} {type.Name}({parameters}){basis}";
        }
        if (type.TypeKind == TypeKind.Class)
        {
            var basis = type.BaseType is null ? "" : $" : {type.BaseType.Name}";
            return $"sealed class {type.Name}{basis}";
        }
        return $"readonly struct {type.Name}";
    }

    private static INamedTypeSymbol GgType(string name) =>
        gg.GetTypeMembers().Single(type => type.Name == name);

    /// The module a catalogued type belongs to: the one its containing class is, and `core` for a
    /// type declared directly in `namespace Gg`.
    private static Module ModuleOf(INamedTypeSymbol type)
    {
        var owner = type.ContainingType;
        var id = owner is null ? TagOf(type, "ggmodule") : TagOf(owner, "ggmodule");
        if (id is null)
        {
            throw new InvalidOperationException(
                $"the type `{type.Name}` belongs to no module — a type in `namespace Gg` carries a "
                    + "`<ggmodule>` of its own, and one nested in a module class inherits that "
                    + "class's");
        }
        return Catalogue.Modules.Single(module => module.Id == id);
    }

    /// The name a documentation view of `type` is opened by: its module's path and its own name.
    private static string Fqn(INamedTypeSymbol type) => $"{ModuleOf(type).Path}.{type.Name}";

    /// The name a signature writes, which is the name a program types: qualified by the containing
    /// class where there is one, and bare for the `core` module's types, which the SDK's own
    /// `global using` puts in scope.
    private static readonly SymbolDisplayFormat TypeFormat = new(
        typeQualificationStyle: SymbolDisplayTypeQualificationStyle.NameAndContainingTypes,
        genericsOptions: SymbolDisplayGenericsOptions.IncludeTypeParameters,
        miscellaneousOptions: SymbolDisplayMiscellaneousOptions.UseSpecialTypes
            | SymbolDisplayMiscellaneousOptions.IncludeNullableReferenceTypeModifier);

    private static string TypeName(ITypeSymbol type) => type.ToDisplayString(TypeFormat);

    // ------------------------------------------------------------------------------------------
    // Documentation
    // ------------------------------------------------------------------------------------------

    private static IMethodSymbol[] Method(INamedTypeSymbol type, string name) =>
        type.GetMembers(name)
            .OfType<IMethodSymbol>()
            .Where(method => method.DeclaredAccessibility == Accessibility.Public)
            .OrderBy(method => method.Parameters.Length)
            .ToArray();

    private static XElement? Comment(ISymbol symbol)
    {
        var xml = symbol.GetDocumentationCommentXml(expandIncludes: true);
        if (string.IsNullOrWhiteSpace(xml))
        {
            return null;
        }
        try
        {
            return XElement.Parse(xml);
        }
        catch (System.Xml.XmlException)
        {
            return null;
        }
    }

    /// The text of a gg tag written on a declaration — `<ggop>files.read_file</ggop>`,
    /// `<ggmodule>files</ggmodule>` — or `null` where the declaration carries none.
    ///
    /// Read off the declaration itself and never through `<inheritdoc>`, deliberately: an operation
    /// id is what an entry IS, and inheriting one would let a second declaration silently claim the
    /// first's identity.
    private static string? TagOf(ISymbol symbol, string tag)
    {
        var written = Comment(symbol)?.Element(tag)?.Value.Trim();
        return string.IsNullOrEmpty(written) ? null : written;
    }

    /// Whether a declaration says it is a **second** way to reach the operation it names.
    private static bool IsAlias(ISymbol symbol) =>
        Comment(symbol)?.Element("ggop")?.Attribute("alias")?.Value == "true";

    /// The declaration a symbol's `<inheritdoc cref="…"/>` points at, or `null` when it has none.
    private static ISymbol? InheritDocTarget(ISymbol symbol)
    {
        var target = Comment(symbol)?.Element("inheritdoc")?.Attribute("cref")?.Value;
        return target is null
            ? null
            : DocumentationCommentId.GetFirstSymbolForDeclarationId(target, compilation);
    }

    private static string? Summary(ISymbol symbol)
    {
        var inherited = InheritDocTarget(symbol);
        if (inherited is not null)
        {
            return Summary(inherited);
        }
        var summary = Comment(symbol)?.Element("summary");
        return summary is null ? null : Text(summary);
    }

    private static string? Remarks(ISymbol symbol)
    {
        var inherited = InheritDocTarget(symbol);
        if (inherited is not null)
        {
            return Remarks(inherited);
        }
        var remarks = Comment(symbol)?.Element("remarks");
        if (remarks is null)
        {
            return null;
        }
        var written = Text(remarks);
        return written.Length == 0 ? null : written;
    }

    private static string? ParameterDocumentation(ISymbol owner, string name)
    {
        var inherited = InheritDocTarget(owner);
        if (inherited is not null)
        {
            return ParameterDocumentation(inherited, name);
        }
        var written = Comment(owner)
            ?.Elements("param")
            .FirstOrDefault(element => element.Attribute("name")?.Value == name);
        return written is null ? null : Text(written);
    }

    /// **The authored brief, and the authored detail** — the whole of what a model reads about one
    /// entry, in Doxygen's implicit structure and with nothing derived.
    ///
    /// `<summary>` is the brief and `<remarks>` is the detail, and the two things the detail gains
    /// here are the two the C# convention puts in their own elements: what the call hands back, and
    /// what it throws. They belong in the detail rather than in the brief because a brief is one line
    /// and there is no honest one-line form of "returns X, and throws Y for Z".
    ///
    /// `<returns>` is **optional**, and requiring it would be the one rule here that manufactures
    /// prose. A signature already writes the return type (`ReadMemory(string name) -> string`), so a
    /// `<returns>` that says "the memory's body" beside a brief that says "read one memory's contents
    /// back" is a second line charged to the model's context for nothing. A detail is added where it
    /// earns its place, and a mandatory element cannot be.
    private static void WriteProse(Utf8JsonWriter writer, ISymbol symbol, string what)
    {
        var target = InheritDocTarget(symbol) ?? symbol;
        writer.WriteString("brief", Brief(Require(Summary(target), what), what));

        var parts = new List<string>();
        var detail = Remarks(target);
        if (detail is not null)
        {
            parts.Add(detail);
        }
        var comment = Comment(target);
        var returns = comment?.Element("returns");
        if (returns is not null)
        {
            parts.Add($"Returns: {Text(returns)}");
        }
        var throws = comment?.Elements("exception").Select(Text).Where(text => text.Length > 0).ToArray();
        if (throws is { Length: > 0 })
        {
            parts.Add($"Throws `ToolException`: {string.Join(" ", throws)}");
        }
        if (parts.Count == 0)
        {
            writer.WriteNull("detail");
        }
        else
        {
            writer.WriteString("detail", string.Join("\n\n", parts));
        }
    }

    /// The whole of a `<summary>` and `<remarks>` as one paragraph, which is the shape the
    /// transitional `meta` section still carries.
    private static string Paragraph(ISymbol symbol, string what)
    {
        var parts = new List<string> { Require(Summary(symbol), what) };
        var detail = Remarks(symbol);
        if (detail is not null)
        {
            parts.Add(detail);
        }
        var returns = Comment(symbol)?.Element("returns");
        if (returns is not null)
        {
            parts.Add($"Returns: {Text(returns)}");
        }
        return string.Join("\n\n", parts);
    }

    /// A brief, held to the one structural property the whole model rests on: it is **one line**.
    ///
    /// The rule is enforced here as well as gg-side because the failure it catches is a paragraph
    /// written into the brief field, and this is where the person who wrote it will see it — with the
    /// declaration named, before a catalogue exists to be checked.
    private static string Brief(string written, string what)
    {
        if (written.Contains('\n'))
        {
            throw new InvalidOperationException(
                $"{what}'s brief is more than one line — a `<summary>` is the brief and a "
                    + $"`<remarks>` is the detail: {written}");
        }
        return written;
    }

    private static string Require(string? value, string what) =>
        string.IsNullOrWhiteSpace(value)
            ? throw new InvalidOperationException($"{what} has no documentation")
            : value;

    /// One XML documentation element as the text a model reads.
    ///
    /// The mapping is to the same lightweight markup every other arm's catalogue carries: `<c>` and
    /// `<see>` become backticks, `<code>` becomes a fenced block, `<para>` becomes a paragraph break,
    /// and emphasis becomes Markdown's.
    /// The character `Render` marks a paragraph boundary with. A control character rather than a
    /// blank line, because the source is written with line breaks everywhere and only some of them
    /// mean anything.
    private const char Break = '\u0001';

    private static string Text(XElement element)
    {
        var builder = new StringBuilder();
        Render(element, builder);
        var paragraphs = builder
            .ToString()
            .Split(Break)
            .Select(Squeeze)
            .Where(paragraph => paragraph.Length > 0);
        return string.Join("\n\n", paragraphs);
    }

    /// Collapse the line breaks and indentation an XML comment is written with, leaving fenced code
    /// blocks — whose line breaks are the content — exactly as they stand.
    private static string Squeeze(string text)
    {
        var trimmed = text.Trim();
        if (!trimmed.Contains("```", StringComparison.Ordinal))
        {
            return string.Join(" ", trimmed.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        }
        return string.Join(
            "\n",
            trimmed.Split('\n').Select(line => line.TrimEnd()));
    }

    private static void Render(XNode node, StringBuilder into)
    {
        switch (node)
        {
            case XText text:
                into.Append(text.Value);
                return;
            case XElement element:
                switch (element.Name.LocalName)
                {
                    case "para":
                        into.Append(Break);
                        RenderChildren(element, into);
                        into.Append(Break);
                        return;
                    case "c":
                        into.Append('`').Append(element.Value.Trim()).Append('`');
                        return;
                    case "code":
                        into.Append(Break).Append("```csharp\n")
                            .Append(Dedent(element.Value))
                            .Append("\n```")
                            .Append(Break);
                        return;
                    case "see":
                    case "seealso":
                        into.Append('`').Append(ShortName(element)).Append('`');
                        return;
                    case "paramref":
                    case "typeparamref":
                        into.Append('`').Append(element.Attribute("name")?.Value ?? "").Append('`');
                        return;
                    case "b":
                        into.Append("**");
                        RenderChildren(element, into);
                        into.Append("**");
                        return;
                    case "i":
                        into.Append('*');
                        RenderChildren(element, into);
                        into.Append('*');
                        return;
                    default:
                        RenderChildren(element, into);
                        return;
                }
        }
    }

    private static void RenderChildren(XElement element, StringBuilder into)
    {
        foreach (var child in element.Nodes())
        {
            Render(child, into);
        }
    }

    /// What a `<see cref="Gg.ToolErrorCode.NotFound"/>` reads as: `ToolErrorCode.NotFound`.
    ///
    /// **A cref is module-qualified in the rendered text and bare in the source**, because Roslyn
    /// resolves `<see cref="ImageFile"/>` written inside `Files` to `Gg.Files.ImageFile` and only the
    /// `Gg.` is dropped here. That is the name the design wants a model to read, and it is not the
    /// name the author had in front of them — so an article written before a cref has to agree with
    /// the *expansion*, and `an <see cref="ImageFile"/>` is wrong where `a` is right.
    private static string ShortName(XElement element)
    {
        var cref = element.Attribute("cref")?.Value;
        if (cref is null)
        {
            return element.Value.Trim();
        }
        var identifier = cref.Contains(':') ? cref[(cref.IndexOf(':') + 1)..] : cref;
        var arguments = identifier.IndexOf('(');
        if (arguments >= 0)
        {
            identifier = identifier[..arguments];
        }
        return identifier.StartsWith("Gg.", StringComparison.Ordinal) ? identifier[3..] : identifier;
    }

    /// Strip the common leading whitespace an XML `<code>` block is indented by.
    private static string Dedent(string text)
    {
        var lines = text
            .Replace("\r", "")
            .Split('\n')
            .Select(line => line.TrimEnd())
            .SkipWhile(line => line.Length == 0)
            .Reverse()
            .SkipWhile(line => line.Length == 0)
            .Reverse()
            .ToArray();
        var indent = lines
            .Where(line => line.Trim().Length > 0)
            .Select(line => line.Length - line.TrimStart().Length)
            .DefaultIfEmpty(0)
            .Min();
        return string.Join("\n", lines.Select(line => line.Length >= indent ? line[indent..] : line));
    }
}
