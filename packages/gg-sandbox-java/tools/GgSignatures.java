package tools;

import com.sun.source.doctree.DocCommentTree;
import com.sun.source.doctree.DocTree;
import com.sun.source.doctree.EndElementTree;
import com.sun.source.doctree.EntityTree;
import com.sun.source.doctree.LinkTree;
import com.sun.source.doctree.LiteralTree;
import com.sun.source.doctree.ParamTree;
import com.sun.source.doctree.StartElementTree;
import com.sun.source.doctree.TextTree;
import com.sun.source.doctree.ThrowsTree;
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
import javax.lang.model.element.RecordComponentElement;
import javax.lang.model.element.TypeElement;
import javax.lang.model.element.VariableElement;
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
 * reads about this surface therefore comes from the declaration it describes: a function's
 * description from its doc comment, an argument's from that argument's {@code @param}, a record
 * component's from the {@code @param} on the record, an enum constant's from the comment above it,
 * an API object's from the doc comment on the field of {@code gg.Gg} that holds it. There is
 * nowhere else for any of it to be written, which is the point: a description kept anywhere else
 * is one that drifts from its subject with nothing to catch it.
 *
 * <p>The doclet API is what makes that possible in Java rather than merely desirable. A
 * {@link ParamTree} carries the parameter's <em>name</em>, so a renamed parameter left behind in
 * the documentation is caught here rather than by a model writing an argument the call refuses;
 * {@link ThrowsTree} carries the failure prose; and the element model carries the real types, so a
 * signature is javac's reading of the declaration rather than a string anybody typed.
 *
 * <h2>What it refuses to emit</h2>
 *
 * <p>The completeness half of the agreement gate fails a catalogue with a blank in it, so this
 * refuses to write one — the failure lands on the author rather than on a model. A method with no
 * doc comment, a parameter with no {@code @param}, a record component or enum constant with no
 * comment, an API object with no description, a {@code @param} naming an argument the method does
 * not take, a catalogue entry naming a method no class declares, and a public method of an API
 * object that {@link GgCatalogue} does not name are each an error rather than an omission.
 *
 * <h2>Overloads are one entry</h2>
 *
 * <p>Java has no default arguments, so an optional argument here is an <b>overload</b> — which is
 * exactly what the catalogue's {@code signatures} array exists for. Every declaration of one name
 * on one object becomes one entry with one signature each, in declaration order, never two entries
 * sharing a name.
 */
public final class GgSignatures implements Doclet {
    /** Where the JSON goes. */
    private Path output;

    /** Where the library manifest is read from. */
    private Path libraries;

    /** How to complain. */
    private Reporter reporter;

    /** Whether anything has gone wrong. */
    private boolean failed;

    /** Every class in {@code gg}, by simple name. */
    private final Map<String, TypeElement> classes = new LinkedHashMap<>();

    /** The type names the catalogue declares, so a signature's references can be resolved. */
    private final Set<String> declaredTypes = new LinkedHashSet<>();

    /** Which declared types each declared type refers to, for the transitive closure. */
    private final Map<String, Set<String>> typeReferences = new LinkedHashMap<>();

    /** The doc trees of the run. */
    private DocletEnvironment environment;

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
        for (Element element : environment.getIncludedElements()) {
            if (element instanceof TypeElement type && type.getNestingKind().isNested() == false) {
                classes.put(type.getSimpleName().toString(), type);
            }
        }
        List<TypeElement> types = new ArrayList<>();
        for (Map.Entry<String, TypeElement> entry : classes.entrySet()) {
            if (!GgCatalogue.NOT_A_TYPE.contains(entry.getKey())) {
                types.add(entry.getValue());
                declaredTypes.add(entry.getKey());
            }
        }

        Json document = Json.object();
        document.put("language", Json.of("java"));
        document.put("generatedFrom",
                Json.of("packages/gg-sandbox-java/src/gg/ (javadoc, jdk.javadoc.doclet)"));
        document.put("libraries", libraries());
        document.put("objects", objects());

        // The type declarations first, so an entry can name the types it refers to.
        List<Json> declarations = new ArrayList<>();
        for (TypeElement type : types) {
            declarations.add(declaration(type));
        }

        document.put("meta", entries(GgCatalogue.META));
        document.put("session", entries(GgCatalogue.SESSION));
        document.put("views", entries(GgCatalogue.VIEWS));
        document.put("programs", entries(GgCatalogue.PROGRAMS));
        document.put("tools", entries(GgCatalogue.TOOLS));
        document.put("helpers", entries(GgCatalogue.HELPERS));
        document.put("types", Json.array(declarations));

        everyMethodIsCatalogued();
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
    // The sections
    // ---------------------------------------------------------------------------------------

    /** Every API object, in presentation order, described by the field of {@code Gg} holding it. */
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

    /** Every API object, in presentation order, described by the field of {@code Gg} holding it. */
    private Json objects() {
        TypeElement gg = classes.get("Gg");
        if (gg == null) {
            complain("there is no `gg.Gg` to read the API objects' descriptions off");
            return Json.array(List.of());
        }
        List<Json> out = new ArrayList<>();
        for (String[] object : GgCatalogue.OBJECTS) {
            VariableElement field = null;
            for (Element member : gg.getEnclosedElements()) {
                if (member.getKind() == ElementKind.FIELD
                        && member.getSimpleName().contentEquals(object[0])) {
                    field = (VariableElement) member;
                }
            }
            if (field == null) {
                complain("`gg.Gg` has no `" + object[0] + "` field to describe the API object");
                continue;
            }
            Json entry = Json.object();
            entry.put("object", Json.of(object[0]));
            entry.put("doc", Json.of(required(prose(field), "the `" + object[0] + "` object")));
            out.add(entry);
        }
        return Json.array(out);
    }

    /** One catalogue section, with every entry's overload group folded into one. */
    private Json entries(List<GgCatalogue.Entry> section) {
        List<Json> out = new ArrayList<>();
        for (GgCatalogue.Entry entry : section) {
            TypeElement owner = classes.get(entry.className());
            if (owner == null) {
                complain("`gg." + entry.className() + "` does not exist, and `" + entry.key()
                        + "` is catalogued as living there");
                continue;
            }
            List<ExecutableElement> overloads = new ArrayList<>();
            for (Element member : owner.getEnclosedElements()) {
                if (member.getKind() == ElementKind.METHOD
                        && member.getModifiers().contains(Modifier.PUBLIC)
                        && member.getSimpleName().contentEquals(entry.name())) {
                    overloads.add((ExecutableElement) member);
                }
            }
            if (overloads.isEmpty()) {
                complain("`gg." + entry.className() + "` declares no public `" + entry.name()
                        + "`, and `" + entry.key() + "` is catalogued as it");
                continue;
            }

            Json out_ = Json.object();
            switch (entry.section()) {
                case "tools" -> out_.put("tool", Json.of(entry.key()));
                default -> out_.put("key", Json.of(entry.key()));
            }
            out_.put("name", Json.of(entry.name()));
            if (entry.object() != null) {
                out_.put("object", Json.of(entry.object()));
            }
            if (entry.ending() != null) {
                out_.put("ending", Json.of(entry.ending()));
            }
            if ("views".equals(entry.section())) {
                out_.put("requires", entry.gate() == null ? Json.NULL : Json.of(entry.gate()));
            }
            if ("helpers".equals(entry.section())) {
                out_.put("requires", Json.of(entry.gate()));
            }

            List<Json> signatures = new ArrayList<>();
            Set<String> referenced = new LinkedHashSet<>();
            List<String> docs = new ArrayList<>();
            for (ExecutableElement overload : overloads) {
                signatures.add(signature(overload, entry, referenced));
                docs.add(required(prose(overload) + raises(overload),
                        "`" + qualified(entry) + "`"));
            }
            out_.put("signatures", Json.array(signatures));
            // The overload group's documentation is the FIRST declaration's, which is the shape
            // Java writes: the fullest overload leads and the rest say what they add. Every one of
            // them is still required to carry documentation, because a model reading a signature
            // reads the one it is about to write.
            out_.put("doc", Json.of(docs.get(0)));
            out_.put("types", Json.array(closure(referenced).stream().map(Json::of).toList()));
            out.add(out_);
        }
        return Json.array(out);
    }

    /** One overload, rendered as Java declares it and documented from its own {@code @param}s. */
    private Json signature(ExecutableElement method, GgCatalogue.Entry entry,
            Set<String> referenced) {
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
            note(referenced, type);
            String doc = documented.remove(name);
            if (doc == null || doc.isBlank()) {
                complain("`" + qualified(entry) + "` takes `" + name
                        + "` and its documentation says nothing about it");
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
            complain("`" + qualified(entry) + "` documents an argument `" + left
                    + "` it does not take");
        }
        String returned = typeName(method.getReturnType(), false);
        note(referenced, returned);
        rendered.append(") -> ").append(returned);

        if (!method.getThrownTypes().isEmpty() || !throwsTags(method).isEmpty()) {
            note(referenced, "ToolError");
        }

        Json out = Json.object();
        out.put("signature", Json.of(rendered.toString()));
        out.put("parameters", Json.array(parameters));
        return out;
    }

    /** Every type this catalogue declares, with its declaration, its prose and its members. */
    private Json declaration(TypeElement type) {
        String name = type.getSimpleName().toString();
        Json out = Json.object();
        out.put("name", Json.of(name));
        out.put("doc", Json.of(required(prose(type), "the type `" + name + "`")));

        List<Json> members = new ArrayList<>();
        Set<String> references = new LinkedHashSet<>();
        String rendered;
        if (type.getKind() == ElementKind.ENUM) {
            List<String> constants = new ArrayList<>();
            for (Element member : type.getEnclosedElements()) {
                if (member.getKind() != ElementKind.ENUM_CONSTANT) {
                    continue;
                }
                String constant = member.getSimpleName().toString();
                constants.add(constant);
                members.add(member(constant, null,
                        required(prose(member), "`" + name + "." + constant + "`")));
            }
            rendered = "enum " + name + " { " + String.join(", ", constants) + " }";
        } else if (type.getKind() == ElementKind.RECORD) {
            Map<String, String> documented = params(type);
            List<String> components = new ArrayList<>();
            for (RecordComponentElement component : type.getRecordComponents()) {
                String field = component.getSimpleName().toString();
                String kind = typeName(component.asType(), false);
                components.add(kind + " " + field);
                references.add(kind);
                String doc = documented.remove(field);
                if (doc == null || doc.isBlank()) {
                    complain("`" + name + "` has a component `" + field
                            + "` its documentation says nothing about");
                    doc = "";
                }
                members.add(member(field, kind, doc));
            }
            for (String left : documented.keySet()) {
                complain("`" + name + "` documents a component `" + left + "` it does not have");
            }
            rendered = "record " + name + "(" + String.join(", ", components) + ")"
                    + implemented(type);
        } else if (type.getKind() == ElementKind.INTERFACE) {
            List<String> permits = new ArrayList<>();
            for (TypeMirror permitted : type.getPermittedSubclasses()) {
                String arm = simple(permitted);
                permits.add(arm);
                references.add(arm);
                TypeElement element = classes.get(arm);
                members.add(member(arm, arm, element == null
                        ? ""
                        : required(firstSentence(prose(element)), "the `" + arm + "` arm of `"
                                + name + "`")));
            }
            rendered = (permits.isEmpty() ? "interface " : "sealed interface ") + name
                    + (permits.isEmpty() ? "" : " permits " + String.join(", ", permits));
        } else {
            List<String> signatures = new ArrayList<>();
            for (Element member : type.getEnclosedElements()) {
                if (!member.getModifiers().contains(Modifier.PUBLIC)) {
                    continue;
                }
                if (member.getKind() != ElementKind.METHOD
                        && member.getKind() != ElementKind.CONSTRUCTOR) {
                    continue;
                }
                ExecutableElement method = (ExecutableElement) member;
                String label = member.getKind() == ElementKind.CONSTRUCTOR
                        ? name
                        : method.getSimpleName().toString();
                StringBuilder shape = new StringBuilder();
                if (member.getModifiers().contains(Modifier.STATIC)) {
                    shape.append("static ");
                }
                if (member.getKind() == ElementKind.METHOD) {
                    String returned = typeName(method.getReturnType(), false);
                    references.add(returned);
                    shape.append(returned).append(' ');
                }
                shape.append(label).append('(');
                List<? extends VariableElement> declared = method.getParameters();
                for (int index = 0; index < declared.size(); index++) {
                    VariableElement parameter = declared.get(index);
                    boolean variadic = method.isVarArgs() && index == declared.size() - 1;
                    String kind = typeName(parameter.asType(), variadic);
                    references.add(kind);
                    if (index > 0) {
                        shape.append(", ");
                    }
                    shape.append(kind).append(' ').append(parameter.getSimpleName());
                }
                shape.append(')');
                signatures.add(shape.toString());
                members.add(member(label, member.getKind() == ElementKind.CONSTRUCTOR
                        ? name
                        : typeName(method.getReturnType(), false),
                        required(prose(member), "`" + name + "." + label + "`")));
            }
            rendered = "final class " + name + extended(type) + " { "
                    + String.join("; ", signatures) + (signatures.isEmpty() ? "}" : "; }");
        }
        out.put("declaration", Json.of(rendered));
        out.put("members", Json.array(members));
        references.remove(name);
        references.retainAll(declaredTypes);
        typeReferences.put(name, references);
        return out;
    }

    private Json member(String name, String type, String doc) {
        Json out = Json.object();
        out.put("name", Json.of(name));
        out.put("type", type == null ? Json.NULL : Json.of(type));
        out.put("doc", Json.of(doc));
        return out;
    }

    // ---------------------------------------------------------------------------------------
    // The checks that are not about one entry
    // ---------------------------------------------------------------------------------------

    /**
     * Every public method of an API object is catalogued.
     *
     * <p>The direction the per-entry checks cannot see: a method added to {@code gg.Fs} and never
     * named in {@link GgCatalogue} would be a call a program can make and a model is never told
     * about, which is the same defect as a catalogued name that does not exist, running the other
     * way.
     */
    private void everyMethodIsCatalogued() {
        Set<String> catalogued = new LinkedHashSet<>();
        for (List<GgCatalogue.Entry> section : List.of(GgCatalogue.TOOLS, GgCatalogue.HELPERS,
                GgCatalogue.SESSION, GgCatalogue.VIEWS, GgCatalogue.PROGRAMS, GgCatalogue.META)) {
            for (GgCatalogue.Entry entry : section) {
                catalogued.add(entry.className() + "." + entry.name());
            }
        }
        for (String[] object : GgCatalogue.OBJECTS) {
            TypeElement type = classes.get(object[1]);
            if (type == null) {
                complain("`gg." + object[1] + "` does not exist, and the `" + object[0]
                        + "` object is catalogued as it");
                continue;
            }
            for (Element member : type.getEnclosedElements()) {
                if (member.getKind() != ElementKind.METHOD
                        || !member.getModifiers().contains(Modifier.PUBLIC)) {
                    continue;
                }
                String name = member.getSimpleName().toString();
                if (!catalogued.contains(object[1] + "." + name)) {
                    complain("`gg." + object[1] + "` offers a public `" + name
                            + "` that nothing in GgCatalogue names, so no model would be told it "
                            + "exists");
                }
            }
        }
    }

    // ---------------------------------------------------------------------------------------
    // Reading a doc comment
    // ---------------------------------------------------------------------------------------

    /** An element's documentation, as the Markdown the catalogue carries. */
    private String prose(Element element) {
        DocCommentTree comment = environment.getDocTrees().getDocCommentTree(element);
        return comment == null ? "" : new Markdown().render(comment.getFullBody());
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
     * The failure paragraph a model reads, built from the declaration's own {@code @throws}.
     *
     * <p>Every arm renders this the same way, because it is the one part of a function's
     * documentation whose <em>shape</em> is gg's rather than the language's: a model scanning for
     * "what can go wrong here" finds one sentence in the same place in every arm.
     */
    private String raises(ExecutableElement method) {
        List<String> said = new ArrayList<>();
        for (ThrowsTree thrown : throwsTags(method)) {
            String description = new Markdown().render(thrown.getDescription());
            if (description.isBlank()) {
                complain("`" + method.getEnclosingElement().getSimpleName() + "."
                        + method.getSimpleName() + "` declares a `@throws` that says nothing");
                continue;
            }
            said.add("Raises `" + simple(thrown.getExceptionName().getSignature()) + "`: "
                    + description);
        }
        return said.isEmpty() ? "" : "\n\n" + String.join("\n\n", said);
    }

    // ---------------------------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------------------------

    /** A type as a signature spells it: simple names, generics kept, varargs as {@code …}. */
    private String typeName(TypeMirror type, boolean variadic) {
        String rendered = render(type);
        if (variadic && rendered.endsWith("[]")) {
            return rendered.substring(0, rendered.length() - 2) + "...";
        }
        return rendered;
    }

    private String render(TypeMirror type) {
        if (type instanceof javax.lang.model.type.ArrayType array) {
            return render(array.getComponentType()) + "[]";
        }
        if (type instanceof DeclaredType declared) {
            String name = simple(declared.asElement().getSimpleName().toString());
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

    private static String simple(Object qualified) {
        String name = String.valueOf(qualified);
        int dot = name.lastIndexOf('.');
        return dot < 0 ? name : name.substring(dot + 1);
    }

    private String implemented(TypeElement type) {
        List<String> names = new ArrayList<>();
        for (TypeMirror face : type.getInterfaces()) {
            names.add(simple(face));
        }
        return names.isEmpty() ? "" : " implements " + String.join(", ", names);
    }

    private String extended(TypeElement type) {
        String parent = simple(type.getSuperclass());
        return "Object".equals(parent) || "none".equals(parent) ? "" : " extends " + parent;
    }

    /** Record every declared type a rendered type mentions. */
    private void note(Set<String> referenced, String rendered) {
        for (String word : rendered.split("[^A-Za-z0-9_]+")) {
            if (declaredTypes.contains(word)) {
                referenced.add(word);
            }
        }
    }

    /** The types an entry refers to, plus everything those refer to in turn. */
    private List<String> closure(Set<String> seeds) {
        List<String> out = new ArrayList<>();
        List<String> pending = new ArrayList<>(seeds);
        while (!pending.isEmpty()) {
            String name = pending.remove(0);
            if (out.contains(name)) {
                continue;
            }
            out.add(name);
            pending.addAll(typeReferences.getOrDefault(name, Set.of()));
        }
        return out;
    }

    // ---------------------------------------------------------------------------------------
    // Odds and ends
    // ---------------------------------------------------------------------------------------

    private String qualified(GgCatalogue.Entry entry) {
        return entry.object() == null ? entry.name() : entry.object() + "." + entry.name();
    }

    private String required(String text, String what) {
        if (text == null || text.isBlank()) {
            complain(what + " has no documentation, and a model would be shown a blank");
            return "";
        }
        return text;
    }

    private static String firstSentence(String text) {
        int stop = text.indexOf(". ");
        return stop < 0 ? text : text.substring(0, stop + 1);
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
     * <b>tree</b> rather than the raw comment, so {@code {@code x}} is a node rather than a
     * substring and a {@code <} inside one is not mistaken for a tag.
     */
    private final class Markdown {
        private final StringBuilder out = new StringBuilder();
        private boolean inCode;

        String render(List<? extends DocTree> trees) {
            walk(trees);
            return tidy(out.toString());
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
                    out.append("\n\n```\n");
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
                    tidied.append("```\n").append(block.strip()).append("\n```");
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
