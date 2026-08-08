// The **shell** a model's C# program runs inside: what the sandbox world's two exports do, how the
// Mono IL interpreter is started, and how the program's own `Main` is reached.
//
// It is compiled once, at build time, into the committed `guests/csharp.component.wasm` — not per
// turn, and nothing here is a function of any one program. What crosses the membrane every turn is
// an **IL assembly**, base64-encoded into the world's `program` parameter, which this file decodes,
// registers with the runtime as a bundled resource and loads by name.
//
// It is not the SDK. Nothing here is model-facing and nothing here is in a signature catalogue; a
// program written by a model will call the curated surface this arm's SDK step adds, which will be
// a managed assembly whose methods land on the internal calls registered below.
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
// instance that is created and never driven — an instantiation gg makes to read `bound-tools` — has
// no reason to pay for it.

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
#include <mono/metadata/object.h>
#include <mono/utils/mono-publib.h>

#include <driver.h>

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

// ---------------------------------------------------------------------------------------------
// The bridge a managed program reaches gg through
// ---------------------------------------------------------------------------------------------
//
// Two functions, and they are the substrate's proof rather than the surface: one that says
// something and one that asks something, so both directions of the membrane are driven by a real
// C# program. The SDK step replaces this with the whole surface, generated the same way — an
// internal call per gg function, each landing on the `wit-bindgen` binding for it.
//
// The managed declarations these answer to are `Gg.Native::Log` and `Gg.Native::ReadFile`. Mono
// resolves an internal call by that `Namespace.Class::Method` string against the method's
// `MethodImplOptions.InternalCall` declaration, wherever the declaration lives — which is why a
// substrate test can declare them inside the program under test and needs no assembly gg shipped.

/// `gg.log` — a line the model reads back in its own transcript.
static void gg_log(MonoString *line) {
  char *utf8 = mono_string_to_utf8(line);
  sandbox_string_t owned;
  sandbox_string_set(&owned, utf8);
  test_cabinet_gg_feedback_log(&owned);
  mono_free(utf8);
}

/// `read_file` — the shortest round trip this arm has that is not a bare string.
///
/// A failure is raised as a managed `IOException` rather than returned, because an exception is what
/// C# does with a call that failed and because it is what the SDK will do with every gg error code.
/// A picture comes back as the empty string: the substrate has no type to hand a model for one, and
/// the SDK's `read_file` will return the union the wire declares.
static MonoString *gg_read_file(MonoString *path) {
  char *utf8 = mono_string_to_utf8(path);
  sandbox_string_t owned;
  sandbox_string_set(&owned, utf8);
  test_cabinet_gg_files_file_read_t read;
  test_cabinet_gg_files_tool_error_t failure;
  const bool ok = test_cabinet_gg_files_read_file(&owned, NULL, NULL, &read, &failure);
  mono_free(utf8);
  if (!ok) {
    char message[512];
    snprintf(message, sizeof message, "%.*s", (int)failure.message.len,
             (const char *)failure.message.ptr);
    mono_raise_exception(mono_get_exception_io(message));
    return NULL;
  }
  if (read.tag != TEST_CABINET_GG_FILES_FILE_READ_TEXT) {
    return mono_string_new(mono_domain_get(), "");
  }
  char *contents = (char *)malloc(read.val.text.contents.len + 1);
  memcpy(contents, read.val.text.contents.ptr, read.val.text.contents.len);
  contents[read.val.text.contents.len] = '\0';
  MonoString *result = mono_string_new(mono_domain_get(), contents);
  free(contents);
  return result;
}

// ---------------------------------------------------------------------------------------------
// The world's exports
// ---------------------------------------------------------------------------------------------

/// **The gg tool names this component can bind** — what `bound-tools` answers.
///
/// **Empty, and it is an honest empty rather than a stub.** This arm has no SDK yet: nothing in a
/// program's scope dispatches a gg tool by name, so there is no name to report. The drift gate that
/// compares a registered arm's answer with gg's own `ALL_TOOL_NAMES` does not run against this arm,
/// because this arm is not registered — and when the SDK lands, this becomes a concatenation of the
/// SDK's own per-object tables, so that what the artifact reports and what the SDK declares are one
/// statement rather than two that can disagree.
void exports_sandbox_bound_tools(sandbox_list_string_t *ret) {
  ret->ptr = NULL;
  ret->len = 0;
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
/// `program` is the model's compiled assembly, base64-encoded. `modules`, `tools`, `ending` and
/// `library` are ignored here and will not be once the SDK lands: on this arm what a program may
/// *call* is decided at compile time by which SDK assembly the host referenced, with the host
/// checking every call regardless — the same shape every compiled arm has — and code modules are
/// assemblies referenced at that compile rather than sources evaluated here.
///
/// An unhandled managed exception is caught by `mono_runtime_run_main` and reported by its own type
/// and message, which is what a C# programmer would have seen printed. It is a recoverable
/// model-facing error, not a trap: this arm has a real exception mechanism because the interpreter
/// has one, and nothing in the guest has to unwind wasm frames to use it.
void exports_sandbox_run(sandbox_string_t *program, sandbox_list_code_module_t *modules,
                         sandbox_list_string_t *tools, sandbox_ending_kind_t ending, bool library) {
  (void)modules;
  (void)tools;
  (void)ending;
  (void)library;

  if (!started) {
    mono_wasm_load_runtime(0);
    mono_add_internal_call("Gg.Native::Log", (const void *)gg_log);
    mono_add_internal_call("Gg.Native::ReadFile", (const void *)gg_read_file);
    started = true;
  }

  size_t assembly_length = 0;
  uint8_t *assembly_bytes =
      base64_decode((const char *)program->ptr, program->len, &assembly_length);
  if (assembly_bytes == NULL || assembly_length == 0) {
    report("the program did not arrive as a readable assembly");
    return;
  }
  // No free function: the resource is registered for the life of this instance, which is the life of
  // this one program, and the instance's whole linear memory goes away with it.
  mono_bundled_resources_add_assembly_resource(GG_PROGRAM_ASSEMBLY, GG_PROGRAM_ASSEMBLY,
                                               assembly_bytes, (uint32_t)assembly_length, NULL,
                                               NULL);

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

  MonoObject *thrown = NULL;
  char *argv[1] = {(char *)"program"};
  mono_runtime_run_main(entry, 0, argv, &thrown);
  if (thrown == NULL) return;

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
