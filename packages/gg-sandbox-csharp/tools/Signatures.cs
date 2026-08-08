// Reflect the C# arm's signature catalogue out of the SDK's own XML documentation comments.
//
// WHY ROSLYN. Everything a model reads about this surface is written on the declaration it
// describes — a function's description in its `<summary>`, an argument's in that argument's
// `<param>`, a record component's in the `<param>` on the record, an enum constant's in the
// `<summary>` above it, an API object's on the `static class` that is the object — and Roslyn is
// what reads all of it. It is also the compiler this arm already runs on every turn, so the
// catalogue is reflected by the same reading of the same sources that the model's program is
// compiled against.
//
// WHAT IT REFUSES. A blank is an error rather than a gap a model discovers: a public member with no
// `<summary>`, a parameter with no `<param>`, a non-void function with no `<returns>`, a type with
// no documentation, a member of one with none. `DocumentationMode.Diagnose` is on and Roslyn's own
// documentation diagnostics are errors too, so a `<param>` naming an argument that is not there, or
// a `<see cref>` pointing at nothing, fails here rather than reaching a model. Two independent
// readings therefore have to agree before anything a model reads is written — and the check this
// adds over Roslyn's own is the one Roslyn does not make: `CS1573` fires only when SOME parameters
// are documented, so a function with a summary and no `<param>` at all compiles clean and is
// rejected below.

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
    private static string sdkRoot = "";
    private static CSharpCompilation compilation = null!;
    private static INamespaceSymbol gg = null!;

    internal static int Main(string[] args)
    {
        var options = ParseArguments(args);
        sdkRoot = options["--sdk"];
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
    // The document
    // ------------------------------------------------------------------------------------------

    private static readonly SortedDictionary<string, INamedTypeSymbol> referenced =
        new(StringComparer.Ordinal);

    private static string Build(string librariesPath)
    {
        var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Indented = true }))
        {
            writer.WriteStartObject();
            writer.WriteString("language", "csharp");
            writer.WriteString(
                "generatedFrom",
                "packages/gg-sandbox-csharp/src/Gg/ (Roslyn, Microsoft.CodeAnalysis.CSharp)");

            WriteLibraries(writer, librariesPath);
            WriteObjects(writer);
            WriteMeta(writer);
            WriteSection(writer, "session", Catalogue.Session);
            WriteSection(writer, "views", Catalogue.Views);
            WriteSection(writer, "programs", Catalogue.Programs);
            WriteSection(writer, "tools", Catalogue.Tools);
            WriteSection(writer, "helpers", Catalogue.Helpers);
            CheckNothingIsUndeclared();
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

    private static void WriteObjects(Utf8JsonWriter writer)
    {
        writer.WriteStartArray("objects");
        foreach (var name in Catalogue.Objects)
        {
            var symbol = ObjectClass(name);
            writer.WriteStartObject();
            writer.WriteString("object", name);
            writer.WriteString("doc", Require(Summary(symbol), $"the API object `{name}`"));
            writer.WriteEndObject();
        }
        writer.WriteEndArray();
    }

    // The one function that belongs to every object. Its SIGNATURE is the object's own `List()`,
    // because that is the call a program writes; its DOCUMENTATION is the one declaration the twelve
    // `<inheritdoc>` at, which is checked here rather than assumed.
    private static void WriteMeta(Utf8JsonWriter writer)
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

        foreach (var name in Catalogue.Objects)
        {
            var inherited = InheritDocTarget(Method(ObjectClass(name), "List").Single());
            if (inherited is null || !SymbolEqualityComparer.Default.Equals(inherited, shared))
            {
                throw new InvalidOperationException(
                    $"`{name}.List` does not inherit its documentation from "
                        + $"{Catalogue.MetaDocumentation}");
            }
        }

        writer.WriteStartArray("meta");
        foreach (var entry in Catalogue.Meta)
        {
            var written = Method(ObjectClass(Catalogue.Objects[0]), entry.Name).Single();
            writer.WriteStartObject();
            writer.WriteString("key", entry.Key);
            writer.WriteString("name", entry.Name);
            WriteSignatures(writer, [written]);
            writer.WriteString("doc", Documentation(shared, $"the meta function `{entry.Key}`"));
            WriteTypeNames(writer, [written]);
            writer.WriteEndObject();
        }
        writer.WriteEndArray();
    }

    private static void WriteSection(Utf8JsonWriter writer, string section, Entry[] entries)
    {
        writer.WriteStartArray(section);
        foreach (var entry in entries)
        {
            var overloads = Method(ObjectClass(entry.Object!), entry.Name);
            if (overloads.Length == 0)
            {
                throw new InvalidOperationException(
                    $"`{entry.Object}.{entry.Name}` is catalogued and the SDK declares no such "
                        + "public method");
            }
            writer.WriteStartObject();
            if (section == "tools")
            {
                writer.WriteString("tool", entry.Key);
            }
            else
            {
                writer.WriteString("key", entry.Key);
            }
            if (section is "helpers")
            {
                writer.WriteString("requires", entry.Gate!);
            }
            if (section is "views")
            {
                if (entry.Gate is null)
                {
                    writer.WriteNull("requires");
                }
                else
                {
                    writer.WriteString("requires", entry.Gate);
                }
            }
            writer.WriteString("name", entry.Name);
            writer.WriteString("object", entry.Object!);
            if (section == "session")
            {
                writer.WriteString("ending", entry.Ending!);
            }
            WriteSignatures(writer, overloads);
            // The documentation is the FIRST overload's, which is the shape a model writes: an
            // overload group is one capability, and a second paragraph explaining the same thing
            // twice is a second place for it to drift.
            writer.WriteString(
                "doc",
                Documentation(overloads[0], $"`{entry.Object}.{entry.Name}`"));
            WriteTypeNames(writer, overloads);
            writer.WriteEndObject();
        }
        writer.WriteEndArray();
    }

    // Both directions: nothing the SDK declares on an API object is left out of the identity table,
    // which is what stops a function from being added to the surface and never described.
    private static void CheckNothingIsUndeclared()
    {
        var catalogued = Catalogue
            .All()
            .Select(entry => (entry.Object, entry.Name))
            .Concat(Catalogue.Objects.Select(name => ((string?)name, Catalogue.Meta[0].Name)))
            .ToHashSet();
        foreach (var name in Catalogue.Objects)
        {
            foreach (var method in ObjectClass(name)
                .GetMembers()
                .OfType<IMethodSymbol>()
                .Where(method => method.DeclaredAccessibility == Accessibility.Public))
            {
                if (!catalogued.Contains(((string?)name, method.Name)))
                {
                    throw new InvalidOperationException(
                        $"`{name}.{method.Name}` is public on an API object and nothing in "
                            + "tools/Catalogue.cs says what it is");
                }
            }
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

    // `Name(string path, uint? offset = null) -> FileRead`.
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
            Require(
                ParameterDocumentation(method, parameter.Name),
                $"`{method.ContainingType.Name}.{method.Name}`'s `{parameter.Name}`"));
        // No fields: every structured argument on this arm is typed BY NAME, and its members carry
        // their own documentation in the `types` section. Filling both would be two copies of one
        // sentence with nothing keeping them equal.
        writer.WriteStartArray("fields");
        writer.WriteEndArray();
        writer.WriteEndObject();
    }

    // ------------------------------------------------------------------------------------------
    // Types
    // ------------------------------------------------------------------------------------------

    private static void WriteTypeNames(Utf8JsonWriter writer, IMethodSymbol[] overloads)
    {
        var names = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var method in overloads)
        {
            Collect(method.ReturnType, names);
            foreach (var parameter in method.Parameters)
            {
                Collect(parameter.Type, names);
            }
        }
        // Every gg call can fail, and the exception it throws carries an enum a catch site branches
        // on. Both are referenced by every entry, so a documentation lookup declares them once.
        Collect(GgType("ToolException"), names);
        writer.WriteStartArray("types");
        foreach (var name in names)
        {
            writer.WriteStringValue(name);
        }
        writer.WriteEndArray();
    }

    /// Add `type` and everything it transitively refers to, keeping only the SDK's own types.
    ///
    /// A container is walked into and then dropped: `IReadOnlyList<DirEntry>`, `TurnRange[]` and
    /// `uint?` all name a type this catalogue declares, wrapped in one the language declares.
    private static void Collect(ITypeSymbol type, SortedSet<string> into)
    {
        if (type is IArrayTypeSymbol array)
        {
            Collect(array.ElementType, into);
            return;
        }
        if (type is not INamedTypeSymbol named)
        {
            return;
        }
        foreach (var argument in named.TypeArguments)
        {
            Collect(argument, into);
        }
        if (!SymbolEqualityComparer.Default.Equals(named.ContainingNamespace, gg))
        {
            return;
        }
        if (Catalogue.Objects.Contains(named.Name) || !into.Add(named.Name))
        {
            return;
        }
        referenced[named.Name] = named;
        foreach (var member in Members(named))
        {
            if (member.Type is not null)
            {
                Collect(member.Type, into);
            }
        }
        foreach (var arm in Arms(named))
        {
            Collect(arm, into);
        }
    }

    private static void WriteTypes(Utf8JsonWriter writer)
    {
        writer.WriteStartArray("types");
        foreach (var (name, symbol) in referenced)
        {
            writer.WriteStartObject();
            writer.WriteString("name", name);
            writer.WriteString("declaration", Declaration(symbol));
            writer.WriteString("doc", Documentation(symbol, $"the type `{name}`"));
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
                writer.WriteString("doc", Require(member.Doc, $"`{name}.{member.Name}`"));
                writer.WriteEndObject();
            }
            writer.WriteEndArray();
            writer.WriteEndObject();
        }
        writer.WriteEndArray();
    }

    /// One member of a catalogued type, in whichever of the four shapes it has.
    private sealed record Member(string Name, ITypeSymbol? Type, string Doc);

    private static Member[] Members(INamedTypeSymbol type)
    {
        if (type.TypeKind == TypeKind.Enum)
        {
            return type
                .GetMembers()
                .OfType<IFieldSymbol>()
                .Where(field => field.ConstantValue is not null)
                .Select(field => new Member(field.Name, null, Summary(field) ?? ""))
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
                    .Select(arm => new Member(arm.Name, type, Summary(arm) ?? ""))
                    .ToArray();
            }
            return PrimaryParameters(type)
                .Select(parameter => new Member(
                    parameter.Name,
                    parameter.Type,
                    ParameterDocumentation(type, parameter.Name) ?? ""))
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
                    members.Add(new Member(property.Name, property.Type, Summary(property) ?? ""));
                    break;
                case IMethodSymbol method when method.MethodKind == MethodKind.Ordinary && method.IsStatic:
                    var arguments = string.Join(", ", method.Parameters.Select(RenderParameter));
                    members.Add(new Member(
                        $"{method.Name}({arguments})",
                        method.ReturnType,
                        Summary(method) ?? ""));
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
    private static INamedTypeSymbol[] Arms(INamedTypeSymbol type) =>
        gg.GetTypeMembers()
            .Where(candidate => SymbolEqualityComparer.Default.Equals(candidate.BaseType, type))
            .OrderBy(candidate => candidate.Name, StringComparer.Ordinal)
            .ToArray();

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
                ? $" : {b.Name}"
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

    private static readonly SymbolDisplayFormat TypeFormat = new(
        typeQualificationStyle: SymbolDisplayTypeQualificationStyle.NameOnly,
        genericsOptions: SymbolDisplayGenericsOptions.IncludeTypeParameters,
        miscellaneousOptions: SymbolDisplayMiscellaneousOptions.UseSpecialTypes
            | SymbolDisplayMiscellaneousOptions.IncludeNullableReferenceTypeModifier);

    private static string TypeName(ITypeSymbol type) => type.ToDisplayString(TypeFormat);

    // ------------------------------------------------------------------------------------------
    // Documentation
    // ------------------------------------------------------------------------------------------

    private static INamedTypeSymbol ObjectClass(string name) => GgType(name);

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
        var comment = Comment(symbol);
        var inherited = InheritDocTarget(symbol);
        if (inherited is not null)
        {
            return Summary(inherited);
        }
        var summary = comment?.Element("summary");
        return summary is null ? null : Text(summary);
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

    /// One catalogue entry's whole paragraph: what it does, why, what it hands back, and what it
    /// throws — in that order, because that is the order a reader needs them in.
    private static string Documentation(ISymbol symbol, string what)
    {
        var target = InheritDocTarget(symbol) ?? symbol;
        var comment = Comment(target);
        var parts = new List<string> { Require(Summary(target), what) };
        var remarks = comment?.Element("remarks");
        if (remarks is not null)
        {
            var written = Text(remarks);
            if (written.Length > 0)
            {
                parts.Add(written);
            }
        }
        var returns = comment?.Element("returns");
        if (returns is not null)
        {
            parts.Add($"Returns: {Text(returns)}");
        }
        else if (target is IMethodSymbol method && !method.ReturnsVoid)
        {
            throw new InvalidOperationException($"{what} hands something back and says nothing about it");
        }
        var throws = comment?.Elements("exception").Select(Text).Where(text => text.Length > 0);
        if (throws is not null && throws.Any())
        {
            parts.Add($"Throws `ToolException`: {string.Join(" ", throws)}");
        }
        return string.Join("\n\n", parts);
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
            .Split(' ')
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
                        into.Append(' ');
                        RenderChildren(element, into);
                        into.Append(' ');
                        return;
                    case "c":
                        into.Append('`').Append(element.Value.Trim()).Append('`');
                        return;
                    case "code":
                        into.Append(' ').Append("```csharp\n")
                            .Append(Dedent(element.Value))
                            .Append("\n```")
                            .Append(' ');
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
