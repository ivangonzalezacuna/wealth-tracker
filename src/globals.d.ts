/**
 * Typed window bridge for main.ts functions settings.ts calls without
 * importing main.ts directly (avoids a settings.ts <-> main.ts import cycle,
 * since main.ts already imports from settings.ts).
 */
export {};

declare global {
  interface Window {
    __forceFullResync?: () => Promise<void>;
    __exportBackup?: () => Promise<void>;
    __restoreFromBackup?: (file: File) => Promise<'cancelled' | 'done'>;
    __exportTaxSummary?: (year: number) => void;
    __getTaxYears?: () => number[];
  }

  // Non-standard InputDeviceCapabilities API (Chrome/Android)
  interface InputDeviceCapabilities {
    firesTouchEvents: boolean;
  }

  interface MouseEvent {
    readonly sourceCapabilities: InputDeviceCapabilities | null;
  }
}
