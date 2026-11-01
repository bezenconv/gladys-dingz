// -----------------------------------------------------------------------------
// Pure translation between the dingz API and Gladys: discovery payloads,
// feature layout, states and commands. No I/O here, everything is unit-tested.
//
// One Gladys device per dingz. Its features depend on how the dingz is wired
// (read from its configuration):
//   output-<i>             each active output: light (or switch for the other
//                          output types: fan, power socket, heater...)
//   output-<i>-brightness  dimmable light outputs
//   blind-<i>-state        each configured motor (blind / shade): open, close, stop
//   blind-<i>-position     0 = closed, 100 = open (dingz and Gladys agree)
//   blind-<i>-lamella      slat angle, 0 = closed, 100 = open
//   temperature            room temperature (°C)
//   illuminance            light sensor (lux)
//   motion                 PIR, dingz with a motion detector only
//   power-<i>              power drawn by each active output (W)
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';

export const DEVICE_TYPE = 'dingz';

// myStrom/dingz UDP announcement: 6 bytes MAC, 1 byte device type, 1 byte flags.
export const DINGZ_UDP_PORT = 7979;
export const DINGZ_DEVICE_TYPE_CODE = 108;

// Gladys COVER_STATE (server/utils/constants.js).
export const COVER_STATE = { STOP: 0, OPEN: 1, CLOSE: -1 };

/** "f0:08:d1:c2:f9:c4", "F008D1C2F9C4" -> "F008D1C2F9C4" (null if not a MAC). */
export function normalizeMac(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const hex = raw.replace(/[^0-9a-f]/gi, '').toUpperCase();
  return hex.length === 12 ? hex : null;
}

/**
 * Decode a UDP announcement (raw bytes). Returns null for anything that is
 * not an 8-byte myStrom-style announcement.
 * @param {Buffer} payload
 * @returns {{ mac: string, typeCode: number, isDingz: boolean } | null}
 */
export function parseAnnouncement(payload) {
  if (!Buffer.isBuffer(payload) || payload.length !== 8) {
    return null;
  }
  const mac = normalizeMac(payload.subarray(0, 6).toString('hex'));
  if (!mac) {
    return null;
  }
  const typeCode = payload[6];
  return { mac, typeCode, isDingz: typeCode === DINGZ_DEVICE_TYPE_CODE };
}

// --- Layout --------------------------------------------------------------------

/**
 * Which outputs / blinds / sensors a dingz exposes, from its configuration
 * and its current state (the `readonly` flag of a dimmer marks an output
 * driven by a motor).
 * @param {{ device: object, outputs: object[], blinds: object[], state: object }} info
 */
export function buildLayout(info) {
  const outputConfigs = info.outputs ?? [];
  const dimmerStates = info.state?.dimmers ?? [];
  const blindStates = info.state?.blinds ?? [];
  const blindConfigs = info.blinds ?? [];
  const sensors = info.state?.sensors ?? {};

  const outputs = [];
  outputConfigs.forEach((output, index) => {
    const dimmer = dimmerStates[index];
    if (!output?.active || !dimmer || dimmer.readonly) {
      return;
    }
    const isLight = output.type === 'light';
    outputs.push({
      index,
      name: output.name || null,
      kind: isLight ? 'light' : 'switch',
      dimmable: isLight && output.light?.dimmable === true,
    });
  });

  const blinds = blindStates.map((blindState, index) => ({
    index,
    name: blindConfigs[index]?.name || null,
    readonly: blindState?.readonly === true,
  }));

  return {
    outputs,
    blinds,
    hasTemperature: typeof sensors.room_temperature === 'number',
    hasIlluminance: typeof sensors.brightness === 'number',
    hasMotion:
      info.device?.has_pir === true ||
      (sensors.pirs ?? []).some((pir) => pir && pir.enabled !== false),
    hasPower: Array.isArray(sensors.power_outputs),
  };
}

// --- Discovery payload ---------------------------------------------------------

export function deviceName(info) {
  const name = info.system?.dingz_name?.trim();
  const room = info.system?.room_name?.trim();
  if (name && room && !name.toLowerCase().includes(room.toLowerCase())) {
    return `${room} – ${name}`;
  }
  return name || room || `dingz ${normalizeMac(info.mac)?.slice(-6) ?? ''}`.trim();
}

const label = (base, custom) => (custom ? `${custom}` : base);

/**
 * The Gladys discovery payload of one dingz.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {object} info result of DingzClient.getFullInfo + `host`
 */
export function buildDevice(gladys, info) {
  const mac = normalizeMac(info.mac);
  const ids = gladys.externalIds(DEVICE_TYPE, mac);
  const layout = buildLayout(info);
  const features = [];
  const add = (key, feature) =>
    features.push({ external_id: ids.feature(key), has_feedback: true, ...feature });

  for (const output of layout.outputs) {
    const base = label(`Output ${output.index + 1}`, output.name);
    if (output.kind === 'light') {
      add(`output-${output.index}`, {
        name: base,
        category: CAT.LIGHT,
        type: TYPES.LIGHT.BINARY,
        read_only: false,
        keep_history: true,
        min: 0,
        max: 1,
      });
      if (output.dimmable) {
        add(`output-${output.index}-brightness`, {
          name: `${base} – brightness`,
          category: CAT.LIGHT,
          type: TYPES.LIGHT.BRIGHTNESS,
          unit: UNITS.PERCENT,
          read_only: false,
          keep_history: true,
          min: 0,
          max: 100,
        });
      }
    } else {
      add(`output-${output.index}`, {
        name: base,
        category: CAT.SWITCH,
        type: TYPES.SWITCH.BINARY,
        read_only: false,
        keep_history: true,
        min: 0,
        max: 1,
      });
    }
  }

  for (const blind of layout.blinds) {
    const base = label(`Blind ${blind.index + 1}`, blind.name);
    add(`blind-${blind.index}-state`, {
      name: base,
      category: CAT.SHUTTER,
      type: TYPES.SHUTTER.STATE,
      read_only: blind.readonly,
      keep_history: false,
      min: -1,
      max: 1,
    });
    add(`blind-${blind.index}-position`, {
      name: `${base} – position`,
      category: CAT.SHUTTER,
      type: TYPES.SHUTTER.POSITION,
      unit: UNITS.PERCENT,
      read_only: blind.readonly,
      keep_history: true,
      min: 0,
      max: 100,
    });
    add(`blind-${blind.index}-lamella`, {
      name: `${base} – slats`,
      category: CAT.SHUTTER,
      type: TYPES.SHUTTER.POSITION,
      unit: UNITS.PERCENT,
      read_only: blind.readonly,
      keep_history: false,
      min: 0,
      max: 100,
    });
  }

  if (layout.hasTemperature) {
    add('temperature', {
      name: 'Temperature',
      category: CAT.TEMPERATURE_SENSOR,
      type: TYPES.SENSOR.DECIMAL,
      unit: UNITS.CELSIUS,
      read_only: true,
      keep_history: true,
      min: -20,
      max: 60,
    });
  }
  if (layout.hasIlluminance) {
    add('illuminance', {
      name: 'Light level',
      category: CAT.LIGHT_SENSOR,
      type: TYPES.SENSOR.DECIMAL,
      unit: UNITS.LUX,
      read_only: true,
      keep_history: true,
      min: 0,
      max: 100000,
    });
  }
  if (layout.hasMotion) {
    add('motion', {
      name: 'Motion',
      category: CAT.MOTION_SENSOR,
      type: TYPES.SENSOR.BINARY,
      read_only: true,
      keep_history: true,
      min: 0,
      max: 1,
    });
  }
  if (layout.hasPower) {
    for (const output of layout.outputs) {
      add(`power-${output.index}`, {
        name: `${label(`Output ${output.index + 1}`, output.name)} – power`,
        category: CAT.SWITCH,
        type: TYPES.SWITCH.POWER,
        unit: UNITS.WATT,
        read_only: true,
        keep_history: true,
        min: 0,
        max: 4000,
      });
    }
  }

  const params = [{ name: 'MAC_ADDRESS', value: mac }];
  if (info.host) {
    params.push({ name: 'IP_ADDRESS', value: info.host });
  }
  if (info.device?.fw_version) {
    params.push({ name: 'FIRMWARE', value: String(info.device.fw_version) });
  }
  if (info.device?.puck_hw_model || info.device?.front_hw_model) {
    params.push({
      name: 'MODEL',
      value: [info.device.front_hw_model, info.device.puck_hw_model].filter(Boolean).join(' / '),
    });
  }

  return {
    name: deviceName(info),
    external_id: ids.device,
    // States are read by the integration's own timer (refresh_interval).
    should_poll: false,
    params,
    features,
  };
}

// --- Ids ------------------------------------------------------------------------

/**
 * Split a device or feature external id of this integration into its MAC and
 * feature key. Returns null for a foreign id.
 */
export function parseExternalId(gladys, externalId) {
  const prefix = gladys.externalId(`${DEVICE_TYPE}:`);
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const [macPart, ...rest] = externalId.slice(prefix.length).split(':');
  const mac = normalizeMac(macPart);
  if (!mac) {
    return null;
  }
  return { mac, featureKey: rest.length > 0 ? rest.join(':') : null };
}

// --- States ---------------------------------------------------------------------

const round1 = (value) => Math.round(value * 10) / 10;

function motionToCoverState(moving) {
  if (moving === 'up') return COVER_STATE.OPEN;
  if (moving === 'down') return COVER_STATE.CLOSE;
  return COVER_STATE.STOP;
}

/**
 * Translate a `/api/v1/state` answer into `{ featureKey: value }`.
 * Keys absent from the device layout are simply ignored by the caller.
 */
export function stateToValues(state) {
  const values = {};
  (state?.dimmers ?? []).forEach((dimmer, index) => {
    if (!dimmer || typeof dimmer.on !== 'boolean') {
      return;
    }
    values[`output-${index}`] = dimmer.on ? 1 : 0;
    // Keep the last brightness while the light is off: Gladys shows it as the
    // level the light comes back at.
    if (dimmer.on && typeof dimmer.output === 'number') {
      values[`output-${index}-brightness`] = Math.max(0, Math.min(100, Math.round(dimmer.output)));
    }
  });
  (state?.blinds ?? []).forEach((blind, index) => {
    if (!blind) {
      return;
    }
    values[`blind-${index}-state`] = motionToCoverState(blind.moving);
    if (typeof blind.position === 'number') {
      values[`blind-${index}-position`] = Math.round(blind.position);
    }
    if (typeof blind.lamella === 'number') {
      values[`blind-${index}-lamella`] = Math.round(blind.lamella);
    }
  });
  const sensors = state?.sensors ?? {};
  if (typeof sensors.room_temperature === 'number') {
    values.temperature = round1(sensors.room_temperature);
  }
  if (typeof sensors.brightness === 'number') {
    values.illuminance = Math.round(sensors.brightness);
  }
  if (Array.isArray(sensors.pirs)) {
    values.motion = sensors.pirs.some((pir) => pir?.motion === true) ? 1 : 0;
  }
  (sensors.power_outputs ?? []).forEach((power, index) => {
    if (typeof power?.value === 'number') {
      values[`power-${index}`] = round1(power.value);
    }
  });
  return values;
}

/** True while at least one motor of the dingz is moving. */
export function isMoving(state) {
  return (state?.blinds ?? []).some(
    (blind) => blind && (blind.moving === 'up' || blind.moving === 'down'),
  );
}

// --- Commands -------------------------------------------------------------------

/**
 * Translate a Gladys command into a dingz API call description.
 * @returns {{ kind: 'dimmer', index, action, value? } | { kind: 'shade-move', index, action } | { kind: 'shade-position', index, blind?, lamella? }}
 */
export function commandFor(featureKey, rawValue) {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid value "${rawValue}"`);
  }
  let match = /^output-(\d+)$/.exec(featureKey ?? '');
  if (match) {
    return { kind: 'dimmer', index: Number(match[1]), action: value >= 1 ? 'on' : 'off' };
  }
  match = /^output-(\d+)-brightness$/.exec(featureKey ?? '');
  if (match) {
    const level = Math.max(0, Math.min(100, Math.round(value)));
    return level === 0
      ? { kind: 'dimmer', index: Number(match[1]), action: 'off' }
      : { kind: 'dimmer', index: Number(match[1]), action: 'on', value: level };
  }
  match = /^blind-(\d+)-state$/.exec(featureKey ?? '');
  if (match) {
    const actions = {
      [COVER_STATE.OPEN]: 'up',
      [COVER_STATE.CLOSE]: 'down',
      [COVER_STATE.STOP]: 'stop',
    };
    const action = actions[Math.round(value)];
    if (!action) {
      throw new Error(`Invalid blind command ${rawValue} (expected -1, 0 or 1)`);
    }
    return { kind: 'shade-move', index: Number(match[1]), action };
  }
  match = /^blind-(\d+)-(position|lamella)$/.exec(featureKey ?? '');
  if (match) {
    const level = Math.max(0, Math.min(100, Math.round(value)));
    return {
      kind: 'shade-position',
      index: Number(match[1]),
      [match[2] === 'position' ? 'blind' : 'lamella']: level,
    };
  }
  throw new Error(`Feature "${featureKey}" cannot be controlled`);
}
