// -----------------------------------------------------------------------------
// Integration configuration: defaults (mirroring the manifest `config_schema`)
// and normalization of the object Gladys sends.
// -----------------------------------------------------------------------------

export const DEFAULT_CONFIG = {
  // Comma/space/newline separated list of dingz addresses (IP or host name),
  // used on top of (or instead of) the UDP discovery.
  hosts: '',
  // Listen to the dingz UDP announcements (port 7979) when scanning.
  udp_discovery: true,
  // Seconds between two state reads of each dingz.
  refresh_interval: 5,
};

export const MIN_REFRESH_INTERVAL = 2;
export const MAX_REFRESH_INTERVAL = 300;

/**
 * Split the free-text `hosts` field into clean host strings: `192.168.1.20`,
 * `dingz-office.lan`, `http://192.168.1.21:80` all accepted.
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseHosts(raw) {
  if (typeof raw !== 'string') {
    return [];
  }
  const hosts = raw
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/^https?:\/\//i, '').replace(/\/+$/, ''));
  return [...new Set(hosts)];
}

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const interval = Number(raw.refresh_interval ?? DEFAULT_CONFIG.refresh_interval);
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    hosts: typeof raw.hosts === 'string' ? raw.hosts : DEFAULT_CONFIG.hosts,
    hostList: parseHosts(raw.hosts),
    udp_discovery: raw.udp_discovery !== false,
    refresh_interval: Number.isFinite(interval)
      ? Math.min(MAX_REFRESH_INTERVAL, Math.max(MIN_REFRESH_INTERVAL, interval))
      : DEFAULT_CONFIG.refresh_interval,
  };
}
