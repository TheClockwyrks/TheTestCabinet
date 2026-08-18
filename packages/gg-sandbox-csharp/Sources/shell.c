// The **shell** a model's C# program runs inside: what the sandbox world's two exports do, how the
// Mono IL interpreter is started, and how the program's own `Main` is reached.
//
// It is compiled once, at build time, into `csharp.component.wasm` — not per turn, and nothing here
// is a function of any one program. What crosses the membrane every turn is a **manifest of named
// IL assemblies** in the world's `program` parameter: gg's own SDK, one library per code module the
// agent has loaded, and the model's own program. This file registers every one of them with the
// runtime as a bundled resource and loads the program by name, which is how a reference the host's
// compiler resolved is resolved again here.
//
// It is not the SDK. Nothing here is model-facing and nothing here is in a signature catalogue: a
// program written by a model calls the curated surface in `src/Gg/`, whose methods land on the
// internal calls `Sources/bridge.c` registers.
//
// # Why a C shell, and why that is the whole answer to this arm's one open question
//
// Binding gg's WIT world from *managed* .NET code has no supported path — `dotnet/runtime#113868`,
// closed unresolved. This arm never asks for one. The component gg instantiates is C: Mono's own
// runtime pack sources, gg's `wit-bindgen`-generated bindings, and this file. The managed half
// reaches gg through `mono_add_internal_call`, which is Mono's embedding API for exactly this and
// is older than wasm. So the piece the feasibility study called unbuilt is not built here either —
// it is not needed, because the WIT is bound by the language that has a generator for it.
//
// # What the runtime costs, and why it is started lazily
//
// `mono_wasm_load_runtime` is the runtime pack's own boot: it loads ICU out of the bundle,
// initialises `monovm` from the bundled `runtimeconfig.bin`, registers the bundled BCL and starts
// the interpreter. It is done on the first `run` rather than in a constructor because a component
// instance that is created and never driven — an instantiation gg makes to read `bound-operations`
// — has no reason to pay for it.
//
// # Why `mono_debug_init` is called before it
//
// So that a stack trace carries the model's own line. Mono resolves a frame to a file and a line
// through `mono_debug_lookup_source_location`, which answers nothing at all until the debug
// subsystem has been initialised — and nothing initialises it here otherwise. The runtime pack's own
// hook (`mono_wasm_load_runtime`'s non-zero `debug_level`) is not the way in: it reaches
// `mono_wasm_enable_debugging`, which lives in the managed debugger component, and this build links
// that component's STUB. It would also turn every interpreter optimisation off, which is a price
// paid for an attachable debugger nothing here can attach.
//
// `MONO_DEBUG_FORMAT_MONO` is the format that reads a portable PDB out of the assembly, which is
// where `csc -debug:embedded` puts it (`csharp.compile.rs`). It costs the lookup and nothing else:
// the interpreter still runs with its optimisations on.

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <mono/metadata/appdomain.h>
#include <mono/metadata/assembly.h>
#include <mono/metadata/class.h>
#include <mono/metadata/exception.h>
#include <mono/metadata/loader.h>
#include <mono/metadata/mono-debug.h>
#include <mono/metadata/object.h>
#include <mono/utils/mono-publib.h>

#include <driver.h>

#include "bridge.h"
#include "sandbox.h"

// The runtime pack's own entry points, declared here for the same reason its `main.c` declares
// them: they are the embedding API, and the pack ships no header that names all three.
extern MonoAssembly *mono_wasm_assembly_load(const char *name);
extern MonoMethod *mono_wasi_assembly_get_entry_point(MonoAssembly *assembly);
extern void mono_bundled_resources_add_assembly_resource(const char *id, const char *name,
                                                         const uint8_t *data, uint32_t size,
                                                         void (*free_func)(void *, void *),
                                                         void *free_data);

// The name the model's assembly is registered and loaded under.
//
// A fixed name, because there is exactly one program per component instance and gg makes a fresh
// instance per program: nothing here is ever asked to hold two. It is also what the host compiles
// to, so `csharp.compile.rs` names the same string.
#define GG_PROGRAM_ASSEMBLY "GgProgram.dll"

// The name gg's own SDK is registered and loaded under, and the one library every program in this
// manifest references. `csharp.compile.rs` names the same string.
#define GG_SDK_ASSEMBLY "Gg.dll"

// ---------------------------------------------------------------------------------------------
// The program's transport
// ---------------------------------------------------------------------------------------------

/// The base64 alphabet's value for one character, or `-1` for anything that is not in it —
/// including the padding, which carries no bits and is skipped rather than decoded.
static int base64_value(char character) {
  if (character >= 'A' && character <= 'Z') return character - 'A';
  if (character >= 'a' && character <= 'z') return character - 'a' + 26;
  if (character >= '0' && character <= '9') return character - '0' + 52;
  if (character == '+') return 62;
  if (character == '/') return 63;
  return -1;
}

/// Decode the program's transport encoding into the IL the interpreter loads.
///
/// **Base64 is not decoration and not a wrapper this arm could have skipped.** The world's `program`
/// is a `string`, which the canonical ABI defines as UTF-8, and an IL assembly is a PE image whose
/// first two bytes are `MZ` and whose body is arbitrary. Widening the parameter to `list<u8>` would
/// change the wire for every arm and force a rebuild of every committed component to say one thing
/// about one language.
///
/// Anything outside the alphabet is skipped rather than refused, so that whitespace the host may
/// have wrapped the payload in costs nothing. The host is the only writer of this string and it
/// writes standard base64; a payload this decoder disagreed with would present as an assembly the
/// runtime will not load, which is reported by name below.
static uint8_t *base64_decode(const char *text, size_t length, size_t *decoded_length) {
  uint8_t *out = (uint8_t *)malloc(length / 4 * 3 + 4);
  if (out == NULL) {
    *decoded_length = 0;
    return NULL;
  }
  size_t at = 0;
  uint32_t accumulator = 0;
  int bits = 0;
  for (size_t index = 0; index < length; index++) {
    const int value = base64_value(text[index]);
    if (value < 0) continue;
    accumulator = (accumulator << 6) | (uint32_t)value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (uint8_t)((accumulator >> bits) & 0xff);
    }
  }
  *decoded_length = at;
  return out;
}

/// **Register every assembly the manifest carries**, and say whether it held together.
///
/// The manifest is two lines per assembly — the name it is registered under, then its IL as base64 —
/// and it carries what the host's compiler was given: gg's SDK, one library per code module in the
/// agent's scope, and the model's own program. Registering them all before anything is loaded is
/// what lets the runtime resolve a reference the compiler already resolved, exactly as it resolves
/// the bundled class libraries.
///
/// Neither the name nor the decoded bytes are freed. The resource holds both for the life of this
/// instance, which is the life of this one program, and the instance's whole linear memory goes away
/// with it.
static bool register_assemblies(const char *text, size_t length) {
  size_t at = 0;
  bool any = false;
  while (at < length) {
    size_t name_end = at;
    while (name_end < length && text[name_end] != '\n') name_end++;
    // A name with nothing under it is a manifest this decoder disagrees with, which is reported by
    // the caller rather than loaded as an assembly nobody wrote.
    if (name_end == at || name_end >= length) return false;
    const size_t payload = name_end + 1;
    size_t payload_end = payload;
    while (payload_end < length && text[payload_end] != '\n') payload_end++;
    if (payload_end == payload) return false;

    char *name = (char *)malloc(name_end - at + 1);
    if (name == NULL) return false;
    memcpy(name, text + at, name_end - at);
    name[name_end - at] = '\0';

    size_t decoded_length = 0;
    uint8_t *bytes = base64_decode(text + payload, payload_end - payload, &decoded_length);
    if (bytes == NULL || decoded_length == 0) {
      free(name);
      return false;
    }
    mono_bundled_resources_add_assembly_resource(name, name, bytes, (uint32_t)decoded_length, NULL,
                                                 NULL);
    any = true;
    at = payload_end + 1;
  }
  return any;
}

/// Call one of gg's SDK's own no-argument statics, if this manifest carried the SDK at all.
///
/// Two of them are called from here. `Install` puts `Console.Out` on gg's feedback channel, and it is
/// called rather than left to the SDK's `[ModuleInitializer]` because that initializer runs when the
/// SDK's own module is first touched: a program whose first line is `Console.WriteLine` would
/// otherwise write it before anything had reached gg. `FlushPending` sends whatever the program
/// wrote and never terminated with a newline.
///
/// A manifest with no SDK in it simply has no such class, which is not an error: the substrate's own
/// tests compile programs against nothing at all.
static void sdk_console(const char *method) {
  MonoAssembly *sdk = mono_wasm_assembly_load(GG_SDK_ASSEMBLY);
  if (sdk == NULL) return;
  MonoClass *klass = mono_class_from_name(mono_assembly_get_image(sdk), "Gg.Internal",
                                          "OperatorConsole");
  if (klass == NULL) return;
  MonoMethod *found = mono_class_get_method_from_name(klass, method, 0);
  if (found == NULL) return;
  MonoObject *thrown = NULL;
  mono_runtime_invoke(found, NULL, NULL, &thrown);
}

// ---------------------------------------------------------------------------------------------
// The world's exports
// ---------------------------------------------------------------------------------------------

/// **The gg tool names this component can bind** — what `bound-operations` answers.
///
/// Read straight off `Sources/bridge.c`'s registration table, so what the artifact reports and what
/// it actually binds are one statement rather than two that can disagree. gg's drift gate compares
/// the answer with its own `ALL_TOOL_NAMES`.
void exports_sandbox_bound_operations(sandbox_list_string_t *ret) {
  const char *const *names = NULL;
  size_t count = 0;
  gg_bridge_operation_names(&names, &count);
  ret->len = count;
  ret->ptr = (sandbox_string_t *)malloc(count * sizeof(sandbox_string_t));
  for (size_t index = 0; index < count; index++) {
    sandbox_string_dup(&ret->ptr[index], names[index]);
  }
}

/// Report something that went wrong *inside* the guest as a model-facing program error.
static void report(const char *message) {
  test_cabinet_gg_feedback_program_error_t error;
  error.kind = TEST_CABINET_GG_FEEDBACK_ERROR_KIND_OTHER;
  error.code.is_some = false;
  error.location.is_some = false;
  sandbox_string_set(&error.message, message);
  test_cabinet_gg_feedback_report_error(&error);
}

/// Whether this instance has started the interpreter. Per **instance**, not per process: a
/// component instance has its own linear memory, so this is one program's boot rather than shared
/// state between two.
static bool started = false;

/// **Evaluate one program** — the sandbox world's `run`.
///
/// `program` is the manifest of named IL assemblies gg's compiler produced for this turn — gg's SDK,
/// one library per code module in the agent's scope, and the model's own program. `modules` is
/// ignored **on purpose**: a code module reaches this guest as one of those libraries, compiled and
/// referenced on the host, rather than as a source the guest evaluates.
///
/// `operations`, `ending` and `library` are ignored **on purpose and permanently**. A compiled arm
/// links its SDK as a library, so there is no scope to leave a name out of: every function is there
/// whatever a run offers, and what withholds one is the host — which refuses anything outside the
/// run's enabled set, the agent's ending role and its program-library flag `unavailable`. That is
/// the seam's own rule for a language of this shape, not a gap here.
///
/// An unhandled managed exception is caught by `mono_runtime_run_main` and reported by its own type
/// and message, which is what a C# programmer would have seen printed. It is a recoverable
/// model-facing error, not a trap: this arm has a real exception mechanism because the interpreter
/// has one, and nothing in the guest has to unwind wasm frames to use it.
///
/// **A status is a failure too, and it is read rather than discarded.** `mono_runtime_run_main`
/// hands back the entry point's own return value, which is the one way a C# program reports failure
/// without throwing and the one that walks past every `catch` there is. A non-zero status is
/// reported with the number the program chose. `Environment.ExitCode` is a different field and this
/// runtime does not fold it in; `csharp.substrate.test.rs` measures both.
void exports_sandbox_run(sandbox_string_t *program, sandbox_list_code_module_t *modules,
                         sandbox_list_string_t *operations, sandbox_ending_kind_t ending,
                         bool library) {
  (void)modules;
  (void)operations;
  (void)ending;
  (void)library;

  if (!started) {
    mono_debug_init(MONO_DEBUG_FORMAT_MONO);
    mono_wasm_load_runtime(0);
    gg_bridge_register();
    started = true;
  }

  if (!register_assemblies((const char *)program->ptr, program->len)) {
    report("the program did not arrive as a readable assembly");
    return;
  }

  MonoAssembly *assembly = mono_wasm_assembly_load(GG_PROGRAM_ASSEMBLY);
  if (assembly == NULL) {
    report("the program's assembly could not be loaded by the runtime");
    return;
  }
  MonoMethod *entry = mono_wasi_assembly_get_entry_point(assembly);
  if (entry == NULL) {
    report("the program's assembly has no entry point");
    return;
  }
  sdk_console("Install");

  // `argc` is 1 and `argv[0]` is the program's own name, which is the convention
  // `mono_runtime_run_main` reads: it takes `argv[1..]` as the managed `string[] args`, so this is
  // an entry point invoked with no arguments.
  //
  // It is 1 rather than 0 because an entry point that DECLARES `string[] args` — which is what
  // Roslyn generates for **top-level statements**, the shape a model reaches for first — asserts
  // inside the runtime when told there is no `argv[0]` to take the program's path from. With 0 the
  // arm accepted only an explicit `Main()`, and a model writing the modern idiom got a trap rather
  // than a program.
  MonoObject *thrown = NULL;
  char *argv[1] = {(char *)"program"};
  const int status = mono_runtime_run_main(entry, 1, argv, &thrown);
  sdk_console("FlushPending");
  if (thrown == NULL) {
    // The status the program chose, said back to it with the number it chose. Nothing is added
    // about what to do instead: a program that returns a status meant to, and what it needs told is
    // that gg read it.
    if (status != 0) {
      char message[128];
      snprintf(message, sizeof message, "the program's entry point returned %d", status);
      report(message);
    }
    return;
  }

  // `ToString()` on an exception is what .NET itself prints for an unhandled one: the full type
  // name, the message, and the managed stack trace. It is taken whole rather than reassembled from
  // the type and the message, because the stack trace is the half a model can act on — and the
  // interpreter has one, which no other compiled arm here can say.
  MonoObject *while_stringifying = NULL;
  MonoString *rendered = mono_object_to_string(thrown, &while_stringifying);
  if (rendered == NULL || while_stringifying != NULL) {
    MonoClass *klass = mono_object_get_class(thrown);
    char message[512];
    snprintf(message, sizeof message, "uncaught %s.%s", mono_class_get_namespace(klass),
             mono_class_get_name(klass));
    report(message);
    return;
  }
  char *utf8 = mono_string_to_utf8(rendered);
  report(utf8);
  mono_free(utf8);
}
