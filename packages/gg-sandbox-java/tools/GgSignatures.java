package tools;

import com.sun.source.doctree.DocCommentTree;
import com.sun.source.doctree.DocTree;
import com.sun.source.doctree.EndElementTree;
import com.sun.source.doctree.EntityTree;
import com.sun.source.doctree.LinkTree;
import com.sun.source.doctree.LiteralTree;
import com.sun.source.doctree.ParamTree;
import com.sun.source.doctree.ReturnTree;
import com.sun.source.doctree.StartElementTree;
import com.sun.source.doctree.TextTree;
import com.sun.source.doctree.ThrowsTree;
import com.sun.source.doctree.UnknownBlockTagTree;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import javax.lang.model.element.Element;
import javax.lang.model.element.ElementKind;
import javax.lang.model.element.ExecutableElement;
import javax.lang.model.element.Modifier;
import javax.lang.model.element.PackageElement;
import javax.lang.model.element.RecordComponentElement;
import javax.lang.model.element.TypeElement;
import javax.lang.model.element.VariableElement;
import javax.lang.model.type.ArrayType;
import javax.lang.model.type.DeclaredType;
import javax.lang.model.type.TypeMirror;
import jdk.javadoc.doclet.Doclet;
import jdk.javadoc.doclet.DocletEnvironment;
import jdk.javadoc.doclet.Reporter;

/**
 * <b>The Java arm's signature catalogue, reflected out of the SDK's own Javadoc.</b>
 *
 * <p>This is a <b>doclet</b> — the JDK's own documentation tool, pointed at
 * {@code packages/gg-sandbox-java/src/gg} and asked for JSON rather than HTML. Everything a model
 * reads about this surface therefore comes from the declaration it describes: a function's brief and
 * detail from its own doc comment, an argument's from that argument's {@code @param}, a record
 * component's from the {@code @param} on the record, an enum constant's from the comment above it, a
 * module's from the doc comment on the class that <em>is</em> the module. There is nowhere else for
 * any of it to be written, which is the point: a description kept anywhere else is one that drifts
 * from its subject with nothing to catch it.
 *
 * <p>The doclet API is what makes that possible in Java rather than merely desirable. A
 * {@link ParamTree} carries the parameter's <em>name</em>, so a renamed parameter left behind in the
 * documentation is caught here rather than by a model writing an argument the call refuses;
 * {@link ThrowsTree} carries the failure prose; and the element model carries the real, <em>resolved</em>
 * types, so a signature is javac's reading of the declaration rather than a string anybody typed and
 * a type reference is a name rather than a spelling that has to be looked up by guesswork.
 *
 * <h2>The operation id is a block tag, and that was measured rather than assumed</h2>
 *
 * <p>Each model-facing declaration says which gg operation it binds, on itself, as
 * {@code @ggop files.read_file}. The C++ arm found that a doc command of gg's own invention warns on
 * every declaration that carries one and arrives split across two nodes, and used an HTML-ish element
 * instead. Java is the exact opposite, measured with the same {@code -Xdoclint:all/protected -Werror}
 * the build runs: {@code <ggop>files.read_file</ggop>} is <b>two errors</b> ("unknown tag: ggop"),
 * while an unknown <b>block tag</b> passes silently and arrives whole as one
 * {@link UnknownBlockTagTree}. A block tag is also where a Java author already expects metadata about
 * a declaration to sit, beside {@code @param} and {@code @throws}, and it keeps the id out of the
 * body prose entirely — {@link DocCommentTree#getFullBody()} excludes block tags.
 *
 * <h2>The brief is the first line, and this refuses a second one</h2>
 *
 * <p>A doc comment's opening block, up to its first {@code <p>}, is the <b>brief</b>; everything
 * after it is the <b>detail</b>. The brief is required to be one line <em>in the source</em>, which
 * this checks on the raw text before any wrapping is collapsed — so the failure lands on the author,
 * at the declaration, rather than several steps later in a gate.
 *
 * <h2>What it refuses to emit</h2>
 *
 * <p>The failure lands on the author rather than on a model. A method with no doc comment, a
 * parameter with no {@code @param}, a record component or enum constant with no comment, a module
 * class with no {@code @ggmodule}, a model-facing method with no {@code @ggop}, a {@code @param}
 * naming an argument the method does not take, a module class the table does not name, and a brief of
 * more than one line are each an error rather than an omission.
 *
 * <h2>Overloads are one entry</h2>
 *
 * <p>Java has no default arguments, so an optional argument here is an <b>overload</b> — which is
 * exactly what the catalogue's {@code signatures} array exists for. Every declaration of one name on
 * one module becomes one entry with one signature each, in declaration order, never two entries
 * sharing a name; and every overload of a name has to name the same operation.
 *
 * <p>Their <b>prose</b> is merged rather than dropped, which {@link #merged} explains: the group's
 * brief is the first declaration's, so the first declaration's brief has to be written about the
 * whole group, and every later overload's own words are folded in under the signature they were
 * written about.
 */
public final class GgSignatures implements Doclet {
    /** The schema this catalogue is written in: the normalized doc model. */
    private static final int SCHEMA = 1;

    /** The block tag naming the gg operation a declaration binds. */
    private static final String OPERATION_TAG = "ggop";

    /** The block tag marking a declaration as a second way to reach an operation. */
    private static final String ALIAS_TAG = "ggalias";

    /** The block tag naming the gg module a class is. */
    private static final String MODULE_TAG = "ggmodule";

    /** Where the JSON goes. */
    private Path output;

    /** Where the library manifest is read from. */
    private Path libraries;

    /** How to complain. */
    private Reporter reporter;

    /** Whether anything has gone wrong. */
    private boolean failed;

    /** The doc trees of the run. */
    private DocletEnvironment environment;

    /** The module class of each module that has one, by gg's module id. */
    private final Map<String, TypeElement> moduleClasses = new LinkedHashMap<>();

    /** Every model-facing type, by its fully-qualified name, in declaration order. */
    private final Map<String, TypeElement> catalogued = new LinkedHashMap<>();

    /** Which model-facing types each model-facing type refers to, for the transitive closure. */
    private final Map<String, Set<String>> neighbours = new LinkedHashMap<>();

    /** Every type something reaches, in the order it was first reached. */
    private final Set<String> reached = new LinkedHashSet<>();

    @Override
    public void init(Locale locale, Reporter reporter) {
        this.reporter = reporter;
    }

    @Override
    public String getName() {
        return "GgSignatures";
    }

    @Override
    public Set<? extends Option> getSupportedOptions() {
        return Set.of(new PathOption("-o", "the JSON file to write", path -> output = path),
                new PathOption("--libraries", "the library manifest to read",
                        path -> libraries = path));
    }

    @Override
    public javax.lang.model.SourceVersion getSupportedSourceVersion() {
        return javax.lang.model.SourceVersion.latest();
    }

    @Override
    public boolean run(DocletEnvironment environment) {
        this.environment = environment;
        index();

        Json document = Json.object();
        document.put("schema", Json.number(SCHEMA));
        document.put("language", Json.of("java"));
        document.put("generatedFrom",
                Json.of("packages/gg-sandbox-java/src/gg/ (javadoc, jdk.javadoc.doclet)"));
        document.put("libraries", libraries());
        document.put("modules", modules());
        // The functions first: what they refer to is what decides which types are declared at all,
        // and a type nothing reaches is a documentation view nothing can open.
        document.put("functions", functions());
        document.put("types", types());

        if (failed) {
            return false;
        }
        try {
            Files.writeString(output, document.render() + "\n", StandardCharsets.UTF_8);
        } catch (IOException failure) {
            reporter.print(javax.tools.Diagnostic.Kind.ERROR,
                    "could not write " + output + ": " + failure);
            return false;
        }
        return true;
    }

    // ---------------------------------------------------------------------------------------
    // The index
    // ---------------------------------------------------------------------------------------

    /**
     * Find the module classes and every model-facing type, and hold the two to the module table.
     *
     * <p>A model-facing type is one <b>nested in a module class</b> — which is what gives it the
     * module's own path as its prefix — or one declared directly in package {@code gg}, which is the
     * {@code core} module: the types and the exception every other module's signatures name.
     */
    private void index() {
        Map<String, GgCatalogue.Module> byType = new LinkedHashMap<>();
        for (GgCatalogue.Module module : GgCatalogue.MODULES) {
            if (!module.type().isEmpty()) {
                byType.put(module.type(), module);
            }
        }
        for (Element element : environment.getIncludedElements()) {
            if (!(element instanceof TypeElement type) || type.getNestingKind().isNested()) {
                continue;
            }
            String qualified = type.getQualifiedName().toString();
            String owner = packageOf(type);
            if (owner.equals(GgCatalogue.INTERNAL_PACKAGE)) {
                continue;
            }
            GgCatalogue.Module module = byType.get(qualified);
            if (module != null) {
                moduleClasses.put(module.id(), type);
                for (Element member : type.getEnclosedElements()) {
                    if (member instanceof TypeElement nested
                            && member.getModifiers().contains(Modifier.PUBLIC)) {
                        catalogued.put(fqn(nested), nested);
                    }
                }
                continue;
            }
            if (owner.equals(GgCatalogue.CORE_PACKAGE)) {
                catalogued.put(fqn(type), type);
                continue;
            }
            complain("`" + qualified + "` is a public type in `" + owner
                    + "` that is neither a module class the table names nor a type of the `core` "
                    + "module — every model-facing type is nested in the module that produces it");
        }

        for (GgCatalogue.Module module : GgCatalogue.MODULES) {
            if (module.type().isEmpty()) {
                declaredModule(environment.getElementUtils().getPackageElement(module.path()),
                        module, "the package `" + module.path() + "`");
                continue;
            }
            TypeElement type = moduleClasses.get(module.id());
            if (type == null) {
                complain("the module table names `" + module.type()
                        + "`, and there is no such class");
                continue;
            }
            declaredModule(type, module, "`" + module.type() + "`");
        }

        // The reference graph, one step per type, so that the closure and the per-entry walk take
        // the same step and cannot come to disagree about what is reachable from what.
        for (Map.Entry<String, TypeElement> entry : catalogued.entrySet()) {
            Set<String> out = new LinkedHashSet<>();
            for (Member member : members(entry.getValue())) {
                gather(member.type(), out);
            }
            // Every public method's signature, not only the ones binding an operation: a builder's
            // setter is how a model reaches the enum it takes, and a type reached only as an
            // argument of a member is exactly as reachable as one reached as a result.
            for (Element member : entry.getValue().getEnclosedElements()) {
                if (member.getKind() != ElementKind.METHOD
                        || !member.getModifiers().contains(Modifier.PUBLIC)) {
                    continue;
                }
                ExecutableElement method = (ExecutableElement) member;
                gather(method.getReturnType(), out);
                for (VariableElement parameter : method.getParameters()) {
                    gather(parameter.asType(), out);
                }
            }
            out.remove(entry.getKey());
            neighbours.put(entry.getKey(), out);
        }
    }

    /** Hold one declaration's {@code @ggmodule} to the row of the table it claims to be. */
    private void declaredModule(Element element, GgCatalogue.Module module, String what) {
        if (element == null) {
            complain("the module table names `" + module.path() + "`, and there is no such package");
            return;
        }
        String declared = tag(element, MODULE_TAG);
        if (declared == null) {
            complain(what + " is the `" + module.id()
                    + "` module and says so nowhere — write `@" + MODULE_TAG + " " + module.id()
                    + "` on it");
            return;
        }
        if (!declared.equals(module.id())) {
            complain(what + " declares `@" + MODULE_TAG + " " + declared
                    + "` and the table files it under `" + module.id() + "`");
        }
    }

    // ---------------------------------------------------------------------------------------
    // The sections
    // ---------------------------------------------------------------------------------------

    /** The libraries a program may reach for, grouped as the manifest that decides them groups them. */
    private Json libraries() {
        List<Json> groups = new ArrayList<>();
        List<String> modules = new ArrayList<>();
        String heading = null;
        List<String> lines;
        try {
            lines = Files.readAllLines(libraries, StandardCharsets.UTF_8);
        } catch (IOException failure) {
            complain("could not read the library manifest " + libraries + ": " + failure);
            return Json.array(groups);
        }
        for (String raw : lines) {
            String line = raw.strip();
            if (line.isEmpty()) {
                continue;
            }
            if (line.startsWith("# ---") && line.endsWith("---")) {
                if (heading != null) {
                    groups.add(group(heading, modules));
                    modules = new ArrayList<>();
                }
                heading = line.substring(5, line.length() - 3).strip();
                continue;
            }
            if (line.startsWith("#")) {
                continue;
            }
            if (heading == null) {
                complain("the library manifest names `" + line + "` under no heading");
                continue;
            }
            modules.add(line);
        }
        if (heading != null) {
            groups.add(group(heading, modules));
        }
        if (groups.isEmpty()) {
            complain("the library manifest declares nothing");
        }
        return Json.array(groups);
    }

    private Json group(String heading, List<String> modules) {
        if (modules.isEmpty()) {
            complain("the library group `" + heading + "` names no package");
        }
        Json group = Json.object();
        group.put("group", Json.of(heading));
        group.put("modules", Json.array(modules.stream().map(Json::of).toList()));
        return group;
    }

    /** Every module, in presentation order, described by the declaration that <em>is</em> it. */
    private Json modules() {
        List<Json> out = new ArrayList<>();
        for (GgCatalogue.Module module : GgCatalogue.MODULES) {
            Element element = module.type().isEmpty()
                    ? environment.getElementUtils().getPackageElement(module.path())
                    : moduleClasses.get(module.id());
            if (element == null) {
                continue;
            }
            Prose prose = prose(element, "the `" + module.id() + "` module");
            Json entry = Json.object();
            entry.put("id", Json.of(module.id()));
            entry.put("path", Json.of(module.path()));
            entry.put("brief", Json.of(prose.brief()));
            entry.put("detail", prose.detail() == null ? Json.NULL : Json.of(prose.detail()));
            // Nothing is imported. gg writes this arm's import header itself — one star import per
            // module — so a documented import line would be a line a program would be wrong to write.
            entry.put("import", Json.NULL);
            out.add(entry);
        }
        return Json.array(out);
    }

    /**
     * Every model-facing call: the module classes' static methods, and the member functions the
     * types they hand back carry.
     */
    private Json functions() {
        List<Json> out = new ArrayList<>();
        for (GgCatalogue.Module module : GgCatalogue.MODULES) {
            TypeElement owner = moduleClasses.get(module.id());
            if (owner == null) {
                continue;
            }
            // The static methods: one entry per name, with an overload group's declarations as its
            // signatures. Java's answer to an optional argument is an overload, which is exactly what
            // the signatures array is for.
            Map<String, List<ExecutableElement>> overloads = new LinkedHashMap<>();
            for (ExecutableElement method : publicStatics(owner)) {
                if (operationOf(method) == null) {
                    complain("`" + module.path() + "." + method.getSimpleName()
                            + "` is a call a program can make and names no gg operation — add a `@"
                            + OPERATION_TAG + "` to it, or it is a capability no model is told about");
                    continue;
                }
                overloads.computeIfAbsent(method.getSimpleName().toString(), key -> new ArrayList<>())
                        .add(method);
            }
            for (Map.Entry<String, List<ExecutableElement>> entry : overloads.entrySet()) {
                out.add(function(module, entry.getKey(), entry.getValue(), null));
            }
            // The member functions: an operation reached through the value it operates on, which is
            // what a Java author writes when the value is already in hand.
            for (Map.Entry<String, TypeElement> declared : catalogued.entrySet()) {
                if (!module.id().equals(moduleOf(declared.getValue()))) {
                    continue;
                }
                Map<String, List<ExecutableElement>> members = new LinkedHashMap<>();
                for (ExecutableElement method : memberFunctions(declared.getValue())) {
                    members.computeIfAbsent(method.getSimpleName().toString(),
                            key -> new ArrayList<>()).add(method);
                }
                for (Map.Entry<String, List<ExecutableElement>> member : members.entrySet()) {
                    out.add(function(module, member.getKey(), member.getValue(),
                            declared.getValue()));
                }
            }
        }
        return Json.array(out);
    }

    /**
     * One catalogue entry: an overload group of one name, on a module or on a type.
     *
     * @param module the module it is documented under
     * @param name the name a program calls it by
     * @param group every declaration of that name, in declaration order
     * @param receiver the type it hangs off, or {@code null} for a module's own static method
     */
    private Json function(GgCatalogue.Module module, String name, List<ExecutableElement> group,
            TypeElement receiver) {
        ExecutableElement first = group.get(0);
        String operation = operationOf(first);
        String fqn = receiver == null
                ? module.path() + "." + name
                : fqn(receiver) + "#" + name;
        String what = "`" + fqn + "`";
        for (ExecutableElement overload : group) {
            if (!operation.equals(operationOf(overload))) {
                complain(what + "'s overloads name different gg operations, and an overload is "
                        + "another way to write one call rather than another call");
            }
        }

        Set<String> referenced = new LinkedHashSet<>();
        List<Overload> overloads = new ArrayList<>();
        List<Json> signatures = new ArrayList<>();
        for (ExecutableElement overload : group) {
            Overload rendered = signature(overload, what, referenced);
            overloads.add(rendered);
            signatures.add(rendered.json());
        }
        // Every overload's return type, not the first one's: two overloads of one name are free to
        // narrow differently, and a type a program can be handed is a type its documentation has to
        // open. The `signatures` array already shows each one; this is what makes each one openable.
        Set<String> returns = new LinkedHashSet<>();
        for (ExecutableElement overload : group) {
            gather(overload.getReturnType(), returns);
        }

        Prose prose = merged(group, overloads, what);
        Json entry = Json.object();
        entry.put("operation", Json.of(operation));
        entry.put("aliasOf",
                tag(first, ALIAS_TAG) == null ? Json.NULL : Json.of(operation));
        entry.put("module", Json.of(module.id()));
        entry.put("kind", Json.of(receiver == null ? "static-method" : "method"));
        entry.put("receiver",
                receiver == null ? Json.NULL : Json.of(receiver.getSimpleName().toString()));
        entry.put("name", Json.of(name));
        entry.put("fqn", Json.of(fqn));
        // The name is what a program writes, all the way down: a static method is called on the
        // module class the path names, and a member function on the value in hand. There is nothing
        // for a separate call spelling to say that the name does not.
        entry.put("call", Json.NULL);
        entry.put("brief", Json.of(prose.brief()));
        entry.put("detail", prose.detail() == null ? Json.NULL : Json.of(prose.detail()));
        entry.put("signatures", Json.array(signatures));
        entry.put("returns", references(closure(returns)));
        entry.put("types", references(closure(referenced)));
        return entry;
    }

    /**
     * The documentation an <b>overload group</b> is shown under: the first declaration's, with every
     * later one's own words folded in beneath the signature they belong to.
     *
     * <p>Java has no default arguments, so what every other arm writes as one function with an
     * optional argument this arm writes as two or three declarations — each with its own brief, its
     * own {@code @return} and its own {@code @throws}, all of which {@code -Xdoclint:all -Werror}
     * <em>forced</em> the author to write. Reading only the first one's prose and emitting three
     * signatures under it threw that away: a model shown {@code listDir(String path)} would never
     * learn that it can fail with {@code NOT_FOUND}, and one shown {@code shell(String, int)} would
     * never learn what the timeout does when it fires.
     *
     * <p>So the entry's <b>brief</b> is the group's — the first declaration's, which is therefore
     * written to describe every overload rather than only its own — and its <b>detail</b> is the
     * first's followed by one labelled block per later overload. The label is that overload's own
     * call form, which is exactly the row it names in {@code signatures}, so a reader can match the
     * two by eye.
     *
     * <p>A later overload's {@code @return} and {@code @throws} lines are <b>unioned</b> rather than
     * repeated: an optional argument usually fails the same way the required form does, and three
     * copies of one sentence would be three copies a model has to read past to find the one line
     * that is new. Its body paragraphs are always kept, because a paragraph written under a second
     * declaration was written about that declaration.
     */
    private Prose merged(List<ExecutableElement> group, List<Overload> overloads, String what) {
        Documented lead = documented(group.get(0), what);
        if (group.size() == 1) {
            return lead.prose();
        }
        List<String> parts = new ArrayList<>();
        if (lead.body() != null) {
            parts.add(lead.body());
        }
        Set<String> said = new LinkedHashSet<>(lead.tags());
        parts.addAll(lead.tags());
        for (int index = 1; index < group.size(); index++) {
            Documented more = documented(group.get(index), what);
            parts.add("`" + overloads.get(index).call() + "` — " + more.brief());
            if (more.body() != null) {
                parts.add(more.body());
            }
            for (String tag : more.tags()) {
                if (said.add(tag)) {
                    parts.add(tag);
                }
            }
        }
        return new Prose(lead.brief(), parts.isEmpty() ? null : String.join("\n\n", parts));
    }

    /** One overload's JSON, with the call form that labels it in an overload group's prose. */
    private record Overload(Json json, String call) {}

    /** One overload, rendered as Java declares it and documented from its own {@code @param}s. */
    private Overload signature(ExecutableElement method, String what, Set<String> referenced) {
        Map<String, String> documented = params(method);
        List<Json> parameters = new ArrayList<>();
        StringBuilder rendered = new StringBuilder(method.getSimpleName()).append('(');
        List<? extends VariableElement> declared = method.getParameters();
        for (int index = 0; index < declared.size(); index++) {
            VariableElement parameter = declared.get(index);
            String name = parameter.getSimpleName().toString();
            boolean variadic = method.isVarArgs() && index == declared.size() - 1;
            String type = typeName(parameter.asType(), variadic);
            if (index > 0) {
                rendered.append(", ");
            }
            rendered.append(type).append(' ').append(name);
            gather(parameter.asType(), referenced);
            String doc = documented.remove(name);
            if (doc == null || doc.isBlank()) {
                complain(what + " takes `" + name + "` and its documentation says nothing about it");
                doc = "";
            }
            Json shape = Json.object();
            shape.put("name", Json.of(name));
            shape.put("type", Json.of(type));
            shape.put("optional", Json.of(variadic));
            shape.put("kind", Json.of("positional"));
            shape.put("default", Json.NULL);
            shape.put("doc", Json.of(doc));
            shape.put("fields", Json.array(List.of()));
            parameters.add(shape);
        }
        for (String left : documented.keySet()) {
            complain(what + " documents an argument `" + left + "` it does not take");
        }
        String returned = typeName(method.getReturnType(), false);
        gather(method.getReturnType(), referenced);
        String call = rendered.append(')').toString();
        rendered.append(" -> ").append(returned);

        if (!throwsTags(method).isEmpty()) {
            referenced.add(GgCatalogue.CORE_PACKAGE + ".ToolError");
        }

        Json out = Json.object();
        out.put("signature", Json.of(rendered.toString()));
        out.put("parameters", Json.array(parameters));
        return new Overload(out, call);
    }

    /** Every type something reaches, with its declaration, its prose, its members and its menu. */
    private Json types() {
        List<Json> out = new ArrayList<>();
        for (String fqn : sorted(reached)) {
            TypeElement type = catalogued.get(fqn);
            String name = type.getSimpleName().toString();
            Prose prose = prose(type, "the type `" + fqn + "`");

            Json entry = Json.object();
            entry.put("fqn", Json.of(fqn));
            entry.put("module", Json.of(moduleOf(type)));
            entry.put("name", Json.of(name));
            entry.put("declaration", Json.of(declaration(type)));
            entry.put("brief", Json.of(prose.brief()));
            entry.put("detail", prose.detail() == null ? Json.NULL : Json.of(prose.detail()));

            List<Json> members = new ArrayList<>();
            for (Member member : members(type)) {
                Json shape = Json.object();
                shape.put("name", Json.of(member.name()));
                shape.put("type",
                        member.type() == null ? Json.NULL : Json.of(typeName(member.type(), false)));
                shape.put("kind", Json.of(member.kind()));
                shape.put("brief", Json.of(member.prose().brief()));
                shape.put("detail", member.prose().detail() == null
                        ? Json.NULL
                        : Json.of(member.prose().detail()));
                members.add(shape);
            }
            entry.put("members", Json.array(members));

            List<Json> functions = new ArrayList<>();
            for (ExecutableElement method : memberFunctions(type)) {
                String member = fqn + "#" + method.getSimpleName();
                Json shape = Json.object();
                shape.put("operation", Json.of(operationOf(method)));
                shape.put("name", Json.of(method.getSimpleName().toString()));
                shape.put("fqn", Json.of(member));
                shape.put("brief", Json.of(prose(method, "`" + member + "`").brief()));
                functions.add(shape);
            }
            entry.put("memberFunctions", Json.array(functions));
            out.add(entry);
        }
        return Json.array(out);
    }

    /**
     * The names in order, because a catalogue two builds of one checkout disagreed on would be a
     * prompt two runs of one study disagreed on — and because a person reading one, or diffing two
     * runs of `scripts/gg-signatures.sh`, should see what changed rather than what the compiler
     * happened to walk first.
     */
    private static List<String> sorted(Set<String> names) {
        List<String> out = new ArrayList<>(names);
        out.sort(null);
        return out;
    }

    // ---------------------------------------------------------------------------------------
    // Members
    // ---------------------------------------------------------------------------------------

    /** One member of a model-facing type, in whichever of the three shapes it has. */
    private record Member(String name, TypeMirror type, String kind, Prose prose) {
    }

    /**
     * The members of one type, as a model reads them.
     *
     * <p>Three shapes reach a model through one field, because all three are things a program has to
     * read a value of: an enum's <b>constants</b>, a record's <b>components</b>, and the <b>arms</b>
     * of a sealed interface. What is left over — a class with named factories, and the exception
     * class whose fields a catch site reads — has its public methods as its members.
     */
    private List<Member> members(TypeElement type) {
        List<Member> out = new ArrayList<>();
        if (type.getKind() == ElementKind.ENUM) {
            for (Element member : type.getEnclosedElements()) {
                if (member.getKind() == ElementKind.ENUM_CONSTANT) {
                    out.add(new Member(member.getSimpleName().toString(), null, "variant",
                            prose(member, "`" + fqn(type) + "." + member.getSimpleName() + "`")));
                }
            }
            return out;
        }
        if (type.getKind() == ElementKind.RECORD) {
            Map<String, String> documented = params(type);
            for (RecordComponentElement component : type.getRecordComponents()) {
                String name = component.getSimpleName().toString();
                String doc = documented.remove(name);
                if (doc == null || doc.isBlank()) {
                    complain("`" + fqn(type) + "` has a component `" + name
                            + "` its documentation says nothing about");
                    doc = "";
                }
                out.add(new Member(name, component.asType(), "field", new Prose(doc, null)));
            }
            for (String left : documented.keySet()) {
                complain("`" + fqn(type) + "` documents a component `" + left
                        + "` it does not have");
            }
            return out;
        }
        if (type.getKind() == ElementKind.INTERFACE) {
            for (TypeMirror permitted : type.getPermittedSubclasses()) {
                Element arm = ((DeclaredType) permitted).asElement();
                out.add(new Member(arm.getSimpleName().toString(), permitted, "variant",
                        new Prose(prose(arm, "`" + fqn((TypeElement) arm) + "`").brief(), null)));
            }
            return out;
        }
        for (Element member : type.getEnclosedElements()) {
            if (!member.getModifiers().contains(Modifier.PUBLIC)
                    || member.getKind() != ElementKind.METHOD
                    || operationOf(member) != null) {
                continue;
            }
            ExecutableElement method = (ExecutableElement) member;
            out.add(new Member(called(method), method.getReturnType(), "field",
                    new Prose(prose(method, "`" + fqn(type) + "." + method.getSimpleName() + "`")
                            .brief(), null)));
        }
        return out;
    }

    /** One method as a member is named: the call a program writes, with its argument types. */
    private String called(ExecutableElement method) {
        List<String> arguments = new ArrayList<>();
        List<? extends VariableElement> declared = method.getParameters();
        for (int index = 0; index < declared.size(); index++) {
            VariableElement parameter = declared.get(index);
            boolean variadic = method.isVarArgs() && index == declared.size() - 1;
            arguments.add(typeName(parameter.asType(), variadic) + " "
                    + parameter.getSimpleName());
        }
        return method.getSimpleName() + "(" + String.join(", ", arguments) + ")";
    }

    /** The public instance methods of `type` that bind a gg operation. */
    private List<ExecutableElement> memberFunctions(TypeElement type) {
        List<ExecutableElement> out = new ArrayList<>();
        for (Element member : type.getEnclosedElements()) {
            if (member.getKind() == ElementKind.METHOD
                    && member.getModifiers().contains(Modifier.PUBLIC)
                    && !member.getModifiers().contains(Modifier.STATIC)
                    && operationOf(member) != null) {
                out.add((ExecutableElement) member);
            }
        }
        return out;
    }

    /** The public static methods of a module class, in declaration order. */
    private List<ExecutableElement> publicStatics(TypeElement module) {
        List<ExecutableElement> out = new ArrayList<>();
        for (Element member : module.getEnclosedElements()) {
            if (member.getKind() == ElementKind.METHOD
                    && member.getModifiers().contains(Modifier.PUBLIC)
                    && member.getModifiers().contains(Modifier.STATIC)) {
                out.add((ExecutableElement) member);
            }
        }
        return out;
    }

    /** The declaration, as short as a reader needs it: what the type is, and what it is made of. */
    private String declaration(TypeElement type) {
        String name = type.getSimpleName().toString();
        if (type.getKind() == ElementKind.ENUM) {
            List<String> constants = new ArrayList<>();
            for (Element member : type.getEnclosedElements()) {
                if (member.getKind() == ElementKind.ENUM_CONSTANT) {
                    constants.add(member.getSimpleName().toString());
                }
            }
            return "enum " + name + " { " + String.join(", ", constants) + " }";
        }
        if (type.getKind() == ElementKind.RECORD) {
            List<String> components = new ArrayList<>();
            for (RecordComponentElement component : type.getRecordComponents()) {
                components.add(typeName(component.asType(), false) + " "
                        + component.getSimpleName());
            }
            return "record " + name + "(" + String.join(", ", components) + ")"
                    + implemented(type);
        }
        if (type.getKind() == ElementKind.INTERFACE) {
            List<String> permits = new ArrayList<>();
            for (TypeMirror permitted : type.getPermittedSubclasses()) {
                permits.add(typeName(permitted, false));
            }
            return (permits.isEmpty() ? "interface " : "sealed interface ") + name
                    + (permits.isEmpty() ? "" : " permits " + String.join(", ", permits));
        }
        return "final class " + name + extended(type);
    }

    private String implemented(TypeElement type) {
        List<String> names = new ArrayList<>();
        for (TypeMirror face : type.getInterfaces()) {
            names.add(typeName(face, false));
        }
        return names.isEmpty() ? "" : " implements " + String.join(", ", names);
    }

    private String extended(TypeElement type) {
        TypeMirror parent = type.getSuperclass();
        String rendered = typeName(parent, false);
        return "Object".equals(rendered) || "none".equals(rendered)
                ? ""
                : " extends " + rendered;
    }

    // ---------------------------------------------------------------------------------------
    // Reading a doc comment
    // ---------------------------------------------------------------------------------------

    /** A declaration's documentation, split where its author split it. */
    private record Prose(String brief, String detail) {
        /** The two halves as one block, which is what a documentation view renders. */
        String rendered() {
            return detail == null ? brief : brief + "\n\n" + detail;
        }
    }

    /**
     * One declaration's brief and detail.
     *
     * <p>The brief is the comment's opening block, up to its first {@code <p>}; the detail is
     * everything after it, plus what the {@code @return} and {@code @throws} tags say — the two parts
     * of a Java doc comment that are prose about the call rather than about one of its arguments.
     *
     * <p>The brief is required to be <b>one line in the source</b>, and that is checked on the raw
     * text rather than after the wrapping is collapsed: a paragraph written without a {@code <p>}
     * would otherwise arrive as a perfectly well-formed brief six lines long, and the author would
     * hear about it from a gate three steps away instead of from the declaration in front of them.
     */
    private Prose prose(Element element, String what) {
        return documented(element, what).prose();
    }

    /**
     * One declaration's documentation with its three parts still apart: the brief, the body
     * paragraphs under it, and the lines its {@code @return} and {@code @throws} tags produced.
     *
     * <p>{@link #prose} joins them and is what almost everything reads. They are kept separate for
     * {@link #merged}, which folds an overload group into one entry and has to union the tag lines
     * while keeping every body paragraph — a distinction it cannot make once the three are one
     * string.
     *
     * @param brief the one line the declaration is summarized by
     * @param body everything after the first {@code <p>}, or {@code null} where there is nothing
     * @param tags one line per {@code @return} and {@code @throws}, in the order they were written
     */
    private record Documented(String brief, String body, List<String> tags) {
        /** The three parts as the one block a catalogue entry carries. */
        Prose prose() {
            List<String> parts = new ArrayList<>();
            if (body != null) {
                parts.add(body);
            }
            parts.addAll(tags);
            return new Prose(brief, parts.isEmpty() ? null : String.join("\n\n", parts));
        }
    }

    /** {@link #prose}'s reading, with the brief, the body and the tag lines still separable. */
    private Documented documented(Element element, String what) {
        DocCommentTree comment = environment.getDocTrees().getDocCommentTree(element);
        if (comment == null) {
            complain(what + " has no documentation, and a model would be shown a blank");
            return new Documented("", null, List.of());
        }
        List<? extends DocTree> body = comment.getFullBody();
        int split = body.size();
        for (int index = 0; index < body.size(); index++) {
            if (body.get(index) instanceof StartElementTree start
                    && start.getName().contentEquals("p")) {
                split = index;
                break;
            }
        }
        String raw = new Markdown().raw(body.subList(0, split)).strip();
        if (raw.isEmpty()) {
            complain(what + " has no documentation, and a model would be shown a blank");
            return new Documented("", null, List.of());
        }
        if (raw.contains("\n")) {
            complain(what + " opens with a paragraph of more than one line — the first line is the "
                    + "brief and everything after a `<p>` is the detail: " + raw.replace('\n', '⏎'));
        }
        String brief = new Markdown().render(body.subList(0, split));

        String detail = null;
        if (split < body.size()) {
            String rest = new Markdown().render(body.subList(split, body.size()));
            if (!rest.isBlank()) {
                detail = rest;
            }
        }
        List<String> tags = new ArrayList<>();
        for (DocTree tag : comment.getBlockTags()) {
            if (tag instanceof ReturnTree returned) {
                String said = new Markdown().render(returned.getDescription());
                if (!said.isBlank()) {
                    tags.add("Returns: " + said);
                }
            }
        }
        for (ThrowsTree thrown : throwsTags(element)) {
            String said = new Markdown().render(thrown.getDescription());
            if (said.isBlank()) {
                complain(what + " declares a `@throws` that says nothing");
                continue;
            }
            tags.add("Throws `" + simple(thrown.getExceptionName().getSignature()) + "`: " + said);
        }
        return new Documented(brief, detail, tags);
    }

    /** Its {@code @param} tags, by the name each names. */
    private Map<String, String> params(Element element) {
        Map<String, String> out = new LinkedHashMap<>();
        DocCommentTree comment = environment.getDocTrees().getDocCommentTree(element);
        if (comment == null) {
            return out;
        }
        for (DocTree tag : comment.getBlockTags()) {
            if (tag instanceof ParamTree param && !param.isTypeParameter()) {
                out.put(param.getName().getName().toString(),
                        new Markdown().render(param.getDescription()));
            }
        }
        return out;
    }

    /** Its {@code @throws} tags. */
    private List<ThrowsTree> throwsTags(Element element) {
        List<ThrowsTree> out = new ArrayList<>();
        DocCommentTree comment = environment.getDocTrees().getDocCommentTree(element);
        if (comment == null) {
            return out;
        }
        for (DocTree tag : comment.getBlockTags()) {
            if (tag instanceof ThrowsTree thrown) {
                out.add(thrown);
            }
        }
        return out;
    }

    /**
     * What one gg block tag on a declaration says, or {@code null} where it carries none.
     *
     * <p>An unknown block tag is what javac's own documentation checker lets through — measured, with
     * the same {@code -Xdoclint:all/protected -Werror} the build runs, against the HTML-ish element
     * the C++ arm uses, which is two errors here. It arrives whole, as one node, and never reaches
     * the body prose.
     */
    private String tag(Element element, String name) {
        DocCommentTree comment = environment.getDocTrees().getDocCommentTree(element);
        if (comment == null) {
            return null;
        }
        for (DocTree found : comment.getBlockTags()) {
            if (found instanceof UnknownBlockTagTree unknown
                    && unknown.getTagName().equals(name)) {
                return new Markdown().render(unknown.getContent()).strip();
            }
        }
        return null;
    }

    /** The gg operation a declaration binds, canonically or as a second way to reach it. */
    private String operationOf(Element element) {
        String alias = tag(element, ALIAS_TAG);
        return alias == null ? tag(element, OPERATION_TAG) : alias;
    }

    // ---------------------------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------------------------

    /**
     * A model-facing type's fully-qualified name: its module's path, then the type.
     *
     * <p>For the twelve modules that are a class, that is the class the type is nested in — which is
     * what makes the name module-qualified without the module having to be a package a call site
     * could not write. For {@code core} it is the package, because that module <em>is</em> the
     * package.
     */
    private String fqn(TypeElement type) {
        Element owner = type.getEnclosingElement();
        if (owner instanceof TypeElement enclosing) {
            return enclosing.getQualifiedName() + "." + type.getSimpleName();
        }
        return GgCatalogue.CORE_PACKAGE + "." + type.getSimpleName();
    }

    /** The module a model-facing type belongs to. */
    private String moduleOf(TypeElement type) {
        Element owner = type.getEnclosingElement();
        if (owner instanceof TypeElement enclosing) {
            for (GgCatalogue.Module module : GgCatalogue.MODULES) {
                if (module.type().equals(enclosing.getQualifiedName().toString())) {
                    return module.id();
                }
            }
        }
        return "core";
    }

    /** A type as a signature spells it: what a program would have to write to name it. */
    private String typeName(TypeMirror type, boolean variadic) {
        String rendered = render(type);
        if (variadic && rendered.endsWith("[]")) {
            return rendered.substring(0, rendered.length() - 2) + "...";
        }
        return rendered;
    }

    private String render(TypeMirror type) {
        if (type instanceof ArrayType array) {
            return render(array.getComponentType()) + "[]";
        }
        if (type instanceof DeclaredType declared) {
            String name = spelled(declared);
            if (declared.getTypeArguments().isEmpty()) {
                return name;
            }
            List<String> arguments = new ArrayList<>();
            for (TypeMirror argument : declared.getTypeArguments()) {
                arguments.add(render(argument));
            }
            return name + "<" + String.join(", ", arguments) + ">";
        }
        return type.toString();
    }

    /**
     * How a signature writes one type: qualified by its module class where the SDK declares it, and
     * by nothing where the classlib does.
     *
     * <p>{@code Files.FileRead} rather than {@code FileRead}, because a type nested in a module class
     * is what a program writes there — the import header brings the module class into scope and
     * nothing else — and because it is what makes one spelling name one type across thirteen modules.
     */
    private String spelled(DeclaredType declared) {
        Element element = declared.asElement();
        if (element instanceof TypeElement type && catalogued.containsKey(fqn(type))) {
            Element owner = type.getEnclosingElement();
            if (owner instanceof TypeElement enclosing) {
                return enclosing.getSimpleName() + "." + type.getSimpleName();
            }
        }
        return element.getSimpleName().toString();
    }

    /** Record every model-facing type a type mention reaches, generic arguments and arrays alike. */
    private void gather(TypeMirror type, Set<String> into) {
        if (type instanceof ArrayType array) {
            gather(array.getComponentType(), into);
            return;
        }
        if (!(type instanceof DeclaredType declared)) {
            return;
        }
        for (TypeMirror argument : declared.getTypeArguments()) {
            gather(argument, into);
        }
        if (declared.asElement() instanceof TypeElement element
                && catalogued.containsKey(fqn(element))) {
            into.add(fqn(element));
        }
    }

    /**
     * The types a set of references reaches, <b>transitively</b>, and the record that they are
     * reached at all.
     *
     * <p>Depth one is not enough and the C# arm proved it by measurement: a type referred to only by
     * another type was left out of every entry's closure, and nine declarations were documented,
     * undiscoverable and unopenable. What a program holding this call's arguments and result can end
     * up looking at is the whole closure.
     */
    private Set<String> closure(Set<String> seeds) {
        Set<String> out = new LinkedHashSet<>();
        List<String> pending = new ArrayList<>(seeds);
        while (!pending.isEmpty()) {
            String fqn = pending.remove(0);
            if (!out.add(fqn)) {
                continue;
            }
            reached.add(fqn);
            pending.addAll(neighbours.getOrDefault(fqn, Set.of()));
        }
        return out;
    }

    /** One type reference, as both halves: what a signature writes, and what opens it. */
    private Json references(Set<String> fqns) {
        List<Json> out = new ArrayList<>();
        for (String fqn : sorted(fqns)) {
            TypeElement type = catalogued.get(fqn);
            Element owner = type.getEnclosingElement();
            Json entry = Json.object();
            entry.put("spelled", Json.of(owner instanceof TypeElement enclosing
                    ? enclosing.getSimpleName() + "." + type.getSimpleName()
                    : type.getSimpleName().toString()));
            entry.put("fqn", Json.of(fqn));
            out.add(entry);
        }
        return Json.array(out);
    }

    // ---------------------------------------------------------------------------------------
    // Odds and ends
    // ---------------------------------------------------------------------------------------

    /** The package a top-level type is declared in. */
    private static String packageOf(TypeElement type) {
        Element owner = type.getEnclosingElement();
        return owner instanceof PackageElement declared
                ? declared.getQualifiedName().toString()
                : "";
    }

    private static String simple(Object qualified) {
        String name = String.valueOf(qualified);
        int dot = name.lastIndexOf('.');
        return dot < 0 ? name : name.substring(dot + 1);
    }

    private void complain(String detail) {
        failed = true;
        reporter.print(javax.tools.Diagnostic.Kind.ERROR, detail);
    }

    /** A doclet option taking one path. */
    private final class PathOption implements Option {
        private final String name;
        private final String description;
        private final java.util.function.Consumer<Path> take;

        PathOption(String name, String description, java.util.function.Consumer<Path> take) {
            this.name = name;
            this.description = description;
            this.take = take;
        }

        @Override
        public int getArgumentCount() {
            return 1;
        }

        @Override
        public String getDescription() {
            return description;
        }

        @Override
        public Kind getKind() {
            return Kind.STANDARD;
        }

        @Override
        public List<String> getNames() {
            return List.of(name);
        }

        @Override
        public String getParameters() {
            return "<path>";
        }

        @Override
        public boolean process(String option, List<String> arguments) {
            take.accept(Path.of(arguments.get(0)));
            return true;
        }
    }

    // ---------------------------------------------------------------------------------------
    // Javadoc's HTML, as the Markdown every other arm's catalogue carries
    // ---------------------------------------------------------------------------------------

    /**
     * A doc comment rendered as Markdown.
     *
     * <p>The catalogue is read by a prompt template and by the console, both of which render
     * Markdown, and every other arm's reflector emits it — so the one thing Java's documentation
     * tooling does that theirs does not, which is speak HTML, is undone here. It walks the
     * <b>tree</b> rather than the raw comment, so {@code {@code x}} is a node rather than a substring
     * and a {@code <} inside one is not mistaken for a tag.
     */
    private final class Markdown {
        private final StringBuilder out = new StringBuilder();
        private boolean inCode;

        String render(List<? extends DocTree> trees) {
            walk(trees);
            return tidy(out.toString());
        }

        /** The same walk with the line structure kept, which is what a brief is checked against. */
        String raw(List<? extends DocTree> trees) {
            walk(trees);
            return out.toString();
        }

        private void walk(List<? extends DocTree> trees) {
            for (DocTree tree : trees) {
                switch (tree) {
                    case TextTree text -> out.append(text.getBody());
                    case LiteralTree literal -> {
                        String body = literal.getBody().getBody();
                        if (inCode) {
                            out.append(dedent(body));
                        } else {
                            out.append('`').append(body.replace('\n', ' ').strip()).append('`');
                        }
                    }
                    case EntityTree entity -> out.append(entity(entity.getName().toString()));
                    case LinkTree link -> {
                        if (link.getLabel().isEmpty()) {
                            out.append('`')
                                    .append(reference(link.getReference().getSignature()))
                                    .append('`');
                        } else {
                            walk(link.getLabel());
                        }
                    }
                    case StartElementTree start -> open(start.getName().toString());
                    case EndElementTree end -> close(end.getName().toString());
                    default -> out.append(tree.toString());
                }
            }
        }

        private void open(String tag) {
            switch (tag.toLowerCase(Locale.ROOT)) {
                case "p" -> out.append("\n\n");
                case "b", "strong" -> out.append("**");
                case "em", "i" -> out.append('*');
                case "ul", "ol" -> out.append("\n\n");
                case "li" -> out.append("\n- ");
                case "pre" -> {
                    inCode = true;
                    out.append("\n\n```java\n");
                }
                case "code" -> out.append('`');
                default -> {
                    // Every other tag is layout gg does not carry into a prompt.
                }
            }
        }

        private void close(String tag) {
            switch (tag.toLowerCase(Locale.ROOT)) {
                case "b", "strong" -> out.append("**");
                case "em", "i" -> out.append('*');
                case "ul", "ol" -> out.append("\n\n");
                case "pre" -> {
                    inCode = false;
                    out.append("\n```\n\n");
                }
                case "code" -> out.append('`');
                default -> {
                    // As above.
                }
            }
        }

        private String entity(String name) {
            return switch (name) {
                case "lt" -> "<";
                case "gt" -> ">";
                case "amp" -> "&";
                case "quot" -> "\"";
                case "nbsp" -> " ";
                case "mdash" -> "—";
                case "ndash" -> "–";
                default -> "&" + name + ";";
            };
        }

        /** A `{@link}` target, as a program would write it: {@code Type.member}. */
        private String reference(String signature) {
            String name = signature.replace('#', '.');
            if (name.startsWith(".")) {
                name = name.substring(1);
            }
            return name.endsWith("()") ? name.substring(0, name.length() - 2) : name;
        }

        /** Strip the common indentation off a fenced block. */
        private String dedent(String body) {
            List<String> lines = new ArrayList<>(List.of(body.split("\n", -1)));
            while (!lines.isEmpty() && lines.get(0).isBlank()) {
                lines.remove(0);
            }
            while (!lines.isEmpty() && lines.get(lines.size() - 1).isBlank()) {
                lines.remove(lines.size() - 1);
            }
            int common = Integer.MAX_VALUE;
            for (String line : lines) {
                if (line.isBlank()) {
                    continue;
                }
                common = Math.min(common, line.length() - line.stripLeading().length());
            }
            List<String> out_ = new ArrayList<>();
            for (String line : lines) {
                out_.add(line.length() >= common ? line.substring(common) : line.stripLeading());
            }
            return String.join("\n", out_);
        }

        /**
         * Collapse the whitespace a doc comment is wrapped with, outside its fenced blocks.
         *
         * <p>Javadoc is written wrapped to a column and the catalogue's consumers rewrap it, so a
         * line break inside a paragraph is presentation rather than content. A blank line, a list
         * item and a fence are content and survive.
         */
        private String tidy(String text) {
            StringBuilder tidied = new StringBuilder();
            boolean fenced = false;
            for (String block : text.split("```", -1)) {
                if (fenced) {
                    tidied.append("```").append(block.strip()).append("\n```");
                } else {
                    tidied.append(block.replaceAll("[ \t]*\r?\n(?![\r\n\\-])[ \t]*", " ")
                            .replaceAll("[ \t]*\r?\n[ \t]*", "\n")
                            .replaceAll("\n{3,}", "\n\n")
                            .replaceAll("[ \t]{2,}", " "));
                }
                fenced = !fenced;
            }
            return tidied.toString().strip();
        }
    }

    // ---------------------------------------------------------------------------------------
    // The little JSON this speaks
    // ---------------------------------------------------------------------------------------

    /** Just enough JSON to write one document. A dependency for three shapes would be one. */
    private static final class Json {
        static final Json NULL = new Json("null");

        private final String rendered;
        private final Map<String, Json> fields;
        private final List<Json> items;

        private Json(String rendered) {
            this.rendered = rendered;
            this.fields = null;
            this.items = null;
        }

        private Json(Map<String, Json> fields, List<Json> items) {
            this.rendered = null;
            this.fields = fields;
            this.items = items;
        }

        static Json of(String value) {
            StringBuilder out = new StringBuilder("\"");
            for (int index = 0; index < value.length(); index++) {
                char character = value.charAt(index);
                switch (character) {
                    case '"' -> out.append("\\\"");
                    case '\\' -> out.append("\\\\");
                    case '\n' -> out.append("\\n");
                    case '\r' -> out.append("\\r");
                    case '\t' -> out.append("\\t");
                    default -> {
                        if (character < 0x20) {
                            out.append(String.format("\\u%04x", (int) character));
                        } else {
                            out.append(character);
                        }
                    }
                }
            }
            return new Json(out.append('"').toString());
        }

        static Json of(boolean value) {
            return new Json(String.valueOf(value));
        }

        static Json number(int value) {
            return new Json(String.valueOf(value));
        }

        static Json object() {
            return new Json(new LinkedHashMap<>(), null);
        }

        static Json array(List<Json> items) {
            return new Json(null, List.copyOf(items));
        }

        void put(String name, Json value) {
            fields.put(name, value);
        }

        String render() {
            StringWriterish out = new StringWriterish();
            write(out, 0);
            return out.toString();
        }

        private void write(StringWriterish out, int depth) {
            String pad = "  ".repeat(depth + 1);
            String close = "  ".repeat(depth);
            if (rendered != null) {
                out.append(rendered);
            } else if (fields != null) {
                if (fields.isEmpty()) {
                    out.append("{}");
                    return;
                }
                out.append("{\n");
                int left = fields.size();
                for (Map.Entry<String, Json> field : fields.entrySet()) {
                    out.append(pad).append(Json.of(field.getKey()).rendered).append(": ");
                    field.getValue().write(out, depth + 1);
                    out.append(--left == 0 ? "\n" : ",\n");
                }
                out.append(close).append("}");
            } else {
                if (items.isEmpty()) {
                    out.append("[]");
                    return;
                }
                out.append("[\n");
                int left = items.size();
                for (Json item : items) {
                    out.append(pad);
                    item.write(out, depth + 1);
                    out.append(--left == 0 ? "\n" : ",\n");
                }
                out.append(close).append("]");
            }
        }
    }

    /** A {@link StringBuilder} whose {@code append} chains the way this writer wants. */
    private static final class StringWriterish {
        private final StringBuilder out = new StringBuilder();

        StringWriterish append(String text) {
            out.append(text);
            return this;
        }

        @Override
        public String toString() {
            return out.toString();
        }
    }
}
