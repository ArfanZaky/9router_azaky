import { GrokCliBulkImportManager } from "./grokCliBulkImportManager.js";
import { runGrokCliDomainAutomation } from "./grokCliDomainAutomation.js";

const DOMAIN_AUTOMATION_VERSION = "2026-07-28-signin-email-next-v16";

export class GrokCliDomainBulkImportManager extends GrokCliBulkImportManager {
  constructor(options = {}) {
    super({
      ...options,
      googleAutomation: options.googleAutomation || runGrokCliDomainAutomation,
      storageName: "grok-cli-domain-bulk-import",
    });
  }
}

function getSingletonStore() {
  if (!globalThis.__grokCliDomainBulkImportSingleton) {
    globalThis.__grokCliDomainBulkImportSingleton = { manager: null };
  }
  return globalThis.__grokCliDomainBulkImportSingleton;
}

export function getGrokCliDomainBulkImportManager() {
  const store = getSingletonStore();
  if (!store.manager) store.manager = new GrokCliDomainBulkImportManager();
  // Next.js HMR preserves the global manager (and its jobs), but the constructor
  // captured the old automation function. Refresh the function pointer in place
  // so new accounts use the latest flow without orphaning active job status.
  store.manager.refreshRuntimeDefaults?.({ googleAutomation: runGrokCliDomainAutomation });
  if (store.manager.domainAutomationVersion !== DOMAIN_AUTOMATION_VERSION) {
    store.manager.domainAutomationVersion = DOMAIN_AUTOMATION_VERSION;
    console.log(`[GrokCLI:Domain] Automation version ${DOMAIN_AUTOMATION_VERSION}`);
  }
  return store.manager;
}

export function _resetGrokCliDomainBulkImportManager() {
  getSingletonStore().manager = null;
}
