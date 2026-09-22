import { useEffect, useMemo, useState } from "react";

import { deviceDescriptor } from "@icm/devices";

import type { ComponentParameter } from "../component-insert/component-parameters";
import { DisplayToggle } from "../component-insert/display-toggle";
import { ColorOverrideControl } from "./color-override-control";
import { ModelTargetControl } from "./component-model-target-control";
import {
  componentPropertyCodeValue,
  parseComponentPropertyCode,
  serializeComponentPropertyCode,
  type ComponentPropertyCodeValue,
} from "./component-property-code";
import { ComponentPropertyCodeEditor } from "./component-property-code-editor";
import { componentSymbolOptions } from "./component-property-details";
import { componentPropertyFields } from "./component-property-field-list";
import { MIRROR_OPTIONS, ROTATION_OPTIONS } from "./component-property-fields";
import {
  useComponentPropertyCodeContext,
  type ComponentPropertySurfaceProps,
} from "./component-property-surface";
import { NO_INTERNAL_MARK } from "./component-visual-variants";
import { PropertyDisclosure } from "./property-disclosure";
import {
  commitPropertyInput,
  handlePropertyInputKeyDown,
} from "./property-input-commit";

export interface ComponentPropertyFormProps extends ComponentPropertySurfaceProps {
  /** Read-only binding summary for a component with no editable model target. */
  targetDescription?: string | null;
  /** The bound model is a reviewed external `.subckt`, not a device model. */
  externalSubcircuit?: boolean;
}

interface ParameterRow {
  key: string;
  label: string;
  unit?: string | undefined;
  help?: string | undefined;
  placeholder?: string | undefined;
  inputMode?: ComponentParameter["inputMode"];
  options?: readonly { readonly value: string; readonly label: string }[];
}

/** Descriptor parameters first, then whatever raw overrides the netlist carries. */
function parameterRows(
  parameters: Readonly<Record<string, string>>,
  known: readonly ComponentParameter[],
  authored: Readonly<Record<string, string>> | undefined,
  waveform: string | undefined,
): ParameterRow[] {
  const rows: ParameterRow[] = [];
  const used = new Set<string>();
  for (const parameter of known) {
    if (parameter.compatibilityOnly) continue;
    if (!(parameter.key in parameters)) continue;
    // A waveform-specific parameter belongs to the waveform that uses it, but
    // an authored value must stay reachable even after the waveform changed.
    if (
      parameter.visibleForSourceWaveforms &&
      !parameter.visibleForSourceWaveforms.some(
        (candidate) => candidate === waveform,
      ) &&
      authored?.[parameter.key] === undefined
    )
      continue;
    used.add(parameter.key);
    rows.push({
      key: parameter.key,
      label: parameter.label,
      unit: parameter.unit,
      help: parameter.help,
      placeholder: parameter.placeholder,
      inputMode: parameter.inputMode,
      ...(parameter.options ? { options: parameter.options } : {}),
    });
  }
  for (const key of Object.keys(parameters)) {
    if (used.has(key)) continue;
    rows.push({ key, label: key, help: "Raw netlist override" });
  }
  return rows;
}

function pairs<T>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += 2)
    rows.push(items.slice(index, index + 2));
  return rows;
}

/**
 * The default component property surface: one control per available field,
 * editing the same {@link ComponentPropertyCodeValue} the code editor edits and
 * committing through the same apply function. The JSON stays underneath as the
 * exact-editing escape hatch, so neither surface owns a private edit path.
 */
export function ComponentPropertyForm(props: ComponentPropertyFormProps) {
  const {
    targetDescription = null,
    externalSubcircuit = false,
    ...surface
  } = props;
  const {
    instance,
    revision,
    defaultForeground = "#000000",
    details,
    onApply,
  } = surface;
  const context = useComponentPropertyCodeContext(surface);
  const value = useMemo(
    () => componentPropertyCodeValue(context),
    [context, revision],
  );
  const baseline = useMemo(
    () => serializeComponentPropertyCode(value),
    [value],
  );
  const fields = useMemo(() => componentPropertyFields(context), [context]);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => setMessage(null), [baseline]);

  const field = (path: string) => fields.find((item) => item.path === path);
  const label = (path: string, fallback: string): string =>
    field(path)?.label ?? fallback;
  const help = (path: string): string | undefined => field(path)?.help;

  const commit = (next: ComponentPropertyCodeValue): boolean => {
    const source = serializeComponentPropertyCode(next);
    if (source === baseline) return true;
    // Validate through the code surface's own parser rather than a second set
    // of rules: one value type, one vocabulary of errors, one apply function.
    const parsed = parseComponentPropertyCode(source, context);
    if (!parsed.ok) {
      setMessage(parsed.message);
      return false;
    }
    const result = onApply(parsed.value);
    setMessage(result.ok ? null : result.message);
    return result.ok;
  };

  const placement = value.placement;
  const commitCoordinate = (axis: 0 | 1, raw: string): boolean => {
    if (!placement) return false;
    const parsed = Number(raw.trim());
    if (raw.trim() === "" || !Number.isFinite(parsed)) return false;
    const coordinate: [number, number] =
      axis === 0
        ? [parsed, placement.coordinate[1]]
        : [placement.coordinate[0], parsed];
    return commit({ ...value, placement: { ...placement, coordinate } });
  };
  const commitDisplay = (
    patch: Partial<NonNullable<ComponentPropertyCodeValue["display"]>>,
  ): boolean => commit({ ...value, display: { ...value.display, ...patch } });
  const commitAppearance = (
    patch: Partial<ComponentPropertyCodeValue["appearance"]>,
  ): boolean =>
    commit({ ...value, appearance: { ...value.appearance, ...patch } });

  const descriptor = deviceDescriptor(instance.symbolId);
  const waveform =
    value.parameters?.waveform || descriptor?.sourceWaveformDefault;
  const rows = value.parameters
    ? parameterRows(
        value.parameters,
        details?.parameters ?? [],
        instance.netlist?.parameters,
        waveform,
      )
    : [];
  const displayParameters = fields.filter((item) =>
    item.path.startsWith("display.parameters."),
  );
  const identityAvailable =
    value.netlistName !== undefined ||
    value.displayName !== undefined ||
    value.connection !== undefined ||
    value.netName !== undefined ||
    value.symbol !== undefined ||
    targetDescription !== null;
  const displayAvailable =
    value.display?.visualAnnotation !== undefined ||
    value.display?.value !== undefined ||
    displayParameters.length > 0;
  const internalMark = value.appearance.internalMark;

  return (
    <>
      {placement ? (
        <PropertyDisclosure
          title="Placement"
          className="property-placement-card"
          ariaLabel="Component placement"
          defaultOpen
        >
          <div
            className="component-geometry-row"
            aria-label="Component geometry"
          >
            <label title={help("placement.coordinate")}>
              X
              <input
                key={`${instance.id}-${revision}-x`}
                aria-label="Component X position"
                inputMode="decimal"
                defaultValue={String(placement.coordinate[0])}
                onBlur={(event) =>
                  commitPropertyInput(
                    event,
                    String(placement.coordinate[0]),
                    (raw) => commitCoordinate(0, raw),
                  )
                }
                onKeyDown={(event) =>
                  handlePropertyInputKeyDown(
                    event,
                    String(placement.coordinate[0]),
                  )
                }
              />
            </label>
            <label title={help("placement.coordinate")}>
              Y
              <input
                key={`${instance.id}-${revision}-y`}
                aria-label="Component Y position"
                inputMode="decimal"
                defaultValue={String(placement.coordinate[1])}
                onBlur={(event) =>
                  commitPropertyInput(
                    event,
                    String(placement.coordinate[1]),
                    (raw) => commitCoordinate(1, raw),
                  )
                }
                onKeyDown={(event) =>
                  handlePropertyInputKeyDown(
                    event,
                    String(placement.coordinate[1]),
                  )
                }
              />
            </label>
            <label title={help("placement.rotation")}>
              {label("placement.rotation", "Rotation")}
              <select
                aria-label="Component rotation"
                value={placement.rotation}
                onChange={(event) =>
                  commit({
                    ...value,
                    placement: {
                      ...placement,
                      rotation: Number(
                        event.currentTarget.value,
                      ) as typeof placement.rotation,
                    },
                  })
                }
              >
                {ROTATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label title={help("placement.mirror")}>
            {label("placement.mirror", "Mirror")}
            <select
              aria-label="Component mirror"
              value={placement.mirror}
              onChange={(event) =>
                commit({
                  ...value,
                  placement: {
                    ...placement,
                    mirror: event.currentTarget
                      .value as typeof placement.mirror,
                  },
                })
              }
            >
              {MIRROR_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </PropertyDisclosure>
      ) : (
        <div className="property-card" aria-label="Component placement">
          <div className="property-section-heading">Placement</div>
          <small>
            This component is waiting in the Placement Tray. Place it on the
            canvas to give it coordinates.
          </small>
        </div>
      )}
      {identityAvailable ? (
        <PropertyDisclosure
          title="Identity"
          ariaLabel="Component identity"
          defaultOpen
        >
          {value.netlistName !== undefined ? (
            <label title={help("netlistName")}>
              {label("netlistName", "Netlist name")}
              <input
                dir="auto"
                key={`${instance.id}-${revision}-netlist-name`}
                aria-label="Netlist name"
                defaultValue={value.netlistName}
                onBlur={(event) =>
                  commitPropertyInput(event, value.netlistName ?? "", (raw) =>
                    commit({ ...value, netlistName: raw }),
                  )
                }
                onKeyDown={(event) =>
                  handlePropertyInputKeyDown(event, value.netlistName ?? "")
                }
              />
            </label>
          ) : null}
          {value.displayName !== undefined ? (
            <label title={help("displayName")}>
              {label("displayName", "Display name")}
              <input
                dir="auto"
                key={`${instance.id}-${revision}-display-name`}
                aria-label="Display name"
                defaultValue={value.displayName}
                onBlur={(event) =>
                  commitPropertyInput(event, value.displayName ?? "", (raw) =>
                    commit({ ...value, displayName: raw }),
                  )
                }
                onKeyDown={(event) =>
                  handlePropertyInputKeyDown(event, value.displayName ?? "")
                }
              />
            </label>
          ) : null}
          {value.netName !== undefined ? (
            <label>
              Net name
              <input
                dir="auto"
                key={`${instance.id}-${revision}-net-name`}
                aria-label="Net name"
                defaultValue={value.netName}
                onBlur={(event) =>
                  commitPropertyInput(event, value.netName ?? "", (raw) =>
                    commit({ ...value, netName: raw }),
                  )
                }
                onKeyDown={(event) =>
                  handlePropertyInputKeyDown(event, value.netName ?? "")
                }
              />
            </label>
          ) : null}
          {value.connection !== undefined ? (
            <label title={help("connection")}>
              {label("connection", "Connection")}
              <select
                aria-label="Connection"
                value={value.connection}
                onChange={(event) =>
                  commit({
                    ...value,
                    connection: event.currentTarget
                      .value as typeof value.connection,
                  })
                }
              >
                {(field("connection")?.options ?? []).map((option) => (
                  <option
                    key={String(option.value)}
                    value={String(option.value)}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {value.symbol !== undefined ? (
            <label>
              {label("symbol", "Drawing variant")}
              <select
                aria-label="Drawing variant"
                value={value.symbol}
                onChange={(event) =>
                  commit({ ...value, symbol: event.currentTarget.value })
                }
              >
                {componentSymbolOptions(instance.symbolId).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {targetDescription ? <small>{targetDescription}</small> : null}
        </PropertyDisclosure>
      ) : null}
      {rows.length > 0 || details?.modelTarget ? (
        <PropertyDisclosure
          title="Parameters"
          ariaLabel="Component parameters"
          defaultOpen
        >
          {rows.length > 0 ? (
            <div className="component-parameter-grid">
              {pairs(rows).map((row) => (
                <div
                  className="component-parameter-row"
                  data-parameter-row={row.map(({ key }) => key).join("-")}
                  key={row.map(({ key }) => key).join("-")}
                >
                  {row.map((parameter) => (
                    <label key={parameter.key} title={parameter.help}>
                      <span className="property-parameter-name">
                        {parameter.label}
                        {parameter.unit ? ` / ${parameter.unit}` : ""}
                      </span>
                      {parameter.options ? (
                        <select
                          aria-label={`Component ${parameter.label.toLowerCase()}`}
                          value={value.parameters?.[parameter.key] ?? ""}
                          onChange={(event) =>
                            commit({
                              ...value,
                              parameters: {
                                ...value.parameters,
                                [parameter.key]: event.currentTarget.value,
                              },
                            })
                          }
                        >
                          {parameter.options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          dir="auto"
                          key={`${instance.id}-${revision}-parameter-${parameter.key}`}
                          aria-label={`Component ${parameter.label.toLowerCase()}`}
                          inputMode={parameter.inputMode}
                          placeholder={parameter.placeholder}
                          defaultValue={value.parameters?.[parameter.key] ?? ""}
                          onBlur={(event) =>
                            commitPropertyInput(
                              event,
                              value.parameters?.[parameter.key] ?? "",
                              (raw) =>
                                commit({
                                  ...value,
                                  parameters: {
                                    ...value.parameters,
                                    [parameter.key]: raw,
                                  },
                                }),
                            )
                          }
                          onKeyDown={(event) =>
                            handlePropertyInputKeyDown(
                              event,
                              value.parameters?.[parameter.key] ?? "",
                            )
                          }
                        />
                      )}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
          {details?.modelTarget ? (
            <div
              className="property-target-card"
              aria-label="Component netlist target"
            >
              <div className="property-section-heading">
                {label("netlistTarget", "Target netlist")}
              </div>
              <ModelTargetControl
                instanceId={instance.id}
                revision={revision}
                value={value.netlistTarget ?? ""}
                suggestions={details.modelTarget.suggestions}
                onChange={(next) => {
                  commit({ ...value, netlistTarget: next });
                }}
              />
              {externalSubcircuit ? (
                <small>External subcircuit · SPICE emits an X card</small>
              ) : null}
            </div>
          ) : null}
        </PropertyDisclosure>
      ) : null}
      {displayAvailable ? (
        <PropertyDisclosure
          title="Display"
          ariaLabel="Component display"
          defaultOpen
        >
          <div
            className="display-toggle-row"
            aria-label="Component display toggles"
          >
            {value.display?.visualAnnotation !== undefined ? (
              <DisplayToggle
                label={label("display.visualAnnotation", "Visual annotation")}
                checked={value.display.visualAnnotation}
                help={help("display.visualAnnotation")}
                onChange={(visible) =>
                  commitDisplay({ visualAnnotation: visible })
                }
              />
            ) : null}
            {value.display?.value !== undefined ? (
              <DisplayToggle
                label={label("display.value", "Value")}
                checked={value.display.value}
                help={help("display.value")}
                onChange={(visible) => commitDisplay({ value: visible })}
              />
            ) : null}
            {displayParameters.map((parameter) => {
              const name = parameter.path.slice("display.parameters.".length);
              return (
                <DisplayToggle
                  key={parameter.path}
                  label={parameter.label}
                  checked={value.display?.parameters?.[name] ?? false}
                  help={parameter.help}
                  onChange={(visible) =>
                    commitDisplay({
                      parameters: {
                        ...value.display?.parameters,
                        [name]: visible,
                      },
                    })
                  }
                />
              );
            })}
          </div>
        </PropertyDisclosure>
      ) : null}
      <PropertyDisclosure
        title="Appearance"
        ariaLabel="Component appearance"
        className="component-appearance-card"
      >
        <ColorOverrideControl
          label={label("appearance.color", "Line")}
          value={
            value.appearance.color === "auto"
              ? undefined
              : value.appearance.color
          }
          fallback={defaultForeground}
          onChange={(color) => {
            commitAppearance({
              color: color ? (color as `#${string}`) : "auto",
            });
          }}
        />
        {internalMark !== undefined ? (
          <>
            <DisplayToggle
              label={label("appearance.internalMark", "Internal mark")}
              checked={internalMark !== NO_INTERNAL_MARK}
              help={help("appearance.internalMark")}
              onChange={(marked) =>
                commitAppearance({
                  internalMark: marked ? "A" : NO_INTERNAL_MARK,
                })
              }
            />
            {internalMark !== NO_INTERNAL_MARK ? (
              <label>
                Mark text
                <input
                  dir="auto"
                  key={`${instance.id}-${revision}-internal-mark`}
                  aria-label="Internal mark text"
                  defaultValue={internalMark}
                  onBlur={(event) =>
                    commitPropertyInput(event, internalMark, (raw) =>
                      commitAppearance({ internalMark: raw }),
                    )
                  }
                  onKeyDown={(event) =>
                    handlePropertyInputKeyDown(event, internalMark)
                  }
                />
              </label>
            ) : null}
          </>
        ) : null}
        {value.appearance.inputPolarity === undefined ? null : (
          <DisplayToggle
            label={label("appearance.inputPolarity", "Inverting input")}
            checked={value.appearance.inputPolarity}
            help={help("appearance.inputPolarity")}
            onChange={(checked) => commitAppearance({ inputPolarity: checked })}
          />
        )}
        {value.appearance.inputsSwapped === undefined ? null : (
          <DisplayToggle
            label={label("appearance.inputsSwapped", "Swap inputs")}
            checked={value.appearance.inputsSwapped}
            help={help("appearance.inputsSwapped")}
            onChange={(checked) => commitAppearance({ inputsSwapped: checked })}
          />
        )}
        {value.appearance.outputsSwapped === undefined ? null : (
          <DisplayToggle
            label={label("appearance.outputsSwapped", "Swap outputs")}
            checked={value.appearance.outputsSwapped}
            help={help("appearance.outputsSwapped")}
            onChange={(checked) =>
              commitAppearance({ outputsSwapped: checked })
            }
          />
        )}
      </PropertyDisclosure>
      <PropertyDisclosure
        title="Code (JSON)"
        ariaLabel="Component property code"
        mountWhenOpen
      >
        <ComponentPropertyCodeEditor {...surface} title="JSON" />
      </PropertyDisclosure>
      {message ? (
        <div className="component-property-code-status" aria-live="polite">
          <span>{message}</span>
        </div>
      ) : null}
    </>
  );
}
