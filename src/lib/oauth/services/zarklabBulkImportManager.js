import {
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY,
  KiroBulkImportManager,
  buildLookupResponse,
  createFreshContext,
} from "./kiroBulkImportManager.js";
import { generateEmail, waitForOtp } from "./catchmailClient.js";
import { generatePassword, runZarkLabAccount } from "./zarklabAutomation.js";

const ZARKLAB_PROVIDER_ID = "zarklab";
const DEFAULT_COUNT = 1;
const MAX_COUNT = 8;
const ZARKLAB_OTP_TIMEOUT_MS = 60_000;
const ZARKLAB_OTP_POLL_INTERVAL_MS = 3_000;

function clampCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_COUNT;
  return Math.min(MAX_COUNT, Math.max(1, parsed));
}

async function defaultZarkLabBrowserLauncher(job) {
  const { launchBulkImportBrowser } = await import("./bulkImportBrowserEngine.js");
  return launchBulkImportBrowser({
    engine: job?.engine || "chromium",
    proxyUrl: job?.proxyUrl || undefined,
    headless: false,
    args: ["--start-maximized"],
  });
}

async function defaultSaveZarkLabConnection({ apiKey, email }) {
  const { createProviderConnection } = await import("../../../models/index.js");
  const providerSpecificData = {
    automation: "signup-bulk",
    baseUrl: "https://www.zarklab.ai/api/v1",
  };
  const connection = await createProviderConnection({
    provider: ZARKLAB_PROVIDER_ID,
    authType: "apikey",
    name: email.split("@")[0] || "zarklab",
    ...(apiKey ? { apiKey } : {}),
    email,
    providerSpecificData,
    testStatus: "active",
  });
  return { connection };
}

export class ZarkLabBulkImportManager extends KiroBulkImportManager {
  constructor({
    browserLauncher = defaultZarkLabBrowserLauncher,
    saveConnection = defaultSaveZarkLabConnection,
    storageName = "zarklab-bulk-import",
  } = {}) {
    super({
      browserLauncher,
      googleAutomation: null,
      socialExchange: null,
      storageName,
    });
    this.saveConnection = saveConnection;
  }

  async startJob({
    count,
    concurrency,
    engine,
    proxyUrl,
    proxyUrls,
    proxyMode,
    proxyPoolId,
    proxySource,
    domain,
  }) {
    const total = clampCount(count);
    const generated = Array.from({ length: total }, () => {
      const email = generateEmail(domain || "random");
      const password = generatePassword();
      return `${email}|${password}`;
    });

    const job = await super.startJob({
      accounts: generated,
      concurrency,
      engine,
      proxyUrl,
      proxyUrls,
      proxyMode,
      proxyPoolId,
      proxySource,
      jobFields: {
        zarklab: {
          domain: domain || "random",
        },
      },
    });
    return job;
  }

  async processAccount(job, account, workerId, browser = job.browser) {
    if (job.cancelRequested || !browser) {
      this.finalizeAccount(account, "cancelled", { error: "Job cancelled" });
      return;
    }

    const { context, page } = await createFreshContext(browser);
    const workerProxyUrl = browser.__ninerouterProxyUrl || job.proxyUrl || null;
    account.runtimeSession = { context, page, proxyUrl: workerProxyUrl };

    try {
      const email = account.email;

      this.setAccountStep(account, "preparing_worker", `Worker ${workerId} preparing ZarkLab browser context`);
      await this.persistJobSnapshot(job, { forcePreview: true });

      this.setAccountStep(account, "generating_temp_email", `Using temporary mailbox ${email}`);
      await this.persistJobSnapshot(job, { forcePreview: true });

      const apiKey = await runZarkLabAccount({
        page,
        email,
        password: account.password,
        waitForOtp: () => waitForOtp(email, {
          timeoutMs: ZARKLAB_OTP_TIMEOUT_MS,
          intervalMs: ZARKLAB_OTP_POLL_INTERVAL_MS,
        }),
        onStep: (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      });

      this.setAccountStep(account, "saving_connection", "Saving ZarkLab connection");
      const { connection } = await this.saveConnection({
        apiKey,
        email,
      });

      this.finalizeAccount(account, "success", {
        connectionId: connection.id,
        step: "connection_saved",
        message: "ZarkLab connection saved successfully",
      });
    } catch (error) {
      const terminalStatus = typeof error.status === "string" ? error.status : "failed";
      this.finalizeAccount(account, terminalStatus, {
        error: error.message || "ZarkLab automation failed",
        step: error.step || "failed",
        message: error.message || "ZarkLab automation failed",
      });
    } finally {
      account.password = undefined;
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    }
  }
}

function getSingletonStore() {
  if (!globalThis.__zarklabBulkImportSingleton) {
    globalThis.__zarklabBulkImportSingleton = {
      manager: new ZarkLabBulkImportManager(),
    };
  }
  return globalThis.__zarklabBulkImportSingleton;
}

export function getZarkLabBulkImportManager() {
  return getSingletonStore().manager;
}

export {
  buildLookupResponse,
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY as ZARKLAB_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY as ZARKLAB_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY as ZARKLAB_BULK_IMPORT_MIN_CONCURRENCY,
};
