import {
  commitPropertyInput,
  handlePropertyInputKeyDown,
} from "./property-input-commit";

/** The range every stroke multiplier in this editor shares. */
export const STROKE_SCALE_MIN = 0.25;
export const STROKE_SCALE_MAX = 4;
/** A quarter of the profile weight is the smallest step worth drawing. */
export const STROKE_SCALE_STEP = 0.25;

/**
 * How much heavier or lighter than usual one object is drawn.
 *
 * The multiplier is free within the range drafting objects already use, so a
 * wire singled out for emphasis and an arrow pointing at it can be given the
 * same weight. One means the profile weight, which is what an object with no
 * override is drawn at — so this control has no empty state: everything on the
 * page already has a width, and this only says how far from it to go.
 *
 * Nothing electrical follows from it. A heavier wire carries no more current
 * and a heavier symbol is the same device.
 */
export function StrokeScaleField({
  ariaLabel,
  label,
  value,
  help,
  resetKey,
  onCommit,
}: {
  ariaLabel: string;
  label: string;
  value: number;
  help?: string | undefined;
  /** Changes when the committed value may have, to reset the typed draft. */
  resetKey: string;
  onCommit(scale: number): boolean;
}) {
  const saved = String(value);
  return (
    <label title={help}>
      {label}
      <input
        key={`${resetKey}-${ariaLabel}`}
        type="number"
        aria-label={ariaLabel}
        inputMode="decimal"
        min={STROKE_SCALE_MIN}
        max={STROKE_SCALE_MAX}
        step={STROKE_SCALE_STEP}
        defaultValue={saved}
        onBlur={(event) =>
          commitPropertyInput(event, saved, (raw) => {
            const parsed = Number(raw.trim());
            if (
              raw.trim() === "" ||
              !Number.isFinite(parsed) ||
              parsed < STROKE_SCALE_MIN ||
              parsed > STROKE_SCALE_MAX
            )
              return false;
            return onCommit(parsed);
          })
        }
        onKeyDown={(event) => handlePropertyInputKeyDown(event, saved)}
      />
    </label>
  );
}
