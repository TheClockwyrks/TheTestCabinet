import { useEffect, useState } from "react";

/**
 * The value `input`, but only after it has stopped changing for `delayMs` — so a
 * fast-typed search box settles before it drives an expensive effect (a server
 * query). Each change restarts the timer; the latest value wins. `delayMs` of 0
 * updates synchronously on the next tick.
 */
export function useDebouncedValue<T>(input: T, delayMs: number): T {
  const [value, setValue] = useState(input);
  useEffect(() => {
    const handle = setTimeout(() => setValue(input), delayMs);
    return () => clearTimeout(handle);
  }, [input, delayMs]);
  return value;
}
