// -----------------------------------------------------------------------------
// Entry point: wires the SDK to the dingz runtime (src/app.js).
//
// Environment provided by the Gladys supervisor: GLADYS_HOST_API_URL,
// GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR (read by the SDK).
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { DingzIntegration } from './src/app.js';

const gladys = new GladysIntegration();
const dingz = new DingzIntegration(gladys);

// Discovery tab: "Scan" button.
gladys.onScanRequest(async () => {
  await dingz.scan();
});

// The user switches a light, moves a blind...
gladys.onSetValue((device, feature, value) => dingz.setValue(device, feature, value));

// Configuration-screen buttons.
gladys.onAction('test_connection', () => dingz.testConnection());
gladys.onAction('identify', (fields) => dingz.identify(fields.device));

gladys.onConfigUpdated(async (newConfig) => {
  dingz.setConfig(newConfig);
  // New addresses typed by the user: show them in the Discovery tab.
  await dingz.scan().catch((err) => logger.warn(`Scan after config update failed: ${err.message}`));
  dingz.start();
});

// Keep the list of created devices current, so the refresh loop reads the
// newly added dingz at once and drops the deleted ones.
const refreshDeviceList = async () => {
  await gladys.getDevices().catch((err) => logger.warn(`getDevices failed: ${err.message}`));
};
gladys.onDeviceCreated(async () => {
  await refreshDeviceList();
  dingz.start();
});
gladys.onDeviceUpdated(refreshDeviceList);
gladys.onDeviceDeleted(refreshDeviceList);

gladys.on('connected', async () => {
  try {
    dingz.setConfig(await gladys.getConfig());
    await refreshDeviceList();
    // Republish the dingz (names, wiring and addresses may have changed).
    await dingz.scan().catch((err) => logger.warn(`Initial scan failed: ${err.message}`));
    dingz.start();
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
      })
      .catch(() => {});
  }
});

gladys.on('disconnected', () => dingz.stop());

gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  dingz.stop();
});

logger.info('Starting the dingz integration...');
await dingz.init();
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
