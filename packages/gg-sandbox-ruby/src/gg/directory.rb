# frozen_string_literal: true

module GG
  # The one function that belongs to **no** module, because it belongs to all of them.
  #
  # Every capability module carries a `list`, so a program can always discover what it has whatever
  # a run enables. Reading what one of those functions *does* is `GG::Views.open_docs_view` — a
  # view, because everything a model reads is a view.
  #
  # It is declared **once**, here, and `GG::Scope` seeds it onto each module it builds with that
  # module's own id closed over. Writing eleven copies of one function would be eleven copies of one
  # paragraph of model-facing documentation with nothing keeping them equal, and this SDK's rule is
  # that every word a model reads is written on the code exactly once.
  #
  # @api private
  module Directory
    # List the functions this module offers, each with a one-line summary.
    #
    # Only the functions this run actually bound are returned, so the directory never names a call
    # the program cannot make. One function's full signature, argument descriptions and types are
    # opened as a view with `GG::Views.open_docs_view`.
    #
    # @return [Array<GG::Core::FunctionSummary>] every function this module offers, one line each
    def self.list
      # DECLARED here and bound by `bind`, which is the honest shape of it: the method a program
      # calls takes no arguments because the module it belongs to is closed over, and there is no
      # one module this declaration could name. Writing the signature and the documentation here, on
      # a real declaration, is what keeps them reflected out of the code like every other function's
      # rather than written into a table gg could never check.
      raise NotImplementedError,
            "`list` is bound per module by GG::Scope; call it as `GG::<Module>.list`"
    end

    # The `list` one module carries, with that module's own path closed over.
    #
    # The path rather than gg's id, because the grouping a documentation lookup files a function
    # under is this arm's own spelling of the module — `GG::Files`, not `files`.
    #
    # @param path [String] the module whose directory the bound method answers (`GG::Files`)
    # @return [Proc] a nullary callable answering with that module's directory
    def self.bind(path)
      lambda do
        Wire.call("list", "docs", "listFunctions", [path]).map do |entry|
          Core::FunctionSummary.new(
            name: Wire.field(entry, "name"),
            summary: Wire.field(entry, "summary")
          )
        end
      end
    end
  end
end
