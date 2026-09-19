# What the Windows installer does beyond copying files in.
#
# electron-builder picks this file up on its own because of where it sits
# (`buildResources/installer.nsh`), and inserts the two macros below into the
# uninstaller.
#
# It exists because this application keeps everything it writes inside its own
# folder — see apps/desktop/src/install-paths.ts — and for an installed copy that
# folder is $INSTDIR. The default uninstall is `RMDir /r $INSTDIR`, which would
# take the user's saved circuits with the program. So removal here is selective.

# The saved Projects and the application's own state, named as
# apps/desktop/src/install-paths.ts creates them.
!define PROJECTS_FOLDER "Projects"
!define APP_STATE_FOLDER "AppData"

# The association apps/desktop/src/file-association.ts writes, spelled the same
# way. A unit test pins these against that module so the two cannot drift.
!define PROJECT_EXTENSION ".schdraft"
!define LEGACY_PROJECT_EXTENSION ".icproj"
!define PROJECT_PROG_ID "SchematicDraft.Project"
!define CLASSES_KEY "Software\Classes"

/*
Remove the program and leave the user's work.

Kept always: the saved Projects. They are documents that happen to live next to
the program; nothing about removing the program makes them ours to delete.

Kept while updating: the application's own folder — window size, preferences,
the crash-recovery copy — so a version bump is not also a reset. A real
uninstall takes it, because nearly all of it is Chromium cache and the recovery
copy is a safety net for the file on disk, never the authority.
*/
!macro customRemoveFiles
  Var /GLOBAL keepAppState
  StrCpy $keepAppState "0"
  ${if} ${isUpdated}
    StrCpy $keepAppState "1"
  ${endif}

  # Out of the folder before emptying it, or Windows holds it open.
  SetOutPath $TEMP

  # Every name is collected before anything is deleted: enumerating a directory
  # whose entries are disappearing can skip entries, and a skipped entry here is
  # a file left behind in a folder reported as removed.
  StrCpy $R2 0
  FindFirst $R0 $R1 "$INSTDIR\*.*"
  scanInstallDir:
    StrCmp $R1 "" scanDone
    StrCmp $R1 "." scanNext
    StrCmp $R1 ".." scanNext
    StrCmp $R1 "${PROJECTS_FOLDER}" scanNext
    StrCmp $R1 "${APP_STATE_FOLDER}" 0 scanCollect
      StrCmp $keepAppState "1" scanNext
    scanCollect:
      Push $R1
      IntOp $R2 $R2 + 1
    scanNext:
      FindNext $R0 $R1
      Goto scanInstallDir
  scanDone:
  FindClose $R0

  removeCollected:
    IntCmp $R2 0 removeDone
    Pop $R1
    IntOp $R2 $R2 - 1
    IfFileExists "$INSTDIR\$R1\*.*" removeDir removeFile
    removeDir:
      RMDir /r "$INSTDIR\$R1"
      Goto removeCollected
    removeFile:
      Delete "$INSTDIR\$R1"
      Goto removeCollected
  removeDone:

  # An empty folder is not work worth keeping. RMDir without /r refuses a folder
  # that still holds anything, so this only removes what nothing was saved in.
  RMDir "$INSTDIR\${PROJECTS_FOLDER}"
  RMDir "$INSTDIR\${APP_STATE_FOLDER}"
  RMDir "$INSTDIR"

  # Details are hidden and there is no finish page text to hang this on, so the
  # one thing the user has to know — that their circuits are still on the disk
  # and where — is said outright.
  ${if} ${FileExists} "$INSTDIR\${PROJECTS_FOLDER}\*.*"
  ${andIfNot} ${Silent}
    MessageBox MB_OK|MB_ICONINFORMATION "Your saved Projects were left where they are:$\r$\n$\r$\n$INSTDIR\${PROJECTS_FOLDER}$\r$\n$\r$\nDelete that folder yourself once you no longer want them."
  ${endif}
!macroend

/*
Hand back the file association this copy claimed.

Only the keys the application writes itself, only under the current user, and
the extension only while it still names this application's document type: once
something else owns the extension, that entry is not ours to delete. The
document type goes the same way — only while its open command still names the
executable being removed, so uninstalling one copy leaves another copy's claim
(a second folder, a copy extracted from the release zip) alone.

An update keeps the association: the program that replaces this one wants it.
*/
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ReadRegStr $R0 HKCU "${CLASSES_KEY}\${PROJECT_EXTENSION}" ""
    ${if} $R0 == "${PROJECT_PROG_ID}"
      DeleteRegKey HKCU "${CLASSES_KEY}\${PROJECT_EXTENSION}"
    ${endif}

    ReadRegStr $R0 HKCU "${CLASSES_KEY}\${LEGACY_PROJECT_EXTENSION}" ""
    ${if} $R0 == "${PROJECT_PROG_ID}"
      DeleteRegKey HKCU "${CLASSES_KEY}\${LEGACY_PROJECT_EXTENSION}"
    ${endif}

    # Matched on the folder rather than the executable name: what has to be true
    # is that the command runs the copy being removed.
    ReadRegStr $R0 HKCU "${CLASSES_KEY}\${PROJECT_PROG_ID}\shell\open\command" ""
    StrLen $R1 '"$INSTDIR\'
    StrCpy $R2 $R0 $R1
    ${if} $R2 == '"$INSTDIR\'
      DeleteRegKey HKCU "${CLASSES_KEY}\${PROJECT_PROG_ID}"
    ${endif}

    System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
  ${endif}
!macroend
