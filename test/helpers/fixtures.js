// Realistic dingz API answers (firmware 2.x, a dingz with one dimmable light,
// one plain light, one blind and a motion detector).

export const MAC = 'F008D1C2F9C4';
export const HOST = '192.168.4.50';

export const deviceResponse = {
  [MAC]: {
    type: 'dingz',
    battery: false,
    reachable: true,
    fw_version: '2.1.14',
    hw_version: '1.2.0',
    puck_hw_model: 'DZ1B-1CH',
    front_hw_model: 'DZ1F-4B-PIR',
    has_pir: true,
  },
};

export const systemConfig = { dingz_name: 'Salon', room_name: 'Rez', id: MAC };

export const outputConfig = {
  outputs: [
    { active: true, name: 'Plafonnier', type: 'light', light: { dimmable: true } },
    { active: true, name: '', type: 'light', light: { dimmable: false } },
    { active: false, name: 'Store', type: 'light' },
    { active: false, name: 'Store', type: 'light' },
  ],
};

export const blindConfig = { blinds: [{ active: true, name: 'Store séjour', type: 'blind' }] };

export const state = {
  dimmers: [
    { on: true, output: 63, ramp: 0, readonly: false, index: { relative: 0, absolute: 0 } },
    { on: false, output: 0, ramp: 0, readonly: false, index: { relative: 1, absolute: 1 } },
    { on: false, output: 0, readonly: true, index: { relative: 0, absolute: 2 } },
    { on: false, output: 0, readonly: true, index: { relative: 1, absolute: 3 } },
  ],
  blinds: [
    {
      moving: 'stop',
      position: 40,
      lamella: 75,
      readonly: false,
      index: { relative: 0, absolute: 0 },
    },
  ],
  led: { on: true, hsv: '0;0;100', rgb: 'FFFFFF', mode: 'rgb' },
  sensors: {
    brightness: 312,
    light_state: 'day',
    room_temperature: 21.46,
    pirs: [{ enabled: true, motion: false }],
    power_outputs: [{ value: 12.34 }, { value: 0 }, { value: 0 }, { value: 0 }],
  },
};

/** Fake fetch routing the dingz API of one or several hosts. */
export function createFakeFetch(routes = { [HOST]: defaultRoutes() }) {
  const calls = [];
  const fakeFetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    calls.push({
      host: u.host,
      method,
      path: u.pathname,
      query: Object.fromEntries(u.searchParams),
      body: init.body,
    });
    const hostRoutes = routes[u.host];
    if (!hostRoutes) {
      throw new TypeError('fetch failed');
    }
    const handler =
      hostRoutes[`${method} ${u.pathname}`] ?? (method === 'POST' ? () => '' : undefined);
    if (!handler) {
      return new Response('not found', { status: 404 });
    }
    const body = handler(u, init);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
  };
  return { fetch: fakeFetch, calls };
}

export function defaultRoutes(overrides = {}) {
  return {
    'GET /api/v1/device': () => deviceResponse,
    'GET /api/v1/system_config': () => systemConfig,
    'GET /api/v1/output_config': () => outputConfig,
    'GET /api/v1/blind_config': () => blindConfig,
    'GET /api/v1/state': () => state,
    ...overrides,
  };
}

/** The 8-byte UDP announcement of a dingz. */
export function announcement(mac = MAC, typeCode = 108) {
  return Buffer.concat([Buffer.from(mac, 'hex'), Buffer.from([typeCode, 0x06])]).toString('base64');
}
