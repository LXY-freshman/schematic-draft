import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { EditorCrashScreen } from "./editor-error-boundary";

describe("EditorCrashScreen", () => {
  it("renders an alert with the failure reason and a reload action", () => {
    const html = renderToStaticMarkup(
      <EditorCrashScreen
        message="boom in scene build"
        onReload={() => undefined}
      />,
    );
    expect(html).toContain("The editor hit an unexpected problem");
    expect(html).toContain("boom in scene build");
    expect(html).toContain("Reload editor");
    expect(html).toContain("Recover Local Work");
  });

  it("names a damaged installation when a file is confirmed missing", () => {
    // #493: a fresh visit could not open the editor because the app chunk
    // named in the document did not exist. The shell serves that chunk from
    // its own installation, so the screen must say the install is the
    // problem rather than blame a reload the user already tried.
    const html = renderToStaticMarkup(
      <EditorCrashScreen
        message="The installation is missing /assets/App-L9bGmgOj.js"
        missingFile
        onReload={() => undefined}
      />,
    );
    expect(html).toContain("Part of the installation is missing");
    expect(html).toContain("Reinstalling the application");
    expect(html).toContain('data-kind="missing"');
  });

  it("keeps the ordinary crash wording for an ordinary crash", () => {
    const html = renderToStaticMarkup(
      <EditorCrashScreen message="boom" onReload={() => undefined} />,
    );
    expect(html).toContain("The editor hit an unexpected problem");
    expect(html).toContain('data-kind="crash"');
    expect(html).not.toContain("installation is missing");
  });

  it("does not call a temporary module failure a damaged installation", () => {
    const html = renderToStaticMarkup(
      <EditorCrashScreen
        message="A required editor file was temporarily unavailable: /assets/App-current.js"
        moduleLoadFailure
        onReload={() => undefined}
      />,
    );
    expect(html).toContain("The editor could not finish loading");
    expect(html).toContain("temporarily unavailable");
    expect(html).toContain("Try again");
    expect(html).not.toContain("Part of the installation is missing");
    expect(html).toContain('data-kind="load"');
  });

  it("offers no outbound report path", () => {
    const html = renderToStaticMarkup(
      <EditorCrashScreen message="boom" onReload={() => undefined} />,
    );
    expect(html).not.toContain("<a ");
  });
});
