/**
 * The window shortcuts the system menu bar used to carry.
 *
 * `Ctrl +`, `Ctrl -`, `Ctrl 0`, `F11` and `Ctrl+Shift+I` worked only because
 * they were accelerators on a `View` menu: Electron registers a role's
 * accelerator with the menu, not with the window. The menu is gone, so the
 * chords are matched here instead, from the raw key event, before the page
 * sees them. None of them is a shortcut the editor itself uses — canvas zoom
 * is the wheel and `F` — so taking them costs the schematic nothing.
 */

export type WindowCommand =
  "zoom-in" | "zoom-out" | "zoom-reset" | "fullscreen" | "devtools";

/** The part of Electron's `before-input-event` input this decision reads. */
export interface KeyChord {
  type: string;
  key: string;
  control: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

/** Which window command a key press asks for, or null for the page's own keys. */
export function windowCommand(input: KeyChord): WindowCommand | null {
  if (input.type !== "keyDown" || input.alt || input.meta) return null;
  if (input.key === "F11") return input.control ? null : "fullscreen";
  if (!input.control) return null;
  if (input.shift) return input.key === "I" ? "devtools" : zoom(input.key);
  return zoom(input.key);
}

/**
 * `Shift` is not excluded from the zoom chords on purpose: on most layouts
 * `+` is `Shift` and `=` together, so the chord a person means by "Ctrl plus"
 * arrives with `Shift` held.
 */
function zoom(key: string): WindowCommand | null {
  if (key === "0") return "zoom-reset";
  if (key === "=" || key === "+") return "zoom-in";
  if (key === "-" || key === "_") return "zoom-out";
  return null;
}

/** One press of Ctrl + or Ctrl -, the same half-step the menu role used. */
export const ZOOM_STEP = 0.5;

/**
 * How far the window zoom may go either way. Electron's zoom level is an
 * exponent — the factor is `1.2 ** level` — so four steps is roughly half size
 * to double size. The limit exists because a schematic editor whose chrome has
 * been zoomed to illegibility has no menu left to undo it with.
 */
export const ZOOM_LEVEL_LIMIT = 4;

export function steppedZoomLevel(
  level: number,
  command: WindowCommand,
): number | null {
  if (command === "zoom-reset") return 0;
  const direction = command === "zoom-in" ? 1 : command === "zoom-out" ? -1 : 0;
  if (direction === 0) return null;
  return Math.max(
    -ZOOM_LEVEL_LIMIT,
    Math.min(ZOOM_LEVEL_LIMIT, level + direction * ZOOM_STEP),
  );
}
