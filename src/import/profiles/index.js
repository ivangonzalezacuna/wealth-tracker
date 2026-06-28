import { tradeRepublicProfile } from './trade_republic.js';

/**
 * Registry of built-in import profiles.
 * To support a new bank, add a profile object here — no parser code change needed.
 *
 * @type {import('../profile.js').ImportProfile[]}
 */
export const builtInProfiles = [
  tradeRepublicProfile,
];
