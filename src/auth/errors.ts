/** Thrown when a Drive call needs an access token and none is available.
 *  Getting one requires a user gesture (GIS opens a popup), so callers in
 *  background paths treat this as "not connected" rather than a failure. */
export class NeedsAuthError extends Error {
  constructor() {
    super('needs_auth');
    this.name = 'NeedsAuthError';
  }
}
