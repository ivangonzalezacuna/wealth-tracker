export const PROFILE_SCHEMA_VERSION = 1;
export const PROFILE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const PROFILE_MAX_RECORDS = 10_000;
export const PROFILE_MAX_EXPORT_BYTES = 3 * 1024 * 1024;

export type ProfileCategory =
  'vital' | 'app' | 'route' | 'render' | 'database' | 'drive' | 'sync' | 'browser' | 'error';

export type ProfileScalar = string | number | boolean;

export interface ProfileRecord {
  id: string;
  timestamp: number;
  appVersion: string;
  buildId: string;
  runId: string;
  profilerSchemaVersion: number;
  category: ProfileCategory;
  name: string;
  route?: string;
  durationMs?: number;
  value?: number;
  unit?: string;
  rating?: string;
  outcome?: string;
  retryCount?: number;
  payloadBytes?: number;
  recordCount?: number;
  count?: number;
  bytes?: number;
  usedHeapBytes?: number;
  navigationType?: string;
  cacheState?: string;
  initiatorType?: string;
  interactionType?: string;
  loadState?: string;
  attribution?: Record<string, ProfileScalar>;
}

export interface ProfileRecordInput {
  route?: string;
  durationMs?: number;
  value?: number;
  unit?: string;
  rating?: string;
  outcome?: string;
  retryCount?: number;
  payloadBytes?: number;
  recordCount?: number;
  count?: number;
  bytes?: number;
  usedHeapBytes?: number;
  navigationType?: string;
  cacheState?: string;
  initiatorType?: string;
  interactionType?: string;
  loadState?: string;
  attribution?: Record<string, ProfileScalar>;
}

export interface ProfileRelease {
  appVersion: string;
  buildId: string;
  sampleCount: number;
  runCount: number;
  firstSeen: number;
  lastSeen: number;
}

export interface Distribution {
  sampleCount: number;
  median: number | null;
  p75: number | null;
  p95: number | null;
  maximum: number | null;
}

export interface ProfileGroup {
  category: ProfileCategory;
  name: string;
  appVersion: string;
  buildId: string;
  route?: string;
  unit: string;
  eventCount: number;
  sampleCount: number;
  distribution: Distribution;
  successCount?: number;
  failureCount?: number;
  retryCount?: number;
  meanPayloadBytes?: number | null;
  ratingCounts?: Record<string, number>;
}
