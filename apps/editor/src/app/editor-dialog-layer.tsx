import { Suspense, type ComponentProps } from "react";

import { ChunkLoadBanner } from "../components/chunk-load-fallback";
import {
  RecoveryAvailableBanner,
  RecoveryFailureBanner,
} from "../components/recovery-banners";
import {
  LazyCellManagerDialog,
  LazyEditorHelpDialog,
  LazyInsertComponentDialog,
  LazyNetlistPreflightDialog,
  LazyProjectSearchDialog,
  LazyRecentRecoveryDialog,
  LazyReplaceGuardDialog,
} from "./lazy-editor-dialogs";

export interface EditorDialogLayerProps {
  help: ComponentProps<typeof LazyEditorHelpDialog> | null;
  chunkLoadFailure: ComponentProps<typeof ChunkLoadBanner> | null;
  recoveryFailure: ComponentProps<typeof RecoveryFailureBanner> | null;
  recoveryAvailable: ComponentProps<typeof RecoveryAvailableBanner> | null;
  recentRecovery: ComponentProps<typeof LazyRecentRecoveryDialog> | null;
  replaceGuard: ComponentProps<typeof LazyReplaceGuardDialog> | null;
  search: ComponentProps<typeof LazyProjectSearchDialog> | null;
  insertComponent: ComponentProps<typeof LazyInsertComponentDialog> | null;
  cellManager: ComponentProps<typeof LazyCellManagerDialog> | null;
  netlistPreflight: ComponentProps<typeof LazyNetlistPreflightDialog> | null;
}

/** All modal/overlay UI kept outside the persistent editor workspace. */
export function EditorDialogLayer({
  help,
  chunkLoadFailure,
  recoveryFailure,
  recoveryAvailable,
  recentRecovery,
  replaceGuard,
  search,
  insertComponent,
  cellManager,
  netlistPreflight,
}: EditorDialogLayerProps) {
  return (
    <Suspense fallback={null}>
      {help ? <LazyEditorHelpDialog {...help} /> : null}
      {chunkLoadFailure ? <ChunkLoadBanner {...chunkLoadFailure} /> : null}
      {recoveryFailure ? <RecoveryFailureBanner {...recoveryFailure} /> : null}
      {recoveryAvailable ? (
        <RecoveryAvailableBanner {...recoveryAvailable} />
      ) : null}
      {recentRecovery ? <LazyRecentRecoveryDialog {...recentRecovery} /> : null}
      {replaceGuard ? <LazyReplaceGuardDialog {...replaceGuard} /> : null}
      {search ? <LazyProjectSearchDialog {...search} /> : null}
      {insertComponent ? (
        <LazyInsertComponentDialog {...insertComponent} />
      ) : null}
      {cellManager ? <LazyCellManagerDialog {...cellManager} /> : null}
      {netlistPreflight ? (
        <LazyNetlistPreflightDialog {...netlistPreflight} />
      ) : null}
    </Suspense>
  );
}
