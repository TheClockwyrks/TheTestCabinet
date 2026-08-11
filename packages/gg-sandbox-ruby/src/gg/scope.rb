# frozen_string_literal: true

module GG
  # The surface a program is handed: the capability modules, carrying every function this SDK
  # declares.
  #
  # **Nothing here varies with the run, and nothing here is a gate.** Every declaration
  # `GG::Surface` recorded is bound onto its module at load time — inside the heap
  # `componentize-js` snapshots — and stays there for every program of every run. A call this agent
  # was not granted is an ordinary Ruby call that reaches the host, and what comes back is a
  # `GG::Core::ToolError` naming the capability that is missing and why: a value a `rescue` clause
  # can catch and act on, where a `NoMethodError` from Opal was only ever a dead end.
  #
  # The gate is the **host's**, from gg's own operations table, and it is the same one that decides
  # what a `docs.search` will show this agent. There is one reading of "may this agent call X" and
  # it is not in this file.
  #
  # **The types are not built at all**, for the same reason they never were: a type is not a
  # capability. `GG::Core::ToolError` is what a `rescue` clause catches and
  # `GG::Tasks::TaskStatus::DONE` is what a status argument is, and both are declared by this SDK
  # once, into the pre-initialised heap, where they stay.
  #
  # ## Why the implementations are still lifted off and put back
  #
  # Not for gating — for **arity and keywords**. Opal lowers keyword arguments to a trailing hash
  # and silently ignores keys the target does not declare, so `create_issue(reviewer: [...])` — the
  # singular/plural typo — would otherwise be accepted and file an issue with no reviewer, a failure
  # the model cannot see. Each implementation is therefore lifted off its module, its calling shape
  # reflected once, and put back behind a forwarder that checks both. All of it happens at load, so
  # a turn pays nothing.
  #
  # @api private
  module Scope
    # The capability modules, resolved from the names `GG::Surface` orders them by.
    MODULES = Surface::MODULES.map { |name| GG.const_get(name) }.freeze

    # Each declaration's implementation and calling shape, lifted off its module at load time.
    #
    # `componentize-js` runs this file's top level under `wizer` and snapshots the heap, so what is
    # built here is *in the artifact* and costs a turn nothing. Reflecting a method's parameters per
    # turn instead is not free and was measured: over the thirty-five bound functions, twice each,
    # it cost about 3 ms of the roughly 9 ms a whole turn takes — a third of it, on the arm whose
    # entire point is what a language costs.
    IMPLEMENTATIONS = {}

    # The module paths a program may reach, in presentation order — read by `shim.js` for the
    # unknown-name hint, and constant because the surface is.
    MODULE_PATHS = []

    # Lift every module function off the module that declares it, record its implementation and its
    # calling shape, and put it straight back behind the forwarder that checks both. Called at load
    # time; see {IMPLEMENTATIONS}.
    #
    # A member function is left exactly where it is: it is a second way to reach an operation the
    # module function already carries, it hangs off a value a program can only be holding because
    # that operation ran, and lifting it would mean rebinding an unbound instance method for no
    # gain.
    #
    # @return [void]
    def self.lift
      declared = Surface.registry.select(&:module_function?)
      declared.each do |entry|
        callable = entry.owner.method(entry.name)
        IMPLEMENTATIONS[entry] = [callable, keywords(callable), arity(callable)].freeze
        entry.owner.singleton_class.send(:remove_method, entry.name)
      end
      # Only where there is a surface to be outside of. `GG::Core` declares types and no function
      # at all, so a name it does not have is an ordinary Ruby mistake, and pointing at a directory
      # it never carries would be an invitation to a call that does not exist.
      MODULES.select { |mod| Surface.declared_on(mod).any? }.each { |mod| refuse_unknown(mod) }
      IMPLEMENTATIONS.freeze
      declared.each { |entry| bind(entry) }
      MODULES.select { |mod| declared.any? { |entry| entry.owner.equal?(mod) } }
             .each { |mod| MODULE_PATHS << mod.name.to_s }
      MODULE_PATHS.freeze
    end

    # Answer a name a module does not declare with the module, the name, and what it does declare.
    #
    # Every gg function is bound, so a name that lands here is one gg does not have — a typo, or a
    # call out of another arm's vocabulary. The difference between `undefined method 'read_fil' for
    # GG::Files` and a sentence listing what that module declares is a turn.
    #
    # @param mod [Module] the capability module to install the refusal on
    # @return [void]
    def self.refuse_unknown(mod)
      mod.singleton_class.send(:define_method, :method_missing) do |name, *_args|
        declares = Surface.declared_on(mod).map(&:name).sort
        raise NoMethodError,
              "`#{mod.name}.#{name}` is not one of the names gg declares there; " \
              "it declares #{declares.join(', ')}"
      end
      mod.singleton_class.send(:define_method, :respond_to_missing?) do |name, include_private = false|
        Surface.declared_on(mod).any? { |entry| entry.name.to_s == name.to_s } ||
          super(name, include_private)
      end
    end

    # The keyword arguments a lifted implementation declares.
    #
    # @param callable [Method] the implementation
    # @return [Array<String>, nil] the declared keyword names, or nil when it takes `**` and there
    #   is therefore no set to be outside of
    def self.keywords(callable)
      declared = callable.parameters
      return nil if declared.any? { |(kind, _name)| kind == :keyrest }

      declared.select { |(kind, _name)| kind == :key || kind == :keyreq }
              .map { |(_kind, name)| name.to_s }
    end

    # How many positional arguments a lifted implementation takes, as `[minimum, maximum]`.
    #
    # A `nil` maximum is a splat: `GG::Context.archive_thread(*ranges)` takes any number.
    #
    # @param callable [Method] the implementation
    # @return [Array(Integer, Integer, nil)] the fewest and the most it accepts
    def self.arity(callable)
      minimum = 0
      maximum = 0
      callable.parameters.each do |(kind, _name)|
        case kind
        when :req
          minimum += 1
          maximum += 1 unless maximum.nil?
        when :opt
          maximum += 1 unless maximum.nil?
        when :rest
          maximum = nil
        end
      end
      [minimum, maximum]
    end

    # Refuse a positional count the target cannot take, naming the call the way the program wrote
    # it.
    #
    # Opal's own `arity_check` — which gg compiles this SDK with — raises here too, but it says two
    # things this cannot: it renders Ruby's *negative arity encoding* (`expected -3`) for anything
    # with an optional argument, which is a number no CRuby message ever prints. This runs first and
    # says `expected 1..2`.
    #
    # @param fn [String] the call as the program wrote it (`GG::Files.read_file`)
    # @param arity [Array(Integer, Integer, nil)] what {arity} reported for the target
    # @param given [Integer] how many positional arguments arrived
    # @return [void]
    # @raise [ArgumentError] in CRuby's own words, naming the call
    def self.check_arity(fn, arity, given)
      minimum, maximum = arity
      return if given >= minimum && (maximum.nil? || given <= maximum)

      expected = if maximum.nil? then "#{minimum}+"
                 elsif minimum == maximum then minimum.to_s
                 else "#{minimum}..#{maximum}"
                 end
      raise ArgumentError,
            "wrong number of arguments (given #{given}, expected #{expected}) — `#{fn}`"
    end

    # Refuse a keyword the target does not declare, the way CRuby would.
    #
    # Opal lowers keyword arguments to a trailing hash and never reads the extra keys, so
    # `GG::Board.create_issue(…, reviewer: ["r1"])` — the singular/plural typo — is otherwise
    # accepted, and the issue is created with `reviewers: []` while the program believes it named
    # one. {check_arity} does not cover this half: it counts positionals, and an unknown keyword is
    # invisible to it.
    #
    # @param fn [String] the call as the program wrote it (`GG::Board.create_issue`)
    # @param accepted [Array<String>, nil] what the target declares; nil accepts anything
    # @param kwargs [Hash] the keywords the program passed
    # @return [void]
    # @raise [ArgumentError] naming the unknown keywords and the accepted set
    def self.check_keywords(fn, accepted, kwargs)
      return if accepted.nil?

      unknown = kwargs.keys.map(&:to_s) - accepted
      return if unknown.empty?

      # Leading colons written by hand for the reason `GG::Check.choice` writes them by hand: Opal's
      # Symbol IS a String, so `:reviewers.inspect` is `"reviewers"` here, and a message that quoted
      # the accepted set that way would be telling a model to write the one thing this argument does
      # not take.
      takes = if accepted.empty?
                "takes no keyword arguments"
              else
                "takes #{accepted.map { |key| ":#{key}" }.join(", ")}"
              end
      raise ArgumentError,
            "unknown keyword#{unknown.size == 1 ? "" : "s"}: " \
            "#{unknown.map { |key| ":#{key}" }.join(", ")} — `#{fn}` #{takes}"
    end

    # The gg tool names this component can bind.
    #
    # gg calls this export in a unit test and asserts set-equality with its own `ALL_TOOL_NAMES`. It
    # is the one drift gate that inspects the **committed artifact** rather than a source file, so
    # it catches the failure no compiler can: a tool added, renamed or removed in gg, with a stale
    # `.wasm` still checked in.
    #
    # @return [Array<String>] every gg tool this SDK really defines a method for, in declaration
    #   order
    def self.bound_tools
      Surface.registry.select { |entry| IMPLEMENTATIONS.key?(entry) }
             .reject(&:aliased)
             .filter_map(&:tool)
             .uniq
    end

    # Bind one declaration back onto the module that declares it, behind the forwarder that says
    # what Ruby would have said.
    #
    # Forwarded explicitly rather than bound with `define_method(name, &callable)`, which reads
    # better and silently drops the caller's block — so `GG::Files.write_file(path) { … }` would
    # arrive with no body and fail on an argument the program did supply.
    #
    # @param entry [Surface::Entry] the declaration to bind
    # @return [void]
    def self.bind(entry)
      callable, accepted, arity = IMPLEMENTATIONS.fetch(entry)
      fn = "#{entry.owner.name}.#{entry.name}"
      entry.owner.singleton_class.send(:define_method, entry.name) do |*args, **kwargs, &block|
        Scope.check_arity(fn, arity, args.length)
        next callable.call(*args, &block) if kwargs.empty?

        Scope.check_keywords(fn, accepted, kwargs)
        callable.call(*args, **kwargs, &block)
      end
    end

    # Bind the code modules `GG::Lib` collected at `lib.<key>`, or remove `lib` when there are none.
    #
    # @return [Boolean] whether a `lib` name was installed
    def self.install_lib
      Object.send(:remove_method, :lib) if Object.method_defined?(:lib)
      modules = Lib.registry
      return false if modules.empty?

      namespaces = Lib::Namespaces.new(modules)
      Object.send(:define_method, :lib) { namespaces }
      true
    end

    lift
  end
end
