-- | **The bridge** — the one module in this SDK that knows there is a JavaScript side at all.
-- |
-- | Nothing here is model-facing. A program never imports this module, no catalogue entry describes
-- | it, and no prompt names it; what a model reads is the typed, namespaced surface the `Gg.*`
-- | modules build on top of it. That split is the seam's rule about a hand-written SDK: the SDK
-- | bridges its own idiom onto the wire, and the model never sees the bridge.
-- |
-- | # What the far side of the bridge is
-- |
-- | Not the WIT membrane. A compiled PureScript program is evaluated by the **shared ECMAScript
-- | guest**, which builds a program's scope out of the run's enabled tools and evaluates the program
-- | as the body of a function whose parameters are the API objects (`fs`, `system`, `view`, …). So
-- | the objects this module reaches are exactly the ones a TypeScript program reaches, and every
-- | call lands in the same lowering — the same argument validation, the same `u64` conversions, the
-- | same `ToolError`. That is not a compromise: it is what makes two arms of a study produce byte
-- | identical arguments for the same capability, which is the property the whole comparison rests
-- | on.
-- |
-- | It also means a **withheld** capability is not a name in the enclosing scope, exactly as it is
-- | not for a TypeScript program. `Gg/Internal/Wire.js` answers that with a `ToolError` carrying
-- | `unavailable` — the code the host itself refuses an out-of-set call with — rather than letting
-- | a `ReferenceError` out, so a program that reached for a capability this run withheld reads the
-- | same sentence in every arm.
-- |
-- | # Why a dispatcher is fine *here*
-- |
-- | [`call`](#v:call) takes the object and function name as data, which is precisely the shape the
-- | seam forbids a model-facing surface from having. The rule is about what the model writes: a
-- | dispatcher a *model* calls moves the whole surface out of the type system and into a string it
-- | has to remember. Below the typed functions, where nobody reads the output and the strings are
-- | written once by hand beside the function that uses them, one bridge is one place for the
-- | crossing to be right.
module Gg.Internal.Wire
  ( Wire
  , call
  , call_
  , wire
  , taken
  , lower
  , pick
  , field
  , text
  , optional
  ) where

import Prelude

import Data.Maybe (Maybe)
import Data.Nullable (Nullable, toMaybe)
import Effect (Effect)
import Unsafe.Coerce (unsafeCoerce)

-- | A value on the JavaScript side of the bridge: an argument on its way out, or a result on its
-- | way in.
-- |
-- | Opaque on purpose. Every `Wire` is made by [`wire`](#v:wire) and read by a function that knows
-- | what shape it is, and the compiler cannot check the step in between — so keeping the type
-- | opaque keeps the number of places that step happens down to this module and the SDK modules
-- | that call it.
foreign import data Wire :: Type

-- | Call one function on one of the guest's API objects.
-- |
-- | `tool` is the gg tool name the failure is reported under when the run withheld the capability;
-- | `object` and `name` are the guest's own spellings, which are the TypeScript SDK's.
foreign import callImpl :: String -> String -> String -> Array Wire -> Effect Wire

-- | Lower a record by converting the fields a converter is given for, and passing every other
-- | field through untouched.
-- |
-- | A PureScript record **is** a JavaScript object, so most of the time nothing has to happen at
-- | all. What does need converting is the handful of fields whose PureScript representation is not
-- | the wire's: a `Maybe` (which is a tagged object here and a `null` there) and an enumeration
-- | (which is a constructor here and a string there).
-- |
-- | Only the keys the record actually carries are walked, which is what makes an *absent* optional
-- | argument stay absent rather than becoming an explicit `null` — the difference, on a patch
-- | field, between leaving a value alone and clearing it.
foreign import lowerImpl :: Wire -> Wire -> Wire

-- | Read one property off a JavaScript value, without knowing anything about it.
foreign import fieldImpl :: String -> Wire -> Wire

-- | Send a PureScript value across as it stands.
wire :: forall a. a -> Wire
wire = unsafeCoerce

-- | Take a JavaScript value as the PureScript type the caller says it is.
taken :: forall a. Wire -> a
taken = unsafeCoerce

-- | Call a function that answers with something.
call :: forall a. String -> String -> String -> Array Wire -> Effect a
call tool object name args = taken <$> callImpl tool object name args

-- | Call a function whose answer is nothing worth having.
call_ :: String -> String -> String -> Array Wire -> Effect Unit
call_ tool object name args = void (callImpl tool object name args)

-- | A record of optional arguments, with the fields named in `converters` converted on the way out.
lower :: forall converters given. Record converters -> Record given -> Wire
lower converters given = lowerImpl (wire converters) (wire given)

-- | One field of an optional-argument record, as the positional argument the guest's own function
-- | takes — `undefined` when the record does not carry it, which is what "not given" is on that
-- | side.
pick :: forall given. String -> Record given -> Wire
pick name given = fieldImpl name (wire given)

-- | One field of a result, as the PureScript type the caller says it is.
field :: forall a. String -> Wire -> a
field name value = taken (fieldImpl name value)

-- | One field of a result that the wire may leave out.
optional :: forall a. String -> Wire -> Maybe a
optional name value = toMaybe (taken (fieldImpl name value) :: Nullable a)

-- | One field of a result that is text — the one type read often enough to be worth a name of its
-- | own, since every other read carries its type in the record it is building.
text :: String -> Wire -> String
text = field
