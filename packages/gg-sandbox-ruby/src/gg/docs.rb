# frozen_string_literal: true

module GG
  # Find what the agent can call, and take a documentation view back out of the window.
  #
  # The system prompt names modules and no function at all, so this is the module every other one is
  # reached through: `GG::Docs.search` turns a keyword or a module id into fully-qualified names, and
  # `GG::Views.open_docs_view` reads one of those names in full.
  #
  # Searching is bound in every program whatever a run enables, because an agent must always be able
  # to find the functions it does hold. Closing a documentation view is the exception and is bought
  # by a capability: opening one only ever appends to the prompt, while closing one rewrites its
  # middle, and those are different enough trades to be different decisions.
  module Docs
    extend Surface::Operations

    # Search every module, function and type the agent holds, by keyword and by filter.
    #
    # This is how a name is found. Matching is a case-insensitive substring over names, signatures,
    # briefs and detailed descriptions, so `docs` finds `open_docs_view`. Ranking is by the kind of
    # evidence that matched — an entry whose own name matched outranks one that merely mentions the
    # word in a paragraph — and a weaker kind never overtakes a stronger one however often it
    # occurs.
    #
    # Only entries this run bound are returned, so nothing a search finds is something the run
    # withheld. The filters compose with each other and with `query`.
    #
    # The page comes back as a value and is also opened as a view, under the selector
    # `search results`, so it can be read on the next turn without a program showing it to itself.
    # The next search replaces that view: it names what is being worked from rather than keeping a
    # record.
    #
    # @param query [String] The words to match, as a case-insensitive substring. It may be empty
    #   when at least one filter is given.
    # @param in_module [String, nil] One module's id — `files`, `views`, `docs` — matched exactly.
    #   An empty `query` with a module is that module's whole directory rather than a search. A
    #   module filter is a lookup, so a name no module has matches nothing rather than failing.
    # @param type [String, nil] One type's name, narrowing to that type and to the functions that
    #   take or return it. Like `in_module`, a name nothing declares matches nothing rather than
    #   failing.
    # @param kind [GG::Docs::DocKind, nil] `:module`, `:function` or `:type` — whether to return
    #   modules, functions or types. The default returns all three.
    # @param offset [Integer, nil] How many hits to skip, for reading past the first page. The
    #   default starts at the best hit.
    # @param limit [Integer, nil] The most hits to return. The default is gg's own page size and
    #   there is a ceiling above it, so comparing the hits against `total` is the only way to see a
    #   capped page. Zero is refused rather than read as "no cap".
    # @return [GG::Docs::DocSearch] the page that matched, best first, with the total behind it
    # @raise [GG::Core::ApiError] `:invalid_argument` for an empty query with no filter at all —
    #   nothing matched and nothing was asked for are different answers — for a `kind` that is none
    #   of `:module`, `:function` and `:type`, and for a `limit` of zero, which asks for a page that
    #   answers nothing. A module or type name gg does not hold is not among them: it matches
    #   nothing.
    def self.search(query, in_module: nil, type: nil, kind: nil, offset: nil, limit: nil)
      found = Wire.call("search", "docs", "search", [
                          query,
                          Wire.js(in_module),
                          Wire.js(type),
                          Wire.js(Wire.arm(Check.choice("search", "kind", kind,
                                                        [DocKind::MODULE, DocKind::FUNCTION,
                                                         DocKind::TYPE]))),
                          Wire.js(Check.uint("search", "offset", offset)),
                          Wire.js(Check.uint("search", "limit", limit))
                        ])
      DocSearch.new(
        total: Wire.field(found, "total"),
        offset: Wire.field(found, "offset"),
        hits: Wire.field(found, "hits").map { |hit| hit_of(hit) }
      )
    end
    operation :search, "docs.search"

    # Take one documentation view out of the context window, by the key it was opened under.
    #
    # The removal has no cascade: closing a type's view leaves every function view beside it, and
    # closing a function's leaves its types. Nothing records why a view was opened, so a type that
    # is closed is opened again by the next function that mentions it.
    #
    # @param key [String] The fully-qualified name the view was opened under.
    # @return [Integer] how many views were closed; a key that is not open closes `0` rather than
    #   failing
    # @raise [GG::Core::ApiError] `:unavailable` under a run that did not enable closing
    #   documentation views.
    def self.close(key)
      Wire.call("close", "docs", "closeDocView", [key])
    end
    operation :close, "docs.close"

    # Take every documentation view out of the context window and report how many went.
    #
    # The blanket form of `GG::Docs.close`, on exactly the same terms and behind the same
    # capability.
    #
    # @return [Integer] how many views were closed
    # @raise [GG::Core::ApiError] `:unavailable` under a run that did not enable closing
    #   documentation views.
    def self.close_all
      Wire.call("close_all", "docs", "closeDocViews", [])
    end
    operation :close_all, "docs.close_all"

    # One hit, as the class a program actually gets.
    #
    # @param hit [Object] the record the membrane returned
    # @return [GG::Docs::DocHit] the same hit, as the model-facing class
    # @api private
    def self.hit_of(hit)
      DocHit.new(
        key: Wire.field(hit, "key"),
        kind: Wire.symbol(Wire.field(hit, "kind")),
        in_module: Wire.field(hit, "module"),
        name: Wire.field(hit, "name"),
        summary: Wire.field(hit, "summary")
      )
    end
    private_class_method :hit_of

    # Which of the three kinds of thing a documentation entry describes.
    module DocKind
      # A module a program imports, with the functions it holds inside it.
      MODULE = :module

      # A function a program calls.
      FUNCTION = :function

      # A type a function takes or hands back.
      TYPE = :type
    end

    # One entry a search matched: enough to choose from, and no more.
    class DocHit
      include Value

      # @return [String] The fully-qualified name `GG::Views.open_docs_view` takes to read the whole
      #   entry.
      attr_reader :key

      # @return [GG::Docs::DocKind] Whether it is a `:module`, a `:function` or a `:type`.
      attr_reader :kind

      # The module it lives in.
      #
      # A module is its own, and a function has exactly one. A type shows every module in which a
      # function the agent can call mentions it — never one nothing is held in, and comma-separated
      # when there are several, which makes it a description rather than something to pass back as
      # `in_module`.
      #
      # @return [String] the module's id, or the ids of every module a type is mentioned in
      attr_reader :module

      # @return [String] The name a program calls it by, or the type's or the module's own name.
      attr_reader :name

      # @return [String] Its one-line brief, and only that. The rest is what a documentation view is
      #   for.
      attr_reader :summary

      # `in_module` rather than `module`, which Ruby reserves: the reader is `module` because that is
      # what the field is, and a keyword argument of that name is one no method body could read back.
      #
      # @api private
      def initialize(key:, kind:, in_module:, name:, summary:)
        @key = key
        @kind = kind
        @module = in_module
        @name = name
        @summary = summary
        freeze
      end
    end

    # A page of search results, with the total behind it.
    class DocSearch
      include Value

      # @return [Integer] How many entries matched before paging, which tells a capped page from a
      #   complete answer.
      attr_reader :total

      # @return [Integer] The offset this page starts at, echoed back.
      attr_reader :offset

      # @return [Array<GG::Docs::DocHit>] The page itself, best first.
      attr_reader :hits

      # @api private
      def initialize(total:, offset:, hits:)
        @total = total
        @offset = offset
        @hits = hits
        freeze
      end
    end
  end
end
