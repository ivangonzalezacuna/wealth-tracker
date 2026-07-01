import { tradeRepublicProfile } from './trade_republic';
import type { ImportProfile } from '../../types';

/**
 * Registry of built-in import profiles.
 * To support a new bank, add a profile object here - no parser code change needed.
 */
export const builtInProfiles: ImportProfile[] = [tradeRepublicProfile];
