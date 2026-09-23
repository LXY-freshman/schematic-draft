import { useCallback, useEffect, useState } from "react";

import {
  readShellInstallInfo,
  setFileAssociation,
  type ShellInstallInfo,
} from "./shell-commands";

/**
 * What this installation looks like on the computer it is installed on.
 *
 * The three facts here — the Projects folder, the settings folder, and whether
 * Explorer opens a Project with this copy — are the only things the old system
 * menu bar carried that the editor could not say for itself. They belong in
 * About because they answer "where did my work go" and "what did this program
 * put on my machine", and because the association is the single thing this
 * application writes outside its own folder: it is shown, and it can be turned
 * off, in the same place it is admitted to.
 *
 * Renders nothing in a plain browser, where there is no installation to
 * describe.
 */
export function ShellInstallFacts() {
  const [info, setInfo] = useState<ShellInstallInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void readShellInstallInfo().then((read) => {
      if (current) setInfo(read);
    });
    return () => {
      current = false;
    };
  }, []);

  const flipAssociation = useCallback(
    (enabled: boolean) => {
      setBusy(true);
      setNotice(null);
      void setFileAssociation(enabled).then((association) => {
        setBusy(false);
        setInfo((previous) =>
          previous === null ? previous : { ...previous, association },
        );
        // The shell already showed a dialog saying what happened; this only
        // catches the case where the answer is not the answer that was asked
        // for, so the checkbox snapping back is not a mystery.
        if (association !== (enabled ? "on" : "off")) {
          setNotice("Windows did not accept the change.");
        }
      });
    },
    [setInfo],
  );

  if (info === null) return null;
  return (
    <div className="help-install-facts" data-testid="install-facts">
      <dl>
        <dt>Projects</dt>
        <dd>
          <code>{info.projectsDirectory}</code>
        </dd>
        <dt>Settings and recovery</dt>
        <dd>
          <code>{info.settingsDirectory}</code>
        </dd>
      </dl>
      <p>
        {info.selfContained
          ? "Everything this copy writes stays in its own folder, so moving the folder moves the whole installation."
          : "This copy cannot write to its own folder, so it uses the per-user locations above."}
      </p>
      {info.association === "unavailable" ? null : (
        <label className="help-association">
          <input
            type="checkbox"
            data-testid="file-association"
            checked={info.association === "on"}
            disabled={busy}
            onChange={(event) => flipAssociation(event.currentTarget.checked)}
          />
          Open <code>.schdraft</code> files with this copy
        </label>
      )}
      {info.association === "unavailable" ? null : (
        <p className="help-association-note">
          {notice ??
            (info.association === "on"
              ? "A per-user registry entry naming this folder. Nothing else of this application is in the registry."
              : "Nothing of this application is in the registry. Opening a Project from inside the application still works.")}
        </p>
      )}
    </div>
  );
}
