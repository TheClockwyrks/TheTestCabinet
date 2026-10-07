# Cover the filesystem tools' wrong-kind-of-path failures

Give `read_file`, `write_file`, `edit_file` and `list_dir` a test for each I/O
branch a model reaches by naming a path of the wrong kind, and one for the
non-image binary a read decodes rather than attaches.

## Current state

The four tools share `resolve_path` and `ToolFailure::from_io`, and each has an
I/O branch no test enters:

- `read_file` fails the whole call on any `std::fs::read` error at
  `crates/gg/src/tools/filesystem.rs:755-759`. Only the missing-file case is
  driven, at `crates/gg/src/tools/filesystem.test.rs:70` and `:290`.
- `write_file` has two: parent-directory creation at
  `crates/gg/src/tools/filesystem.rs:836-842`, whose message is
  `creating parent dirs`, and the write itself at `:843-845`.
- `edit_file` reads with `read_to_string` at
  `crates/gg/src/tools/filesystem.rs:934-938`, which any I/O error reaches, and
  writes back at `:962-964` with the message `writing back`.
- `list_dir` fails on `read_dir` at `crates/gg/src/tools/filesystem.rs:1025` and
  on an entry that cannot be read mid-iteration at `:1036-1041`.

`read_file` answers a picture as a picture only when `sniff_image` recognises the
bytes (`crates/gg/src/tools/filesystem.rs:765-767`); anything else falls through
to `read_window`/`read_whole`, which decode the bytes lossily.
`sniff_image_ignores_text_and_unrecognized_binaries`
(`crates/gg/src/tools/filesystem.image.test.rs:83`) covers the sniffer alone, and
`a_binary_file_is_skipped` (`crates/gg/src/tools/filesystem.search.test.rs:211`)
is `search`'s counterpart.

The harnesses to reuse are `workspace()` and `reader()`
(`crates/gg/src/tools/filesystem.test.rs:16` and `:24`), the classification tests
`a_missing_path_is_classified_not_found` (`:290`) and
`argument_diagnostics_are_classified_as_invalid_arguments` (`:313`), and
`tool(policy)` plus `workspace_with_lines` in
`crates/gg/src/tools/filesystem.read.test.rs:50` and `:41`.

Each case names a path of the wrong kind rather than removing a permission bit,
so the tests hold when the suite runs as root.

## Design

These land in `crates/gg/src/tools/filesystem.test.rs`, each a `#[tokio::test]`
calling the tool's `invoke` with a synthesized JSON argument object over a
`TempDir` workspace.

- `reading_a_directory_is_an_io_error` — `read_file` on a directory the test
  created. Not ok, `failure` is `ToolFailure::IoError`, and the message names the
  path.
- `an_empty_read_path_is_an_argument_error` — `read_file` with `"path": "  "`;
  `InvalidArgument`, by the same branch `write_file`'s empty path is asserted
  through at `:313`.
- `writing_under_a_file_is_an_io_error` — a file `a.txt` exists, and
  `write_file` names `a.txt/b.txt`; `IoError`, with `creating parent dirs` in the
  message.
- `writing_onto_a_directory_is_an_io_error` — `write_file` names an existing
  directory; `IoError`, and the message names the path.
- `editing_a_directory_is_an_io_error` — `edit_file` names a directory with a
  well-formed `old_string`/`new_string` pair; `IoError` rather than `NotFound`,
  so the model is told the path is wrong rather than the text.
- `listing_a_file_is_an_io_error` — `list_dir` names a regular file; `IoError`,
  and the message begins `list_dir:`.
- `an_empty_listing_path_is_an_argument_error` — `list_dir` with `"path": ""`;
  `InvalidArgument`.

`list_dir`'s mid-iteration entry error at
`crates/gg/src/tools/filesystem.rs:1036-1041` is answered by the same
`ToolFailure::from_io` classification the `read_dir` branch above it is, and a
model reaches it only on a filesystem that changes under the walk. It keeps the
classifier test at `crates/gg/src/tools/data.test.rs:192` as its coverage.

One test lands in `crates/gg/src/tools/filesystem.read.test.rs`, beside the
windowing tests:

- `an_unrecognised_binary_is_decoded_rather_than_attached` — the workspace holds
  a file of bytes `sniff_image` does not recognise, including a byte sequence
  that is not valid UTF-8. The read succeeds, carries a `FileTextData` sidecar
  rather than a `FileImageData` one, attaches no image, and its output holds the
  replacement character rather than the raw bytes.

## Done when

- [ ] Each I/O branch listed above is entered by its own test through the tool's
      `invoke`.
- [ ] Every wrong-kind-of-path case asserts `ToolFailure::IoError` and a message
      that names what was asked for.
- [ ] A read of an unrecognised binary is asserted to return text with a
      `FileTextData` sidecar.
- [ ] No test depends on file permissions.
- [ ] Gates green.
