/**
 * Guarded dynamic import for on-demand feature chunks.
 *
 * The desktop shell serves every content-hashed chunk from its own
 * installation, so a failure here means a missing or damaged asset. The
 * browser reports it as "Failed to fetch dynamically imported module: …",
 * and that string must never be the user's answer; callers catch
 * {@link ChunkLoadError} and show the refresh remedy instead. React.lazy
 * surfaces use `lazyChunk` in app/lazy-editor-dialogs.ts; this is the same
 * contract for plain `await import()` call sites.
 */
export class ChunkLoadError extends Error {
  constructor(
    readonly feature: string,
    override readonly cause: unknown,
  ) {
    super(
      `${feature} could not load — part of the installation is missing or damaged`,
    );
    this.name = "ChunkLoadError";
  }
}

/** One status-bar line: what failed, why, and the remedy. */
export function chunkLoadStatus(feature: string): string {
  return `${feature} could not load — part of the installation is missing or damaged. Refresh to load it again; your circuit is restored automatically.`;
}

export async function importChunk<T>(
  feature: string,
  load: () => Promise<T>,
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    // The raw failure keeps its stack for diagnosis, off the user's screen.
    console.error(`Chunk for ${feature} failed to load:`, error);
    throw new ChunkLoadError(feature, error);
  }
}
