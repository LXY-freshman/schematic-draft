import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  annotationPropertyFields,
  serializeAnnotationPropertyCode,
  type AnnotationPropertyValue,
  type PropertyResult,
} from "./annotation-property-code";
import { ColorOverrideControl } from "./color-override-control";
import { PropertyDisclosure } from "./property-disclosure";
import {
  commitPropertyInput,
  handlePropertyInputKeyDown,
} from "./property-input-commit";

type Appearance = AnnotationPropertyValue["appearance"];
type Geometry = NonNullable<AnnotationPropertyValue["geometry"]>;

/**
 * The default surface for an annotation or a drawing: one control per field the
 * object actually has. It edits the same {@link AnnotationPropertyValue} the
 * code editor edits and commits through the caller's parse and apply functions,
 * with the JSON collapsed underneath as the exact-editing escape hatch.
 */
export function AnnotationPropertyForm<T>({
  value,
  colorLabel,
  parse,
  onApply,
  defaultColor,
  title,
  codeAriaLabel,
  ownedByActions = [],
  contentHint,
  actions,
  code,
}: {
  value: AnnotationPropertyValue;
  /** Names the ink this object draws with: Text, Border, or Stroke. */
  colorLabel: string;
  parse(source: string): PropertyResult<T>;
  onApply(value: T): { ok: boolean; message?: string };
  defaultColor: string;
  title: string;
  codeAriaLabel: string;
  /** Paths the panel's own buttons own; the form draws no second control. */
  ownedByActions?: readonly string[];
  contentHint?: string;
  actions?: ReactNode;
  code: ReactNode;
}) {
  const baseline = useMemo(
    () => serializeAnnotationPropertyCode(value),
    [value],
  );
  const fields = useMemo(
    () => annotationPropertyFields(colorLabel),
    [colorLabel],
  );
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => setMessage(null), [baseline]);

  const commit = (next: AnnotationPropertyValue): boolean => {
    const source = serializeAnnotationPropertyCode(next);
    if (source === baseline) return true;
    // Validate through the code surface's own parser rather than a second set
    // of rules: one value type, one vocabulary of errors, one apply function.
    const parsed = parse(source);
    if (!parsed.ok) {
      setMessage(parsed.message);
      return false;
    }
    const result = onApply(parsed.value);
    setMessage(
      result.ok ? null : (result.message ?? "Annotation edit was rejected"),
    );
    return result.ok;
  };
  const commitAppearance = (patch: Partial<Appearance>): boolean =>
    commit({ ...value, appearance: { ...value.appearance, ...patch } });
  const commitGeometry = (patch: Partial<Geometry>): boolean =>
    commit({ ...value, geometry: { ...value.geometry, ...patch } });

  // A locked object rejects every edit but the unlocking one, so the controls
  // say so instead of collecting text the parser will refuse.
  const locked = value.locked;
  const owns = (path: string): boolean => ownedByActions.includes(path);

  /** Keyed by the serialized value: an accepted edit refreshes the defaults. */
  const numberField = (
    ariaLabel: string,
    label: string,
    current: number,
    apply: (parsed: number) => boolean,
  ): ReactNode => (
    <label>
      {label}
      <input
        key={`${baseline}-${ariaLabel}`}
        aria-label={ariaLabel}
        inputMode="decimal"
        disabled={locked}
        defaultValue={String(current)}
        onBlur={(event) =>
          commitPropertyInput(event, String(current), (raw) => {
            const parsed = Number(raw.trim());
            if (raw.trim() === "" || !Number.isFinite(parsed)) return false;
            return apply(parsed);
          })
        }
        onKeyDown={(event) =>
          handlePropertyInputKeyDown(event, String(current))
        }
      />
    </label>
  );

  /** One labelled select per choice field, so the form and the JSON agree. */
  const choiceField = (
    path: string,
    ariaLabel: string,
    current: string | number | boolean,
    apply: (raw: string) => boolean,
  ): ReactNode => {
    const definition = fields.find((candidate) => candidate.path === path);
    if (!definition) return null;
    const options = definition.options ?? [];
    return (
      <label key={path} title={definition.help}>
        {definition.label}
        <select
          aria-label={ariaLabel}
          disabled={locked && path !== "locked"}
          value={String(current)}
          onChange={(event) => apply(event.currentTarget.value)}
        >
          {options.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label}
            </option>
          ))}
          {/* An authored angle the preset list does not carry stays selectable
              rather than silently snapping to the nearest preset. */}
          {options.some(
            (option) => String(option.value) === String(current),
          ) ? null : (
            <option value={String(current)}>{String(current)}</option>
          )}
        </select>
      </label>
    );
  };

  const placement = value.placement;
  const appearance = value.appearance;
  const geometry = value.geometry;
  const sized =
    geometry?.width !== undefined ||
    geometry?.height !== undefined ||
    geometry?.radius !== undefined;
  const displayed =
    (value.stacking !== undefined && !owns("stacking.layer")) ||
    value.display !== undefined ||
    !owns("locked");

  return (
    <>
      <div className="property-section-heading">{title}</div>
      <PropertyDisclosure
        title="Placement"
        ariaLabel="Annotation placement"
        defaultOpen
      >
        {placement.at ? (
          <div className="component-geometry-row" aria-label="Annotation spot">
            {numberField("Annotation X position", "X", placement.at[0], (x) =>
              commit({
                ...value,
                placement: {
                  ...placement,
                  at: [Math.round(x), placement.at![1]],
                },
              }),
            )}
            {numberField("Annotation Y position", "Y", placement.at[1], (y) =>
              commit({
                ...value,
                placement: {
                  ...placement,
                  at: [placement.at![0], Math.round(y)],
                },
              }),
            )}
          </div>
        ) : (
          // An attached anchor follows what it labels; the path anchor is not a
          // second place to move it from.
          <small>
            Attached to the object it labels. Drag it on the canvas to move it.
          </small>
        )}
        {placement.rotation === undefined
          ? null
          : choiceField(
              "placement.rotation",
              "Annotation rotation",
              placement.rotation,
              (raw) =>
                commit({
                  ...value,
                  placement: { ...placement, rotation: Number(raw) },
                }),
            )}
      </PropertyDisclosure>
      <PropertyDisclosure
        title="Appearance"
        ariaLabel="Annotation appearance"
        defaultOpen
      >
        <ColorOverrideControl
          label={colorLabel}
          value={appearance.color === "auto" ? undefined : appearance.color}
          fallback={defaultColor}
          disabled={locked}
          onChange={(color) =>
            commitAppearance({
              color: color ? (color as `#${string}`) : "auto",
            })
          }
        />
        {appearance.fillColor === undefined ? null : (
          <ColorOverrideControl
            label="Fill"
            value={
              appearance.fillColor === "auto" ? undefined : appearance.fillColor
            }
            fallback="#ffffff"
            transparentDefault
            autoTitle="Leave the shape unfilled"
            disabled={locked}
            onChange={(fillColor) =>
              commitAppearance({
                fillColor: fillColor ? (fillColor as `#${string}`) : "auto",
              })
            }
          />
        )}
        {appearance.lineStyle === undefined
          ? null
          : choiceField(
              "appearance.lineStyle",
              "Annotation line style",
              appearance.lineStyle,
              (raw) =>
                commitAppearance({
                  lineStyle: raw as Appearance["lineStyle"],
                }),
            )}
        {appearance.strokeScale === undefined
          ? null
          : numberField(
              "Annotation stroke width",
              "Stroke width ×",
              appearance.strokeScale,
              (strokeScale) => commitAppearance({ strokeScale }),
            )}
        {appearance.arrowShape === undefined
          ? null
          : choiceField(
              "appearance.arrowShape",
              "Annotation arrow shape",
              appearance.arrowShape,
              (raw) =>
                commitAppearance({
                  arrowShape: raw as Appearance["arrowShape"],
                }),
            )}
        {appearance.startStyle === undefined
          ? null
          : choiceField(
              "appearance.startStyle",
              "Annotation start style",
              appearance.startStyle,
              (raw) =>
                commitAppearance({
                  startStyle: raw as Appearance["startStyle"],
                }),
            )}
        {appearance.endStyle === undefined
          ? null
          : choiceField(
              "appearance.endStyle",
              "Annotation end style",
              appearance.endStyle,
              (raw) =>
                commitAppearance({ endStyle: raw as Appearance["endStyle"] }),
            )}
        {appearance.sizeScale === undefined
          ? null
          : numberField(
              "Annotation text size",
              "Text size ×",
              appearance.sizeScale,
              (sizeScale) => commitAppearance({ sizeScale }),
            )}
        {appearance.weight === undefined
          ? null
          : choiceField(
              "appearance.weight",
              "Annotation text weight",
              appearance.weight,
              (raw) =>
                commitAppearance({ weight: raw as Appearance["weight"] }),
            )}
        {appearance.italic === undefined
          ? null
          : choiceField(
              "appearance.italic",
              "Annotation italic",
              appearance.italic,
              (raw) => commitAppearance({ italic: raw === "true" }),
            )}
        {appearance.alignment === undefined
          ? null
          : choiceField(
              "appearance.alignment",
              "Annotation text alignment",
              appearance.alignment,
              (raw) =>
                commitAppearance({
                  alignment: raw as Appearance["alignment"],
                }),
            )}
      </PropertyDisclosure>
      {sized ? (
        <PropertyDisclosure
          title="Size"
          ariaLabel="Annotation size"
          defaultOpen
        >
          {geometry?.width === undefined
            ? null
            : numberField(
                "Annotation width",
                "Width",
                geometry.width,
                (width) => commitGeometry({ width }),
              )}
          {geometry?.height === undefined
            ? null
            : numberField(
                "Annotation height",
                "Height",
                geometry.height,
                (height) => commitGeometry({ height: Math.round(height) }),
              )}
          {geometry?.radius === undefined
            ? null
            : numberField(
                "Annotation radius",
                "Radius",
                geometry.radius,
                (radius) => commitGeometry({ radius: Math.round(radius) }),
              )}
        </PropertyDisclosure>
      ) : null}
      {displayed ? (
        <PropertyDisclosure
          title="Display"
          ariaLabel="Annotation display"
          defaultOpen
        >
          {value.stacking === undefined || owns("stacking.layer")
            ? null
            : choiceField(
                "stacking.layer",
                "Annotation layer",
                value.stacking.layer,
                (raw) =>
                  commit({
                    ...value,
                    stacking: { layer: raw as "back" | "front" },
                  }),
              )}
          {value.display === undefined
            ? null
            : choiceField(
                "display.visible",
                "Annotation visibility",
                value.display.visible,
                (raw) =>
                  commit({ ...value, display: { visible: raw === "true" } }),
              )}
          {owns("locked")
            ? null
            : choiceField("locked", "Annotation lock", locked, (raw) =>
                commit({ ...value, locked: raw === "true" }),
              )}
        </PropertyDisclosure>
      ) : null}
      {contentHint ? <small>{contentHint}</small> : null}
      {actions}
      <PropertyDisclosure
        title="Code (JSON)"
        ariaLabel={codeAriaLabel}
        mountWhenOpen
      >
        {code}
      </PropertyDisclosure>
      {message ? (
        <div className="component-property-code-status" aria-live="polite">
          <span>{message}</span>
        </div>
      ) : null}
    </>
  );
}
