import type { ComponentProps } from "react";
import styles from "./Textarea.module.scss";
import { controlClass } from "./controlClass";

export interface TextareaProps extends ComponentProps<"textarea"> {
  /** Whether the field's value is refused; drawn with the negative border. */
  invalid?: boolean;
}

/** A multi-line text control: the shared treatment, resizable downward. */
export function Textarea({ invalid, className, ...rest }: TextareaProps) {
  return (
    <textarea
      {...rest}
      aria-invalid={invalid ? true : rest["aria-invalid"]}
      className={controlClass(styles.textarea, className)}
    />
  );
}
