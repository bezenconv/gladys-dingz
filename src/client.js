// -----------------------------------------------------------------------------
// Minimal client of the dingz local REST API (http://<dingz>/api/v1/...).
//
// The dingz is a small embedded device: it answers one request at a time and
// needs a short pause between two of them (iolo recommends ~200 ms), or it
// returns 5xx / drops the connection. Every request to the same host therefore
// goes through a per-host queue that serializes them and spaces them out.
// -----------------------------------------------------------------------------

const REQUEST_GAP_MS = 200;
const DEFAULT_TIMEOUT_MS = 5000;

export class DingzHttpError extends Error {
  constructor(message, { status, host, path } = {}) {
    super(message);
    this.name = 'DingzHttpError';
    this.status = status;
    this.host = host;
    this.path = path;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class DingzClient {
  /**
   * @param {object} [options]
   * @param {typeof fetch} [options.fetch] injectable for the tests
   * @param {number} [options.timeoutMs]
   * @param {number} [options.gapMs]
   */
  constructor({
    fetch: fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    gapMs = REQUEST_GAP_MS,
  } = {}) {
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.gapMs = gapMs;
    // host -> tail promise of its queue
    this.queues = new Map();
  }

  /** Run `task` after every request already queued for `host`. */
  enqueue(host, task) {
    const previous = this.queues.get(host) ?? Promise.resolve();
    const run = previous.then(task, task);
    // The queue tail must never reject, and keeps the pause between requests.
    const tail = run.then(
      () => sleep(this.gapMs),
      () => sleep(this.gapMs),
    );
    this.queues.set(host, tail);
    tail.then(() => {
      if (this.queues.get(host) === tail) {
        this.queues.delete(host);
      }
    });
    return run;
  }

  async request(host, method, path, { query, body, attempts = method === 'GET' ? 3 : 2 } = {}) {
    const url = new URL(`http://${host}/api/v1/${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.enqueue(host, async () => {
          const init = { method, signal: AbortSignal.timeout(this.timeoutMs) };
          if (body !== undefined) {
            init.body = body;
            init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
          }
          const response = await this.fetch(url, init);
          if (!response.ok) {
            throw new DingzHttpError(
              `dingz ${host} answered ${response.status} to ${method} /${path}`,
              {
                status: response.status,
                host,
                path,
              },
            );
          }
          const text = await response.text();
          if (!text) {
            return null;
          }
          try {
            return JSON.parse(text);
          } catch {
            return text;
          }
        });
      } catch (err) {
        lastError = err;
        // A 4xx will not get better by retrying.
        if (err instanceof DingzHttpError && err.status >= 400 && err.status < 500) {
          break;
        }
        if (attempt < attempts) {
          await sleep(500 * attempt);
        }
      }
    }
    if (lastError instanceof DingzHttpError) {
      throw lastError;
    }
    throw new DingzHttpError(
      `dingz ${host} unreachable (${lastError?.message ?? 'unknown error'})`,
      {
        host,
        path,
      },
    );
  }

  get(host, path, options) {
    return this.request(host, 'GET', path, options);
  }

  post(host, path, query, options) {
    return this.request(host, 'POST', path, { ...options, query });
  }

  // --- Reads -----------------------------------------------------------------

  getDevice(host) {
    return this.get(host, 'device');
  }

  getState(host) {
    return this.get(host, 'state');
  }

  getSystemConfig(host) {
    return this.get(host, 'system_config');
  }

  getOutputConfig(host) {
    return this.get(host, 'output_config');
  }

  getBlindConfig(host) {
    return this.get(host, 'blind_config');
  }

  /**
   * Everything needed to describe a dingz to Gladys, in one call.
   * @returns {Promise<{ mac: string, device: object, system: object, outputs: object[], blinds: object[], state: object }>}
   */
  async getFullInfo(host) {
    const deviceResponse = (await this.getDevice(host)) ?? {};
    const [macKey] = Object.keys(deviceResponse);
    if (!macKey) {
      throw new DingzHttpError(`dingz ${host}: /api/v1/device returned no device`, {
        host,
        path: 'device',
      });
    }
    const device = deviceResponse[macKey] ?? {};
    const system = (await this.getSystemConfig(host)) ?? {};
    const outputs = (await this.getOutputConfig(host))?.outputs ?? [];
    // Some firmwares answer 404 here when no motor is configured.
    const blinds = await this.getBlindConfig(host)
      .then((body) => body?.blinds ?? [])
      .catch(() => []);
    const state = (await this.getState(host)) ?? {};
    return { mac: macKey, device, system, outputs, blinds, state };
  }

  // --- Commands --------------------------------------------------------------

  /** `action`: on | off | toggle. `value`: 0-100. */
  setDimmer(host, index, action, { value, ramp } = {}) {
    return this.post(host, `dimmer/${index}/${action}`, { value, ramp });
  }

  /** `action`: up | down | stop. */
  moveShade(host, index, action) {
    return this.post(host, `shade/${index}/${action}`);
  }

  /** Position and/or lamella, 0-100 (0 = closed, 100 = open). */
  setShadePosition(host, index, { blind, lamella } = {}) {
    return this.post(host, `shade/${index}`, { blind, lamella });
  }

  /**
   * Front LED: `action` on | off | toggle, `color` "RRGGBB" (rgb mode) or
   * "h;s;v" (hsv mode). The dingz does not decode escaped form fields (a `;`
   * sent as `%3B` is refused), hence the hand-built body.
   */
  setLed(host, { action, color, mode, ramp } = {}) {
    const body = Object.entries({ action, color, mode, ramp })
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
    return this.request(host, 'POST', 'led/set', { body });
  }
}
