/**
 * The SVG path subset symbol artwork is authored in.
 *
 * Symbol `path` primitives carry raw SVG path data, which Visio geometry rows
 * cannot consume directly. Every built-in symbol uses only moves, lines and
 * cubic curves — all three have an exact Visio counterpart, so nothing here
 * approximates anything.
 *
 * Commands outside that subset are rejected rather than flattened. Visio has
 * its own arc rows, so a symbol that needs one deserves a real translation, and
 * a loud failure in the catalog test is how that gets noticed. Silently
 * replacing a curve with a chord would be the one outcome worse than no export.
 */

export interface PathPoint {
  readonly x: number;
  readonly y: number;
}

export type PathSegment =
  | { readonly kind: "line"; readonly to: PathPoint }
  | {
      readonly kind: "cubic";
      readonly control1: PathPoint;
      readonly control2: PathPoint;
      readonly to: PathPoint;
    };

export interface PathSubpath {
  readonly start: PathPoint;
  readonly segments: readonly PathSegment[];
  /** `Z` was given, so the last point joins back to `start`. */
  readonly closed: boolean;
}

/** Numbers first, so the `e` of an exponent is never read as a command. */
const PATH_TOKEN = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?|[A-Za-z]/g;

const SUPPORTED_COMMANDS = new Set([
  "M",
  "m",
  "L",
  "l",
  "H",
  "h",
  "V",
  "v",
  "C",
  "c",
  "Z",
  "z",
]);

class PathScanner {
  readonly #tokens: readonly string[];
  #index = 0;

  constructor(data: string) {
    this.#tokens = data.match(PATH_TOKEN) ?? [];
  }

  next(): string | undefined {
    return this.#tokens[this.#index++];
  }

  peek(): string | undefined {
    return this.#tokens[this.#index];
  }

  peekIsNumber(): boolean {
    const token = this.peek();
    return token !== undefined && !/^[A-Za-z]$/.test(token);
  }

  number(command: string): number {
    const token = this.next();
    const value = token === undefined ? Number.NaN : Number(token);
    if (!Number.isFinite(value)) {
      throw new Error(
        `Path command "${command}" is missing a number in symbol path data`,
      );
    }
    return value;
  }
}

/**
 * Splits path data into subpaths of absolute-coordinate segments.
 *
 * @throws if the data uses a command outside `M L H V C Z`, in either case.
 */
export function parseSymbolPathData(data: string): PathSubpath[] {
  const scanner = new PathScanner(data);
  const subpaths: PathSubpath[] = [];
  let segments: PathSegment[] = [];
  let start: PathPoint | undefined;
  let current: PathPoint = { x: 0, y: 0 };
  let command: string | undefined;

  const flush = (closed: boolean): void => {
    if (start === undefined) return;
    if (segments.length > 0 || closed) {
      subpaths.push({ start, segments, closed });
    }
    segments = [];
  };

  for (;;) {
    if (scanner.peekIsNumber()) {
      if (command === undefined) {
        throw new Error("Symbol path data must start with a move command");
      }
      if (command === "Z" || command === "z") {
        throw new Error(
          "Symbol path data continues past a close command without a new command",
        );
      }
      // An implicit repeat: after a move, further coordinate pairs are lines.
      if (command === "M") command = "L";
      else if (command === "m") command = "l";
    } else {
      const token = scanner.next();
      if (token === undefined) break;
      if (!SUPPORTED_COMMANDS.has(token)) {
        throw new Error(
          `Unsupported command "${token}" in symbol path data; Visio geometry is written from M, L, H, V, C and Z only`,
        );
      }
      command = token;
    }

    const relative = command === command.toLowerCase();
    const letter = command.toUpperCase();
    // A drawing command before any move has no point to draw from. Left alone
    // it would fall through and be dropped, which is the silent geometry loss
    // this module exists to refuse.
    if (letter !== "M" && start === undefined) {
      throw new Error("Symbol path data must start with a move command");
    }
    switch (letter) {
      case "M": {
        flush(false);
        const x = scanner.number(command);
        const y = scanner.number(command);
        current = relative ? { x: current.x + x, y: current.y + y } : { x, y };
        start = current;
        break;
      }
      case "L": {
        const x = scanner.number(command);
        const y = scanner.number(command);
        current = relative ? { x: current.x + x, y: current.y + y } : { x, y };
        segments.push({ kind: "line", to: current });
        break;
      }
      case "H": {
        const x = scanner.number(command);
        current = { x: relative ? current.x + x : x, y: current.y };
        segments.push({ kind: "line", to: current });
        break;
      }
      case "V": {
        const y = scanner.number(command);
        current = { x: current.x, y: relative ? current.y + y : y };
        segments.push({ kind: "line", to: current });
        break;
      }
      case "C": {
        const origin = current;
        const coordinates = Array.from({ length: 6 }, () =>
          scanner.number(command!),
        ) as [number, number, number, number, number, number];
        const point = (x: number, y: number): PathPoint =>
          relative ? { x: origin.x + x, y: origin.y + y } : { x, y };
        const control1 = point(coordinates[0], coordinates[1]);
        const control2 = point(coordinates[2], coordinates[3]);
        current = point(coordinates[4], coordinates[5]);
        segments.push({ kind: "cubic", control1, control2, to: current });
        break;
      }
      case "Z": {
        flush(true);
        if (start !== undefined) current = start;
        break;
      }
    }
  }
  flush(false);

  if (subpaths.length === 0) {
    throw new Error("Symbol path data describes no geometry");
  }
  return subpaths;
}
