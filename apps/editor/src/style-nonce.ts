/**
 * The Content Security Policy nonce for this document's inline stylesheets.
 *
 * The desktop shell serves `style-src 'self' 'nonce-…'` and mints the nonce
 * per document load, publishing it on a meta element (see
 * `apps/desktop/src/app-protocol.ts`). Two stylesheets the editor writes at
 * runtime need it: CodeMirror's theme, which it mounts as a `<style>` element
 * when the first code view opens, and the canvas `@font-face` for the
 * round-period glyph. Without the nonce the shell drops both — silently, since
 * a blocked stylesheet is not an error the editor can see.
 *
 * In a browser there is no shell, no policy and no meta element; the empty
 * string means "no nonce", which is also what CodeMirror's facet expects.
 */
export function styleNonce(): string {
  if (typeof document === "undefined") return "";
  const meta = document.querySelector('meta[name="csp-nonce"]');
  return meta?.getAttribute("content") ?? "";
}
