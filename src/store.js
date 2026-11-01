// -----------------------------------------------------------------------------
// Last known address of every dingz (MAC -> host), kept in /data so a restart
// can reach the devices before any new scan. Best effort: a read-only or
// missing /data only costs a scan.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'store' });

export class HostStore {
  /** @param {string | null} dataDir null disables persistence (tests) */
  constructor(dataDir = '/data') {
    this.file = dataDir ? path.join(dataDir, 'hosts.json') : null;
    /** @type {Map<string, string>} */
    this.hosts = new Map();
  }

  async load() {
    if (!this.file) return;
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8'));
      for (const [mac, host] of Object.entries(raw ?? {})) {
        if (typeof host === 'string' && host) {
          this.hosts.set(mac, host);
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn(`Could not read ${this.file}: ${err.message}`);
      }
    }
  }

  get(mac) {
    return this.hosts.get(mac) ?? null;
  }

  /** Remember an address; resolves true when it changed. */
  async set(mac, host) {
    if (this.hosts.get(mac) === host) {
      return false;
    }
    this.hosts.set(mac, host);
    await this.save();
    return true;
  }

  async save() {
    if (!this.file) return;
    try {
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, JSON.stringify(Object.fromEntries(this.hosts), null, 2));
      await rename(tmp, this.file);
    } catch (err) {
      logger.warn(`Could not write ${this.file}: ${err.message}`);
    }
  }
}
