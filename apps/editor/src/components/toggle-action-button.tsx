export interface ToggleActionButtonProps {
  /** Names the state the button turns on, and never changes with it. */
  label: string;
  pressed: boolean;
  disabled?: boolean | undefined;
  help?: string | undefined;
  testId?: string | undefined;
  onToggle(pressed: boolean): void;
}

/**
 * A button that stays held down while the state it turned on is on. The label
 * is fixed and `aria-pressed` carries the state, wearing the same accent frame
 * a chosen colour swatch does.
 *
 * The alternative — a label that rewrites itself to name the undo, the way
 * **Highlight Net** became **Clear Net highlight** — asks the reader to infer
 * the current state from the offer to leave it, and moves the button's name
 * out from under anything that clicks it by name.
 */
export function ToggleActionButton({
  label,
  pressed,
  disabled = false,
  help,
  testId,
  onToggle,
}: ToggleActionButtonProps) {
  return (
    <button
      type="button"
      className="toggle-action-button"
      data-testid={testId}
      aria-pressed={pressed}
      disabled={disabled}
      title={help}
      onClick={() => onToggle(!pressed)}
    >
      {label}
    </button>
  );
}
