// The half of gg's JVM compiler driver that does not depend on which language the program
// was written in: `javac`, TeaVM, the two diagnostic shapes flattened into one, and the
// little JSON the driver speaks.
//
// NOT A COMPILATION UNIT. This file is the *tail of a class body*: gg appends it to a
// front end (`java.compiler.java`, `kotlin.compiler.java`) and closes the brace, and the
// result is what the JDK's single-file source-code launcher runs. It therefore declares no
// package, no imports and no class of its own — the front end's import block serves this
// text too, which is stated in each front end's own header.
//
// WHY IT IS SHARED RATHER THAN COPIED. Two arms reach gg through TeaVM, and three of TeaVM's
// settings are not optional — each of them failing SILENTLY when it is missing:
// `setStrict(true)`, without which a `NullPointerException` is not an exception at all and a
// program that failed is recorded as one that succeeded; `setClassesToPreserve(PRESERVED)`,
// without which the entry class is dead-stripped and the component is encoded with no exports
// and no diagnostic; and an equal minimum and maximum heap, without which a program gets the
// minimum and a generous maximum reads as an allowance it never has. A second copy of
// `teavm(…)` would be a standing chance for one arm to lose any of them silently — which is the
// same argument that has JavaScript serve TypeScript's prebuilt component rather than a
// byte-identical copy of it. The single-file launcher compiles one file, so "shared" here means
// gg assembles the file rather than that javac does.

    /**
     * Compile Java sources to bytecode, collecting whatever javac disagreed with.
     *
     * <p>Both arms use this. The Java arm compiles the model's own program with it; the Kotlin
     * arm compiles only gg's generated entry class, because the model's program is Kotlin.
     */
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

    /** The classes TeaVM must keep whatever the dependency analysis concludes.
     *
     * <p>MEASURED, AND A SILENT FOOTGUN. TeaVM emits a core export for an {@code @Export} method
     * ONLY IF THE CLASS IS REACHABLE; an {@code @Export} on a class nothing calls is dead-stripped
     * with no diagnostic and exit code 0, and the component encoded from the result has no exports
     * at all. gg's generated entry class is called by nobody — the host calls its {@code run}
     * through the component's own export — and {@code gg.internal.Abi} is reached only from the SDK
     * classes a particular program happens to use, so both are named here rather than discovered.
     */
    static final String[] PRESERVED = { "GgEntry", "gg.internal.Abi" };

    /** The transformers TeaVM runs over every class it parses.
     *
     * <p>ONE, and it makes {@code java.lang.Math} reachable at all. The classlib declares fourteen
     * of its methods {@code native} and annotates each {@code @Import(module = "teavmMath", …)}, so
     * the backend emits them as core imports of a module a WebAssembly component has no way to
     * resolve — measured: a program whose only unusual line was {@code Math.sqrt} produced a module
     * gg could not encode, naming {@code teavmMath::sqrt}. {@code gg.internal.MathImports} rewrites
     * that module to {@code test-cabinet:gg/math}, which gg's own host answers; its class note
     * carries the whole argument.
     *
     * <p>Named rather than discovered, and loaded out of the build's own classpath, which is where
     * each arm's SDK jar is.
     */
    static final String[] TRANSFORMERS = { "gg.internal.MathImports" };

    /**
     * The Java heap a compiled program gets, which is its <b>minimum and its maximum at once</b>.
     *
     * <h3>Why they are equal: the minimum is what a program actually gets</h3>
     *
     * <p>TeaVM's heap is in the module's own linear memory and TeaVM sizes it itself. A maximum
     * larger than the minimum does <b>not</b> buy a program the difference — measured, on the
     * production route, with a program that allocates one block per round and grows it a megabyte
     * at a time:
     *
     * <ul>
     *   <li>no heap settings at all, and min 4 MiB with max 128 MiB: identical, both out of memory
     *       after the 8 MiB round;
     *   <li>min and max both 128 MiB: past the 65 MiB round.
     * </ul>
     *
     * <p>So writing a generous maximum beside a small minimum reads as an allowance and is not one.
     * The two are set to one number, and that number is what a program may use.
     *
     * <h3>What this is NOT the fix for</h3>
     *
     * <p>An earlier version of this file set 4 MiB and 128 MiB and blamed the pair for a program
     * that died on its next write to standard error with {@code assertion failed at adapter line
     * 2804}. Equal sizes did make that go away, and they were the wrong explanation: the fault was
     * that the SDK's {@code cabi_realloc} handed the preview1 adapter its state out of a buffer the
     * SDK then abandoned, so the adapter's magic-number check failed as soon as a collection reused
     * it — and a bigger heap only postponed the collection. That is fixed where it lives, in
     * {@code gg-sandbox-jvm}'s {@code Abi.java} permanently-held region, and
     * {@code jvm.wire.test.rs} drives
     * forty-four megabytes of collection with a write to standard error after every one.
     *
     * <h3>What it does answer for</h3>
     *
     * <p>An allocation past the heap reports itself: {@code at Program.main(Program.java:4)} and
     * {@code Out of memory}, on the guest's own standard error, in the model's own coordinates,
     * which is the shape ruling D8a wants a resource fault in.
     *
     * <h3>The number</h3>
     *
     * <p>128 MiB, which is half the sandbox's own 256 MiB linear-memory cap — leaving the module,
     * its static data and the ABI regions room inside the cap that actually denies a runaway. It
     * costs nothing at rest: the memory is reserved rather than touched, and instantiate-plus-run
     * measured 14–16 ms at every size from 8 MiB to 128 MiB.
     */
    static final int HEAP = 128 * 1024 * 1024;

    /**
     * Turn the bytecode into the core module gg encodes as a component, collecting whatever TeaVM
     * could not translate.
     *
     * <p>ONE TARGET, AND BOTH ARMS ARE ON IT. TeaVM's JavaScript backend and everything that went
     * with it — the module type, the source map, the source-file policy — are gone, because both
     * JVM arms now compile to a WebAssembly component of their own and a second road kept alive
     * "just in case" is a road nothing tests.
     *
     * <p>{@code programFile} is the model's own file, and it is here for one diagnostic: the
     * arithmetic TeaVM evaluates on the program's behalf. See {@code programsOwnArithmetic}.
     */
    static void teavm(Path classes, Path output, List<String> classpath, String mainClass,
            String targetFile, String programFile, List<Diagnostics.Entry> entries)
            throws Exception {
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
        build.setMainClass(mainClass);
        build.setTargetDirectory(output.toString());
        build.setTargetFileName(targetFile);
        // MANDATORY, on both targets. Without it TeaVM omits the null and bounds checks that make a
        // `NullPointerException` an exception at all, and `catch (NullPointerException)`
        // silently fails to catch — a program that failed would be recorded as one that did not.
        build.setStrict(true);
        // Names a model can recognise in a stack.
        build.setObfuscated(false);
        build.setDebugInformationGenerated(true);
        // SIMPLE rather than FULL: a model's program is short and read once, so the seconds
        // FULL spends inlining across the classlib buy a turn nothing.
        build.setOptimizationLevel(TeaVMOptimizationLevel.SIMPLE);
        build.setIncremental(false);
        build.setTargetType(TeaVMTargetType.WEBASSEMBLY_WASI);
        build.setClassesToPreserve(PRESERVED);
        build.setTransformers(TRANSFORMERS);
        // ONE NUMBER FOR BOTH, AND THAT IS THE POINT — see `HEAP`.
        build.setMinHeapSize(HEAP);
        build.setMaxHeapSize(HEAP);
        BuildResult result;
        try {
            result = build.build();
        } catch (Exception failure) {
            ArithmeticException arithmetic = programsOwnArithmetic(failure);
            if (arithmetic == null) {
                throw failure;
            }
            entries.add(Diagnostics.of(arithmetic, programFile));
            return;
        }
        for (Problem problem : result.getProblems().getProblems()) {
            entries.add(Diagnostics.of(problem));
        }
    }

    /**
     * The {@code ArithmeticException} in {@code failure}'s cause chain, or null.
     *
     * <h3>Why an exception out of the compiler can be the program's</h3>
     *
     * <p>TeaVM folds a constant expression by <b>evaluating</b> it, on the JVM it is running on. So
     * a program whose divisor folds to zero — {@code 7 / 0}, or Kotlin's {@code 7 / "".length},
     * which its own front end folds first — makes the compiler throw {@code
     * java.lang.ArithmeticException: / by zero} and abandon the build. MEASURED: before this, both
     * arms answered that program with a toolchain failure, which is gg's own defect and ends the
     * run, so a model writing one line of legal Java was told nothing and the session was over.
     *
     * <p>The words are the ones the JVM would have used had the expression been evaluated at run
     * time, about arithmetic the model wrote, so they are reported as a diagnostic on the program
     * rather than as a failure of the machine. Every other way a build can throw is still gg's or
     * the operator's, and is still rethrown.
     *
     * <p>The location is the model's file with no line: TeaVM discards the expression's location
     * when it folds it, and a line reached any other way would be a line gg computed.
     */
    static ArithmeticException programsOwnArithmetic(Throwable failure) {
        Throwable cause = failure;
        int depth = 0;
        while (cause != null && depth < 8) {
            if (cause instanceof ArithmeticException) {
                return (ArithmeticException) cause;
            }
            cause = cause.getCause();
            depth++;
        }
        return null;
    }

    /** One thing a compiler said, and how to say it in JSON. */
    static final class Diagnostics {
        /** What a diagnostic carries once every compiler's shape is flattened into one. */
        static final class Entry {
            /** Which compiler said it: `javac`, `kotlinc` or `teavm`. */
            String stage;
            /** Whether it stops the build. */
            boolean error;
            /** javac's stable code (`compiler.err.cant.resolve`), Kotlin's rendered
             * diagnostic name (`UNRESOLVED_REFERENCE`), or nothing. */
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
                // TeaVM's own name for the file, kept WHOLE rather than reduced to its last
                // component. A model's own file has no directory in it either way; a library's
                // does, and `kotlin/concurrent/Thread.kt` says what a program reached through where
                // `Thread.kt` says nothing. Each arm decides what a diagnostic in a file the model
                // did not write means.
                entry.file = source.getFileName();
                entry.line = Math.max(source.getLine(), 0);
            }
            if (entry.file == null && location != null && location.getMethod() != null) {
                entry.message = entry.message + " (in " + location.getMethod() + ")";
            }
            return entry;
        }

        /**
         * The arithmetic the compiler evaluated on the program's behalf, as a diagnostic about the
         * program — see {@code programsOwnArithmetic}.
         *
         * <p>The exception's own rendering and nothing added: {@code java.lang.ArithmeticException:
         * / by zero} is what the JVM says about this fault, and gg's account of what a compiler was
         * doing when it said it belongs in gg's documentation rather than in a compiler diagnostic.
         */
        static Entry of(ArithmeticException failure, String file) {
            Entry entry = new Entry();
            entry.stage = "teavm";
            entry.error = true;
            entry.file = file;
            entry.message = String.valueOf(failure);
            return entry;
        }

        /**
         * The first error among `entries`, for a failure an operator reads rather than a model.
         *
         * <p>Used where a compiler refused something gg GENERATED, which is never the model's
         * fault and must not be reported as a diagnostic about its program.
         */
        static String first(List<Entry> entries) {
            for (Entry entry : entries) {
                if (entry.error) {
                    return entry.file + ":" + entry.line + ": " + entry.message;
                }
            }
            return "it reported no diagnostic at all";
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

        /** One `"<name>Ms":<milliseconds>` field, for the timings a front end reports. */
        static String millis(String name, long nanos) {
            return ",\"" + name + "Ms\":" + nanos / 1_000_000;
        }

        /** A failure that is gg's or the toolchain's rather than the model's. */
        static String failure(String stage, String message) {
            return "{\"ok\":false,\"internal\":" + string(message)
                    + ",\"stage\":" + string(stage) + ",\"diagnostics\":[]}";
        }

        /**
         * A finished build.
         *
         * <p>`timings` is a front end's own list of `,"<stage>Ms":<n>` fields, because which
         * compilers ran is the one thing the arms do not agree on.
         */
        static String response(boolean ok, String stage, List<Diagnostics.Entry> entries,
                String timings) {
            StringBuilder out = new StringBuilder("{\"ok\":");
            out.append(ok).append(",\"stage\":").append(string(stage));
            out.append(timings);
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
