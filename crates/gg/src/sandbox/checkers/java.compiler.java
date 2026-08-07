// gg's Java program compiler, driven as a long-lived process.
//
// ONE FILE ON PURPOSE. gg embeds this source in its own binary and starts it with the
// JDK's single-file source-code launcher (`java -cp <teavm jars> GgCompiler.java`), so
// there is no jar to build, no binary artifact to commit, and no way for the compiler
// driver gg ships to be a different vintage from the gg that ships it. The launcher
// compiles it in memory once per daemon start, which is the same startup a JVM pays
// anyway. Nested static classes are how a single file stays readable; a second top-level
// file would need a build step, and a build step would need a committed artifact.
//
// The protocol is one request per line on stdin, one JSON response per line on stdout.
// stdout is claimed before anything else runs and `System.out` is re-pointed at stderr,
// because javac and TeaVM both print, and one stray line would desynchronise the stream
// gg is parsing.
//
// Concurrency: NONE here. gg lends one of these to one preparation at a time out of a
// `CompilerPool`, so this reads a request, answers it, and reads the next. Every build
// gets a fresh `InProcessBuildStrategy` and a fresh file manager — a shared build strategy
// driven from four threads was measured producing no output for three of them while
// throwing nothing, which is the bug this shape exists not to have.

import java.io.BufferedReader;
import java.io.File;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.StandardLocation;
import javax.tools.ToolProvider;

import org.teavm.backend.javascript.JSModuleType;
import org.teavm.diagnostics.DefaultProblemTextConsumer;
import org.teavm.diagnostics.Problem;
import org.teavm.diagnostics.ProblemSeverity;
import org.teavm.model.CallLocation;
import org.teavm.model.TextLocation;
import org.teavm.tooling.EmptyTeaVMToolLog;
import org.teavm.tooling.TeaVMTargetType;
import org.teavm.tooling.builder.BuildResult;
import org.teavm.tooling.builder.BuildStrategy;
import org.teavm.tooling.builder.InProcessBuildStrategy;
import org.teavm.vm.TeaVMOptimizationLevel;

public final class GgCompiler {
    /** The protocol version gg checks at the handshake. Bump it when a field changes meaning. */
    static final int PROTOCOL = 1;

    /** The bytecode level the model's program is compiled to. */
    static final String RELEASE = "21";

    /** The real stdout, claimed before anything else can print to it. */
    static PrintStream channel;

    public static void main(String[] args) throws Exception {
        channel = new PrintStream(new FileOutputStream(FileDescriptor.out), true, "UTF-8");
        // Everything that prints without being asked — javac's notes, a TeaVM warning, a JVM
        // deprecation notice — goes to stderr, where gg reads it as an operator's diagnostic
        // rather than as a response.
        System.setOut(System.err);

        List<String> classpath = new ArrayList<>(Arrays.asList(args[0].split(File.pathSeparator)));
        channel.println("{\"protocol\":" + PROTOCOL
                + ",\"java\":" + Json.string(System.getProperty("java.version"))
                + ",\"release\":" + Json.string(RELEASE) + "}");

        BufferedReader requests = new BufferedReader(
                new InputStreamReader(System.in, StandardCharsets.UTF_8));
        String request;
        while ((request = requests.readLine()) != null) {
            if (request.isEmpty()) {
                continue;
            }
            channel.println(build(request, classpath));
        }
    }

    /**
     * One build: `<work>\t<output>\t<mainClass>\t<targetFile>\t<file>[\t<file>…]`.
     *
     * <p>Every path is absolute and inside one preparation's own tree. Nothing is remembered
     * between requests, which is what makes a build a function of its request alone.
     */
    static String build(String request, List<String> classpath) {
        String[] fields = request.split("\t", -1);
        if (fields.length < 5) {
            return Json.failure("internal", "gg sent a request with " + fields.length + " fields");
        }
        Path work = Paths.get(fields[0]);
        Path output = Paths.get(fields[1]);
        String mainClass = fields[2];
        String targetFile = fields[3];
        List<File> sources = new ArrayList<>();
        for (int index = 4; index < fields.length; index++) {
            sources.add(work.resolve(fields[index]).toFile());
        }

        List<Diagnostics.Entry> entries = new ArrayList<>();
        long started = System.nanoTime();
        Path classes = work.resolve("classes");
        try {
            Files.createDirectories(classes);
            Files.createDirectories(output);
        } catch (Exception failure) {
            return Json.failure("internal", "could not create " + classes + ": " + failure);
        }

        boolean compiled;
        try {
            compiled = javac(sources, classes, classpath, entries);
        } catch (Throwable failure) {
            return Json.failure("internal", "javac fell over: " + Diagnostics.render(failure));
        }
        long afterJavac = System.nanoTime();
        if (!compiled) {
            return Json.response(false, "javac", entries, afterJavac - started, 0);
        }

        try {
            teavm(classes, output, classpath, mainClass, targetFile, entries);
        } catch (Throwable failure) {
            return Json.failure("internal", "TeaVM fell over: " + Diagnostics.render(failure));
        }
        long afterTeaVm = System.nanoTime();
        boolean ok = true;
        for (Diagnostics.Entry entry : entries) {
            if (entry.error) {
                ok = false;
            }
        }
        return Json.response(ok, ok ? null : "teavm", entries,
                afterJavac - started, afterTeaVm - afterJavac);
    }

    /** Compile the model's Java to bytecode, collecting whatever javac disagreed with. */
    static boolean javac(List<File> sources, Path classes, List<String> classpath,
            List<Diagnostics.Entry> entries) throws Exception {
        JavaCompiler javac = ToolProvider.getSystemJavaCompiler();
        if (javac == null) {
            throw new IllegalStateException("this JVM has no javac; gg needs a JDK, not a JRE");
        }
        DiagnosticCollector<JavaFileObject> collected = new DiagnosticCollector<>();
        boolean ok;
        try (StandardJavaFileManager files = javac.getStandardFileManager(collected, null, null)) {
            files.setLocation(StandardLocation.CLASS_OUTPUT, List.of(classes.toFile()));
            List<File> entriesOnPath = new ArrayList<>();
            for (String entry : classpath) {
                entriesOnPath.add(new File(entry));
            }
            files.setLocation(StandardLocation.CLASS_PATH, entriesOnPath);
            // `-g` so TeaVM can emit a source map back to the model's own lines; `--release`
            // so the class files stay inside what TeaVM's bytecode reader accepts however new
            // the JDK in the image gets.
            ok = javac.getTask(null, files, collected,
                    List.of("-g", "-nowarn", "--release", RELEASE), null,
                    files.getJavaFileObjectsFromFiles(sources)).call();
        }
        for (Diagnostic<? extends JavaFileObject> diagnostic : collected.getDiagnostics()) {
            entries.add(Diagnostics.of(diagnostic));
        }
        return ok;
    }

    /** Turn the bytecode into JavaScript, collecting whatever TeaVM could not translate. */
    static void teavm(Path classes, Path output, List<String> classpath, String mainClass,
            String targetFile, List<Diagnostics.Entry> entries) throws Exception {
        // A FRESH strategy per build. A shared one produced no output for three of four
        // concurrent builds while throwing nothing; even lent exclusively, a strategy reused
        // across builds would carry the previous program's dependency graph.
        BuildStrategy build = new InProcessBuildStrategy();
        build.init();
        build.setLog(new EmptyTeaVMToolLog());
        List<String> entriesOnPath = new ArrayList<>();
        entriesOnPath.add(classes.toString());
        entriesOnPath.addAll(classpath);
        build.setClassPathEntries(entriesOnPath);
        build.setTargetType(TeaVMTargetType.JAVASCRIPT);
        build.setMainClass(mainClass);
        build.setTargetDirectory(output.toString());
        build.setTargetFileName(targetFile);
        // NONE, so the emitted code declares its entry point as a bare name in the enclosing
        // scope rather than as a module export. The guest evaluates a program as the body of a
        // function whose parameters are the API objects, and a bare reference to one of those
        // names has to resolve to the parameter — which a module wrapper would shadow.
        build.setJsModuleType(JSModuleType.NONE);
        // MANDATORY. Without it TeaVM omits the null and bounds checks that make a
        // `NullPointerException` an exception at all, and `catch (NullPointerException)`
        // silently fails to catch — a program that failed would be recorded as one that did not.
        build.setStrict(true);
        // Names a model can recognise in a stack, and the source map that turns a generated
        // line back into the line the model wrote.
        build.setObfuscated(false);
        build.setDebugInformationGenerated(true);
        build.setSourceMapsFileGenerated(true);
        build.setSourceFilePolicy(org.teavm.tooling.TeaVMSourceFilePolicy.DO_NOTHING);
        // SIMPLE rather than FULL: a model's program is short and read once, so the seconds
        // FULL spends inlining across the classlib buy a turn nothing.
        build.setOptimizationLevel(TeaVMOptimizationLevel.SIMPLE);
        build.setIncremental(false);
        BuildResult result = build.build();
        for (Problem problem : result.getProblems().getProblems()) {
            entries.add(Diagnostics.of(problem));
        }
    }

    /** One thing a compiler said, and how to say it in JSON. */
    static final class Diagnostics {
        /** What a diagnostic carries once both compilers' shapes are flattened into one. */
        static final class Entry {
            /** Which compiler said it: `javac` or `teavm`. */
            String stage;
            /** Whether it stops the build. */
            boolean error;
            /** javac's stable code (`compiler.err.cant.resolve`), or nothing. */
            String code;
            /** The file it is about, as gg named it. */
            String file;
            /** 1-based line, or 0. */
            long line;
            /** 1-based column, or 0. */
            long column;
            /** The prose. */
            String message;
        }

        static Entry of(Diagnostic<? extends JavaFileObject> diagnostic) {
            Entry entry = new Entry();
            entry.stage = "javac";
            entry.error = diagnostic.getKind() == Diagnostic.Kind.ERROR;
            entry.code = diagnostic.getCode();
            JavaFileObject source = diagnostic.getSource();
            entry.file = source == null ? null : new File(source.getName()).getName();
            entry.line = Math.max(diagnostic.getLineNumber(), 0);
            entry.column = Math.max(diagnostic.getColumnNumber(), 0);
            entry.message = diagnostic.getMessage(Locale.ROOT);
            return entry;
        }

        static Entry of(Problem problem) {
            Entry entry = new Entry();
            entry.stage = "teavm";
            entry.error = problem.getSeverity() == ProblemSeverity.ERROR;
            DefaultProblemTextConsumer text = new DefaultProblemTextConsumer();
            problem.render(text);
            entry.message = text.getText();
            CallLocation location = problem.getLocation();
            TextLocation source = location == null ? null : location.getSourceLocation();
            if (source != null) {
                entry.file = new File(source.getFileName()).getName();
                entry.line = Math.max(source.getLine(), 0);
            }
            if (entry.file == null && location != null && location.getMethod() != null) {
                entry.message = entry.message + " (in " + location.getMethod() + ")";
            }
            return entry;
        }

        /** A throwable as one string, for the failure gg reports to an operator rather than a model. */
        static String render(Throwable failure) {
            StringBuilder out = new StringBuilder(String.valueOf(failure));
            Throwable cause = failure.getCause();
            int depth = 0;
            while (cause != null && depth < 4) {
                out.append(" <- ").append(cause);
                cause = cause.getCause();
                depth++;
            }
            return out.toString();
        }
    }

    /** The little JSON this speaks. A dependency for three object shapes would be a dependency. */
    static final class Json {
        static String string(String value) {
            if (value == null) {
                return "null";
            }
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
            return out.append('"').toString();
        }

        /** A failure that is gg's or the toolchain's rather than the model's. */
        static String failure(String stage, String message) {
            return "{\"ok\":false,\"internal\":" + string(message)
                    + ",\"stage\":" + string(stage) + ",\"diagnostics\":[]}";
        }

        static String response(boolean ok, String stage, List<Diagnostics.Entry> entries,
                long javacNanos, long teavmNanos) {
            StringBuilder out = new StringBuilder("{\"ok\":");
            out.append(ok).append(",\"stage\":").append(string(stage));
            out.append(",\"javacMs\":").append(javacNanos / 1_000_000);
            out.append(",\"teavmMs\":").append(teavmNanos / 1_000_000);
            out.append(",\"diagnostics\":[");
            boolean first = true;
            for (Diagnostics.Entry entry : entries) {
                if (!first) {
                    out.append(',');
                }
                first = false;
                out.append("{\"stage\":").append(string(entry.stage));
                out.append(",\"error\":").append(entry.error);
                out.append(",\"code\":").append(string(entry.code));
                out.append(",\"file\":").append(string(entry.file));
                out.append(",\"line\":").append(entry.line);
                out.append(",\"column\":").append(entry.column);
                out.append(",\"message\":").append(string(entry.message));
                out.append('}');
            }
            return out.append("]}").toString();
        }
    }
}
