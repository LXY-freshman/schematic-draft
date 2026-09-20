/**
 * Annotation text on the page.
 *
 * A schematic's text is not decoration: a reference designator, a device value
 * and a net label are the reader's only way to tell one transistor from the
 * next. So the export writes them as Visio text a person can select and retype,
 * not as outlines — which means the house RichText style has to be expressed in
 * the cells Visio's Character section offers.
 *
 * It offers fewer than the schematic uses. Bold, italic and the script
 * positions map exactly; a stacked fraction, an overbar and a typeset formula
 * do not, and each of those leaves a caveat rather than disappearing.
 */

import type { RichTextDocument, RichTextRun } from "@icm/model";

import { pinCells } from "./follow.js";
import type { VisioShapeFollow } from "./follow.js";
import type { PagePoint } from "./geometry.js";
import { escapeXmlAttribute, escapeXmlText, formatVisioNumber } from "./xml.js";

/**
 * The typeface Visio is asked for.
 *
 * The schematic's own `fontFamily` is a browser stack whose first two entries —
 * a one-glyph embedded face and DejaVu Sans — are not fonts a Windows Visio
 * has, so naming them would only hand the choice to Visio's font substitution.
 * The stack's first genuinely portable face is named instead, and the metric
 * difference against the schematic is part of the export's fidelity contract.
 */
export const VISIO_TEXT_FONT = "Arial";

/** Visio's `Pos` cell: where a run sits against the baseline. */
const POSITION_NORMAL = 0;
const POSITION_SUPERSCRIPT = 1;
const POSITION_SUBSCRIPT = 2;

/** Visio's `Style` cell is a bit set; these are the two bits used here. */
const STYLE_BOLD = 1;
const STYLE_ITALIC = 2;

/** Visio's `HorzAlign` cell, in the order the schematic's alignments run. */
const HORIZONTAL_ALIGNMENT = { start: 0, middle: 1, end: 2 } as const;

/**
 * How much wider than the shape its text block is made.
 *
 * Visio wraps text at the width of the text block, and the schematic's
 * measurement is not a promise about Visio's: a flattened fraction is one line
 * where the schematic stacked two, and Arial is not the face the schematic
 * measured. A label that wrapped would read as two labels, so the block is made
 * wide enough that none of them ever does. Being generous costs nothing — the
 * block has neither outline nor fill, and the edge the text is aligned to stays
 * pinned to the shape however far the other edge runs.
 */
const TEXT_BLOCK_WIDTH_FACTOR = 4;

/**
 * Where the text block sits against the shape, per alignment.
 *
 * `TxtPinX` picks the point on the shape and `TxtLocPinX` picks the edge of the
 * block that lands on it, so all the extra width falls away from the edge the
 * text is aligned to — which is the edge the schematic measured.
 */
const TEXT_BLOCK_ANCHOR = {
  start: { pin: "0", locPin: "0" },
  middle: { pin: "Width*0.5", locPin: "TxtWidth*0.5" },
  end: { pin: "Width", locPin: "TxtWidth" },
} as const;

/** Something the text block could not say. Nothing here is dropped quietly. */
export type VisioTextCaveat =
  | { readonly kind: "formula-text"; readonly detail: string }
  | { readonly kind: "stacked-fraction"; readonly detail: string }
  | { readonly kind: "overbar-text"; readonly detail: string };

export interface VisioTextStyle {
  readonly fontSizeInches: number;
  /** `#RRGGBB`, as the persisted model spells a color. */
  readonly color: string;
}

export interface VisioTextContent {
  /** The `<Section N="Character">` element, one row per distinct format. */
  readonly characterSection: string;
  /** The `<Text>` element, with a `<cp>` marker before each formatted run. */
  readonly text: string;
  readonly caveats: readonly VisioTextCaveat[];
}

interface TextFormat {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly position:
    | typeof POSITION_NORMAL
    | typeof POSITION_SUPERSCRIPT
    | typeof POSITION_SUBSCRIPT;
}

interface TextChunk {
  value: string;
  readonly format: TextFormat;
}

const PLAIN: TextFormat = {
  bold: false,
  italic: false,
  position: POSITION_NORMAL,
};

function formatKey(format: TextFormat): string {
  return `${format.bold ? "b" : ""}${format.italic ? "i" : ""}${format.position}`;
}

/**
 * Flattens RichText into formatted chunks.
 *
 * The three constructs Visio's text block has no cell for are flattened rather
 * than skipped: a fraction becomes `numerator/denominator`, a formula becomes
 * its LaTeX source, and an overbar loses its rule. A label is a name, and a
 * reader can still read a name that lost its typesetting; a missing one tells
 * them nothing. Each of the three leaves a caveat behind.
 */
function collectChunks(
  runs: readonly RichTextRun[],
  format: TextFormat,
  chunks: TextChunk[],
  caveats: VisioTextCaveat[],
  detail: string,
): void {
  const push = (value: string): void => {
    if (value.length === 0) return;
    const previous = chunks.at(-1);
    if (previous && formatKey(previous.format) === formatKey(format)) {
      previous.value += value;
      return;
    }
    chunks.push({ value, format });
  };
  for (const run of runs) {
    switch (run.kind) {
      case "text":
        push(run.value);
        break;
      case "line-break":
        push("\n");
        break;
      case "math":
        caveats.push({ kind: "formula-text", detail });
        push(run.latex);
        break;
      case "fraction":
        caveats.push({ kind: "stacked-fraction", detail });
        collectChunks(run.numerator.runs, format, chunks, caveats, detail);
        push("/");
        collectChunks(run.denominator.runs, format, chunks, caveats, detail);
        break;
      case "span": {
        if (run.style === "overbar") {
          caveats.push({ kind: "overbar-text", detail });
        }
        const nested: TextFormat = {
          bold: format.bold || run.style === "bold",
          italic: format.italic || run.style === "italic",
          position:
            run.style === "subscript"
              ? POSITION_SUBSCRIPT
              : run.style === "superscript"
                ? POSITION_SUPERSCRIPT
                : format.position,
        };
        collectChunks(run.children, nested, chunks, caveats, detail);
        break;
      }
    }
  }
}

/**
 * Expands a persisted `#RRGGBB` color for Visio's `Color` cell.
 *
 * The model validates the six-digit form, so this only has to normalize case.
 * Anything else is passed through: a profile foreground is not a persisted
 * field and may still be spelled `#000`, which Visio reads as well.
 */
function visioColor(color: string): string {
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color.toUpperCase() : color;
}

export function visioTextContent(
  content: RichTextDocument,
  style: VisioTextStyle,
  detail = "",
): VisioTextContent {
  const chunks: TextChunk[] = [];
  const caveats: VisioTextCaveat[] = [];
  collectChunks(content.runs, PLAIN, chunks, caveats, detail);

  const formats: TextFormat[] = [];
  const rowIndexByKey = new Map<string, number>();
  for (const chunk of chunks) {
    const key = formatKey(chunk.format);
    if (rowIndexByKey.has(key)) continue;
    rowIndexByKey.set(key, formats.length);
    formats.push(chunk.format);
  }
  if (formats.length === 0) {
    rowIndexByKey.set(formatKey(PLAIN), 0);
    formats.push(PLAIN);
  }

  const rows = formats.map((format, index) => {
    const bits =
      (format.bold ? STYLE_BOLD : 0) | (format.italic ? STYLE_ITALIC : 0);
    return (
      `<Row IX="${index}">` +
      `<Cell N="Font" V="${escapeXmlAttribute(VISIO_TEXT_FONT)}"/>` +
      `<Cell N="Size" V="${formatVisioNumber(style.fontSizeInches)}" U="PT"/>` +
      `<Cell N="Color" V="${escapeXmlAttribute(visioColor(style.color))}"/>` +
      `<Cell N="Style" V="${bits}"/>` +
      `<Cell N="Pos" V="${format.position}"/>` +
      // Only row 0 is given the cell's default. A later row that leaves
      // `FontScale` out gets no horizontal scale at all rather than 100%, and
      // Visio then lays every character of that run at the same x — a
      // subscript and the character before it printed on top of each other.
      `<Cell N="FontScale" V="1"/>` +
      `</Row>`
    );
  });

  let previousRow = -1;
  const body = chunks
    .map((chunk) => {
      const row = rowIndexByKey.get(formatKey(chunk.format))!;
      const marker = row === previousRow ? "" : `<cp IX="${row}"/>`;
      previousRow = row;
      return marker + escapeXmlText(chunk.value);
    })
    .join("");

  return {
    characterSection: `<Section N="Character">${rows.join("")}</Section>`,
    // Visio terminates the last paragraph the same way it separates the
    // others, and writes that terminator into the part. Text read back from a
    // package without it is the same text, but the file then differs from
    // every one Visio wrote itself.
    text: `<Text><pp IX="0"/>${body}\n</Text>`,
    caveats,
  };
}

export interface VisioTextShape {
  readonly id: number;
  /** Where the middle of the text box lands on the page. */
  readonly pin: PagePoint;
  /** Keeps the text with another shape; see {@link pinCells}. */
  readonly follows?: VisioShapeFollow;
  readonly widthInches: number;
  readonly heightInches: number;
  /** Radians counterclockwise, as every Visio angle is. */
  readonly angleRadians: number;
  readonly alignment: "start" | "middle" | "end";
  readonly content: VisioTextContent;
  /** A `<Section N="Property">` element, or nothing. */
  readonly propertySection?: string;
}

/**
 * A page shape that is nothing but its text.
 *
 * It has no geometry section at all, which is what Visio's own text tool
 * produces: no outline to print, no fill to hide a wire that passes behind the
 * label, and no master, since every label is a different size.
 */
export function textShape(shape: VisioTextShape): string {
  const blockWidth = shape.widthInches * TEXT_BLOCK_WIDTH_FACTOR;
  const anchor = TEXT_BLOCK_ANCHOR[shape.alignment];
  const anchorPin =
    shape.alignment === "start"
      ? 0
      : shape.alignment === "middle"
        ? shape.widthInches / 2
        : shape.widthInches;
  const anchorLocPin =
    shape.alignment === "start"
      ? 0
      : shape.alignment === "middle"
        ? blockWidth / 2
        : blockWidth;
  return (
    `<Shape ID="${shape.id}" Type="Shape">` +
    pinCells(shape.pin, shape.follows) +
    `<Cell N="Width" V="${formatVisioNumber(shape.widthInches)}"/>` +
    `<Cell N="Height" V="${formatVisioNumber(shape.heightInches)}"/>` +
    `<Cell N="LocPinX" V="${formatVisioNumber(shape.widthInches / 2)}" F="Width*0.5"/>` +
    `<Cell N="LocPinY" V="${formatVisioNumber(shape.heightInches / 2)}" F="Height*0.5"/>` +
    `<Cell N="Angle" V="${formatVisioNumber(shape.angleRadians)}"/>` +
    `<Cell N="FlipX" V="0"/><Cell N="FlipY" V="0"/>` +
    `<Cell N="LinePattern" V="0"/><Cell N="FillPattern" V="0"/>` +
    `<Cell N="ShdwPattern" V="0"/>` +
    // The text fills the box it was measured into, so the margins Visio would
    // otherwise inset it by are exactly what would push it off its anchor.
    `<Cell N="LeftMargin" V="0"/><Cell N="RightMargin" V="0"/>` +
    `<Cell N="TopMargin" V="0"/><Cell N="BottomMargin" V="0"/>` +
    `<Cell N="VerticalAlign" V="1"/>` +
    `<Cell N="TxtWidth" V="${formatVisioNumber(blockWidth)}" F="Width*${TEXT_BLOCK_WIDTH_FACTOR}"/>` +
    `<Cell N="TxtPinX" V="${formatVisioNumber(anchorPin)}" F="${anchor.pin}"/>` +
    `<Cell N="TxtLocPinX" V="${formatVisioNumber(anchorLocPin)}" F="${anchor.locPin}"/>` +
    // A shape that writes some of the text-block cells and leaves the rest out
    // gets nothing for the rest — not the defaults a Visio-authored shape
    // inherits. An unwritten `TxtHeight` is zero, and a line centred in a
    // zero-height block sits on the shape's bottom edge: every label half a box
    // low, and a fraction's numerator struck through by its own bar.
    `<Cell N="TxtHeight" V="${formatVisioNumber(shape.heightInches)}" F="Height"/>` +
    `<Cell N="TxtPinY" V="${formatVisioNumber(shape.heightInches / 2)}" F="Height*0.5"/>` +
    `<Cell N="TxtLocPinY" V="${formatVisioNumber(shape.heightInches / 2)}" F="TxtHeight*0.5"/>` +
    shape.content.characterSection +
    `<Section N="Paragraph"><Row IX="0">` +
    `<Cell N="HorzAlign" V="${HORIZONTAL_ALIGNMENT[shape.alignment]}"/>` +
    `</Row></Section>` +
    (shape.propertySection ?? "") +
    shape.content.text +
    `</Shape>`
  );
}
