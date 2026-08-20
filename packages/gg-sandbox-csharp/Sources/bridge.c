// **The membrane, from the managed side** — one Mono internal call per gg function, each landing on
// the `wit-bindgen` binding for it.
//
// Nothing here is model-facing. What a model reads is `src/Gg/`, whose XML documentation comments
// are the whole of this arm's signature catalogue; this file is the lowering underneath it, and the
// two are held together by name: every `mono_add_internal_call` string below is the
// `Gg.Internal.Native::<Name>` an `extern` in `src/Gg/Internal/Native.cs` declares, and Mono resolves
// the pair by that string alone.
//
// # Why the managed half assembles the records and this half does not
//
// The canonical ABI has records, variants, options and lists; a Mono internal call has scalars,
// strings and arrays. The alternative to what is here is constructing managed objects from C —
// `mono_class_from_name`, `mono_object_new`, a field handle per property — which would put the SDK's
// own field layout inside a C file and break it *silently* the day a property is renamed. So this
// half writes primitives into `out` parameters, the SDK assembles the public record from them, and a
// mismatch between the two is a **compile error in the SDK** rather than a wrong value at run time.
//
// Four conventions carry all of it, and `src/Gg/Internal/Native.cs` states the same four:
//
//   * an absent `option<u32>`/`option<u64>` is `-1` in an `int64_t`, which no `u32` can be;
//   * an absent `option<s32>` — where `-1` is a real value — gets its own `MonoBoolean *has…`;
//   * an absent `option<f64>` is NaN, and an absent `option<string>` is a NULL `MonoString *`;
//   * a `list<record>` is lowered as one array per field, of equal length.
//
// # The error register
//
// Every fallible call returns `false` and parks its `api-error` in [`parked`], which `TakeError`
// reads back and the SDK turns into a thrown `ApiException`. It is a register rather than three
// more `out` parameters on all forty of them because a failure is the same three fields everywhere,
// and it is safe because a program is single-threaded and every call is synchronous: there is no
// second call that could overwrite it between the `false` and the `TakeError`.

#include <math.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <mono/metadata/appdomain.h>
#include <mono/metadata/class.h>
#include <mono/metadata/loader.h>
#include <mono/metadata/object.h>
#include <mono/utils/mono-publib.h>

#include "bridge.h"
#include "sandbox.h"

// ---------------------------------------------------------------------------------------------
// Lifting and lowering
// ---------------------------------------------------------------------------------------------

/// A `MonoString *` as UTF-8 the caller must release, or NULL for a null managed string.
static char *lift(MonoString *text) { return text == NULL ? NULL : mono_string_to_utf8(text); }

/// A borrowed `sandbox_string_t` over UTF-8 this function still owns.
static sandbox_string_t borrow(const char *utf8) {
  sandbox_string_t owned;
  sandbox_string_set(&owned, (char *)(utf8 == NULL ? "" : utf8));
  return owned;
}

/// A `sandbox_string_t` as a managed string. The empty string rather than null for an absent one:
/// every field lowered this way is declared non-nullable in the SDK.
static MonoString *lower(const sandbox_string_t *text) {
  return mono_string_new_len(mono_domain_get(), (const char *)text->ptr, (unsigned int)text->len);
}

/// A `sandbox_string_t` as a managed string, or managed null when the option is absent.
static MonoString *lower_option(const sandbox_option_string_t *text) {
  return text->is_some ? lower(&text->val) : NULL;
}

/// An `option<u32>` argument: a pointer to the value, or NULL when the SDK passed `-1`.
static uint32_t *maybe_u32(int32_t slot, uint32_t *storage) {
  if (slot < 0) return NULL;
  *storage = (uint32_t)slot;
  return storage;
}

/// An `option<f64>` argument: a pointer to the value, or NULL when the SDK passed NaN.
static double *maybe_f64(double slot, double *storage) {
  if (isnan(slot)) return NULL;
  *storage = slot;
  return storage;
}

/// An `option<u32>` result: the value, or `-1` for absent.
static int64_t slot_u32(const sandbox_option_u32_t *value) {
  return value->is_some ? (int64_t)value->val : -1;
}

/// A managed `string[]` lowered into a `list<string>` this function still owns.
typedef struct {
  sandbox_list_string_t list;
  char **utf8;
} borrowed_list_t;

static borrowed_list_t borrow_list(MonoArray *array) {
  borrowed_list_t borrowed = {{NULL, 0}, NULL};
  if (array == NULL) return borrowed;
  const size_t count = (size_t)mono_array_length(array);
  borrowed.list.len = count;
  if (count == 0) return borrowed;
  borrowed.list.ptr = (sandbox_string_t *)calloc(count, sizeof(sandbox_string_t));
  borrowed.utf8 = (char **)calloc(count, sizeof(char *));
  for (size_t index = 0; index < count; index++) {
    borrowed.utf8[index] = lift(mono_array_get(array, MonoString *, index));
    borrowed.list.ptr[index] = borrow(borrowed.utf8[index]);
  }
  return borrowed;
}

static void release_list(borrowed_list_t *borrowed) {
  for (size_t index = 0; index < borrowed->list.len; index++) {
    if (borrowed->utf8[index] != NULL) mono_free(borrowed->utf8[index]);
  }
  free(borrowed->utf8);
  free(borrowed->list.ptr);
}

/// A `list<string>` result as a managed `string[]`.
static MonoArray *lower_strings(const sandbox_list_string_t *list) {
  MonoDomain *domain = mono_domain_get();
  MonoArray *array = mono_array_new(domain, mono_get_string_class(), list->len);
  for (size_t index = 0; index < list->len; index++) {
    mono_array_setref(array, index, lower(&list->ptr[index]));
  }
  return array;
}

// The typed arrays a `list<record>` is lowered into, one per field.
#define GG_ARRAY(name, klass, type)                                        \
  static MonoArray *name(size_t count) {                                   \
    return mono_array_new(mono_domain_get(), klass(), count);              \
  }                                                                        \
  static void name##_set(MonoArray *array, size_t index, type value) {     \
    mono_array_set(array, type, index, value);                             \
  }

GG_ARRAY(int_array, mono_get_int32_class, int32_t)
GG_ARRAY(uint_array, mono_get_uint32_class, uint32_t)
GG_ARRAY(ulong_array, mono_get_uint64_class, uint64_t)
GG_ARRAY(long_array, mono_get_int64_class, int64_t)
GG_ARRAY(bool_array, mono_get_boolean_class, uint8_t)

static MonoArray *string_array(size_t count) {
  return mono_array_new(mono_domain_get(), mono_get_string_class(), count);
}

// ---------------------------------------------------------------------------------------------
// The error register
// ---------------------------------------------------------------------------------------------

/// The failure the last call parked, read back by `TakeError` and never by anything else.
static struct {
  int32_t code;
  char *operation;
  char *message;
} parked = {0, NULL, NULL};

/// Take ownership of an `api-error` and free the wire's copy of it.
static void park(test_cabinet_gg_types_api_error_t *failure) {
  free(parked.operation);
  free(parked.message);
  parked.code = (int32_t)failure->code;
  parked.operation = strndup((const char *)failure->operation.ptr, failure->operation.len);
  parked.message = strndup((const char *)failure->message.ptr, failure->message.len);
  test_cabinet_gg_types_api_error_free(failure);
}

static void gg_take_error(int32_t *code, MonoString **operation, MonoString **message) {
  MonoDomain *domain = mono_domain_get();
  *code = parked.code;
  *operation = mono_string_new(domain, parked.operation == NULL ? "" : parked.operation);
  *message = mono_string_new(domain, parked.message == NULL ? "" : parked.message);
}

// ---------------------------------------------------------------------------------------------
// feedback
// ---------------------------------------------------------------------------------------------

/// One line to the run's operator log — where `Console.Out` is redirected.
static void gg_log(MonoString *line) {
  char *utf8 = lift(line);
  sandbox_string_t owned = borrow(utf8);
  test_cabinet_gg_feedback_log(&owned);
  if (utf8 != NULL) mono_free(utf8);
}

// ---------------------------------------------------------------------------------------------
// system
// ---------------------------------------------------------------------------------------------

static MonoBoolean gg_shell(MonoString *command, double timeout_seconds,
                            MonoBoolean *has_exit_code, int32_t *exit_code, MonoString **output,
                            MonoBoolean *truncated) {
  char *utf8 = lift(command);
  sandbox_string_t owned = borrow(utf8);
  double timeout_storage = 0;
  test_cabinet_gg_shell_shell_output_t result;
  test_cabinet_gg_shell_api_error_t failure;
  const bool ok = test_cabinet_gg_shell_shell(
      &owned, maybe_f64(timeout_seconds, &timeout_storage), &result, &failure);
  if (utf8 != NULL) mono_free(utf8);
  if (!ok) {
    park(&failure);
    return 0;
  }
  *has_exit_code = result.exit_code.is_some ? 1 : 0;
  *exit_code = result.exit_code.is_some ? result.exit_code.val : 0;
  *output = lower(&result.output);
  *truncated = result.truncated ? 1 : 0;
  test_cabinet_gg_shell_shell_output_free(&result);
  return 1;
}

// ---------------------------------------------------------------------------------------------
// files
// ---------------------------------------------------------------------------------------------

/// The one lowering `fs.ReadFile` and `view.OpenFile` share: a `file-read` is a two-arm variant, and
/// the SDK builds whichever record `kind` names out of that arm's fields.
///
/// Its six NUMBERS come back as one array — `[first-line, last-line, total-lines, byte-truncated,
/// bytes, shown]` — rather than as six `out` parameters, and that is the interpreter's doing rather
/// than a preference: an internal call with fourteen arguments is one Mono's interpreter refuses to
/// build a frame for at all, aborting the guest from inside `get_build_args_from_sig_info`. The
/// strings stay named, because they are the half a misplacement would corrupt silently.
static void lower_file_read(const test_cabinet_gg_files_file_read_t *read, int32_t *kind,
                            MonoString **contents, MonoString **media_type, MonoString **label,
                            MonoString **not_shown_reason, MonoArray **numbers) {
  MonoDomain *domain = mono_domain_get();
  MonoArray *values = long_array(6);
  if (read->tag == TEST_CABINET_GG_FILES_FILE_READ_TEXT) {
    *kind = 0;
    *contents = lower(&read->val.text.contents);
    long_array_set(values, 0, read->val.text.first_line);
    long_array_set(values, 1, read->val.text.last_line);
    long_array_set(values, 2, read->val.text.total_lines);
    long_array_set(values, 3, read->val.text.byte_truncated ? 1 : 0);
    long_array_set(values, 4, 0);
    long_array_set(values, 5, 0);
    *media_type = mono_string_new(domain, "");
    *label = mono_string_new(domain, "");
    *not_shown_reason = NULL;
    *numbers = values;
    return;
  }
  *kind = 1;
  *contents = mono_string_new(domain, "");
  long_array_set(values, 0, 0);
  long_array_set(values, 1, 0);
  long_array_set(values, 2, 0);
  long_array_set(values, 3, 0);
  long_array_set(values, 4, (int64_t)read->val.image.bytes);
  long_array_set(values, 5, read->val.image.shown ? 1 : 0);
  *media_type = lower(&read->val.image.media_type);
  *label = lower(&read->val.image.label);
  *not_shown_reason = lower_option(&read->val.image.not_shown_reason);
  *numbers = values;
}

static MonoBoolean gg_read_file(MonoString *path, int32_t offset, int32_t limit, int32_t *kind,
                                MonoString **contents, MonoString **media_type, MonoString **label,
                                MonoString **not_shown_reason, MonoArray **numbers) {
  char *utf8 = lift(path);
  sandbox_string_t owned = borrow(utf8);
  uint32_t offset_storage = 0;
  uint32_t limit_storage = 0;
  test_cabinet_gg_files_file_read_t read;
  test_cabinet_gg_files_api_error_t failure;
  const bool ok =
      test_cabinet_gg_files_read_file(&owned, maybe_u32(offset, &offset_storage),
                                      maybe_u32(limit, &limit_storage), &read, &failure);
  if (utf8 != NULL) mono_free(utf8);
  if (!ok) {
    park(&failure);
    return 0;
  }
  lower_file_read(&read, kind, contents, media_type, label, not_shown_reason, numbers);
  test_cabinet_gg_files_file_read_free(&read);
  return 1;
}

static MonoBoolean gg_read_text_file(MonoString *path, int32_t offset, int32_t limit,
                                     MonoString **contents) {
  char *utf8 = lift(path);
  sandbox_string_t owned = borrow(utf8);
  uint32_t offset_storage = 0;
  uint32_t limit_storage = 0;
  sandbox_string_t result;
  test_cabinet_gg_helpers_api_error_t failure;
  const bool ok =
      test_cabinet_gg_helpers_read_text_file(&owned, maybe_u32(offset, &offset_storage),
                                             maybe_u32(limit, &limit_storage), &result, &failure);
  if (utf8 != NULL) mono_free(utf8);
  if (!ok) {
    park(&failure);
    return 0;
  }
  *contents = lower(&result);
  sandbox_string_free(&result);
  return 1;
}

static MonoBoolean gg_write_file(MonoString *path, MonoString *contents, uint64_t *written) {
  char *path_utf8 = lift(path);
  char *contents_utf8 = lift(contents);
  sandbox_string_t owned_path = borrow(path_utf8);
  sandbox_string_t owned_contents = borrow(contents_utf8);
  test_cabinet_gg_files_api_error_t failure;
  const bool ok =
      test_cabinet_gg_files_write_file(&owned_path, &owned_contents, written, &failure);
  if (path_utf8 != NULL) mono_free(path_utf8);
  if (contents_utf8 != NULL) mono_free(contents_utf8);
  if (!ok) park(&failure);
  return ok ? 1 : 0;
}

static MonoBoolean gg_edit_file(MonoString *path, MonoString *old_string, MonoString *new_string) {
  char *path_utf8 = lift(path);
  char *old_utf8 = lift(old_string);
  char *new_utf8 = lift(new_string);
  sandbox_string_t owned_path = borrow(path_utf8);
  sandbox_string_t owned_old = borrow(old_utf8);
  sandbox_string_t owned_new = borrow(new_utf8);
  test_cabinet_gg_files_api_error_t failure;
  const bool ok =
      test_cabinet_gg_files_edit_file(&owned_path, &owned_old, &owned_new, &failure);
  if (path_utf8 != NULL) mono_free(path_utf8);
  if (old_utf8 != NULL) mono_free(old_utf8);
  if (new_utf8 != NULL) mono_free(new_utf8);
  if (!ok) park(&failure);
  return ok ? 1 : 0;
}

static MonoBoolean gg_list_dir(MonoString *path, MonoArray **names, MonoArray **kinds) {
  char *utf8 = lift(path);
  sandbox_string_t owned = borrow(utf8);
  test_cabinet_gg_files_list_dir_entry_t result;
  test_cabinet_gg_files_api_error_t failure;
  const bool ok =
      test_cabinet_gg_files_list_dir(utf8 == NULL ? NULL : &owned, &result, &failure);
  if (utf8 != NULL) mono_free(utf8);
  if (!ok) {
    park(&failure);
    return 0;
  }
  *names = string_array(result.len);
  *kinds = int_array(result.len);
  for (size_t index = 0; index < result.len; index++) {
    mono_array_setref(*names, index, lower(&result.ptr[index].name));
    int_array_set(*kinds, index, (int32_t)result.ptr[index].kind);
  }
  test_cabinet_gg_files_list_dir_entry_free(&result);
  return 1;
}

// ---------------------------------------------------------------------------------------------
// skills
// ---------------------------------------------------------------------------------------------

static MonoBoolean gg_read_skill(MonoString *name, MonoString **body) {
  char *utf8 = lift(name);
  sandbox_string_t owned = borrow(utf8);
  sandbox_string_t result;
  test_cabinet_gg_skills_api_error_t failure;
  const bool ok = test_cabinet_gg_skills_read_skill(&owned, &result, &failure);
  if (utf8 != NULL) mono_free(utf8);
  if (!ok) {
    park(&failure);
    return 0;
  }
  *body = lower(&result);
  sandbox_string_free(&result);
  return 1;
}

// ---------------------------------------------------------------------------------------------
// memories
// ---------------------------------------------------------------------------------------------

static void lower_memory_usage(const test_cabinet_gg_memories_memory_usage_t *usage,
                               uint32_t *count, int64_t *max_count, uint32_t *total_chars,
                               int64_t *max_total_chars, int64_t *index_chars,
                               int64_t *max_index_chars) {
  *count = usage->count;
  *max_count = slot_u32(&usage->max_count);
  *total_chars = usage->total_chars;
  *max_total_chars = slot_u32(&usage->max_total_chars);
  *index_chars = slot_u32(&usage->index_chars);
  *max_index_chars = slot_u32(&usage->max_index_chars);
}

static MonoBoolean gg_record_memory(int32_t strategy, MonoString *name, MonoString *description,
                                    MonoString *body, MonoString *code, MonoString *on_use,
                                    uint32_t *count, int64_t *max_count, uint32_t *total_chars,
                                    int64_t *max_total_chars, int64_t *index_chars,
                                    int64_t *max_index_chars) {
  char *name_utf8 = lift(name);
  char *description_utf8 = lift(description);
  char *body_utf8 = lift(body);
  char *code_utf8 = lift(code);
  char *on_use_utf8 = lift(on_use);
  test_cabinet_gg_memories_memory_input_t input;
  input.name = borrow(name_utf8);
  input.description = borrow(description_utf8);
  input.body = borrow(body_utf8);
  input.code.is_some = code_utf8 != NULL;
  if (code_utf8 != NULL) input.code.val = borrow(code_utf8);
  input.on_use.is_some = on_use_utf8 != NULL;
  if (on_use_utf8 != NULL) input.on_use.val = borrow(on_use_utf8);
  test_cabinet_gg_memories_memory_usage_t usage;
  test_cabinet_gg_memories_api_error_t failure;
  bool ok;
  switch (strategy) {
    case 0:
      ok = test_cabinet_gg_memories_write_memory(&input, &usage, &failure);
      break;
    case 1:
      ok = test_cabinet_gg_memories_update_memory(&input, &usage, &failure);
      break;
    default:
      ok = test_cabinet_gg_memories_create_memory(&input, &usage, &failure);
      break;
  }
  if (name_utf8 != NULL) mono_free(name_utf8);
  if (description_utf8 != NULL) mono_free(description_utf8);
  if (body_utf8 != NULL) mono_free(body_utf8);
  if (code_utf8 != NULL) mono_free(code_utf8);
  if (on_use_utf8 != NULL) mono_free(on_use_utf8);
  if (!ok) {
    park(&failure);
    return 0;
  }
  lower_memory_usage(&usage, count, max_count, total_chars, max_total_chars, index_chars,
                     max_index_chars);
  return 1;
}

static MonoBoolean gg_read_memory(MonoString *name, MonoString **body) {
  char *utf8 = lift(name);
  sandbox_string_t owned = borrow(utf8);
  sandbox_string_t result;
  test_cabinet_gg_memories_api_error_t failure;
  const bool ok = test_cabinet_gg_memories_read_memory(&owned, &result, &failure);
  if (utf8 != NULL) mono_free(utf8);
  if (!ok) {
    park(&failure);
    return 0;
  }
  *body = lower(&result);
  sandbox_string_free(&result);
  return 1;
}

static MonoBoolean gg_edit_memory(MonoString *name, MonoString *search, MonoString *replace,
                                  uint32_t *count, int64_t *max_count, uint32_t *total_chars,
                                  int64_t *max_total_chars, int64_t *index_chars,
                                  int64_t *max_index_chars) {
  char *name_utf8 = lift(name);
  char *search_utf8 = lift(search);
  char *replace_utf8 = lift(replace);
  test_cabinet_gg_memories_memory_edit_t edit;
  edit.name = borrow(name_utf8);
  edit.search = borrow(search_utf8);
  edit.replace = borrow(replace_utf8);
  test_cabinet_gg_memories_memory_usage_t usage;
  test_cabinet_gg_memories_api_error_t failure;
  const bool ok = test_cabinet_gg_memories_edit_memory(&edit, &usage, &failure);
  if (name_utf8 != NULL) mono_free(name_utf8);
  if (search_utf8 != NULL) mono_free(search_utf8);
  if (replace_utf8 != NULL) mono_free(replace_utf8);
  if (!ok) {
    park(&failure);
    return 0;
  }
  lower_memory_usage(&usage, count, max_count, total_chars, max_total_chars, index_chars,
                     max_index_chars);
  return 1;
}

static MonoBoolean gg_search_memories(MonoArray *keywords, MonoArray **names,
                                      MonoArray **descriptions, MonoArray **matched,
                                      MonoArray **occurrences, MonoArray **excerpts) {
  borrowed_list_t borrowed = borrow_list(keywords);
  test_cabinet_gg_memories_list_memory_hit_t result;
  test_cabinet_gg_memories_api_error_t failure;
  const bool ok = test_cabinet_gg_memories_search_memories(&borrowed.list, &result, &failure);
  release_list(&borrowed);
  if (!ok) {
    park(&failure);
    return 0;
  }
  *names = string_array(result.len);
  *descriptions = string_array(result.len);
  *matched = uint_array(result.len);
  *occurrences = uint_array(result.len);
  *excerpts = string_array(result.len);
  for (size_t index = 0; index < result.len; index++) {
    mono_array_setref(*names, index, lower(&result.ptr[index].name));
    mono_array_setref(*descriptions, index, lower(&result.ptr[index].description));
    uint_array_set(*matched, index, result.ptr[index].matched);
    uint_array_set(*occurrences, index, result.ptr[index].occurrences);
    mono_array_setref(*excerpts, index, lower(&result.ptr[index].excerpt));
  }
  test_cabinet_gg_memories_list_memory_hit_free(&result);
  return 1;
}

static MonoBoolean gg_delete_memory(MonoString *name, uint32_t *count, int64_t *max_count,
                                    uint32_t *total_chars, int64_t *max_total_chars,
                                    int64_t *index_chars, int64_t *max_index_chars) {
  char *utf8 = lift(name);
  sandbox_string_t owned = borrow(utf8);
  test_cabinet_gg_memories_memory_usage_t usage;
  test_cabinet_gg_memories_api_error_t failure;
  const bool ok = test_cabinet_gg_memories_delete_memory(&owned, &usage, &failure);
  if (utf8 != NULL) mono_free(utf8);
  if (!ok) {
    park(&failure);
    return 0;
  }
  lower_memory_usage(&usage, count, max_count, total_chars, max_total_chars, index_chars,
                     max_index_chars);
  return 1;
}

// ---------------------------------------------------------------------------------------------
// tasks
// ---------------------------------------------------------------------------------------------

/// The `text-edit` three-way, as the SDK's `TextEdit` lowered it: 0 keep, 1 clear, 2 set.
static test_cabinet_gg_types_text_edit_t text_edit(int32_t kind, const char *text) {
  test_cabinet_gg_types_text_edit_t edit;
  switch (kind) {
    case 1:
      edit.tag = TEST_CABINET_GG_TYPES_TEXT_EDIT_CLEAR;
      break;
    case 2:
      edit.tag = TEST_CABINET_GG_TYPES_TEXT_EDIT_SET;
      edit.val.set = borrow(text);
      break;
    default:
      edit.tag = TEST_CABINET_GG_TYPES_TEXT_EDIT_KEEP;
      break;
  }
  return edit;
}

static MonoBoolean gg_add_task(MonoString *id, MonoString *title, MonoString *description,
                               MonoArray *blocked_by, uint32_t *count, uint32_t *max_tasks) {
  char *id_utf8 = lift(id);
  char *title_utf8 = lift(title);
  char *description_utf8 = lift(description);
  borrowed_list_t borrowed = borrow_list(blocked_by);
  test_cabinet_gg_tasks_task_input_t input;
  input.id = borrow(id_utf8);
  input.title = borrow(title_utf8);
  input.description.is_some = description_utf8 != NULL;
  if (description_utf8 != NULL) input.description.val = borrow(description_utf8);
  input.blocked_by = borrowed.list;
  test_cabinet_gg_tasks_task_usage_t usage;
  test_cabinet_gg_tasks_api_error_t failure;
  const bool ok = test_cabinet_gg_tasks_add_task(&input, &usage, &failure);
  if (id_utf8 != NULL) mono_free(id_utf8);
  if (title_utf8 != NULL) mono_free(title_utf8);
  if (description_utf8 != NULL) mono_free(description_utf8);
  release_list(&borrowed);
  if (!ok) {
    park(&failure);
    return 0;
  }
  *count = usage.count;
  *max_tasks = usage.max_tasks;
  return 1;
}

static MonoBoolean gg_update_task(MonoString *id, MonoString *title, int32_t description_edit,
                                  MonoString *description_text, int32_t status) {
  char *id_utf8 = lift(id);
  char *title_utf8 = lift(title);
  char *description_utf8 = lift(description_text);
  sandbox_string_t owned_id = borrow(id_utf8);
  test_cabinet_gg_tasks_task_patch_t patch;
  patch.title.is_some = title_utf8 != NULL;
  if (title_utf8 != NULL) patch.title.val = borrow(title_utf8);
  patch.description = text_edit(description_edit, description_utf8);
  patch.status.is_some = status >= 0;
  patch.status.val = (test_cabinet_gg_tasks_task_status_t)(status < 0 ? 0 : status);
  test_cabinet_gg_tasks_api_error_t failure;
  const bool ok = test_cabinet_gg_tasks_update_task(&owned_id, &patch, &failure);
  if (id_utf8 != NULL) mono_free(id_utf8);
  if (title_utf8 != NULL) mono_free(title_utf8);
  if (description_utf8 != NULL) mono_free(description_utf8);
  if (!ok) park(&failure);
  return ok ? 1 : 0;
}

static MonoBoolean gg_set_blocked_by(MonoString *id, MonoArray *blocked_by) {
  char *utf8 = lift(id);
  sandbox_string_t owned = borrow(utf8);
  borrowed_list_t borrowed = borrow_list(blocked_by);
  test_cabinet_gg_tasks_api_error_t failure;
  const bool ok = test_cabinet_gg_tasks_set_blocked_by(&owned, &borrowed.list, &failure);
  if (utf8 != NULL) mono_free(utf8);
  release_list(&borrowed);
  if (!ok) park(&failure);
  return ok ? 1 : 0;
}

static MonoBoolean gg_complete_task(MonoString *id) {
  char *utf8 = lift(id);
  sandbox_string_t owned = borrow(utf8);
  test_cabinet_gg_tasks_api_error_t failure;
  const bool ok = test_cabinet_gg_tasks_complete_task(&owned, &failure);
  if (utf8 != NULL) mono_free(utf8);
  if (!ok) park(&failure);
  return ok ? 1 : 0;
}

static MonoBoolean gg_remove_task(MonoString *id, uint32_t *count, uint32_t *max_tasks) {
  char *utf8 = lift(id);
  sandbox_string_t owned = borrow(utf8);
  test_cabinet_gg_tasks_task_usage_t usage;
  test_cabinet_gg_tasks_api_error_t failure;
  const bool ok = test_cabinet_gg_tasks_remove_task(&owned, &usage, &failure);
  if (utf8 != NULL) mono_free(utf8);
  if (!ok) {
    park(&failure);
    return 0;
  }
  *count = usage.count;
  *max_tasks = usage.max_tasks;
  return 1;
}

// ---------------------------------------------------------------------------------------------
// board
// ---------------------------------------------------------------------------------------------

static void lower_board_usage(const test_cabinet_gg_board_board_usage_t *usage, uint32_t *epics,
                              uint32_t *max_epics, uint32_t *issues, uint32_t *max_issues) {
  *epics = usage->epics;
  *max_epics = usage->max_epics;
  *issues = usage->issues;
  *max_issues = usage->max_issues;
}

/// The same four, as one array in declaration order — the shape the two calls that would otherwise
/// take too many arguments use. See [`lower_file_read`] for why the ceiling exists.
static MonoArray *board_array(const test_cabinet_gg_board_board_usage_t *usage) {
  MonoArray *values = uint_array(4);
  uint_array_set(values, 0, usage->epics);
  uint_array_set(values, 1, usage->max_epics);
  uint_array_set(values, 2, usage->issues);
  uint_array_set(values, 3, usage->max_issues);
  return values;
}

static MonoBoolean gg_create_epic(MonoString *prefix, MonoString *title, MonoString *description,
                                  MonoString **id, uint32_t *epics, uint32_t *max_epics,
                                  uint32_t *issues, uint32_t *max_issues) {
  char *prefix_utf8 = lift(prefix);
  char *title_utf8 = lift(title);
  char *description_utf8 = lift(description);
  test_cabinet_gg_board_epic_input_t input;
  input.prefix = borrow(prefix_utf8);
  input.title = borrow(title_utf8);
  input.description = borrow(description_utf8);
  test_cabinet_gg_board_epic_created_t created;
  test_cabinet_gg_board_api_error_t failure;
  const bool ok = test_cabinet_gg_board_create_epic(&input, &created, &failure);
  if (prefix_utf8 != NULL) mono_free(prefix_utf8);
  if (title_utf8 != NULL) mono_free(title_utf8);
  if (description_utf8 != NULL) mono_free(description_utf8);
  if (!ok) {
    park(&failure);
    return 0;
  }
  *id = lower(&created.id);
  lower_board_usage(&created.board, epics, max_epics, issues, max_issues);
  test_cabinet_gg_board_epic_created_free(&created);
  return 1;
}

static MonoBoolean gg_create_issue(MonoString *title, MonoString *description, MonoString *in_scope,
                                   MonoString *out_of_scope, MonoString *completion_criteria,
                                   MonoArray *blocked_by, MonoString *epic_id, MonoString *agent,
                                   MonoArray *reviewers, MonoString **id, MonoArray **board) {
  char *title_utf8 = lift(title);
  char *description_utf8 = lift(description);
  char *in_scope_utf8 = lift(in_scope);
  char *out_of_scope_utf8 = lift(out_of_scope);
  char *criteria_utf8 = lift(completion_criteria);
  char *epic_utf8 = lift(epic_id);
  char *agent_utf8 = lift(agent);
  borrowed_list_t blockers = borrow_list(blocked_by);
  borrowed_list_t reviewer_list = borrow_list(reviewers);
  test_cabinet_gg_board_issue_input_t input;
  input.title = borrow(title_utf8);
  input.description.is_some = description_utf8 != NULL;
  if (description_utf8 != NULL) input.description.val = borrow(description_utf8);
  input.in_scope = borrow(in_scope_utf8);
  input.out_of_scope = borrow(out_of_scope_utf8);
  input.completion_criteria = borrow(criteria_utf8);
  input.blocked_by = blockers.list;
  input.epic_id.is_some = epic_utf8 != NULL;
  if (epic_utf8 != NULL) input.epic_id.val = borrow(epic_utf8);
  input.agent = borrow(agent_utf8);
  input.reviewers = reviewer_list.list;
  test_cabinet_gg_board_issue_created_t created;
  test_cabinet_gg_board_api_error_t failure;
  const bool ok = test_cabinet_gg_board_create_issue(&input, &created, &failure);
  if (title_utf8 != NULL) mono_free(title_utf8);
  if (description_utf8 != NULL) mono_free(description_utf8);
  if (in_scope_utf8 != NULL) mono_free(in_scope_utf8);
  if (out_of_scope_utf8 != NULL) mono_free(out_of_scope_utf8);
  if (criteria_utf8 != NULL) mono_free(criteria_utf8);
  if (epic_utf8 != NULL) mono_free(epic_utf8);
  if (agent_utf8 != NULL) mono_free(agent_utf8);
  release_list(&blockers);
  release_list(&reviewer_list);
  if (!ok) {
    park(&failure);
    return 0;
  }
  *id = lower(&created.id);
  *board = board_array(&created.board);
  test_cabinet_gg_board_issue_created_free(&created);
  return 1;
}

static MonoBoolean gg_update_issue(MonoString *id, MonoString *title, int32_t description_edit,
                                   MonoString *description_text, MonoString *in_scope,
                                   MonoString *out_of_scope, MonoString *completion_criteria,
                                   int32_t status, int32_t epic_edit, MonoString *epic_id) {
  char *id_utf8 = lift(id);
  char *title_utf8 = lift(title);
  char *description_utf8 = lift(description_text);
  char *in_scope_utf8 = lift(in_scope);
  char *out_of_scope_utf8 = lift(out_of_scope);
  char *criteria_utf8 = lift(completion_criteria);
  char *epic_utf8 = lift(epic_id);
  sandbox_string_t owned_id = borrow(id_utf8);
  test_cabinet_gg_board_issue_patch_t patch;
  patch.title.is_some = title_utf8 != NULL;
  if (title_utf8 != NULL) patch.title.val = borrow(title_utf8);
  patch.description = text_edit(description_edit, description_utf8);
  patch.in_scope.is_some = in_scope_utf8 != NULL;
  if (in_scope_utf8 != NULL) patch.in_scope.val = borrow(in_scope_utf8);
  patch.out_of_scope.is_some = out_of_scope_utf8 != NULL;
  if (out_of_scope_utf8 != NULL) patch.out_of_scope.val = borrow(out_of_scope_utf8);
  patch.completion_criteria.is_some = criteria_utf8 != NULL;
  if (criteria_utf8 != NULL) patch.completion_criteria.val = borrow(criteria_utf8);
  patch.status.is_some = status >= 0;
  patch.status.val = (test_cabinet_gg_board_issue_status_t)(status < 0 ? 0 : status);
  switch (epic_edit) {
    case 1:
      patch.epic.tag = TEST_CABINET_GG_BOARD_EPIC_ASSIGNMENT_UNGROUP;
      break;
    case 2:
      patch.epic.tag = TEST_CABINET_GG_BOARD_EPIC_ASSIGNMENT_SET;
      patch.epic.val.set = borrow(epic_utf8);
      break;
    default:
      patch.epic.tag = TEST_CABINET_GG_BOARD_EPIC_ASSIGNMENT_KEEP;
      break;
  }
  test_cabinet_gg_board_api_error_t failure;
  const bool ok = test_cabinet_gg_board_update_issue(&owned_id, &patch, &failure);
  if (id_utf8 != NULL) mono_free(id_utf8);
  if (title_utf8 != NULL) mono_free(title_utf8);
  if (description_utf8 != NULL) mono_free(description_utf8);
  if (in_scope_utf8 != NULL) mono_free(in_scope_utf8);
  if (out_of_scope_utf8 != NULL) mono_free(out_of_scope_utf8);
  if (criteria_utf8 != NULL) mono_free(criteria_utf8);
  if (epic_utf8 != NULL) mono_free(epic_utf8);
  if (!ok) park(&failure);
  return ok ? 1 : 0;
}

static MonoBoolean gg_set_issue_blocked_by(MonoString *id, MonoArray *blocked_by) {
  char *utf8 = lift(id);
  sandbox_string_t owned = borrow(utf8);
  borrowed_list_t borrowed = borrow_list(blocked_by);
  test_cabinet_gg_board_api_error_t failure;
  const bool ok = test_cabinet_gg_board_set_issue_blocked_by(&owned, &borrowed.list, &failure);
  if (utf8 != NULL) mono_free(utf8);
  release_list(&borrowed);
  if (!ok) park(&failure);
  return ok ? 1 : 0;
}

static MonoBoolean gg_remove_from_board(int32_t epic, MonoString *id, MonoArray **board) {
  char *utf8 = lift(id);
  sandbox_string_t owned = borrow(utf8);
  test_cabinet_gg_board_board_usage_t usage;
  test_cabinet_gg_board_api_error_t failure;
  const bool ok = epic != 0 ? test_cabinet_gg_board_remove_epic(&owned, &usage, &failure)
                            : test_cabinet_gg_board_remove_issue(&owned, &usage, &failure);
  if (utf8 != NULL) mono_free(utf8);
  if (!ok) {
    park(&failure);
    return 0;
  }
  *board = board_array(&usage);
  return 1;
}

static MonoBoolean gg_wait_for_issue(MonoString *id, MonoString **acknowledgement) {
  char *utf8 = lift(id);
  sandbox_string_t owned = borrow(utf8);
  sandbox_string_t result;
  test_cabinet_gg_board_api_error_t failure;
  const bool ok = test_cabinet_gg_board_wait_for_issue(&owned, &result, &failure);
  if (utf8 != NULL) mono_free(utf8);
  if (!ok) {
    park(&failure);
    return 0;
  }
  *acknowledgement = lower(&result);
  sandbox_string_free(&result);
  return 1;
}

// ---------------------------------------------------------------------------------------------
// context
// ---------------------------------------------------------------------------------------------

static void lower_reclaim(const test_cabinet_gg_context_reclaim_report_t *report, uint32_t *items,
                          uint32_t *reclaimed_tokens, MonoArray **paths, MonoString **detail) {
  *items = report->items;
  *reclaimed_tokens = report->reclaimed_tokens;
  *paths = lower_strings(&report->paths);
  *detail = lower(&report->detail);
}

static MonoBoolean gg_evict_file_view(MonoString *path, uint32_t *items, uint32_t *reclaimed_tokens,
                                      MonoArray **paths, MonoString **detail) {
  char *utf8 = lift(path);
  sandbox_string_t owned = borrow(utf8);
  test_cabinet_gg_context_reclaim_report_t report;
  test_cabinet_gg_context_api_error_t failure;
  const bool ok =
      test_cabinet_gg_context_evict_file_view(utf8 == NULL ? NULL : &owned, &report, &failure);
  if (utf8 != NULL) mono_free(utf8);
  if (!ok) {
    park(&failure);
    return 0;
  }
  lower_reclaim(&report, items, reclaimed_tokens, paths, detail);
  test_cabinet_gg_context_reclaim_report_free(&report);
  return 1;
}

static MonoBoolean gg_archive_thread(MonoArray *starts, MonoArray *ends, uint32_t *items,
                                     uint32_t *reclaimed_tokens, MonoArray **paths,
                                     MonoString **detail) {
  const size_t count = starts == NULL ? 0 : (size_t)mono_array_length(starts);
  test_cabinet_gg_context_list_turn_range_t ranges;
  ranges.len = count;
  ranges.ptr = count == 0
                   ? NULL
                   : (test_cabinet_gg_context_turn_range_t *)calloc(
                         count, sizeof(test_cabinet_gg_context_turn_range_t));
  for (size_t index = 0; index < count; index++) {
    ranges.ptr[index].start = mono_array_get(starts, uint32_t, index);
    ranges.ptr[index].end = mono_array_get(ends, uint32_t, index);
  }
  test_cabinet_gg_context_reclaim_report_t report;
  test_cabinet_gg_context_api_error_t failure;
  const bool ok = test_cabinet_gg_context_archive_thread(&ranges, &report, &failure);
  free(ranges.ptr);
  if (!ok) {
    park(&failure);
    return 0;
  }
  lower_reclaim(&report, items, reclaimed_tokens, paths, detail);
  test_cabinet_gg_context_reclaim_report_free(&report);
  return 1;
}

static MonoBoolean gg_search_archive(MonoString *query, MonoBoolean *archive_empty,
                                     MonoArray **sequences, MonoArray **roles, MonoArray **texts) {
  char *utf8 = lift(query);
  sandbox_string_t owned = borrow(utf8);
  test_cabinet_gg_context_archive_search_t result;
  test_cabinet_gg_context_api_error_t failure;
  const bool ok = test_cabinet_gg_context_search_archive(&owned, &result, &failure);
  if (utf8 != NULL) mono_free(utf8);
  if (!ok) {
    park(&failure);
    return 0;
  }
  *archive_empty = result.archive_empty ? 1 : 0;
  *sequences = uint_array(result.hits.len);
  *roles = int_array(result.hits.len);
  *texts = string_array(result.hits.len);
  for (size_t index = 0; index < result.hits.len; index++) {
    uint_array_set(*sequences, index, result.hits.ptr[index].seq);
    int_array_set(*roles, index, (int32_t)result.hits.ptr[index].role);
    mono_array_setref(*texts, index, lower(&result.hits.ptr[index].text));
  }
  test_cabinet_gg_context_archive_search_free(&result);
  return 1;
}

static MonoBoolean gg_compact(MonoString *summary, MonoArray *files) {
  char *utf8 = lift(summary);
  sandbox_string_t owned = borrow(utf8);
  borrowed_list_t borrowed = borrow_list(files);
  test_cabinet_gg_context_api_error_t failure;
  const bool ok = test_cabinet_gg_context_compact(&owned, &borrowed.list, &failure);
  if (utf8 != NULL) mono_free(utf8);
  release_list(&borrowed);
  if (!ok) park(&failure);
  return ok ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------
// delegation
// ---------------------------------------------------------------------------------------------

static MonoBoolean gg_spawn_subagent(MonoString *agent, int32_t brief_kind, MonoString *brief,
                                     MonoString **id, MonoString **slot, MonoString **model_id) {
  char *agent_utf8 = lift(agent);
  char *brief_utf8 = lift(brief);
  test_cabinet_gg_delegation_spawn_request_t request;
  request.agent = borrow(agent_utf8);
  if (brief_kind == 1) {
    request.task.tag = TEST_CABINET_GG_DELEGATION_SUBAGENT_BRIEF_ISSUE;
    request.task.val.issue = borrow(brief_utf8);
  } else {
    request.task.tag = TEST_CABINET_GG_DELEGATION_SUBAGENT_BRIEF_PROMPT;
    request.task.val.prompt = borrow(brief_utf8);
  }
  test_cabinet_gg_delegation_subagent_handle_t handle;
  test_cabinet_gg_delegation_api_error_t failure;
  const bool ok = test_cabinet_gg_delegation_spawn_subagent(&request, &handle, &failure);
  if (agent_utf8 != NULL) mono_free(agent_utf8);
  if (brief_utf8 != NULL) mono_free(brief_utf8);
  if (!ok) {
    park(&failure);
    return 0;
  }
  *id = lower(&handle.id);
  *slot = lower(&handle.slot);
  *model_id = lower(&handle.model_id);
  test_cabinet_gg_delegation_subagent_handle_free(&handle);
  return 1;
}

static MonoBoolean gg_wait_for_subagents(MonoArray *ids, MonoArray **result_ids,
                                         MonoArray **statuses, MonoArray **summaries) {
  borrowed_list_t borrowed = borrow_list(ids);
  test_cabinet_gg_delegation_list_subagent_result_t results;
  test_cabinet_gg_delegation_api_error_t failure;
  const bool ok = test_cabinet_gg_delegation_wait_for_subagents(
      ids == NULL ? NULL : &borrowed.list, &results, &failure);
  release_list(&borrowed);
  if (!ok) {
    park(&failure);
    return 0;
  }
  *result_ids = string_array(results.len);
  *statuses = int_array(results.len);
  *summaries = string_array(results.len);
  for (size_t index = 0; index < results.len; index++) {
    mono_array_setref(*result_ids, index, lower(&results.ptr[index].id));
    int_array_set(*statuses, index,
                  results.ptr[index].status.is_some ? (int32_t)results.ptr[index].status.val : -1);
    mono_array_setref(*summaries, index, lower(&results.ptr[index].summary));
  }
  test_cabinet_gg_delegation_list_subagent_result_free(&results);
  return 1;
}

static MonoBoolean gg_send_message(MonoString *agent_id, MonoString *message) {
  char *agent_utf8 = lift(agent_id);
  char *message_utf8 = lift(message);
  sandbox_string_t owned_agent = borrow(agent_utf8);
  sandbox_string_t owned_message = borrow(message_utf8);
  test_cabinet_gg_delegation_api_error_t failure;
  const bool ok =
      test_cabinet_gg_delegation_send_message(&owned_agent, &owned_message, &failure);
  if (agent_utf8 != NULL) mono_free(agent_utf8);
  if (message_utf8 != NULL) mono_free(message_utf8);
  if (!ok) park(&failure);
  return ok ? 1 : 0;
}

static MonoBoolean gg_transition_state(MonoString *state, MonoString *note) {
  char *state_utf8 = lift(state);
  char *note_utf8 = lift(note);
  sandbox_string_t owned_state = borrow(state_utf8);
  sandbox_string_t owned_note = borrow(note_utf8);
  test_cabinet_gg_delegation_api_error_t failure;
  const bool ok = test_cabinet_gg_delegation_transition_state(
      &owned_state, note_utf8 == NULL ? NULL : &owned_note, &failure);
  if (state_utf8 != NULL) mono_free(state_utf8);
  if (note_utf8 != NULL) mono_free(note_utf8);
  if (!ok) park(&failure);
  return ok ? 1 : 0;
}

static MonoBoolean gg_exec(MonoString *agent, MonoString *prompt) {
  char *agent_utf8 = lift(agent);
  char *prompt_utf8 = lift(prompt);
  sandbox_string_t owned_agent = borrow(agent_utf8);
  sandbox_string_t owned_prompt = borrow(prompt_utf8);
  test_cabinet_gg_delegation_api_error_t failure;
  const bool ok = test_cabinet_gg_delegation_exec(
      &owned_agent, prompt_utf8 == NULL ? NULL : &owned_prompt, &failure);
  if (agent_utf8 != NULL) mono_free(agent_utf8);
  if (prompt_utf8 != NULL) mono_free(prompt_utf8);
  if (!ok) park(&failure);
  return ok ? 1 : 0;
}

static MonoBoolean gg_fork(MonoString *prompt, MonoString **id, MonoString **slot,
                           MonoString **model_id) {
  char *utf8 = lift(prompt);
  sandbox_string_t owned = borrow(utf8);
  test_cabinet_gg_delegation_subagent_handle_t handle;
  test_cabinet_gg_delegation_api_error_t failure;
  const bool ok = test_cabinet_gg_delegation_fork(&owned, &handle, &failure);
  if (utf8 != NULL) mono_free(utf8);
  if (!ok) {
    park(&failure);
    return 0;
  }
  *id = lower(&handle.id);
  *slot = lower(&handle.slot);
  *model_id = lower(&handle.model_id);
  test_cabinet_gg_delegation_subagent_handle_free(&handle);
  return 1;
}

// ---------------------------------------------------------------------------------------------
// session
// ---------------------------------------------------------------------------------------------

static MonoBoolean gg_finish(MonoString *summary) {
  char *utf8 = lift(summary);
  sandbox_string_t owned = borrow(utf8);
  test_cabinet_gg_session_api_error_t failure;
  const bool ok = test_cabinet_gg_session_finish(&owned, &failure);
  if (utf8 != NULL) mono_free(utf8);
  if (!ok) park(&failure);
  return ok ? 1 : 0;
}

static MonoBoolean gg_approve(void) {
  test_cabinet_gg_session_api_error_t failure;
  const bool ok = test_cabinet_gg_session_approve(&failure);
  if (!ok) park(&failure);
  return ok ? 1 : 0;
}

static MonoBoolean gg_request_changes(MonoArray *items) {
  borrowed_list_t borrowed = borrow_list(items);
  test_cabinet_gg_session_api_error_t failure;
  const bool ok = test_cabinet_gg_session_request_changes(&borrowed.list, &failure);
  release_list(&borrowed);
  if (!ok) park(&failure);
  return ok ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------
// docs
// ---------------------------------------------------------------------------------------------

/// The search's page, lowered the way every `list<record>` here is — one managed array per field —
/// with the two numbers that describe the page itself handed back as a sixth array rather than as
/// two more `out` parameters. That is the same subtraction [`board_array`] makes and for the same
/// reason: twelve arguments is as wide a frame as the interpreter builds for an internal call, and
/// this one already spends six on the query and its filters.
static MonoBoolean gg_search_docs(MonoString *query, MonoArray *modules, MonoString *type,
                                  MonoString *kind, int32_t offset, int32_t limit, MonoArray **page,
                                  MonoArray **keys, MonoArray **kinds, MonoArray **hit_modules,
                                  MonoArray **names, MonoArray **summaries) {
  char *query_utf8 = lift(query);
  char *type_utf8 = lift(type);
  char *kind_utf8 = lift(kind);
  sandbox_string_t owned_query = borrow(query_utf8);
  sandbox_string_t owned_type = borrow(type_utf8);
  sandbox_string_t owned_kind = borrow(kind_utf8);
  borrowed_list_t borrowed = borrow_list(modules);
  uint32_t offset_storage = 0;
  uint32_t limit_storage = 0;
  test_cabinet_gg_docs_doc_search_t result;
  test_cabinet_gg_docs_api_error_t failure;
  const bool ok = test_cabinet_gg_docs_search(
      query_utf8 == NULL ? NULL : &owned_query, &borrowed.list,
      type_utf8 == NULL ? NULL : &owned_type, kind_utf8 == NULL ? NULL : &owned_kind,
      maybe_u32(offset, &offset_storage), maybe_u32(limit, &limit_storage), &result, &failure);
  if (query_utf8 != NULL) mono_free(query_utf8);
  if (type_utf8 != NULL) mono_free(type_utf8);
  if (kind_utf8 != NULL) mono_free(kind_utf8);
  release_list(&borrowed);
  if (!ok) {
    park(&failure);
    return 0;
  }
  *page = uint_array(2);
  uint_array_set(*page, 0, result.total);
  uint_array_set(*page, 1, result.offset);
  *keys = string_array(result.hits.len);
  *kinds = string_array(result.hits.len);
  *hit_modules = string_array(result.hits.len);
  *names = string_array(result.hits.len);
  *summaries = string_array(result.hits.len);
  for (size_t index = 0; index < result.hits.len; index++) {
    mono_array_setref(*keys, index, lower(&result.hits.ptr[index].key));
    mono_array_setref(*kinds, index, lower(&result.hits.ptr[index].kind));
    mono_array_setref(*hit_modules, index, lower(&result.hits.ptr[index].module));
    mono_array_setref(*names, index, lower(&result.hits.ptr[index].name));
    mono_array_setref(*summaries, index, lower(&result.hits.ptr[index].summary));
  }
  test_cabinet_gg_docs_doc_search_free(&result);
  return 1;
}

static MonoBoolean gg_close_doc_view(MonoString *key, uint32_t *closed) {
  char *utf8 = lift(key);
  sandbox_string_t owned = borrow(utf8);
  test_cabinet_gg_docs_api_error_t failure;
  const bool ok = test_cabinet_gg_docs_close_doc_view(&owned, closed, &failure);
  if (utf8 != NULL) mono_free(utf8);
  if (!ok) park(&failure);
  return ok ? 1 : 0;
}

static MonoBoolean gg_close_doc_views(uint32_t *closed) {
  test_cabinet_gg_docs_api_error_t failure;
  const bool ok = test_cabinet_gg_docs_close_doc_views(closed, &failure);
  if (!ok) park(&failure);
  return ok ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------
// views
// ---------------------------------------------------------------------------------------------

static MonoBoolean gg_open_file_view(MonoString *path, int32_t offset, int32_t limit, int32_t *kind,
                                     MonoString **contents, MonoString **media_type,
                                     MonoString **label, MonoString **not_shown_reason,
                                     MonoArray **numbers) {
  char *utf8 = lift(path);
  sandbox_string_t owned = borrow(utf8);
  uint32_t offset_storage = 0;
  uint32_t limit_storage = 0;
  test_cabinet_gg_views_file_read_t read;
  test_cabinet_gg_views_api_error_t failure;
  const bool ok =
      test_cabinet_gg_views_open_file_view(&owned, maybe_u32(offset, &offset_storage),
                                           maybe_u32(limit, &limit_storage), &read, &failure);
  if (utf8 != NULL) mono_free(utf8);
  if (!ok) {
    park(&failure);
    return 0;
  }
  lower_file_read(&read, kind, contents, media_type, label, not_shown_reason, numbers);
  test_cabinet_gg_views_file_read_free(&read);
  return 1;
}

static MonoBoolean gg_open_text_view(MonoString *label, MonoString *body) {
  char *label_utf8 = lift(label);
  char *body_utf8 = lift(body);
  sandbox_string_t owned_label = borrow(label_utf8);
  sandbox_string_t owned_body = borrow(body_utf8);
  test_cabinet_gg_views_api_error_t failure;
  const bool ok = test_cabinet_gg_views_open_text_view(&owned_label, &owned_body, &failure);
  if (label_utf8 != NULL) mono_free(label_utf8);
  if (body_utf8 != NULL) mono_free(body_utf8);
  if (!ok) park(&failure);
  return ok ? 1 : 0;
}

static MonoBoolean gg_open_docs_view(MonoString *name) {
  char *utf8 = lift(name);
  sandbox_string_t owned = borrow(utf8);
  test_cabinet_gg_views_api_error_t failure;
  const bool ok = test_cabinet_gg_views_open_docs_view(&owned, &failure);
  if (utf8 != NULL) mono_free(utf8);
  if (!ok) park(&failure);
  return ok ? 1 : 0;
}

static MonoBoolean gg_close_view(MonoString *selector, uint32_t *closed) {
  char *utf8 = lift(selector);
  sandbox_string_t owned = borrow(utf8);
  test_cabinet_gg_views_api_error_t failure;
  const bool ok = test_cabinet_gg_views_close_view(&owned, closed, &failure);
  if (utf8 != NULL) mono_free(utf8);
  if (!ok) park(&failure);
  return ok ? 1 : 0;
}

static void gg_current_views(MonoArray **kinds, MonoArray **selectors, MonoArray **tokens,
                             MonoArray **offsets, MonoArray **limits) {
  test_cabinet_gg_views_list_open_view_t views;
  test_cabinet_gg_views_current_views(&views);
  *kinds = int_array(views.len);
  *selectors = string_array(views.len);
  *tokens = ulong_array(views.len);
  *offsets = long_array(views.len);
  *limits = long_array(views.len);
  for (size_t index = 0; index < views.len; index++) {
    int_array_set(*kinds, index, (int32_t)views.ptr[index].kind);
    mono_array_setref(*selectors, index, lower(&views.ptr[index].selector));
    ulong_array_set(*tokens, index, views.ptr[index].tokens);
    const bool paged = views.ptr[index].region.is_some;
    long_array_set(*offsets, index, paged ? (int64_t)views.ptr[index].region.val.offset : -1);
    long_array_set(*limits, index, paged ? (int64_t)views.ptr[index].region.val.limit : -1);
  }
  test_cabinet_gg_views_list_open_view_free(&views);
}

// ---------------------------------------------------------------------------------------------
// programs
// ---------------------------------------------------------------------------------------------

static MonoBoolean gg_history(MonoArray **turns, MonoArray **lines, MonoArray **chars,
                              MonoArray **ok_flags, MonoArray **errors) {
  test_cabinet_gg_programs_list_program_summary_t history;
  test_cabinet_gg_programs_api_error_t failure;
  const bool ok = test_cabinet_gg_programs_history(&history, &failure);
  if (!ok) {
    park(&failure);
    return 0;
  }
  *turns = uint_array(history.len);
  *lines = uint_array(history.len);
  *chars = uint_array(history.len);
  *ok_flags = bool_array(history.len);
  *errors = string_array(history.len);
  for (size_t index = 0; index < history.len; index++) {
    uint_array_set(*turns, index, history.ptr[index].turn);
    uint_array_set(*lines, index, history.ptr[index].lines);
    uint_array_set(*chars, index, history.ptr[index].chars);
    bool_array_set(*ok_flags, index, history.ptr[index].ok ? 1 : 0);
    mono_array_setref(*errors, index, lower_option(&history.ptr[index].error));
  }
  test_cabinet_gg_programs_list_program_summary_free(&history);
  return 1;
}

static MonoBoolean gg_get_program(int32_t turn, MonoString **source) {
  uint32_t turn_storage = 0;
  sandbox_string_t result;
  test_cabinet_gg_programs_api_error_t failure;
  const bool ok =
      test_cabinet_gg_programs_get(maybe_u32(turn, &turn_storage), &result, &failure);
  if (!ok) {
    park(&failure);
    return 0;
  }
  *source = lower(&result);
  sandbox_string_free(&result);
  return 1;
}

static MonoBoolean gg_rerun(MonoString *source) {
  char *utf8 = lift(source);
  sandbox_string_t owned = borrow(utf8);
  test_cabinet_gg_programs_api_error_t failure;
  const bool ok = test_cabinet_gg_programs_rerun(&owned, &failure);
  if (utf8 != NULL) mono_free(utf8);
  if (!ok) park(&failure);
  return ok ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------

/// One row of the registration table: the `Namespace.Class::Method` Mono resolves by, the C function
/// that answers it, and — for the thirty-five that dispatch a gg tool — that tool's name.
///
/// The tool name lives here rather than in a second list so that `bound-operations` and the
/// bindings are one statement. A row with no tool name is one of the model-facing carve-outs that
/// is not a gg tool: an ending, a view, a documentation search or close, a program-library call, or
/// the feedback channel.
typedef struct {
  const char *managed;
  const void *native;
  const char *tool;
} binding_t;

static const binding_t bindings[] = {
    {"Gg.Internal.Native::TakeError", (const void *)gg_take_error, NULL},
    {"Gg.Internal.Native::Log", (const void *)gg_log, NULL},
    {"Gg.Internal.Native::Shell", (const void *)gg_shell, "shell"},
    {"Gg.Internal.Native::ReadFile", (const void *)gg_read_file, "read_file"},
    {"Gg.Internal.Native::WriteFile", (const void *)gg_write_file, "write_file"},
    {"Gg.Internal.Native::EditFile", (const void *)gg_edit_file, "edit_file"},
    {"Gg.Internal.Native::ListDir", (const void *)gg_list_dir, "list_dir"},
    {"Gg.Internal.Native::ReadTextFile", (const void *)gg_read_text_file, NULL},
    {"Gg.Internal.Native::ReadSkill", (const void *)gg_read_skill, "read_skill"},
    {"Gg.Internal.Native::ReadMemory", (const void *)gg_read_memory, "read_memory"},
    {"Gg.Internal.Native::EditMemory", (const void *)gg_edit_memory, "edit_memory"},
    {"Gg.Internal.Native::SearchMemories", (const void *)gg_search_memories, "search_memories"},
    {"Gg.Internal.Native::DeleteMemory", (const void *)gg_delete_memory, "delete_memory"},
    {"Gg.Internal.Native::AddTask", (const void *)gg_add_task, "add_task"},
    {"Gg.Internal.Native::UpdateTask", (const void *)gg_update_task, "update_task"},
    {"Gg.Internal.Native::SetBlockedBy", (const void *)gg_set_blocked_by, "set_blocked_by"},
    {"Gg.Internal.Native::CompleteTask", (const void *)gg_complete_task, "complete_task"},
    {"Gg.Internal.Native::RemoveTask", (const void *)gg_remove_task, "remove_task"},
    {"Gg.Internal.Native::CreateEpic", (const void *)gg_create_epic, "create_epic"},
    {"Gg.Internal.Native::CreateIssue", (const void *)gg_create_issue, "create_issue"},
    {"Gg.Internal.Native::UpdateIssue", (const void *)gg_update_issue, "update_issue"},
    {"Gg.Internal.Native::SetIssueBlockedBy", (const void *)gg_set_issue_blocked_by,
     "set_issue_blocked_by"},
    {"Gg.Internal.Native::RemoveFromBoard", (const void *)gg_remove_from_board, NULL},
    {"Gg.Internal.Native::WaitForIssue", (const void *)gg_wait_for_issue, "wait_for_issue"},
    {"Gg.Internal.Native::EvictFileView", (const void *)gg_evict_file_view, "evict_file_view"},
    {"Gg.Internal.Native::ArchiveThread", (const void *)gg_archive_thread, "archive_thread"},
    {"Gg.Internal.Native::SearchArchive", (const void *)gg_search_archive, "search_archive"},
    {"Gg.Internal.Native::Compact", (const void *)gg_compact, "compact"},
    {"Gg.Internal.Native::SpawnSubagent", (const void *)gg_spawn_subagent, "spawn_subagent"},
    {"Gg.Internal.Native::WaitForSubagents", (const void *)gg_wait_for_subagents,
     "wait_for_subagents"},
    {"Gg.Internal.Native::SendMessage", (const void *)gg_send_message, "send_message"},
    {"Gg.Internal.Native::TransitionState", (const void *)gg_transition_state, "transition_state"},
    {"Gg.Internal.Native::Exec", (const void *)gg_exec, "exec"},
    {"Gg.Internal.Native::Fork", (const void *)gg_fork, "fork"},
    {"Gg.Internal.Native::Finish", (const void *)gg_finish, NULL},
    {"Gg.Internal.Native::Approve", (const void *)gg_approve, NULL},
    {"Gg.Internal.Native::RequestChanges", (const void *)gg_request_changes, NULL},
    {"Gg.Internal.Native::SearchDocs", (const void *)gg_search_docs, NULL},
    {"Gg.Internal.Native::CloseDocView", (const void *)gg_close_doc_view, NULL},
    {"Gg.Internal.Native::CloseDocViews", (const void *)gg_close_doc_views, NULL},
    {"Gg.Internal.Native::OpenFileView", (const void *)gg_open_file_view, NULL},
    {"Gg.Internal.Native::OpenTextView", (const void *)gg_open_text_view, NULL},
    {"Gg.Internal.Native::OpenDocsView", (const void *)gg_open_docs_view, NULL},
    {"Gg.Internal.Native::CloseView", (const void *)gg_close_view, NULL},
    {"Gg.Internal.Native::CurrentViews", (const void *)gg_current_views, NULL},
    {"Gg.Internal.Native::History", (const void *)gg_history, NULL},
    {"Gg.Internal.Native::GetProgram", (const void *)gg_get_program, NULL},
    {"Gg.Internal.Native::Rerun", (const void *)gg_rerun, NULL},
};

// The three recording calls share one lowering — `write_memory`, `update_memory` and
// `create_memory` take one record and differ in nothing else — so `RecordMemory` is one binding that
// dispatches three gg tools. It is the one row the table above cannot express, and it is here rather
// than being flattened into three bindings, because three managed `extern`s over one C function
// would be three names Mono resolves to the same code with nothing saying why.
static const char *const record_memory_tools[] = {"write_memory", "update_memory",
                                                  "create_memory"};

// And the same for the two removals, which take one id and read back one `board-usage` and differ in
// nothing else.
static const char *const remove_from_board_tools[] = {"remove_epic", "remove_issue"};

#define GG_BINDING_COUNT (sizeof bindings / sizeof bindings[0])
#define GG_RECORD_MEMORY_COUNT (sizeof record_memory_tools / sizeof record_memory_tools[0])
#define GG_REMOVE_COUNT (sizeof remove_from_board_tools / sizeof remove_from_board_tools[0])

void gg_bridge_register(void) {
  gg_install_trampolines();
  for (size_t index = 0; index < GG_BINDING_COUNT; index++) {
    mono_add_internal_call(bindings[index].managed, bindings[index].native);
  }
  mono_add_internal_call("Gg.Internal.Native::RecordMemory", (const void *)gg_record_memory);
}

/// Every gg tool name the table above binds, gathered once.
static const char *operation_names[GG_BINDING_COUNT + GG_RECORD_MEMORY_COUNT + GG_REMOVE_COUNT];
static size_t operation_name_count = 0;

void gg_bridge_operation_names(const char *const **names, size_t *count) {
  if (operation_name_count == 0) {
    for (size_t index = 0; index < GG_BINDING_COUNT; index++) {
      if (bindings[index].tool != NULL) operation_names[operation_name_count++] = bindings[index].tool;
    }
    for (size_t index = 0; index < GG_RECORD_MEMORY_COUNT; index++) {
      operation_names[operation_name_count++] = record_memory_tools[index];
    }
    for (size_t index = 0; index < GG_REMOVE_COUNT; index++) {
      operation_names[operation_name_count++] = remove_from_board_tools[index];
    }
  }
  *names = operation_names;
  *count = operation_name_count;
}
