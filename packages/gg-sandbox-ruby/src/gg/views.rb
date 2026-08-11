# frozen_string_literal: true

module GG
  # Show a file, a computed value, or a function's documentation.
  #
  # A view is the only way material enters the agent's context window.
  #
  # Under responses as code a whole program's output would otherwise collapse into one anonymous
  # blob of logs, charged to one band, attributable to nothing and closable by nothing. A view
  # restores what tool calling gave for free: one message per view, carrying the band it is charged
  # to and the selector it can be closed by. So `puts` reaches the run's operator and a view reaches
  # the model.
  module Views
    extend Surface::Operations

    # The catalogue name behind an `open_docs_view` argument.
    #
    # A Symbol and a String are the name itself; a `Method` knows its own, and an SDK method's name
    # is a name gg catalogues it under. Anything else is refused here, before the lookup, so a `nil`
    # that came from somewhere else is not looked up as a function literally called "" and reported
    # as an unknown name nobody wrote.
    #
    # @param target [Object] whatever the program passed
    # @return [String] the catalogue name
    # @raise [GG::Core::ToolError] `invalid-argument` for anything that is not a name or a method
    # @api private
    def self.docs_name(target)
      return target.to_s if target.is_a?(Symbol) || target.is_a?(String)
      return target.name.to_s if target.respond_to?(:name) && target.is_a?(Method)

      raise Core::ToolError.new("open_docs_view", Core::ToolErrorCode::INVALID_ARGUMENT,
                                "expected a function name or a method, got #{target.inspect}")
    end
    private_class_method :docs_name

    # Read a file and place it in the context window, attributed to its path and closable by it.
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
    # @param path [String] The file to open, relative to the workspace or absolute.
    # @param offset [Integer, nil] The 1-based line to start at.
    # @param limit [Integer, nil] How many lines to show from `offset`.
    # @return [GG::Files::TextFile, GG::Files::ImageFile] the same thing `GG::Files.read_file`
    #   returns
    # @raise [GG::Core::ToolError] `:not_found` for a missing path, and `:invalid_argument` for an
    #   offset past the end of the file. The read is what fails; nothing is opened when it does.
    def self.open_file(path, offset: nil, limit: nil)
      Wire.file_read(Wire.call("open_file", "views", "openFileView", [
                                 path,
                                 Wire.js(Check.uint("open_file", "offset", offset)),
                                 Wire.js(Check.uint("open_file", "limit", limit))
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
    #   @param label [String] What to file the view under. `GG::Views.close` takes it, and opening
    #     the same label again replaces what it showed. It may not be empty.
    #   @param body [String] What to show. An empty body is allowed: it is how a program says that
    #     something it was showing is now empty.
    # @overload open_text(label, &body)
    #   @param label [String] What to file the view under. `GG::Views.close` takes it, and opening
    #     the same label again replaces what it showed. It may not be empty.
    #   @param body [String] A block returning what to show.
    # @return [nil] nothing; the view arrives in the next prompt
    # @raise [GG::Core::ToolError] `:invalid_argument` for an empty label — a view with no selector
    #   could never be closed or attributed — and for neither a `body` argument nor a block, and
    #   `:limit_exceeded`, naming the cap, for a body or label over gg's caps. Nothing is ever
    #   silently truncated.
    def self.open_text(label, body = nil, &block)
      text = block ? block.call : body
      if text.nil?
        raise Core::ToolError.new("open_text", Core::ToolErrorCode::INVALID_ARGUMENT,
                                  "`open_text` needs the body to show, as an argument or as a block")
      end

      Wire.call("open_text", "views", "openTextView", [label, text])
      nil
    end
    operation :open_text, "views.open_text"

    # Place one function's full documentation into the context window.
    #
    # Its signature, its description, and the declarations of any types it refers to that have not
    # already been shown this session. This is how a function is read. It is a **view**, not a
    # return value — the documentation arrives in the next prompt under a `Documentation` heading
    # keyed by the function name, exactly as a file or a computed value arrives — so it is not
    # available in the turn it is asked for. Ask in one turn, use it in the next. Opening the same
    # function's documentation again replaces the view rather than adding a second copy, and
    # `GG::Views.close` closes it.
    #
    # @param target [Symbol, String, Method] The function to document, by its fully-qualified name
    #   (`"GG::Files.read_file"`), by the name it is called by in its module, or as the method
    #   itself.
    # @return [nil] nothing; the documentation arrives in the next prompt
    # @raise [GG::Core::ToolError] `:not_found` for an unknown or unbound name.
    def self.open_docs_view(target)
      Wire.call("open_docs_view", "views", "openDocsView", [docs_name(target)])
      nil
    end
    operation :open_docs_view, "views.open_docs_view"

    # Close every view carrying `selector`, freeing the tokens they occupied.
    #
    # For a file that is every page of that path, for a text view the one with that label, for a
    # documentation view the function's name. Closing a selector that is not open hands back `0`
    # rather than failing, so a program that tidies up unconditionally need not guard every call.
    # Closing a file view forgets what was read, not what exists; closing a text view discards the
    # only copy of what it held, so anything needed later belongs in a file or a memory first.
    #
    # @param selector [String] What the view is filed under: a file's path, a text view's label, or
    #   a documentation view's function name.
    # @return [Integer] how many views were closed
    def self.close(selector)
      Wire.call("close", "views", "closeView", [selector])
    end
    operation :close, "views.close"

    # List what is open in the context window right now.
    #
    # Each view's `kind`, the `selector` that closes it, roughly what it costs in `tokens`, and —
    # for a paged file view — the `region` it covers. Reading it is what decides what to close when
    # the window is filling up. What it enumerates is the context window's contents, not
    # any module's functions.
    #
    # @return [Array<GG::Views::OpenView>] every view open in the context window
    def self.current
      Wire.call("current", "views", "currentViews", []).map do |view|
        region = Wire.field(view, "region")
        OpenView.new(
          kind: Wire.symbol(`#{view}.kind`),
          selector: Wire.field(view, "selector"),
          tokens: Wire.integer(`#{view}.tokens`),
          region: region.nil? ? nil : ViewRegion.new(
            offset: Wire.field(region, "offset"),
            limit: Wire.field(region, "limit")
          )
        )
      end
    end
    operation :current, "views.current"

    # Which of the three kinds a view is.
    #
    # The taxonomy is closed at three deliberately: everything on disk is a file, everything a
    # program can compute is a string, and documentation is neither — gg holds it.
    module ViewKind
      # A file that was opened; its selector is the path.
      FILE = :file

      # A computed value; its selector is the label it was given.
      TEXT = :text

      # A function's documentation; its selector is the function's name.
      DOCS = :docs
    end

    # The window of lines a paged file view covers; absent for a whole-file view.
    class ViewRegion
      include Value

      # @return [Integer] The 1-based first line the view shows.
      attr_reader :offset

      # @return [Integer] How many lines it shows.
      attr_reader :limit

      # @api private
      def initialize(offset:, limit:)
        @offset = offset
        @limit = limit
        freeze
      end
    end

    # One view open in the context window, as `GG::Views.current` reports it.
    class OpenView
      include Value
      extend Surface::Operations

      # @return [GG::Views::ViewKind] Whether it is a file, text, or documentation view.
      attr_reader :kind

      # @return [String] What `GG::Views.close` takes: a file's path, a text view's label, or a
      #   documentation view's function name.
      attr_reader :selector

      # @return [Integer] Roughly what holding it costs, in tokens.
      attr_reader :tokens

      # @return [GG::Views::ViewRegion, nil] The line window a paged file view covers; `nil` for a
      #   whole-file view and for text views.
      attr_reader :region

      # @api private
      def initialize(kind:, selector:, tokens:, region:)
        @kind = kind
        @selector = selector
        @tokens = tokens
        @region = region
        freeze
      end

      # Close this view, freeing the tokens it occupied.
      #
      # `GG::Views.close` with the selector already supplied, which is what makes tidying a window
      # read as ordinary Ruby: `GG::Views.current.each(&:close)`.
      #
      # @return [Integer] how many views were closed, counting every page of one file
      def close
        Views.close(@selector)
      end
      member_operation :close, "views.close"
    end
  end
end
