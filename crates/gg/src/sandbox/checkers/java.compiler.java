// gg's Java program compiler, driven as a long-lived process.
//
// ONE FILE ON PURPOSE, and gg assembles it. This is the Java arm's FRONT END; the half
// that is the same whatever language the program was written in — `javac`, TeaVM, the
// diagnostic shapes and the JSON — is `jvm.backend.java`, which gg appends to this text
// before closing the class (see `jvm.rs`). Both halves are embedded in gg's own binary
// and the assembled file is started with the JDK's single-file source-code launcher
// (`java -cp <toolchain jars> GgCompiler.java`), so there is no jar to build, no binary
// artifact to commit, and no way for the compiler driver gg ships to be a different
// vintage from the gg that ships it. The launcher compiles it in memory once per daemon
// start, which is the same startup a JVM pays anyway. Nested static classes are how a
// single file stays readable; a second top-level file would need a build step, and a
// build step would need a committed artifact.
//
// THE IMPORT BLOCK BELOW SERVES THE BACKEND TOO. Imports are a property of a compilation
// unit rather than of a class, so the appended text has none of its own. A missing one is
// a javac error at daemon start naming the symbol, which every test of this arm reaches.
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
    static final int PROTOCOL = 3;

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
     * One build:
     * `<work>\t<output>\t<classes>\t<classpath>\t<mainClass>\t<targetFile>\t<file>[\t<file>…]`.
     *
     * <p>The first two paths are absolute and inside one preparation's own tree; every path after
     * them is relative to {@code work}. Nothing is remembered between requests, which is what makes
     * a build a function of its request alone.
     *
     * <p>{@code classes} IS WHERE javac WRITES AND {@code classpath} IS WHAT IT READS BESIDES THE
     * TOOLCHAIN — a path-separated list, possibly empty, appended after the entries this daemon was
     * started with so that gg's SDK jar stays first. A code module is built into a directory of its
     * own and handed to the program compiled against it that way, which is how a Java library
     * reaches any program: as a classpath entry that declares no name.
     *
     * <p>AN EMPTY {@code targetFile} MEANS {@code javac} AND NOTHING ELSE. gg builds a code module
     * that way: there is no entry point for TeaVM to root a dependency graph at, and the module's
     * classes are the whole of what that build is for. Empty is the one value the field cannot
     * otherwise take, since a file has a name.
     */
    static String build(String request, List<String> classpath) {
        String[] fields = request.split("\t", -1);
        if (fields.length < 7) {
            return Json.failure("internal", "gg sent a request with " + fields.length + " fields");
        }
        Path work = Paths.get(fields[0]);
        Path output = Paths.get(fields[1]);
        Path classes = work.resolve(fields[2]);
        List<String> reads = new ArrayList<>(classpath);
        for (String entry : fields[3].split(File.pathSeparator)) {
            if (!entry.isEmpty()) {
                reads.add(work.resolve(entry).toString());
            }
        }
        String mainClass = fields[4];
        String targetFile = fields[5];
        List<File> sources = new ArrayList<>();
        for (int index = 6; index < fields.length; index++) {
            sources.add(work.resolve(fields[index]).toFile());
        }

        List<Diagnostics.Entry> entries = new ArrayList<>();
        long started = System.nanoTime();
        try {
            Files.createDirectories(classes);
            Files.createDirectories(output);
        } catch (Exception failure) {
            return Json.failure("internal", "could not create " + classes + ": " + failure);
        }

        boolean compiled;
        try {
            compiled = javac(sources, classes, reads, entries);
        } catch (Throwable failure) {
            return Json.failure("internal", "javac fell over: " + Diagnostics.render(failure));
        }
        long afterJavac = System.nanoTime();
        if (!compiled || targetFile.isEmpty()) {
            return Json.response(compiled, compiled ? null : "javac", entries,
                    Json.millis("javac", afterJavac - started) + Json.millis("teavm", 0));
        }

        try {
            teavm(classes, output, reads, mainClass, targetFile,
                    sources.get(0).getName(), entries);
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
                Json.millis("javac", afterJavac - started)
                        + Json.millis("teavm", afterTeaVm - afterJavac));
    }

