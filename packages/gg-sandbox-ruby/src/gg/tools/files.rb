# frozen_string_literal: true

module GG
  # The `fs` family: reading, writing, editing and listing files.
  #
  # One lowering lives here. `as_file_read` flattens the membrane's `{ tag, val }` read variant
  # into the `TextFile` or `ImageFile` a program narrows with an ordinary `case`, rather than a
  # wrapper reached through a field nobody would guess at. It is shared with `view.open_file`,
  # which performs the very same host read and returns the very same shape.
  #
  # @api private
  module Files
    # The membrane's tagged read, as the class a program actually gets.
    #
    # @param read [Object] the `{ tag, val }` variant the membrane returned
    # @return [TextFile, ImageFile] the read, as the model-facing class
    def self.as_file_read(read)
      value = `#{read}.val`
      if `#{read}.tag` == "text"
        TextFile.new(
          contents: Wire.field(value, "contents"),
          first_line: Wire.field(value, "firstLine"),
          last_line: Wire.field(value, "lastLine"),
          total_lines: Wire.field(value, "totalLines"),
          byte_truncated: Wire.field(value, "byteTruncated")
        )
      else
        ImageFile.new(
          media_type: Wire.field(value, "mediaType"),
          label: Wire.field(value, "label"),
          bytes: Wire.integer(`#{value}.bytes`),
          shown: Wire.field(value, "shown"),
          not_shown_reason: Wire.field(value, "notShownReason")
        )
      end
    end

    # Read a file, returning a `TextFile` or an `ImageFile` — the format is detected from the
    # file's bytes, never its extension.
    #
    # This gets bytes for your PROGRAM and puts NOTHING in your context window; `view.open_file` is
    # the call that shows the file to you. A relative path resolves against your workspace; an
    # absolute one is read as given, so anything in this container — an offloaded command's output
    # under `/tmp/gg-shell`, say — is readable.
    #
    # Reading an IMAGE describes it to your program — label, media type, byte size — and does not
    # show it to YOU: the pixels reach neither your program nor your context window, so a file you
    # only `read_file` is a file you have not looked at. `view.open_file` is the one way to
    # actually see a picture.
    #
    # Narrow the two with an ordinary `case`:
    #
    #     case fs.read_file("logo.png")
    #     when TextFile then …
    #     when ImageFile then …
    #     end
    #
    # @param path [String] The file to read. Relative to your workspace, or absolute for anything
    #   else in this container.
    # @param offset [Integer, nil] The 1-based line to start at. Honoured only under a capped read
    #   policy.
    # @param limit [Integer, nil] How many lines to return from `offset`. Honoured only under a
    #   capped read policy.
    # @return [TextFile, ImageFile] the file's text window, or the picture's description
    # @raise [ToolError] `:not_found` for a missing path.
    def self.read_file(path, offset: nil, limit: nil)
      as_file_read(Wire.call("read_file", "files", "readFile", [
                               path,
                               Wire.js(Check.uint("read_file", "offset", offset)),
                               Wire.js(Check.uint("read_file", "limit", limit))
                             ]))
    end

    # Write UTF-8 text to a file, creating parent directories and replacing any existing file, and
    # return the number of bytes written.
    #
    # Writing is the expensive direction of the sandbox — rewriting more than a few dozen large
    # files in one program exhausts its fuel budget, so split a large rewrite across several turns.
    #
    # The contents may be given as a block, which is what a Ruby program reaches for when the text
    # is assembled rather than held: `fs.write_file("notes.md") { rows.join("\n") }`.
    #
    # @overload write_file(path, contents)
    #   @param path [String] Where to write. Relative to your workspace, or absolute. Parent
    #     directories are created for you.
    #   @param contents [String] The UTF-8 text to write. It replaces the file entirely.
    # @overload write_file(path, &contents)
    #   @param path [String] Where to write. Relative to your workspace, or absolute. Parent
    #     directories are created for you.
    #   @param contents [String] A block returning the UTF-8 text to write. It replaces the file
    #     entirely.
    # @return [Integer] how many bytes were written
    # @raise [ToolError] `:invalid_argument` when neither a `contents` argument nor a block was
    #   given.
    def self.write_file(path, contents = nil, &block)
      text = block ? block.call : contents
      if text.nil?
        raise ToolError.new("write_file", ToolErrorCode::INVALID_ARGUMENT,
                            "`write_file` needs the text to write, as an argument or as a block")
      end

      Wire.integer(Wire.call("write_file", "files", "writeFile", [path, text]))
    end

    # Replace the one exact occurrence of `old_string` in a file with `new_string`.
    #
    # Widen the surrounding context until the match is unique rather than counting occurrences.
    #
    # @param path [String] The file to edit.
    # @param old_string [String] The exact text to find, including its whitespace. It must appear
    #   exactly once.
    # @param new_string [String] The text to put in its place. An empty string deletes the match.
    # @return [nil] nothing; the edit either happened or raised
    # @raise [ToolError] `:not_found` when the text does not appear, and `:conflict` — with the
    #   number of matches — when it appears more than once.
    def self.edit_file(path, old_string, new_string)
      Wire.call("edit_file", "files", "editFile", [path, old_string, new_string])
      nil
    end

    # List a directory, sorted by name; defaults to your workspace.
    #
    # Each entry carries a bare `name` — join it with the directory you listed — and its `kind`. An
    # empty directory is an empty array, not a failure.
    #
    # @param path [String, nil] The directory to list; leave it out for your workspace root.
    # @return [Array<DirEntry>] what the directory holds, sorted by name
    def self.list_dir(path = nil)
      Wire.call("list_dir", "files", "listDir", [Wire.js(path)]).map do |entry|
        DirEntry.new(
          name: Wire.field(entry, "name"),
          kind: Wire.symbol(`#{entry}.kind`)
        )
      end
    end
  end
end
