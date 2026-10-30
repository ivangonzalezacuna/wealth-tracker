import {
  getPendingSyncConflict,
  getSyncError,
  isSyncing,
  overwriteCloudWithLocal,
  replaceLocalWithCloud,
} from './engine';
import { isBusy } from './lock';
import { conflictDialog } from '../ui/conflictDialog';
import { confirmDialog } from '../ui/confirmDialog';
import type { SyncStatus } from '../ui/headerStatus';

interface RecoveryOptions {
  localIsEmpty: () => Promise<boolean>;
  backup: () => Promise<void>;
  refresh: () => Promise<void>;
  setBusy: (busy: boolean) => void;
  setStatus: (status: SyncStatus, message?: string) => void;
  onComplete: () => void;
  onError: (message: string) => void;
}

export function createConflictRecovery(options: RecoveryOptions) {
  let active: Promise<void> | null = null;
  let refreshRequired = false;

  async function finishRefresh(): Promise<void> {
    options.setStatus('refreshing');
    await options.refresh();
    refreshRequired = false;
    options.onComplete();
  }

  async function run(): Promise<void> {
    try {
      if (refreshRequired) {
        options.setBusy(true);
        try {
          await finishRefresh();
        } finally {
          options.setBusy(false);
        }
        return;
      }
      while (getPendingSyncConflict()) {
        const choice = await conflictDialog({ localIsEmpty: await options.localIsEmpty() });
        if (choice === 'cancel') return;
        if (choice === 'backup') {
          await options.backup();
          continue;
        }
        const local = choice === 'keep-local';
        const confirmed = await confirmDialog({
          title: local ? 'Overwrite Drive with local data?' : 'Replace local data with Drive?',
          body: local
            ? 'This keeps this device as the source of truth and discards the newer Drive copy.'
            : 'This discards this device\u2019s unsynced local changes and replaces the local database with the Drive copy.',
          confirmLabel: local ? 'Overwrite Drive' : 'Replace local',
          danger: true,
        });
        if (!confirmed) continue;
        if (isBusy() || isSyncing()) throw new Error('A sync or save is in progress. Try again.');
        options.setBusy(true);
        options.setStatus(local ? 'checking' : 'downloading');
        try {
          const succeeded = await (local ? overwriteCloudWithLocal() : replaceLocalWithCloud());
          if (!succeeded) throw new Error(getSyncError() || 'Sync did not complete. Try again.');
          refreshRequired = true;
          await finishRefresh();
        } finally {
          options.setBusy(false);
        }
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.setStatus('error', message);
      options.onError(message);
    }
  }

  return {
    needsRefresh: () => refreshRequired,
    isOpen: () => active !== null,
    open(): Promise<void> {
      if (active) return active;
      if (isBusy() || isSyncing()) return Promise.resolve();
      active = run().finally(() => {
        active = null;
      });
      return active;
    },
  };
}
