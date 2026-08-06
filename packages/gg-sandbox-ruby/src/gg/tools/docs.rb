# frozen_string_literal: true

module GG
  # The `docs` carve-out: documentation lookup, bound onto every API object and never a gg tool.
  #
  # It is one of the model-facing families that is not a capability: no toolset offers it, an
  # ablation cannot withhold it, and it is absent from `Catalogue::TOOLS` so the bijection the
  # component is checked against is undisturbed. `GG::Scope` binds it onto every API object as
  # `<object>.list`, so a model can always discover the functions it has, whatever a run enables.
  # Reading what one *does* is `view.open_docs_view` — a view, because everything the model reads
  # is a view.
  #
  # @api private
  module Docs
    # List the functions available on this API object, each with a one-line summary.
    #
    # Only the functions this run actually bound are returned, so the directory never names a call
    # your program cannot make. Open a view of one function's full signature, argument descriptions
    # and types with `view.open_docs_view`.
    #
    # @return [Array<FunctionSummary>] every function bound on this object, each with one line
    def self.list
      # DECLARED here and bound by `bind_list`, which is the honest shape of it: the method a
      # program calls takes no arguments because the object it belongs to is closed over, and there
      # is no one object this declaration could name. Writing the signature and the documentation
      # HERE, on a real declaration, is what keeps them reflected out of the code like every other
      # function's rather than written into a table gg could never check.
      raise NotImplementedError,
            "`list` is bound per object by GG::Scope; call it as `<object>.list`"
    end

    # The `list` an API object carries, with that object's name closed over.
    #
    # @param object [String] The API object the bound method lists (`fs`, `view`, …).
    # @return [Proc] a nullary callable answering with that object's directory
    def self.bind_list(object)
      lambda do
        Wire.call("list", "docs", "listFunctions", [object]).map do |entry|
          FunctionSummary.new(
            name: Wire.field(entry, "name"),
            summary: Wire.field(entry, "summary")
          )
        end
      end
    end
  end
end
