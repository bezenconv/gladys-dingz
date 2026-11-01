// -----------------------------------------------------------------------------
// Runtime of the integration: address book of the dingz, discovery, the state
// refresh loop and the commands. index.js only wires it to the SDK.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { DingzClient } from './client.js';
import { normalizeConfig } from './config.js';
import {
  DINGZ_UDP_PORT,
  buildDevice,
  commandFor,
  isMoving,
  normalizeMac,
  parseAnnouncement,
  parseExternalId,
  stateToValues,
} from './model.js';
import { HostStore } from './store.js';

const logger = createLogger({ name: 'dingz' });

const UDP_SCAN_SECONDS = 12;
// After a command: first read, then follow a moving blind until it stops.
const AFTER_COMMAND_DELAY_MS = 800;
const FOLLOW_MOVE_EVERY_MS = 2000;
const FOLLOW_MOVE_MAX_MS = 150_000;
// An unreachable dingz may have a new DHCP lease: rescan, but not too often.
const RESCAN_COOLDOWN_MS = 5 * 60_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class DingzIntegration {
  /**
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
   * @param {{ client?: DingzClient, store?: HostStore }} [deps]
   */
  constructor(gladys, { client = new DingzClient(), store = new HostStore() } = {}) {
    this.gladys = gladys;
    this.client = client;
    this.store = store;
    this.config = normalizeConfig();
    this.timer = null;
    this.running = false;
    this.refreshing = false;
    this.lastRescan = 0;
    /** @type {Map<string, boolean>} mac -> reachable at last read */
    this.reachable = new Map();
    /** @type {Map<string, Promise<void>>} mac -> movement follower */
    this.followers = new Map();
  }

  async init() {
    await this.store.load();
  }

  setConfig(raw) {
    this.config = normalizeConfig(raw);
  }

  // --- Devices created in Gladys -------------------------------------------

  /** The created devices of this integration: [{ mac, device, featureIds }]. */
  createdDevices() {
    return (this.gladys.devices ?? [])
      .map((device) => {
        const parsed = parseExternalId(this.gladys, device.external_id);
        if (!parsed) return null;
        return {
          mac: parsed.mac,
          device,
          featureIds: new Set((device.features ?? []).map((feature) => feature.external_id)),
        };
      })
      .filter(Boolean);
  }

  /** Address of a dingz: address book first, then the IP_ADDRESS param. */
  hostOf(mac, device) {
    const known = this.store.get(mac);
    if (known) return known;
    const param = (device?.params ?? []).find((p) => p.name === 'IP_ADDRESS');
    return param?.value || null;
  }

  // --- Discovery -------------------------------------------------------------

  /** Candidate hosts: configured ones, then the UDP announcements. */
  async findCandidateHosts() {
    const candidates = new Map(); // host -> mac | null
    for (const host of this.config.hostList) {
      candidates.set(host, null);
    }
    if (this.config.udp_discovery) {
      try {
        const datagrams = await this.gladys.scanNetwork('udp-broadcast', {
          timeoutSeconds: UDP_SCAN_SECONDS,
        });
        for (const { source_ip: sourceIp, payload_base64: payload } of datagrams ?? []) {
          const announcement = parseAnnouncement(Buffer.from(payload ?? '', 'base64'));
          if (announcement?.isDingz && sourceIp) {
            candidates.set(sourceIp, announcement.mac);
          }
        }
      } catch (err) {
        logger.warn(
          `UDP discovery failed (${err.message}); only the configured addresses are used`,
        );
      }
    }
    return candidates;
  }

  /**
   * Read every reachable dingz and publish them in the Discovery tab.
   * @returns {Promise<{ found: object[], failed: { host: string, error: string }[] }>}
   */
  async scan() {
    const candidates = await this.findCandidateHosts();
    const found = [];
    const failed = [];
    for (const host of candidates.keys()) {
      try {
        const info = await this.client.getFullInfo(host);
        if (info.device?.type && info.device.type !== 'dingz') {
          logger.info(`${host} is a ${info.device.type}, not a dingz: ignored`);
          continue;
        }
        const mac = normalizeMac(info.mac);
        await this.store.set(mac, host);
        found.push({ ...info, mac, host });
      } catch (err) {
        failed.push({ host, error: err.message });
        logger.warn(`Cannot read the dingz at ${host}: ${err.message}`);
      }
    }
    this.lastRescan = Date.now();
    const devices = found.map((info) => buildDevice(this.gladys, info));
    if (devices.length > 0) {
      await this.gladys.publishDiscoveredDevices(devices);
    }
    logger.info(`Scan: ${found.length} dingz found, ${failed.length} unreachable`);
    return { found, failed };
  }

  // --- State refresh ---------------------------------------------------------

  start() {
    this.running = true;
    this.schedule(0);
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
  }

  schedule(delayMs) {
    clearTimeout(this.timer);
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      await this.refreshAll().catch((err) => logger.error('Refresh failed', err));
      this.schedule(this.config.refresh_interval * 1000);
    }, delayMs);
    this.timer.unref?.();
  }

  async refreshAll() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const devices = this.createdDevices();
      await Promise.all(devices.map((entry) => this.refreshDevice(entry)));
      const unreachable = devices.filter((entry) => this.reachable.get(entry.mac) === false);
      if (unreachable.length > 0 && Date.now() - this.lastRescan > RESCAN_COOLDOWN_MS) {
        // A new DHCP lease is the usual cause: the scan updates the address book.
        logger.info(`${unreachable.length} dingz unreachable: looking for new addresses`);
        await this.scan().catch((err) => logger.warn(`Rescan failed: ${err.message}`));
      }
      await this.reportStatus(devices);
    } finally {
      this.refreshing = false;
    }
  }

  /** Read one dingz and publish its changed states; resolves its raw state. */
  async refreshDevice({ mac, device, featureIds }) {
    const host = this.hostOf(mac, device);
    if (!host) {
      this.markReachable(mac, false, 'no known address');
      return null;
    }
    let state;
    try {
      state = await this.client.getState(host);
      this.markReachable(mac, true);
    } catch (err) {
      this.markReachable(mac, false, err.message);
      return null;
    }
    const prefix = `${device.external_id}:`;
    const states = Object.entries(stateToValues(state))
      .map(([key, value]) => ({ device_feature_external_id: `${prefix}${key}`, state: value }))
      .filter((entry) => featureIds.has(entry.device_feature_external_id));
    if (states.length > 0) {
      // Only the changed values are sent (300 states/min host API budget); a
      // stable value is re-sent every 30 min so it stays recently dated. A
      // refused batch is re-sent by the next call.
      await this.gladys
        .publishChangedStates(states, { heartbeat: 30 * 60_000 })
        .catch((err) => logger.warn(`Publishing the states of ${mac} failed: ${err.message}`));
    }
    return state;
  }

  markReachable(mac, ok, reason) {
    const previous = this.reachable.get(mac);
    this.reachable.set(mac, ok);
    if (previous !== ok) {
      if (ok) logger.info(`dingz ${mac} reachable`);
      else logger.warn(`dingz ${mac} unreachable: ${reason}`);
    }
  }

  async reportStatus(devices) {
    const down = devices.filter((entry) => this.reachable.get(entry.mac) === false);
    if (down.length === 0) {
      await this.gladys.setConnectionStatus(true).catch(() => {});
      return;
    }
    const names = down.map((entry) => entry.device.name || entry.mac).join(', ');
    await this.gladys
      .setConnectionStatus(down.length < devices.length, {
        en: `Unreachable dingz: ${names}.`,
        fr: `dingz injoignable(s) : ${names}.`,
      })
      .catch(() => {});
  }

  // --- Commands --------------------------------------------------------------

  async setValue(device, feature, value) {
    const parsed = parseExternalId(this.gladys, feature.external_id);
    if (!parsed?.featureKey) {
      throw new Error(`Unknown feature ${feature.external_id}`);
    }
    const host = this.hostOf(parsed.mac, device);
    if (!host) {
      throw new Error(
        `No known address for the dingz ${parsed.mac}: run a scan or set its address`,
      );
    }
    const command = commandFor(parsed.featureKey, value);
    logger.info(`${device.name ?? parsed.mac}: ${parsed.featureKey} <- ${value}`);
    if (command.kind === 'dimmer') {
      await this.client.setDimmer(host, command.index, command.action, { value: command.value });
    } else if (command.kind === 'shade-move') {
      await this.client.moveShade(host, command.index, command.action);
    } else {
      await this.client.setShadePosition(host, command.index, {
        blind: command.blind,
        lamella: command.lamella,
      });
    }
    // Publish what the dingz reports, not what was asked (has_feedback).
    this.followAfterCommand(parsed.mac);
  }

  /** Read the device right after a command, then while a blind moves. */
  followAfterCommand(mac) {
    if (this.followers.has(mac)) return;
    const run = (async () => {
      const startedAt = Date.now();
      await sleep(AFTER_COMMAND_DELAY_MS);
      for (;;) {
        const entry = this.createdDevices().find((candidate) => candidate.mac === mac);
        if (!entry) return;
        const state = await this.refreshDevice(entry);
        if (!state || !isMoving(state) || Date.now() - startedAt > FOLLOW_MOVE_MAX_MS) return;
        await sleep(FOLLOW_MOVE_EVERY_MS);
      }
    })()
      .catch((err) => logger.warn(`Follow-up read failed: ${err.message}`))
      .finally(() => this.followers.delete(mac));
    this.followers.set(mac, run);
  }

  // --- Actions ---------------------------------------------------------------

  /** Blink the front LED of a dingz, then restore it. */
  async identify(externalId) {
    const parsed = parseExternalId(this.gladys, externalId);
    const entry = parsed && this.createdDevices().find((candidate) => candidate.mac === parsed.mac);
    const host = parsed && this.hostOf(parsed.mac, entry?.device);
    if (!host) {
      return { en: 'No known address for this dingz.', fr: 'Aucune adresse connue pour ce dingz.' };
    }
    const led = (await this.client.getState(host))?.led ?? {};
    for (let i = 0; i < 3; i += 1) {
      await this.client.setLed(host, { action: 'on', color: 'FF0000', mode: 'rgb' });
      await sleep(500);
      await this.client.setLed(host, { action: 'off' });
      await sleep(400);
    }
    if (led.on) {
      const mode = led.mode === 'hsv' ? 'hsv' : 'rgb';
      const color = mode === 'hsv' ? led.hsv : led.rgb;
      await this.client.setLed(host, { action: 'on', ...(color ? { color, mode } : {}) });
    }
    return {
      en: 'The front LED of the dingz blinked red three times.',
      fr: 'La LED frontale du dingz a clignoté trois fois en rouge.',
    };
  }

  /** Configuration-screen button: scan and report what answered. */
  async testConnection() {
    const { found, failed } = await this.scan();
    if (found.length === 0 && failed.length === 0) {
      return {
        en: 'No dingz found. Enter their IP addresses, or check that the UDP discovery is enabled on the dingz (Settings > Services).',
        fr: 'Aucun dingz trouvé. Saisissez leurs adresses IP, ou vérifiez que la découverte UDP est activée sur les dingz (Réglages > Services).',
      };
    }
    const ok = found
      .map((info) => `${info.system?.dingz_name || info.mac} (${info.host})`)
      .join(', ');
    const ko = failed.map((entry) => entry.host).join(', ');
    return {
      en: [
        found.length ? `Reachable: ${ok}.` : '',
        failed.length ? `Unreachable: ${ko}.` : '',
        found.length ? 'Add them from the Discovery tab.' : '',
      ]
        .filter(Boolean)
        .join(' '),
      fr: [
        found.length ? `Joignables : ${ok}.` : '',
        failed.length ? `Injoignables : ${ko}.` : '',
        found.length ? "Ajoutez-les depuis l'onglet Découverte." : '',
      ]
        .filter(Boolean)
        .join(' '),
    };
  }
}

export { DINGZ_UDP_PORT };
