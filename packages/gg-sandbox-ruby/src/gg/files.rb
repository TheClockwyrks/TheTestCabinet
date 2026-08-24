# frozen_string_literal: true

module GG
  # Read, write, edit and list the files of the workspace.
  #
  # Nothing here places anything in the agent's context window; a view is what does that.
  module Files
    extend Surface::Operations

    # Read a file, as either a `GG::Files::TextFile` or a `GG::Files::ImageFile`.
    #
    # Which of the two comes back is detected from the file's bytes, never from the extension, so a
    # mislabelled picture is still a picture. Both are classes, so an ordinary `case` narrows them:
    #
    # ```ruby
    # case GG::Files.read_file("logo.png")
    # when GG::Files::TextFile then …
    # when GG::Files::ImageFile then …
    # end
    # ```
    #
    # A relative path resolves against the workspace; an absolute one is read as given, so anything
    # else in this container — an offloaded command's output under `/tmp/gg-shell`, say — is
    # readable. This call hands bytes to the program and places nothing in the context window;
    # reading a picture describes it and shows nothing, so a file only read here is a file nobody
    # has looked at.
    #
    # @param path [String] The file to read, relative to the workspace or absolute.
    # @param offset [Integer, nil] The 1-based line to start at. Left out, the read starts at the
    #   first line.
    # @param limit [Integer, nil] How many lines to return from `offset`. Left out, a capped read
    #   policy's default applies, or the read runs to the end of the file.
    # @return [GG::Files::TextFile, GG::Files::ImageFile] the file's window of text, or the
    #   picture's description
    # @raise [GG::Core::ApiError] `:not_found` for a missing path.
    def self.read_file(path, offset: nil, limit: nil)
      Wire.file_read(Wire.call("read_file", "files", "readFile", [
                                 path,
                                 Wire.js(Check.uint("read_file", "offset", offset)),
                                 Wire.js(Check.uint("read_file", "limit", limit))
                               ]))
    end
    operation :read_file, "files.read_file", tool: "read_file"

    # Write UTF-8 text to a file, creating parent directories and replacing what is there.
    #
    # The contents may be given as a block, which is what a Ruby program reaches for when the text
    # is assembled rather than held: `GG::Files.write_file("notes.md") { rows.join("\n") }`.
    #
    # @overload write_file(path, contents)
    #   @param path [String] Where to write, relative to the workspace or absolute. Parent
    #     directories are created.
    #   @param contents [String] The UTF-8 text to write. It replaces the file entirely.
    # @overload write_file(path, &contents)
    #   @param path [String] Where to write, relative to the workspace or absolute. Parent
    #     directories are created.
    #   @param contents [String] A block returning the UTF-8 text to write. It replaces the file
    #     entirely.
    # @return [Integer] how many bytes were written
    # @raise [GG::Core::ApiError] `:invalid_argument` when neither a `contents` argument nor a
    #   block was given, and for an empty path; `:io_error` when creating the parent directories or
    #   the write itself failed.
    def self.write_file(path, contents = nil, &block)
      text = block ? block.call : contents
      if text.nil?
        raise Core::ApiError.new("write_file", Core::ApiErrorCode::INVALID_ARGUMENT,
                                 "`write_file` needs the text to write, as an argument or as a " \
                                 "block")
      end

      Wire.integer(Wire.call("write_file", "files", "writeFile", [path, text]))
    end
    operation :write_file, "files.write_file", tool: "write_file"

    # Replace the one exact occurrence of some text in a file with something else.
    #
    # Widening the surrounding context until the match is unique is the way to disambiguate;
    # counting occurrences is not.
    #
    # @param path [String] The file to edit.
    # @param old_string [String] The exact text to find, whitespace included. It must appear exactly
    #   once.
    # @param new_string [String] The text to put in its place. An empty string deletes the match.
    # @return [nil]
    # @raise [GG::Core::ApiError] `:not_found` when the text does not appear, and `:conflict` —
    #   with the number of matches — when it appears more than once.
    def self.edit_file(path, old_string, new_string)
      Wire.call("edit_file", "files", "editFile", [path, old_string, new_string])
      nil
    end
    operation :edit_file, "files.edit_file", tool: "edit_file"

    # List a directory, sorted by name; no argument lists the workspace root.
    #
    # Each entry carries a bare `name` — join it with the directory that was listed — and its
    # `kind`. An empty directory is an empty array, not a failure.
    #
    # @param path [String, nil] The directory to list, relative to the workspace or absolute. Leave
    #   it out for the workspace root.
    # @return [Array<GG::Files::DirEntry>] what the directory holds, sorted by name
    # @raise [GG::Core::ApiError] `:not_found` for a missing directory, and `:invalid_argument` for
    #   a path that is given but empty — leaving it out is what lists the workspace root.
    def self.list_dir(path = nil)
      Wire.call("list_dir", "files", "listDir", [Wire.js(path)]).map do |entry|
        DirEntry.new(
          name: Wire.field(entry, "name"),
          kind: Wire.symbol(`#{entry}.kind`)
        )
      end
    end
    operation :list_dir, "files.list_dir", tool: "list_dir"

    # Search the workspace's files for a regular expression and hand back every matching line.
    #
    # `query` is a regular expression — Rust syntax, so `foo|bar`, `fn\s+update`, and `(?i)todo`
    # for a case-insensitive match — tried against each line on its own, and every line it matches
    # comes back with its path and 1-based line number, in path order and then line order. It is the
    # pattern's text, as a String, rather than a Ruby Regexp. `path` roots the search at one
    # directory or one file; leave it out for the workspace root.
    #
    # The search honours ignore files: what `.gitignore`, `.ignore` and their kin exclude — nested
    # files, negations and `.git/info/exclude` included, and `.git` itself — is never scanned and
    # never returned, whether or not the workspace is a repository yet, and a file that is not text
    # (one carrying a NUL byte) is skipped rather than matched byte by byte. Dotfiles are otherwise
    # searched like any other file. So a match list holds the project's own sources rather than
    # `node_modules`, build output and the run's own bookkeeping, and a file under an ignored path
    # is still reachable by its path through every other call in this module.
    #
    # The result is bounded so one search cannot flood a turn, which is where it differs from a
    # shell `grep`: at most `limit` matches come back — 50 by default, and never more than 200 — and
    # a list exactly `limit` long may have been cut. There is no offset, because a search is a
    # question about where to point the other calls rather than a way of reading a file, so the
    # answer to a cut list is a narrower query or path. A matching line longer than 200 characters
    # is cut there and annotated in place as `foo (123 more chars...)`.
    #
    # @param query [String] The regular expression to match each line against, in Rust syntax;
    #   `(?i)` at the front makes it case-insensitive. It may not be blank.
    # @param path [String, nil] The directory or file to search, relative to the workspace or
    #   absolute. Leave it out to search the whole workspace.
    # @param limit [Integer, nil] The most matches to return, at least 1. Leave it out for 50; the
    #   ceiling is 200, and a larger request is answered with the first 200 rather than refused.
    # @return [Array<GG::Files::SearchMatch>] every matching line, in path order and then line
    #   order, each with its `path`, 1-based `line` and `text`; an empty array when nothing matched,
    #   and one exactly `limit` long may have been cut
    # @raise [GG::Core::ApiError] `:invalid_argument` for a blank query, one that is not a valid
    #   pattern, a `query` that is not a String, or a `limit` of zero, and `:not_found` for a `path`
    #   that does not exist.
    def self.search(query, path: nil, limit: nil)
      unless query.is_a?(String)
        raise Core::ApiError.new("search", Core::ApiErrorCode::INVALID_ARGUMENT,
                                 "`query` is the pattern's text as a String, in Rust regular-" \
                                 "expression syntax, got #{query.inspect}")
      end

      bound = Check.uint("search", "limit", limit)
      if bound == 0
        raise Core::ApiError.new("search", Core::ApiErrorCode::INVALID_ARGUMENT,
                                 "`limit` must be at least 1, got 0; leave it out for gg's " \
                                 "default of 50")
      end

      Wire.call("search", "files", "search", [query, Wire.js(path), Wire.js(bound)]).map do |match|
        SearchMatch.new(
          path: Wire.field(match, "path"),
          line: Wire.field(match, "line"),
          text: Wire.field(match, "text")
        )
      end
    end
    operation :search, "files.search", tool: "search"

    # A text file's window, as `GG::Files.read_file` returns it.
    class TextFile
      include Value

      # @return [String] The file's text, or just the requested window where the read named one.
      attr_reader :contents

      # @return [Integer] The 1-based first line returned.
      attr_reader :first_line

      # @return [Integer] The 1-based last line returned.
      attr_reader :last_line

      # @return [Integer] The file's total line count, which says whether to page again.
      attr_reader :total_lines

      # @api private
      def initialize(contents:, first_line:, last_line:, total_lines:, byte_truncated:)
        @contents = contents
        @first_line = first_line
        @last_line = last_line
        @total_lines = total_lines
        @byte_truncated = byte_truncated
        freeze
      end

      # @return [Boolean] Whether a 256 KiB byte ceiling cut the returned text.
      def byte_truncated?
        @byte_truncated
      end
    end

    # A picture's description, as `GG::Files.read_file` returns it.
    #
    # The pixels never enter the program. `GG::Views.open_file` is what attaches the picture to the
    # turn for it to be looked at, which is worth far more than base64 in a variable.
    class ImageFile
      include Value

      # @return [String] The IANA media type (`image/png`, `image/jpeg`, `image/gif`, `image/webp`).
      attr_reader :media_type

      # @return [String] The short format label (`PNG`, `JPEG`, `GIF`, `WebP`).
      attr_reader :label

      # @return [Integer] The file's size in bytes.
      attr_reader :bytes

      # @return [String, nil] Why the picture is not being shown; `nil` when it is.
      attr_reader :not_shown_reason

      # @api private
      def initialize(media_type:, label:, bytes:, shown:, not_shown_reason:)
        @media_type = media_type
        @label = label
        @bytes = bytes
        @shown = shown
        @not_shown_reason = not_shown_reason
        freeze
      end

      # @return [Boolean] Whether the picture is being attached to this turn to be looked at.
      def shown?
        @shown
      end
    end

    # What a directory entry is.
    #
    # Every arm is a Symbol, so a comparison may name the constant or write the literal:
    # `GG::Files::EntryKind::FILE` and `:file` are the same value.
    module EntryKind
      # An ordinary file.
      FILE = :file

      # A directory, which can be listed in its own right.
      DIRECTORY = :directory

      # Everything that is neither, a symlink among them.
      OTHER = :other
    end

    # One entry `GG::Files.list_dir` found: a bare name, and its kind.
    class DirEntry
      include Value

      # @return [String] The entry's bare name, with no directory part. Join it with the directory
      #   that was listed.
      attr_reader :name

      # @return [GG::Files::EntryKind] What the entry is.
      attr_reader :kind

      # @api private
      def initialize(name:, kind:)
        @name = name
        @kind = kind
        freeze
      end
    end

    # One line `GG::Files.search` matched: where it is, and the line itself.
    class SearchMatch
      include Value

      # @return [String] The file's path, relative to the workspace root — or absolute, for a search
      #   rooted outside it — with `/` separators.
      attr_reader :path

      # @return [Integer] The 1-based line number of the match within that file.
      attr_reader :line

      # The matching line, without its line ending.
      #
      # A line longer than 200 characters is cut there and annotated in place as
      # `foo (123 more chars...)`.
      #
      # @return [String] the matching line
      attr_reader :text

      # @api private
      def initialize(path:, line:, text:)
        @path = path
        @line = line
        @text = text
        freeze
      end
    end
  end
end
