/** Type declarations for Google Identity Services (GIS) oauth2 token client. */

declare namespace google.accounts.oauth2 {
  interface TokenClientConfig {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: ErrorResponse) => void;
  }

  interface TokenResponse {
    access_token: string;
    expires_in: number;
    token_type: string;
    scope: string;
    error?: string;
    error_description?: string;
    error_uri?: string;
  }

  interface ErrorResponse {
    type: string;
    message?: string;
  }

  interface TokenClient {
    callback: (response: TokenResponse) => void;
    requestAccessToken(overrideConfig?: { prompt?: string }): void;
  }

  function initTokenClient(config: TokenClientConfig): TokenClient;
  function revoke(accessToken: string, done?: () => void): void;
}
