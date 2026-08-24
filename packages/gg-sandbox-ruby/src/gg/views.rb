# frozen_string_literal: true

module GG
  # Show a file, a computed value, or a module, function or type's documentation.
  #
  # A view is the only way material enters the agent's context window.
  #
  # Under responses as code a whole program's output would otherwise collapse into one anonymous
  # blob of logs, charged to one band, attributable to nothing and closable by nothing. A view
  # restores what tool calling gave for free: one message per view, carrying the band it is charged
  # to and the selector it is filed under. So `puts` reaches the run's operator and a view reaches
  # the model.
  module Views
    extend Surface::Operations

    # The catalogue name behind an `open_docs_view` argument.
    #
    # A Symbol and a String are the name itself; a `Method` knows its own, and an SDK method's name
    # is a name gg catalogues it under. Anything else is refused here, before the lookup, so a `nil`
    # that came from somewhere else is not looked up as an entry literally called "" and reported
    # as an unknown name nobody wrote.
    #
    # @param target [Object] whatever the program passed
    # @return [String] the catalogue name
    # @raise [GG::Core::ApiError] `invalid-argument` for anything that is not a name or a method
    # @api private
    def self.docs_name(target)
      return target.to_s if target.is_a?(Symbol) || target.is_a?(String)
      return target.name.to_s if target.respond_to?(:name) && target.is_a?(Method)

      raise Core::ApiError.new("open_docs_view", Core::ApiErrorCode::INVALID_ARGUMENT,
                               "expected an entry name or a method, got #{target.inspect}")
    end
    private_class_method :docs_name

    # Read a file and place it in the context window, attributed to its path and filed under it.
    #
    # What comes back is exactly what `GG::Files.read_file` returns; the difference is the view.
    # That split is the point: reading gets bytes for the program, opening shows the file to the
    # agent, so a program that reads forty files to grep them puts nothing in the window. `offset`
    # and `limit` select a window of lines, and two pages of one file are two views that coexist;
    # re-opening the same page replaces what it showed rather than piling up a duplicate. An image
    # is shown as a picture, and this is the only call that shows one.
    #
    # Re-opening a picture that is already open replaces it rather than adding a second copy, which
    # is the same rule a page of a file follows.
    #
    # The view's text body is held to the same 65,536-byte cap a `GG::Views.open_text` body is: a
    # window that would carry more is refused, naming the size and the bound, and nothing is opened
    # — never a truncation. The way out is a narrower window, with `offset` and `limit`, or
    # `max_line_chars`, which cuts each line of the view longer than that many characters at that
    # point and annotates it in place as `foo (123 more chars...)`, with the count of characters
    # dropped. The cut is the view's alone — what this call returns and the file itself are
    # untouched — and the byte cap is measured against the body after it, which is what lets a
    # window over a log of enormous lines fit. Left out, lines arrive whole. A picture is not a text
    # body and is not subject to the cap.
    #
    # @param path [String] The file to open, relative to the workspace or absolute.
    # @param offset [Integer, nil] The 1-based line to start at.
    # @param limit [Integer, nil] How many lines to show from `offset`.
    # @param max_line_chars [Integer, nil] The most characters of each line to show, 1 to 65,536;
    #   a longer line is cut there and annotated with how many characters were dropped. Leave it
    #   out to show lines whole.
    # @return [GG::Files::TextFile, GG::Files::ImageFile] the same thing `GG::Files.read_file`
    #   returns
    # @raise [GG::Core::ApiError] `:not_found` for a missing path, `:invalid_argument` for an
    #   offset past the end of the file or a `max_line_chars` of zero or over 65,536, and
    #   `:limit_exceeded` — naming the size and the bound — for a text window over the cap. The
    #   read is what fails; nothing is opened when it does.
    def self.open_file(path, offset: nil, limit: nil, max_line_chars: nil)
      Wire.file_read(Wire.call("open_file", "views", "openFileView", [
                                 path,
                                 Wire.js(Check.uint("open_file", "offset", offset)),
                                 Wire.js(Check.uint("open_file", "limit", limit)),
                                 Wire.js(Check.uint("open_file", "max_line_chars", max_line_chars))
                               ]))
    end
    operation :open_file, "views.open_file", tool: "read_file"

    # Place a value the program computed into the context window, under `label`.
    #
    # A directory listing, a command's output, a child agent's answer, a table the program
    # assembled. This is how the result of a program reaches the model that wrote it, and the only
    # way it does. Opening the same label again replaces what it showed, so a program may refine a
    # view in a loop without piling up a copy per iteration.
    #
    # The body may be given as a block, which is what a Ruby program reaches for when the text is
    # built rather than held:
    #
    # ```ruby
    # GG::Views.open_text("failing tests") do
    #   failures.map { |name| "- #{name}" }.join("\n")
    # end
    # ```
    #
    # @overload open_text(label, body)
    #   @param label [String] What to file the view under; opening the same label again replaces
    #     what it showed. It may not be empty.
    #   @param body [String] What to show. An empty body is allowed: it is how a program says that
    #     something it was showing is now empty.
    # @overload open_text(label, &body)
    #   @param label [String] What to file the view under; opening the same label again replaces
    #     what it showed. It may not be empty.
    #   @param body [String] A block returning what to show.
    # @return [nil]
    # @raise [GG::Core::ApiError] `:invalid_argument` for an empty label — a view with no selector
    #   could never be closed or attributed — and for neither a `body` argument nor a block, and
    #   `:limit_exceeded`, naming the cap, for a body or label over gg's caps. Nothing is ever
    #   silently truncated.
    def self.open_text(label, body = nil, &block)
      text = block ? block.call : body
      if text.nil?
        raise Core::ApiError.new("open_text", Core::ApiErrorCode::INVALID_ARGUMENT,
                                 "`open_text` needs the body to show, as an argument or as a block")
      end

      Wire.call("open_text", "views", "openTextView", [label, text])
      nil
    end
    operation :open_text, "views.open_text"

    # Place one module, function or type's full documentation into the context window.
    #
    # Its signature, its description, and the declarations of any types it refers to that have not
    # already been shown this session. Anything `GG::Docs.search` returns is read this way. It is a
    # **view**, not a return value — the documentation arrives in the next prompt under a
    # `Documentation` heading keyed by the entry's name, exactly as a file or a computed value
    # arrives — so it is not available in the turn it is asked for. Ask in one turn, use it in the
    # next. Opening a key that is already open does nothing at all — not a move, not a re-emit —
    # so the band only ever grows, and nothing in this module takes a page back out of it.
    #
    # @param target [Symbol, String, Method] The entry to document, by its fully-qualified name
    #   (`"GG::Views.open_text"`), by the name it is called by in its module, or as the method
    #   itself. A module's own key is its path, `"GG::Views"`.
    # @return [nil]
    # @raise [GG::Core::ApiError] `:not_found` for an unknown or unbound name.
    def self.open_docs_view(target)
      Wire.call("open_docs_view", "views", "openDocsView", [docs_name(target)])
      nil
    end
    operation :open_docs_view, "views.open_docs_view"

    # Close every view carrying `selector`, freeing the tokens they occupied.
    #
    # For a file that is every page of that path, for a text view the one with that label, for the
    # results of a search the label `search results`. Closing a selector that is not open hands back
    # `0` rather than failing, so a program that tidies up unconditionally need not guard every
    # call. Closing a file view forgets what was read, not what exists; closing a text view discards
    # the only copy of what it held, so anything needed later belongs in a file or a memory first.
    #
    # Documentation views are not reached from here: taking one away is a different call, bought
    # by a capability of its own — so a sweep that included them would answer `0` for an agent that
    # may not close one, which reads as a selector that named nothing.
    #
    # Closing a view is context management, bought by the `agent-managed-context` capability: an
    # agent whose run did not enable it is refused.
    #
    # @param selector [String] What the view is filed under: a file's path, a text view's label, or
    #   `search results`.
    # @return [Integer] how many views were closed
    # @raise [GG::Core::ApiError] `:invalid_argument` for an empty selector, which names nothing
    #   rather than everything — no call here closes the window wholesale — and `:unavailable` for
    #   an agent whose run did not buy `agent-managed-context`.
    def self.close(selector)
      Wire.call("close", "views", "closeView", [selector])
    end
    operation :close, "views.close"

  end
end
