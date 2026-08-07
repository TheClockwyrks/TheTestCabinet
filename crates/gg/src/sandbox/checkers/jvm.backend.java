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
// WHY IT IS SHARED RATHER THAN COPIED. Two arms reach the same guest through TeaVM, and
// two of TeaVM's settings are not optional: `setJsModuleType(NONE)`, without which the
// entry point is not a bare name the guest's scope can reach, and `setStrict(true)`,
// without which a `NullPointerException` is not an exception at all and a program that
// failed is recorded as one that succeeded. A second copy of `teavm(…)` would be a
// standing chance for one arm to lose either of them silently — which is the same argument
// that has JavaScript serve TypeScript's committed component rather than a byte-identical
// copy of it. The single-file launcher compiles one file, so "shared" here means gg
// assembles the file rather than that javac does.

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
