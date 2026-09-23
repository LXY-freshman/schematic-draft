/**
 * Which drawing a Razavi MOS is placed with, and which drawing shows its bulk.
 *
 * A leaf on purpose: the property surfaces read this map to offer the bulk
 * switch, and they must not drag the Edit Engine or the editor session in
 * behind it. `razavi-presentation.ts` re-exports it for the placement path.
 */
const DEFAULT_SYMBOL_VARIANTS: Readonly<Record<string, string>> = {
  nmos: "textbook-3terminal",
  pmos: "textbook-3terminal",
  "depletion-nmos": "textbook-3terminal",
  "depletion-pmos": "textbook-3terminal",
  ndmos: "standard-3terminal",
  pdmos: "standard-3terminal",
};

/**
 * The whole calibrated artwork, bulk lead included. Every symbol above carries
 * it, because every one of them already carries B as a terminal — the three
 * terminal drawing hides the lead, it does not remove the pin.
 */
export const FOUR_TERMINAL_VARIANT_ID = "four-terminal";

export function defaultRazaviSymbolVariantId(
  symbolId: string,
): string | undefined {
  return DEFAULT_SYMBOL_VARIANTS[symbolId];
}
