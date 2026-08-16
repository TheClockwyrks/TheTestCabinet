/*
 *  Copyright 2016 Alexey Andreev.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */
// ---------------------------------------------------------------------------------------------
// VENDORED, AND CHANGED IN ONE PLACE. This is TeaVM 0.13.1's own
// `core/src/main/java/org/teavm/runtime/ExceptionHandling.java`, kept under gg's Apache-2.0
// obligations with its copyright notice above, and it is on the TeaVM *program* classpath ahead of
// `teavm-core.jar` so that this copy is the one the compiler translates. Nothing is patched, no jar
// is rebuilt and no fork exists: TeaVM resolves this class from the classpath it is given.
//
// WHAT gg CHANGED, and why it had to be here. Upstream's uncaught path is
// `printStack(); abort();`, and `printStack` writes `\tat …` lines AND NOTHING ELSE — no exception
// type and no message. Measured: a program that threw
// `new IllegalStateException("the model's own message")` reached the model with five correctly
// located frames and not one word about what went wrong. Ruling D8a says a failure must name what
// happened as well as where, so gg adds `printHeader()` in front of `printStack()` and nothing else.
// The upstream file's own `printStackTrace` DOES print a header; the WASI backend simply does not
// use it, because the uncaught path is `@Unmanaged`.
//
// It is capture rather than interception under ruling D8: gg adds no catch, changes no control flow
// and learns of the failure only through the runtime's own standard error. What it changes is what
// the runtime PRINTS on its way out.
//
// KEEPING IT IN STEP. It is pinned to one TeaVM release by `java-version.sh`, which is the last
// release carrying the `WEBASSEMBLY_WASI` target and is therefore terminal — there is no upstream
// version of this file to drift from. A test drives the whole of what this is for: see
// `crates/gg/src/sandbox/language/jvm.wire.test.rs`.
// ---------------------------------------------------------------------------------------------
package org.teavm.runtime;

import org.teavm.interop.Address;
import org.teavm.interop.Export;
import org.teavm.interop.StaticInit;
import org.teavm.interop.Unmanaged;

@StaticInit
public final class ExceptionHandling {
    private ExceptionHandling() {
    }

    @Unmanaged
    public static native CallSite findCallSiteById(int id, Address frame);

    @Unmanaged
    public static native boolean isJumpSupported();

    @Unmanaged
    public static native void jumpToFrame(Address frame, int id);

    @Unmanaged
    public static native void abort();

    @Unmanaged
    private static native boolean isObfuscated();

    /**
     * gg's ADDITION — the one line upstream's uncaught path is missing: what was thrown.
     *
     * <p>The type name and the message are read in {@link #headerOf}, which is deliberately NOT
     * {@code @Unmanaged}: both of them are reached by virtual calls, and a virtual call made
     * directly from this path traps with {@code indirect call type mismatch}. A static call into
     * managed code is what the shadow stack can carry.
     *
     * <p>It runs immediately before {@link #printStack}, so what reaches standard error is the
     * shape every Java programmer reads a failure in: a header, then the frames. Building that
     * string allocates, on a path the runtime does not otherwise allocate on; measured, the frames
     * printed after it are still the program's own.
     */
    @Unmanaged
    public static void printHeader(Throwable exception) {
        if (exception == null) {
            return;
        }
        Console.printString(headerOf(exception));
        Console.printString("\n");
    }

    /**
     * What was thrown, as {@code java.lang.NullPointerException} or
     * {@code java.lang.IllegalStateException: the message}.
     *
     * <p>WHICH HALF ARRIVES, MEASURED. TeaVM emits a class's name into the binary only for the class
     * values its dependency analysis sees reaching {@code Class.getName()}, and the only assignments
     * to {@code thrownException} that analysis can see are the three faults the runtime raises
     * itself. So a {@code NullPointerException}, an {@code ArrayIndexOutOfBoundsException} and a
     * {@code ClassCastException} — which carry no message, and for which the type IS what went wrong
     * — arrive named; a type a program threw itself arrives as the message the program wrote, which
     * is the half that says something in that case. Between them every failure names what happened,
     * and the frames beside it say where.
     */
    private static String headerOf(Throwable exception) {
        String name = exception.getClass().getName();
        String message = exception.getMessage();
        if (name == null) {
            return message == null ? "an exception carrying no message" : message;
        }
        return message == null ? name : name + ": " + message;
    }

    @Unmanaged
    public static void printStack() {
        Address stackFrame = ShadowStack.getStackTop();
        while (stackFrame != null) {
            int callSiteId = ShadowStack.getCallSiteId(stackFrame);
            if (isObfuscated()) {
                Console.printString("\tat Obfuscated.obfuscated(Obfuscated.java:");
                Console.printInt(callSiteId);
                Console.printString(")\n");
            } else {
                CallSite callSite = findCallSiteById(callSiteId, stackFrame);
                CallSiteLocation location = callSite.location;
                while (location != null) {
                    MethodLocation methodLocation = location.method;

                    if (methodLocation != null) {
                        Console.printString("\tat ");
                        if (methodLocation.className == null || methodLocation.methodName == null) {
                            Console.printString("(Unknown method)");
                        } else {
                            Console.printString(methodLocation.className.value);
                            Console.printString(".");
                            Console.printString(methodLocation.methodName.value);
                        }
                        Console.printString("(");
                        if (methodLocation.fileName != null && location.lineNumber >= 0) {
                            Console.printString(methodLocation.fileName.value);
                            Console.printString(":");
                            Console.printInt(location.lineNumber);
                        }
                        Console.printString(")\n");
                    }

                    location = location.next;
                }
            }
            stackFrame = ShadowStack.getNextStackFrame(stackFrame);
        }
    }

    private static Throwable thrownException;

    @Export(name = "teavm_catchException")
    @Unmanaged
    public static Throwable catchException() {
        Throwable exception = thrownException;
        thrownException = null;
        return exception;
    }

    @Unmanaged
    public static Throwable peekException() {
        return thrownException;
    }

    @Unmanaged
    public static void throwException(Throwable exception) {
        thrownException = exception;

        RuntimeObject exceptionPtr = Address.ofObject(exception).toStructure();
        RuntimeClass exceptionClass = RuntimeClass.getClass(exceptionPtr);

        Address stackFrame = ShadowStack.getStackTop();
        int handlerId = 0;
        stackLoop: while (stackFrame != null) {
            int callSiteId = ShadowStack.getCallSiteId(stackFrame);
            if (callSiteId >= 0) {
                CallSite callSite = findCallSiteById(callSiteId, stackFrame);
                ExceptionHandler handler = callSite.firstHandler;

                while (handler != null) {
                    if (handler.exceptionClass == null || handler.exceptionClass.isSupertypeOf.apply(exceptionClass)) {
                        handlerId = handler.id;
                        if (!isJumpSupported()) {
                            ShadowStack.setExceptionHandlerId(stackFrame, handlerId);
                        }
                        break stackLoop;
                    }
                    handler = handler.next;
                }

                if (!isJumpSupported()) {
                    ShadowStack.setExceptionHandlerSkip(stackFrame);
                }
            }
            stackFrame = ShadowStack.getNextStackFrame(stackFrame);
        }

        if (stackFrame == null) {
            if (!isJumpSupported()) {
                stackFrame = ShadowStack.getStackTop();
                while (stackFrame != null) {
                    int callSiteId = ShadowStack.getCallSiteId(stackFrame);
                    if (callSiteId >= 0) {
                        ShadowStack.setExceptionHandlerRestore(stackFrame);
                    }
                    stackFrame = ShadowStack.getNextStackFrame(stackFrame);
                }
            }
            printHeader(exception);
            printStack();
            abort();
        } else {
            jumpToFrame(stackFrame, handlerId);
        }
    }

    @Unmanaged
    public static void throwClassCastException() {
        throwException(new ClassCastException());
    }

    @Unmanaged
    @Export(name = "teavm_throwNullPointerException")
    public static void throwNullPointerException() {
        throwException(new NullPointerException());
    }

    @Unmanaged
    @Export(name = "teavm_throwArrayIndexOutOfBoundsException")
    public static void throwArrayIndexOutOfBoundsException() {
        throwException(new ArrayIndexOutOfBoundsException());
    }

    @Unmanaged
    private static int callStackSize() {
        Address stackFrame = ShadowStack.getStackTop();
        int size = 0;
        while (stackFrame != null) {
            int callSiteId = ShadowStack.getCallSiteId(stackFrame);
            if (callSiteId >= 0) {
                CallSite callSite = findCallSiteById(callSiteId, stackFrame);
                CallSiteLocation location = callSite.location;
                if (isObfuscated() || location == null) {
                    size++;
                } else {
                    while (location != null) {
                        size++;
                        location = location.next;
                    }
                }
            }

            stackFrame = ShadowStack.getNextStackFrame(stackFrame);
        }
        return size;
    }

    @Unmanaged
    public static StackTraceElement[] fillStackTrace() {
        Address stackFrame = ShadowStack.getStackTop();
        int size = callStackSize();

        ShadowStack.allocStack(1);
        ShadowStack.removeGCRoot(0);
        StackTraceElement[] target = new StackTraceElement[size];
        ShadowStack.registerGCRoot(0, target);

        int index = 0;
        while (stackFrame != null) {
            int callSiteId = ShadowStack.getCallSiteId(stackFrame);
            if (callSiteId >= 0) {
                CallSite callSite = findCallSiteById(callSiteId, stackFrame);
                CallSiteLocation location = callSite.location;
                if (isObfuscated()) {
                    target[index++] = new StackTraceElement("Obfuscated", "obfuscated", "Obfuscated.java", callSiteId);
                } else if (location == null) {
                    target[index++] = new StackTraceElement("", "", null, -1);
                } else {
                    while (location != null) {
                        MethodLocation methodLocation = location.method;
                        StackTraceElement element;
                        if (methodLocation != null) {
                            element = new StackTraceElement(
                                    methodLocation.className != null ? methodLocation.className.value : "",
                                    methodLocation.methodName != null ? methodLocation.methodName.value : "",
                                    methodLocation.fileName != null ? methodLocation.fileName.value : null,
                                    location.lineNumber);
                        } else {
                            element = new StackTraceElement("", "", null, location.lineNumber);
                        }
                        target[index++] = element;
                        location = location.next;
                    }
                }
            }
            stackFrame = ShadowStack.getNextStackFrame(stackFrame);
        }
        ShadowStack.releaseStack(1);

        return target;
    }
}
