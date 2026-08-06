# frozen_string_literal: true

module GG
  # One of the API objects a program calls gg through: `fs`, `project`, `view`, `harness`, ….
  #
  # A bare `Object.new` would have done, and this exists for what it says when a program reaches
  # for a function that is **not** on it. `fs.read_file` in a run with reading withheld is the
  # single most likely mistake a model makes against this surface, and the difference between
  # `undefined method 'read_file' for #<Object>` and a sentence naming the object and pointing at
  # its directory is a turn.
  #
  # @api private
  class ApiObject
    # @param object [String] the object's model-facing name (`fs`)
    # @param members [Hash{String => Method, Proc}] the callables this run bound onto it
    # @param hint [String] what to point a program at when it reaches for something else
    def initialize(object, members, hint = nil)
      @object = object
      @members = members
      @hint = hint || "`#{object}.list` shows the ones it does"
      # Forwarded explicitly rather than bound with `define_singleton_method(name, &callable)`,
      # which reads better and silently drops the caller's block — so `fs.write_file(path) { … }`
      # would arrive with no body and fail on an argument the program did supply.
      #
      # The keyword check is the second thing this forwarder exists for, and it is the same class
      # of hazard as the dropped block: an argument the program DID supply going nowhere. Opal
      # lowers keyword arguments to a trailing hash and never reads the extra keys, so
      # `project.create_issue(…, reviewer: ["r1"])` — the singular/plural typo — is otherwise
      # accepted, and the issue is created with `reviewers: []` while the program believes it named
      # one. `arity_check` does not cover this half: it counts positionals and catches a MISSING
      # required keyword, and an unknown one is invisible to it. This forwarder is the only place
      # that knows both what was passed and what the target declares, so it is where CRuby's
      # `ArgumentError: unknown keyword:` is put back.
      members.each do |name, callable|
        accepted, arity = ApiObject.shape(callable)
        define_singleton_method(name) do |*args, **kwargs, &block|
          fn = "#{object}.#{name}"
          ApiObject.check_arity(fn, arity, args.length)
          next callable.call(*args, &block) if kwargs.empty?

          ApiObject.check_keywords(fn, accepted, kwargs)
          callable.call(*args, **kwargs, &block)
        end
      end
    end

    # Every SDK method's calling shape, keyed by the module it is defined on and its name, and
    # filled by {precompute} AT LOAD TIME.
    #
    # `componentize-js` runs this file's top level under `wizer` and snapshots the heap, so a table
    # built here is *in the artifact* and costs a turn nothing. Reflecting it per turn instead is
    # not free and was measured: `Method#parameters` over the thirty-five bound functions, twice
    # each, cost about 3 ms of the roughly 9 ms a whole turn takes — a third of it, on the arm whose
    # entire point is what a language costs. This is the same argument the baked Opal runtime rests
    # on, one level down.
    SHAPES = {}

    # The calling shape of one bound callable: `[keywords, arity]`.
    #
    # A hit is every SDK function. A miss is the per-object `list`, which is a `Proc` closing over
    # its object's name rather than a method on a module — there is one per object and it takes no
    # arguments, so computing it here costs nothing worth a table entry.
    #
    # @param callable [Method, Proc] the SDK function bound onto an object
    # @return [Array(Array<String>, nil, Array(Integer, Integer, nil))] its keywords and its arity
    def self.shape(callable)
      key = shape_key(callable)
      (key && SHAPES[key]) || [keywords(callable), arity(callable)]
    end

    # The table's key, or nil for a callable that has no module to be defined on.
    #
    # @param callable [Method, Proc] the callable to key
    # @return [String, nil] `GG::Files.read_file`'s key, or nil for a `Proc`
    def self.shape_key(callable)
      return nil unless callable.respond_to?(:owner)

      "#{callable.owner}##{callable.name}"
    end

    # Fill {SHAPES} for every function `modules` define. Called at load time; see {SHAPES}.
    #
    # @param modules [Array<Module>] the SDK modules whose singleton methods are bound onto objects
    # @return [void]
    def self.precompute(modules)
      modules.each do |mod|
        mod.methods(false).each do |name|
          callable = mod.method(name)
          SHAPES[shape_key(callable)] = [keywords(callable), arity(callable)].freeze
        end
      end
      SHAPES.freeze
    end

    # The keyword arguments a bound callable declares.
    #
    # @param callable [Method, Proc] the SDK function bound onto an object
    # @return [Array<String>, nil] the declared keyword names, or nil when it takes `**` and there
    #   is therefore no set to be outside of
    def self.keywords(callable)
      declared = callable.parameters
      return nil if declared.any? { |(kind, _name)| kind == :keyrest }

      declared.select { |(kind, _name)| kind == :key || kind == :keyreq }
              .map { |(_kind, name)| name.to_s }
    end

    # How many positional arguments a bound callable takes, as `[minimum, maximum]`.
    #
    # A `nil` maximum is a splat: `context.archive_thread(*ranges)` takes any number.
    #
    # @param callable [Method, Proc] the SDK function bound onto an object
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

    # Refuse a positional count the target cannot take, naming the call the way the program wrote it.
    #
    # Opal's own `arity_check` — which gg compiles this SDK with, and which stays on as the backstop
    # for a program that reaches past the objects into `GG::Files` directly — raises here too, but
    # it says two things this cannot: it names `GG::Files.read_file` rather than the `fs.read_file`
    # the model actually wrote, and for anything with an optional argument it renders Ruby's
    # *negative arity encoding* (`expected -3`), which is a number no CRuby message ever prints.
    # This runs first and says `expected 1..2`.
    #
    # @param fn [String] the call as the program wrote it (`fs.read_file`)
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
    # @param fn [String] the call as the program wrote it (`project.create_issue`)
    # @param accepted [Array<String>, nil] what the target declares; nil accepts anything
    # @param kwargs [Hash] the keywords the program passed
    # @return [void]
    # @raise [ArgumentError] naming the unknown keywords and the accepted set
    def self.check_keywords(fn, accepted, kwargs)
      return if accepted.nil?

      unknown = kwargs.keys.map(&:to_s) - accepted
      return if unknown.empty?

      # Leading colons written by hand for the reason `GG::Check.choice` writes them by hand: Opal's
      # Symbol IS a String, so `:reviewers.inspect` is `"reviewers"` here, and a message that
      # quoted the accepted set that way would be telling a model to write the one thing this
      # argument does not take.
      takes = if accepted.empty?
                "takes no keyword arguments"
              else
                "takes #{accepted.map { |key| ":#{key}" }.join(", ")}"
              end
      raise ArgumentError,
            "unknown keyword#{unknown.size == 1 ? "" : "s"}: " \
            "#{unknown.map { |key| ":#{key}" }.join(", ")} — `#{fn}` #{takes}"
    end

    # What a program gets for a function this run did not bind.
    #
    # @param name [Symbol] the method that was reached for
    # @param _args [Array] whatever it was called with
    # @raise [NoMethodError] always, naming the object and its directory
    def method_missing(name, *_args)
      raise NoMethodError, "`#{@object}.#{name}` is not one of the names this run offers; #{@hint}"
    end

    # @param name [Symbol] the method being asked about
    # @param include_private [Boolean] whether private methods count, as Ruby's contract requires
    # @return [Boolean] whether this object really binds `name`
    def respond_to_missing?(name, include_private = false)
      @members.key?(name.to_s) || super
    end

    # @return [String] the object's name and the functions on it
    def inspect
      "#<gg #{@object}: #{@members.keys.sort.join(", ")}>"
    end

    alias to_s inspect
  end

  # The names a program is given: the API objects, and the types they speak in.
  #
  # Two things are built here, and the difference between them is the whole of gg's capability
  # model as this guest sees it.
  #
  # **The API objects are built from the run.** One per `Catalogue::OBJECT_FOR_MODULE` namespace
  # with at least one function this run offers, each carrying the functions it offers and the
  # `list` directory every object has, installed as a method on `Object` — which is exactly what a
  # top-level `def` in Ruby produces, so `fs.read_file("main.rb")` works in a program with no
  # `require` line and no receiver.
  #
  # **It is not the enforcement.** A program can reach `GG::Files.read_file` directly and gg is
  # built for that: the **host** refuses a call outside the run's enabled set, whichever name the
  # program used to make it. What is built here is the *surface*, and the surface is what a model
  # reads.
  #
  # **The types are built from the SDK.** Every declaration `Catalogue::TYPES` names is bound
  # unconditionally, because a type is not a capability: `ToolError` is what a `rescue` clause
  # catches and `TaskStatus::DONE` is what a status argument is, and a program that could not name
  # them would have to reach for a string.
  #
  # @api private
  module Scope
    # The SDK modules, keyed by the name `Catalogue` files each function under.
    MODULES = {
      "Shell" => Shell,
      "Files" => Files,
      "Skills" => Skills,
      "Memories" => Memories,
      "Tasks" => Tasks,
      "Board" => Board,
      "Context" => Context,
      "Delegation" => Delegation,
      "Views" => Views,
      "Programs" => Programs,
      "Session" => Session,
      "Helpers" => Helpers
    }.freeze

    # The object names installed by the last `install`, so a second run does not leave the first
    # run's surface behind.
    @installed = []

    class << self
      # @return [Array<String>] the object names currently installed on `Object`
      attr_reader :installed
    end

    # The method `name` on `mod`, or nil when the module does not define one.
    #
    # A catalogue entry naming something a module does not define is then a missing name in
    # `bound_tools` — which gg compares against its own vocabulary — rather than a `nil` a program
    # would discover by calling it.
    #
    # @param mod [Module] the SDK module
    # @param name [String] the method name the catalogue gives
    # @return [Method, nil] the bound method, or nil
    def self.exported(mod, name)
      mod.respond_to?(name) ? mod.method(name) : nil
    end

    # The gg tool names this component can bind.
    #
    # gg calls this export in a unit test and asserts set-equality with its own `ALL_TOOL_NAMES`.
    # It is the one drift gate that inspects the **committed artifact** rather than a source file,
    # so it catches the failure no compiler can: a tool added, renamed or removed in gg, with a
    # stale `.wasm` still checked in.
    #
    # @return [Array<String>] every gg tool this SDK really defines a method for
    def self.bound_tools
      Catalogue::TOOLS.select { |(_tool, method, mod)| exported(MODULES[mod], method) }
                      .map { |(tool, _method, _mod)| tool }
    end

    # The API objects a program is given, each carrying the functions this run offers on it.
    #
    # An object with nothing on it is not built at all, so a run with no board tools has no
    # `project` name rather than an empty one.
    #
    # @param enabled [Array<String>] the run's enabled gg tool names
    # @param ending [String] the role whose ending group this program is given; `none` binds no
    #   ending at all, which is what an on-use script runs under
    # @param library [Boolean] whether this agent keeps a program library
    # @return [Hash{String => ApiObject}] the objects, keyed by the name a program calls
    def self.build_objects(enabled, ending, library)
      on = enabled.to_a
      objects = {}
      # Fetch (creating on first use) one object's members, seeded with the directory every object
      # shares.
      object_for = lambda do |name|
        objects[name] ||= Catalogue::META.each_with_object({}) do |(_key, method), members|
          members[method] = Docs.bind_list(name)
        end
      end

      Catalogue::TOOLS.each do |(tool, method, mod)|
        next unless on.include?(tool)

        callable = exported(MODULES[mod], method)
        object_for.call(Catalogue::OBJECT_FOR_MODULE[mod])[method] = callable if callable
      end

      # A helper lives on the object of the tool it is built on, and is bound exactly when that
      # tool is.
      Catalogue::HELPERS.each do |(_key, method, requires)|
        next unless on.include?(requires)

        callable = exported(Helpers, method)
        object_for.call(Catalogue::OBJECT_FOR_MODULE["Helpers"])[method] = callable if callable
      end

      # `view`: always present, on the same carve-out `harness` has — a run that enables no tools
      # at all must still be able to show its model something, and a view is the only channel that
      # reaches it. `open_file` is the one exception: it is a read, so it is offered exactly when
      # `read_file` is.
      view = object_for.call(Catalogue::OBJECT_FOR_MODULE["Views"])
      Catalogue::VIEWS.each do |(_key, method, requires)|
        next if !requires.nil? && !on.include?(requires)

        callable = exported(Views, method)
        view[method] = callable if callable
      end

      # `programs`: the whole object, or no object at all. It is the one family a *capability*
      # gates rather than a tool or a role, so the host says so with a flag instead of a name.
      if library
        object = object_for.call(Catalogue::OBJECT_FOR_MODULE["Programs"])
        Catalogue::PROGRAMS.each do |(_key, method)|
          callable = exported(Programs, method)
          object[method] = callable if callable
        end
      end

      # The one ending group this role produces: what is not this role's ending is not a name.
      Catalogue::SESSION.each do |(_key, method, object_name, role)|
        next unless role == ending

        callable = exported(Session, method)
        object_for.call(object_name)[method] = callable if callable
      end

      objects.each_with_object({}) do |(name, members), out|
        out[name] = ApiObject.new(name, members)
      end
    end

    # Bind every name a program starts with: the API objects this run offers, and the SDK's types.
    #
    # The objects become methods on `Object`, which is what a top-level `def` in Ruby produces, and
    # the types become top-level constants. Both are re-installed on every run and the previous
    # run's objects are removed first, so one instantiation serving two programs never leaves a
    # name behind that this run did not offer.
    #
    # @param enabled [Array<String>] the run's enabled gg tool names
    # @param ending [String] the role whose ending group this program is given
    # @param library [Boolean] whether this agent keeps a program library
    # @return [Array<String>] the API object names a program may reach, in presentation order
    def self.install(enabled, ending, library)
      objects = build_objects(enabled, ending, library)

      @installed.each { |name| Object.send(:remove_method, name) if Object.method_defined?(name) }
      objects.each do |name, api|
        Object.send(:define_method, name) { api }
      end
      @installed = objects.keys

      Catalogue::TYPES.each do |name|
        Object.const_set(name, GG.const_get(name)) unless Object.const_defined?(name)
      end
      Object.const_set(:UNCHANGED, UNCHANGED) unless Object.const_defined?(:UNCHANGED)

      Catalogue::OBJECT_ORDER.select { |name| objects.key?(name) }
    end

    # Bind the code modules `GG::Lib` collected at `lib.<key>`, or remove `lib` when there are
    # none.
    #
    # @return [Boolean] whether a `lib` name was installed
    def self.install_lib
      name = Catalogue::LIB_OBJECT
      Object.send(:remove_method, name) if Object.method_defined?(name)
      modules = Lib.registry
      return false if modules.empty?

      members = modules.each_with_object({}) do |(key, namespace), out|
        out[key] = -> { namespace }
      end
      lib = ApiObject.new(name, members,
                          "the keys gg named when it answered the read are the ones it has")
      Object.send(:define_method, name) { lib }
      true
    end
  end

  # Reflect every SDK function's calling shape ONCE, here, at load time — so it is baked into the
  # component's pre-initialised snapshot rather than recomputed on every turn. See
  # {GG::ApiObject::SHAPES} for what that is worth in milliseconds.
  ApiObject.precompute(Scope::MODULES.values)
end
