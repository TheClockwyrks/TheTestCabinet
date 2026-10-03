import type { ComponentProps } from "react";
import styles from "./Input.module.scss";
import { controlClass } from "./controlClass";

export interface InputProps extends ComponentProps<"input"> {
  /** Whether the field's value is refused; drawn with the negative border. */
  invalid?: boolean;
}

/**
 * A text-entry control. It fills its container, so a caller sizes it by the box
 * it sits in; every other aspect of its look is the shared control treatment.
 */
export function Input({ invalid, className, ...rest }: InputProps) {
  return (
    <input
      {...rest}
      aria-invalid={invalid ? true : rest["aria-invalid"]}
      className={controlClass(styles.input, className)}
    />
  );
}
