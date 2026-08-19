let _enabled = false;
let _apiKey = '';

export function configureFmpService(opts: { enabled: boolean; apiKey: string }): void {
  _enabled = opts.enabled;
  _apiKey = opts.apiKey;
}

export function getFmpServiceConfig(): { enabled: boolean; apiKey: string } {
  return { enabled: _enabled, apiKey: _apiKey };
}
