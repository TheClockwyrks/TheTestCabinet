# frozen_string_literal: true

module GG
  # The `view` object: the only way material enters an agent's own context window.
  #
  # These are not gg tools. No capability offers one, nothing dispatches one by name, and four of
  # the five are bound into **every** program's scope — the same carve-out `harness` has, and for
  # the same reason: a run that enables no tools at all must still be able to show its model
  # something. Cataloguing them among the tools would break the bijection the committed component
  # is checked against, so they have their own membrane interface, their own `Catalogue::VIEWS`
  # list, and their own object.
  #
  # **Why the object exists at all.** Under responses-as-code a whole program's output used to
  # collapse into one anonymous blob of logs, charged to one band, attributable to nothing and
  # evictable by nothing. A view restores what tool calling gave for free: one message per view,
  # carrying the band it is charged to and the selector it can be closed by. So `puts` reaches the
  # run's operator, and a **view** reaches the model.
  #
  # @api private
  module Views
    # Read a file AND show it to yourself: you get back exactly what `fs.read_file` returns, and
    # the file also becomes its own item in your context window, attributed to its path and
    # closable by it.
    #
    # The split from `fs.read_file` is the point — `fs.read_file` gets bytes for your PROGRAM,
    # `view.open_file` shows a file to YOU — so a program that reads forty files to grep them still
    # puts nothing in your window. `offset` and `limit` select a window of lines, and two pages of
    # one file are two views that coexist; re-opening the SAME page replaces what it showed rather
    # than piling up a duplicate. An image file is shown to you as a picture, and is the ONLY way
    # to look at one — `fs.read_file` of an image describes it without showing it.
    #
    # Pictures are the one thing this call can refuse. Only so many image-carrying views may be
    # open at once (your agent's `imageViewCap`); nothing is opened and nothing is shown when you
    # pass that cap, so close one with `view.close(path)` and try again. Re-opening a picture you
    # already have open replaces it rather than adding one, and is never refused. Text views are
    # never refused by this cap.
    #
    # @param path [String] The file to open. Relative to your workspace, or absolute.
    # @param offset [Integer, nil] The 1-based line to start at.
    # @param limit [Integer, nil] How many lines to show from `offset`.
    # @return [TextFile, ImageFile] the same thing `fs.read_file` returns
    # @raise [ToolError] `:limit_exceeded`, naming the cap, when opening a picture would pass your
    #   agent's image-view cap.
    def self.open_file(path, offset: nil, limit: nil)
      Files.as_file_read(Wire.call("open_file", "views", "openFileView", [
                                     path,
                                     Wire.js(Check.uint("open_file", "offset", offset)),
                                     Wire.js(Check.uint("open_file", "limit", limit))
                                   ]))
    end

    # Show yourself a value your program computed, under `label` — a directory listing, a command's
    # output, a child agent's answer, a table you assembled.
    #
    # This is what replaced `puts` as the channel into your context: what you print goes to the
    # run's operator, views come back to you on your next turn.
    #
    # The body may be given as a block, which is what a Ruby program reaches for when the text is
    # built rather than held:
    #
    #     view.open_text("failing tests") do
    #       failures.map { |name| "- #{name}" }.join("\n")
    #     end
    #
    # Opening the same `label` again replaces what it showed, so a program may refine a view in a
    # loop without piling up a copy per iteration. An empty BODY is allowed, since it is how you
    # say that something you were showing is now empty. Nothing is ever silently truncated.
    #
    # @overload open_text(label, body)
    #   @param label [String] What to file the view under. It is what `view.close` takes, and
    #     opening the same label again replaces what it showed. It may not be empty.
    #   @param body [String] What to show yourself. An empty body is allowed: it is how you say
    #     that something you were showing is now empty.
    # @overload open_text(label, &body)
    #   @param label [String] What to file the view under. It is what `view.close` takes, and
    #     opening the same label again replaces what it showed. It may not be empty.
    #   @param body [String] A block returning what to show yourself.
    # @return [nil] nothing; the view arrives in your next prompt
    # @raise [ToolError] `:invalid_argument` for an empty label — a view with no selector could
    #   never be closed or attributed — for neither a `body` argument nor a block, and
    #   `:limit_exceeded`, naming the cap, for a body or label over gg's caps.
    def self.open_text(label, body = nil, &block)
      text = block ? block.call : body
      if text.nil?
        raise ToolError.new("open_text", ToolErrorCode::INVALID_ARGUMENT,
                            "`open_text` needs the body to show, as an argument or as a block")
      end

      Wire.call("open_text", "views", "openTextView", [label, text])
      nil
    end

    # Show yourself the full documentation for one function: its signature, its description, and
    # the declarations of any types it refers to that you have not already been shown this session.
    #
    # Name it with a Symbol (`view.open_docs_view(:read_file)`), with a String, or with the method
    # itself (`view.open_docs_view(fs.method(:read_file))`).
    #
    # This is how you read what a function does. It is a **view**, not a return value — the
    # documentation arrives in your next prompt under a `Documentation` heading keyed by the
    # function name, exactly as a file or a computed value arrives — so it is not available in the
    # turn you ask for it. Plan for that: ask in one turn, use it in the next. Opening the same
    # function's docs again replaces the view rather than adding a second copy, and
    # `view.close(name)` closes it when you are done with it. `<object>.list` is how you find out
    # which names exist.
    #
    # @param target [Symbol, String, Method] The function to document — its name, or the method
    #   itself.
    # @return [nil] nothing; the documentation arrives in your next prompt
    # @raise [ToolError] `:not_found` for an unknown or unbound name.
    def self.open_docs_view(target)
      Wire.call("open_docs_view", "views", "openDocsView", [docs_name(target)])
      nil
    end

    # The catalogue name behind an `open_docs_view` argument.
    #
    # A Symbol and a String are the name itself; a `Method` knows its own, and an SDK method's name
    # *is* the name gg catalogues it under. Anything else is refused here, before the lookup, so a
    # `nil` that came from somewhere else is not looked up as a function literally called "" and
    # reported as an unknown name the model never wrote.
    #
    # @param target [Object] whatever the program passed
    # @return [String] the catalogue name
    # @raise [ToolError] `invalid-argument` for anything that is not a name or a method
    def self.docs_name(target)
      return target.to_s if target.is_a?(Symbol) || target.is_a?(String)
      return target.name.to_s if target.respond_to?(:name) && target.is_a?(Method)

      raise ToolError.new("open_docs_view", ToolErrorCode::INVALID_ARGUMENT,
                          "expected a function name or a method, got #{target.inspect}")
    end

    # Close every view carrying `selector` — for a file that is every page of that path, for a text
    # view the one with that label, for a documentation view the function's name — and return how
    # many were closed, freeing the tokens they occupied.
    #
    # Closing a selector that is not open returns `0` rather than failing, so a program that tidies
    # up unconditionally does not have to guard every call. Closing a file view forgets what you
    # read, not what exists; closing a text view discards the only copy of what it held, so write
    # anything you will need later to a file or a memory first.
    #
    # @param selector [String] What the view is filed under: a file's path, a text view's label, or
    #   a documentation view's function name.
    # @return [Integer] how many views were closed
    def self.close(selector)
      Wire.call("close", "views", "closeView", [selector])
    end

    # List what is open in your context window right now: each view's `kind`, the `selector` that
    # closes it, roughly what it costs you in `tokens`, and — for a paged file view — the `region`
    # it covers.
    #
    # It is called `current` rather than `list` because every API object already carries a `list`
    # that lists that object's own functions. Read it before deciding what to close when your
    # window is filling up.
    #
    # @return [Array<OpenView>] every view open in your context window
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
  end
end
