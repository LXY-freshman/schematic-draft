import type { RecoveryState } from "../document/recovery-coordinator";

export interface RecoveryFailureBannerProps {
  state: RecoveryState;
  onSaveCopy(): void;
  onDismiss(): void;
}

export interface RecoveryAvailableBannerProps {
  projectName: string;
  updatedAt: string;
  onRestore(): void;
  onSaveCopy(): void;
  onDismiss(): void;
}

function failureMessage(state: RecoveryState): string {
  switch (state) {
    case "quota-exceeded":
      return "Browser storage for this site is full — new recovery copies cannot be saved.";
    case "unavailable":
      return "Browser storage is unavailable — recovery copies cannot be saved.";
    default:
      return "The latest recovery copy could not be saved.";
  }
}

/**
 * Persistent, dismissible warning that recovery writes are failing, with a
 * direct save so the user can secure the current Project immediately.
 */
export function RecoveryFailureBanner({
  state,
  onSaveCopy,
  onDismiss,
}: RecoveryFailureBannerProps) {
  return (
    <aside
      className="recovery-banner recovery-banner-warning"
      data-testid="recovery-failure-banner"
      role="alert"
      aria-label="Recovery storage problem"
    >
      <p>{failureMessage(state)} Save a copy to keep your work safe.</p>
      <div className="recovery-banner-actions">
        <button type="button" onClick={onSaveCopy}>
          Save a Copy…
        </button>
        <button type="button" onClick={onDismiss} aria-label="Dismiss warning">
          Dismiss
        </button>
      </div>
    </aside>
  );
}

/** Non-modal startup offer for a newer, explicitly unsaved working copy. */
export function RecoveryAvailableBanner({
  projectName,
  updatedAt,
  onRestore,
  onSaveCopy,
  onDismiss,
}: RecoveryAvailableBannerProps) {
  return (
    <aside
      className="recovery-banner"
      data-testid="startup-recovery-banner"
      aria-label="Unsaved recovery available"
    >
      <p>
        Unsaved work for <strong>{projectName}</strong> was recovered from{" "}
        <time dateTime={updatedAt}>{new Date(updatedAt).toLocaleString()}</time>
        .
      </p>
      <div className="recovery-banner-actions">
        <button type="button" onClick={onRestore}>
          Restore
        </button>
        <button type="button" onClick={onSaveCopy}>
          Save a copy…
        </button>
        <button type="button" onClick={onDismiss}>
          Ignore
        </button>
      </div>
    </aside>
  );
}

/** Concise statusbar label derived from coordinator recovery state. */
export function recoveryStateLabel(state: RecoveryState): string | null {
  switch (state) {
    case "idle":
    case "pending":
    case "stored":
      return null;
    case "quota-exceeded":
      return "Recovery full — save a copy now";
    case "unavailable":
      return "Recovery unavailable — save a copy now";
    case "failed":
      return "Recovery failed — save a copy now";
  }
}
