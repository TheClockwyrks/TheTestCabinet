// gg's Kotlin program compiler, driven as a long-lived process.
//
// ONE FILE ON PURPOSE, and gg assembles it. This is the Kotlin arm's FRONT END; the half
// that is the same whatever language the program was written in — `javac`, TeaVM, the
// diagnostic shapes and the JSON — is `jvm.backend.java`, which gg appends to this text
// before closing the class (see `jvm.rs`). Both halves are embedded in gg's own binary and
// the assembled file is started with the JDK's single-file source-code launcher, so there
// is no jar to build, no binary artifact to commit, and no way for the compiler driver gg
// ships to be a different vintage from the gg that ships it.
//
// WRITTEN IN JAVA, THOUGH IT DRIVES KOTLIN. The compiler's own entry point
// (`K2JVMCompiler`) is an ordinary JVM class, and a driver written in Kotlin would have to
// be compiled by the compiler it is driving before it could run — which is a bootstrap and
// a committed artifact for no gain at all.
//
// THE IMPORT BLOCK BELOW SERVES THE BACKEND TOO. Imports are a property of a compilation
// unit rather than of a class, so the appended text has none of its own. A missing one is a
// javac error at daemon start naming the symbol, which every test of this arm reaches.
//
// The protocol is one request per line on stdin, one JSON response per line on stdout.
// stdout is claimed before anything else runs and `System.out` is re-pointed at stderr,
// because all three compilers print, and one stray line would desynchronise the stream gg
// is parsing.
//
// Concurrency: NONE here. gg lends one of these to one preparation at a time out of a
// `CompilerPool`, so this reads a request, answers it, and reads the next. Every build gets
// a fresh `K2JVMCompiler` and a fresh `InProcessBuildStrategy` — a shared TeaVM build
// strategy driven from four threads was measured producing no output for three of them
// while throwing nothing, which is the bug this shape exists not to have.

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

import org.jetbrains.kotlin.cli.common.ExitCode;
import org.jetbrains.kotlin.cli.common.arguments.K2JVMCompilerArguments;
import org.jetbrains.kotlin.cli.common.messages.CompilerMessageSeverity;
import org.jetbrains.kotlin.cli.common.messages.CompilerMessageSourceLocation;
import org.jetbrains.kotlin.cli.common.messages.MessageCollector;
import org.jetbrains.kotlin.cli.jvm.K2JVMCompiler;
import org.jetbrains.kotlin.config.Services;

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

    /** The bytecode level gg's own generated entry class is compiled to. */
    static final String RELEASE = "21";

    /**
     * The bytecode level the model's Kotlin is compiled to.
     *
     * <p>The same number as {@link #RELEASE} and separate from it because they are different
     * compilers' flags: TeaVM reads class files with a bundled ASM, and a class file version
     * that outran it fails with `Unsupported class file major version` rather than with
     * anything a model could act on.
     */
    static final String JVM_TARGET = "21";

    /** The real stdout, claimed before anything else can print to it. */
    static PrintStream channel;

    /** The classpath gg's generated entry class is compiled with, and TeaVM translates from. */
    static List<String> toolchain;

    /** The classpath a model's PROGRAM is compiled against: the Kotlin standard library. */
    static List<String> programPath;

    /** The classpath a code MODULE is compiled against: the above, plus TeaVM's export annotations. */
    static List<String> modulePath;

    /** The directory the scripting plugin is loaded out of, as the compiler's `-kotlin-home`. */
    static String kotlinHome;

    public static void main(String[] args) throws Exception {
        channel = new PrintStream(new FileOutputStream(FileDescriptor.out), true, "UTF-8");
        // Everything that prints without being asked — a Kotlin logging line, a TeaVM warning, a
        // JVM deprecation notice — goes to stderr, where gg reads it as an operator's diagnostic
        // rather than as a response.
        System.setOut(System.err);

        toolchain = Arrays.asList(args[0].split(File.pathSeparator));
        programPath = Arrays.asList(args[1].split(File.pathSeparator));
        modulePath = Arrays.asList(args[2].split(File.pathSeparator));
        kotlinHome = args[3];
        settle();
        channel.println("{\"protocol\":" + PROTOCOL
                + ",\"java\":" + Json.string(System.getProperty("java.version"))
                + ",\"kotlin\":" + Json.string(kotlinVersion())
                + ",\"release\":" + Json.string(RELEASE) + "}");

        BufferedReader requests = new BufferedReader(
                new InputStreamReader(System.in, StandardCharsets.UTF_8));
        String request;
        while ((request = requests.readLine()) != null) {
            if (request.isEmpty()) {
                continue;
            }
            channel.println(build(request));
        }
    }

    /**
     * Give the compiler's IntelliJ core somewhere of its own to keep its configuration.
     *
     * <p>Not optional, and not decoration. `PathManager` throws
     * `Could not find installation home path. Please make sure product-info.json is present` out of
     * a STATIC INITIALISER the moment the scripting pipeline asks for a configuration directory —
     * before it has read a line of the model's program — and nothing about that message says what
     * gg would have to install to answer it. These three directories answer it without an
     * installation.
     *
     * <p>They are resolved against this process's working directory, which the seam gave this
     * daemon and gave to no other, so two daemons never share one. Set here rather than passed as
     * `-D` flags because gg's side does not know that directory: `daemon` mints it.
     */
    static void settle() {
        for (String name : new String[] { "config", "system", "plugins" }) {
            System.setProperty("idea." + name + ".path",
                    new File("idea/" + name).getAbsolutePath());
        }
    }

    /**
     * The Kotlin release this JVM actually loaded, for the handshake.
     *
     * <p>gg pins the jars and checks the answer, because the two are installed separately from
     * the binary that speaks to them: a machine carrying another release would otherwise be
     * discovered through a diagnostic that words itself differently, which is the hardest kind
     * of difference to attribute in a study.
     */
    static String kotlinVersion() {
        try {
            Class<?> version = Class.forName("org.jetbrains.kotlin.config.KotlinCompilerVersion");
            return String.valueOf(version.getMethod("getVersion").invoke(null));
        } catch (Throwable failure) {
            return null;
        }
    }

    /**
     * One build: `<work>\t<output>\t<mainClass>\t<targetFile>\t<kind>\t<source>\t<entry>`.
     *
     * <p>`kind` is `program` or `module`, and it decides which classpath the model's own source
     * is compiled against — a module needs the annotations gg writes into it to export a
     * namespace, a program does not and is therefore compiled against the standard library
     * alone.
     *
     * <p>Every path is absolute and inside one preparation's own tree. Nothing is remembered
     * between requests, which is what makes a build a function of its request alone.
     */
    static String build(String request) {
        String[] fields = request.split("\t", -1);
        if (fields.length != 7) {
            return Json.failure("internal", "gg sent a request with " + fields.length + " fields");
        }
        Path work = Paths.get(fields[0]);
        Path output = Paths.get(fields[1]);
        String mainClass = fields[2];
        String targetFile = fields[3];
        boolean module = fields[4].equals("module");
        File source = work.resolve(fields[5]).toFile();
        File entry = work.resolve(fields[6]).toFile();

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
            compiled = kotlinc(source, classes, module ? modulePath : programPath, entries);
        } catch (Throwable failure) {
            return Json.failure("internal", "kotlinc fell over: " + Diagnostics.render(failure));
        }
        long afterKotlinc = System.nanoTime();
        if (!compiled) {
            return Json.response(false, "kotlinc", entries,
                    Json.millis("kotlinc", afterKotlinc - started)
                            + Json.millis("javac", 0) + Json.millis("teavm", 0));
        }

        // gg's own entry class, compiled AFTER the model's Kotlin and against it: it calls into
        // what the model wrote, so the classes directory is on its classpath. Nothing goes the
        // other way, which is why one javac pass is enough and why a model's Kotlin never sees a
        // Java file gg generated.
        try {
            List<String> path = new ArrayList<>();
            path.add(classes.toString());
            // The standard library as well as the toolchain: gg's entry class names Kotlin's own
            // exception classes in its catch chain — `!!` on a null and a `lateinit` read too early
            // are two of the three ways a Kotlin program most often stops — and those are declared
            // in `kotlin-stdlib` rather than in `java.base`.
            path.addAll(programPath);
            path.addAll(toolchain);
            if (!javac(List.of(entry), classes, path, entries)) {
                return Json.failure("internal",
                        "gg's own entry class did not compile: " + Diagnostics.first(entries));
            }
        } catch (Throwable failure) {
            return Json.failure("internal", "javac fell over: " + Diagnostics.render(failure));
        }
        long afterJavac = System.nanoTime();

        try {
            List<String> path = new ArrayList<>();
            path.addAll(programPath);
            path.addAll(toolchain);
            teavm(classes, output, path, mainClass, targetFile, entries);
        } catch (Throwable failure) {
            return Json.failure("internal", "TeaVM fell over: " + Diagnostics.render(failure));
        }
        long afterTeaVm = System.nanoTime();
        boolean ok = true;
        for (Diagnostics.Entry entry2 : entries) {
            if (entry2.error) {
                ok = false;
            }
        }
        return Json.response(ok, ok ? null : "teavm", entries,
                Json.millis("kotlinc", afterKotlinc - started)
                        + Json.millis("javac", afterJavac - afterKotlinc)
                        + Json.millis("teavm", afterTeaVm - afterJavac));
    }

    /** Compile the model's Kotlin to bytecode, collecting whatever the compiler disagreed with. */
    static boolean kotlinc(File source, Path classes, List<String> classpath,
            List<Diagnostics.Entry> entries) {
        // A FRESH compiler per build. `exec` builds and disposes its own environment, so nothing
        // survives a build except what the JVM's class loaders hold — which is why gg retires a
        // daemon after a fixed number of builds rather than trusting this to be free.
        K2JVMCompiler compiler = new K2JVMCompiler();
        // A developer's shell may carry KOTLIN_* settings, and a compiler that picked one up
        // would compile differently from the one in the run image — a difference between two
        // arms of a study that came from a dotfile.
        compiler.setReadingSettingsFromEnvironmentAllowed(false);
        K2JVMCompilerArguments arguments = compiler.createArguments();
        compiler.parseArguments(new String[] {
            "-classpath", String.join(File.pathSeparator, classpath),
            "-d", classes.toString(),
            "-jvm-target", JVM_TARGET,
            "-nowarn",
            // gg puts the standard library on the classpath above, by name, out of the jars it
            // installed. Left to itself the compiler looks for a "Kotlin home" that does not
            // exist here and reports the absence as a diagnostic about the model's program.
            "-no-stdlib",
            "-no-reflect",
            // What makes a Kotlin diagnostic carry a STABLE code. Without it a message is prose
            // and the only way to tell "the parser could not read this" from "I read it and
            // disagreed" — which are two different bands to a model — is to match on English.
            "-Xrender-internal-diagnostic-names",
            // What makes this a SCRIPT rather than a program: a `.kts` in the source roots is
            // compiled to classes, where `-script` would compile it and then RUN it inside this
            // daemon. See `kotlin.source.rs` for why a program is a script at all.
            "-Xallow-any-scripts-in-source-roots",
            // Where the scripting plugin is found. Without it the compiler answers a script with
            // `SCRIPTING_ERROR: Unable to evaluate script, no scripting plugin loaded`, which is a
            // sentence about gg's packaging wearing the shape of a diagnostic about the program.
            "-kotlin-home", kotlinHome,
            source.toString(),
        }, arguments);
        Collector collector = new Collector(entries);
        ExitCode code = compiler.exec(collector, Services.EMPTY, arguments);
        return code == ExitCode.OK;
    }

    /** Kotlin's diagnostics, as the shape the backend renders. */
    static final class Collector implements MessageCollector {
        final List<Diagnostics.Entry> entries;
        boolean errors;

        Collector(List<Diagnostics.Entry> entries) {
            this.entries = entries;
        }

        public void clear() {
        }

        public boolean hasErrors() {
            return errors;
        }

        public void report(CompilerMessageSeverity severity, String message,
                CompilerMessageSourceLocation location) {
            // LOGGING and INFO are the compiler talking about itself — which JDK it inferred,
            // which plugins it could not load. They are not about the program and gg never shows
            // them to a model, so they are dropped here rather than filtered on the other side.
            if (severity == CompilerMessageSeverity.LOGGING
                    || severity == CompilerMessageSeverity.INFO) {
                return;
            }
            if (severity.isError()) {
                errors = true;
            }
            Diagnostics.Entry entry = new Diagnostics.Entry();
            entry.stage = "kotlinc";
            entry.error = severity.isError();
            entry.message = message;
            if (location != null) {
                entry.file = new File(location.getPath()).getName();
                entry.line = Math.max(location.getLine(), 0);
                entry.column = Math.max(location.getColumn(), 0);
            }
            // `-Xrender-internal-diagnostic-names` prefixes the message with the compiler's own
            // name for the diagnostic: `[SYNTAX] Syntax error: …`. It is lifted out into the code
            // field and off the prose, so what a model reads is the message its own compiler
            // would have printed and what gg BANDS on is a stable identifier.
            if (entry.message != null && entry.message.startsWith("[")) {
                int close = entry.message.indexOf(']');
                if (close > 1) {
                    entry.code = entry.message.substring(1, close);
                    entry.message = entry.message.substring(close + 1).trim();
                }
            }
            entries.add(entry);
        }
    }
