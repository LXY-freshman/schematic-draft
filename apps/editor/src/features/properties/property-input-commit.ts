import type { FocusEvent, KeyboardEvent } from "react";

/**
 * Text fields commit on blur so one authored edit is one transaction. A
 * rejected commit does not bump the document revision, so the keyed input
 * would keep the refused text; restore what the model still holds instead.
 */
export function commitPropertyInput(
  event: FocusEvent<HTMLInputElement>,
  savedValue: string,
  commit: (value: string) => boolean | void,
): void {
  if (commit(event.currentTarget.value) === false) {
    event.currentTarget.value = savedValue;
  }
}

/** Enter commits through blur; Escape abandons the draft text. */
export function handlePropertyInputKeyDown(
  event: KeyboardEvent<HTMLInputElement>,
  savedValue: string,
): void {
  if (event.key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.blur();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.value = savedValue;
    event.currentTarget.blur();
  }
}
