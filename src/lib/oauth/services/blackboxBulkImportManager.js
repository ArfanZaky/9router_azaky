import {
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY,
  KiroBulkImportManager,
  buildLookupResponse,
  createFreshContext,
} from "./kiroBulkImportManager.js";
import { generateEmail, waitForOtp } from "./catchmailClient.js";
import { generatePassword, runBlackboxAccount } from "./blackboxAutomation.js";

const BLACKBOX_PROVIDER_ID = "blackbox";
const DEFAULT_COUNT = 1;
const MAX_COUNT = 8;
const BLACKBOX_DEFAULT_KEY_NAME = "9router-auto-farm";
const BLACKBOX_OTP_TIMEOUT_MS = 60_000;
const BLACKBOX_OTP_POLL_INTERVAL_MS = 3_000;

function clampCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_COUNT;
  return Math.min(MAX_COUNT, Math.max(1, parsed));
}

async function defaultBlackboxBrowserLauncher(job) {
  const { launchBulkImportBrowser } = await import("./bulkImportBrowserEngine.js");
  return launchBulkImportBrowser({
    engine: job?.engine || "chromium",
    proxyUrl: job?.proxyUrl || undefined,
    headless: false,
    args: ["--start-maximized"],
  });
}

function generateBlackboxKeyName() {
  const prefix = "9router";
  const slug = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${slug}`;
}

async function defaultSaveBlackboxConnection({ apiKey, email, keyName, keyError = null }) {
  const { createProviderConnection } = await import("../../../models/index.js");
  const providerSpecificData = {
    automation: "signup-bulk",
    baseUrl: "https://api.blackbox.ai/v1",
    ...(keyError ? { keyCreationError: keyError } : {}),
  };
  const connection = await createProviderConnection({
    provider: BLACKBOX_PROVIDER_ID,
    authType: "apikey",
    name: keyName || email.split("@")[0] || "blackbox",
    ...(apiKey ? { apiKey } : {}),
    email,
    providerSpecificData,
    testStatus: "active",
  });
  return { connection };
}

export class BlackboxBulkImportManager extends KiroBulkImportManager {
  constructor({
    browserLauncher = defaultBlackboxBrowserLauncher,
    saveConnection = defaultSaveBlackboxConnection,
    storageName = "blackbox-bulk-import",
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
    keyName,
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
        blackbox: {
          domain: domain || "random",
          keyName: keyName || generateBlackboxKeyName(),
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
      const blackboxConfig = job.blackbox || {};
      const email = account.email;

      this.setAccountStep(account, "preparing_worker", `Worker ${workerId} is preparing a Blackbox browser context`);
      await this.persistJobSnapshot(job, { forcePreview: true });

      this.setAccountStep(account, "generating_temp_email", `Using temporary mailbox ${email}`);
      await this.persistJobSnapshot(job, { forcePreview: true });

      let apiKey = null;
      try {
        apiKey = await runBlackboxAccount({
          page,
          email,
          password: account.password,
          keyName: blackboxConfig.keyName || BLACKBOX_DEFAULT_KEY_NAME,
          waitForOtp: () => waitForOtp(email, {
            timeoutMs: BLACKBOX_OTP_TIMEOUT_MS,
            intervalMs: BLACKBOX_OTP_POLL_INTERVAL_MS,
          }),
          onStep: (step, message) => {
            this.setAccountStep(account, step, message);
            void this.persistJobSnapshot(job, { forcePreview: false });
          },
        });
      } catch (error) {
        const message = error.message || "Blackbox automation failed";
        const keyFailed = /failed to create key|api key creation failed|key creation failed/i.test(message);
        if (!keyFailed) throw error;

        // Signup+OTP likely succeeded but Blackbox gated API-key creation for
        // this account (API-access approval). Save the registered account so
        // the user can finish key creation manually instead of losing it.
        const accountRegistered = await this.isBlackboxSignedIn(page);
        if (!accountRegistered) throw error;

        this.setAccountStep(account, "signup_complete_key_gated", "Blackbox signup succeeded but key creation was rejected; saving account");
        await this.persistJobSnapshot(job, { forcePreview: false });

        const { connection } = await this.saveConnection({
          apiKey: null,
          email,
          keyName: blackboxConfig.keyName || null,
          keyError: message,
        });

        this.finalizeAccount(account, "failed_key_gated", {
          connectionId: connection.id,
          error: message,
          step: "key_gated",
          message: `${message} — account saved, create the key manually`,
        });
        account.runtimeSession = null;
        await context.close().catch(() => null);
        await this.persistJobSnapshot(job, { forcePreview: true });
        return;
      }

      this.setAccountStep(account, "saving_connection", "Saving Blackbox connection");
      const { connection } = await this.saveConnection({
        apiKey,
        email,
        keyName: blackboxConfig.keyName || null,
      });

      this.finalizeAccount(account, "success", {
        connectionId: connection.id,
        step: "connection_saved",
        message: "Blackbox connection saved with harvested API key",
      });
    } catch (error) {
      const terminalStatus = typeof error.status === "string" ? error.status : "failed";
      this.finalizeAccount(account, terminalStatus, {
        error: error.message || "Blackbox automation failed",
        step: error.step || "failed",
        message: error.message || "Blackbox automation failed",
      });
    } finally {
      account.password = undefined;
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    }
  }

  async isBlackboxSignedIn(page) {
    try {
      const url = page.url();
      if (/\/(activity|dashboard|keys|settings|billing)/.test(url)) return true;
      const text = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
      return /james|@|sign out|create key|api keys/i.test(text || "");
    } catch {
      return false;
    }
  }
}

function getSingletonStore() {
  if (!globalThis.__blackboxBulkImportSingleton) {
    globalThis.__blackboxBulkImportSingleton = {
      manager: new BlackboxBulkImportManager(),
    };
  }
  return globalThis.__blackboxBulkImportSingleton;
}

export function getBlackboxBulkImportManager() {
  return getSingletonStore().manager;
}

export {
  buildLookupResponse,
  generateBlackboxKeyName,
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY as BLACKBOX_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY as BLACKBOX_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY as BLACKBOX_BULK_IMPORT_MIN_CONCURRENCY,
};
