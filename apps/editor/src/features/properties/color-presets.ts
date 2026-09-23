/**
 * Eight authoring colors: the neutral this editor already used, then MATLAB's
 * default color order. Engineers reading these schematics plot in MATLAB, so a
 * wire and the trace it produced can be given the same color without anyone
 * matching hex by eye. Custom colors remain available as RGB.
 */
export const COMMON_COLOR_PRESETS = [
  { label: "Light gray", value: "#9ca3af" },
  { label: "Blue", value: "#0072bd" },
  { label: "Orange", value: "#d95319" },
  { label: "Yellow", value: "#edb120" },
  { label: "Purple", value: "#7e2f8e" },
  { label: "Green", value: "#77ac30" },
  { label: "Cyan", value: "#4dbeee" },
  { label: "Dark red", value: "#a2142f" },
] as const;
