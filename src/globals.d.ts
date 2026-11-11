/**
 * Typed window bridge for main.ts functions settings.ts calls without
 * importing main.ts directly (avoids a settings.ts <-> main.ts import cycle,
 * since main.ts already imports from settings.ts).
 */
export {};

import type { ProfileCategory, ProfileRecordInput } from './performance/types';

declare global {
  var __wtProfiler:
    | {
        record: (category: ProfileCategory, name: string, input?: ProfileRecordInput) => void;
        flush: () => Promise<void>;
        getStatus: () => {
          enabled: boolean;
          queuedRecords: number;
          storageError: string | null;
          runId: string;
        };
      }
    | undefined;

  interface Window {
    __forceFullResync?: () => Promise<void>;
    __exportBackup?: () => Promise<void>;
    __restoreFromBackup?: (file: File) => Promise<'cancelled' | 'done'>;
    __openSyncConflictResolver?: () => Promise<void>;
    __hasSyncConflict?: () => boolean;
    __allowSyncWrite?: () => boolean;
  }

  // Non-standard InputDeviceCapabilities API (Chrome/Android)
  interface InputDeviceCapabilities {
    firesTouchEvents: boolean;
  }

  interface MouseEvent {
    readonly sourceCapabilities: InputDeviceCapabilities | null;
  }
}
