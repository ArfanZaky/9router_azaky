import {
  KiroBulkImportManager,
  parseKiroBulkAccounts,
  createFreshContext,
} from "./kiroBulkImportManager.js";
import {
  runZarkLabGoogleAutomation,
  createZarkLabTokenMonitor,
} from "./zarklabAutomation.js";

const ZARKLAB_PROVIDER_ID = "zarklab";
const ZARKLAB_BULK_CONFIG = {
  shortTimeoutMs: 60_000,
  tokenTimeoutMs: 120_000,
};

async function defaultZarkLabBrowserLauncher(job) {
  const { launchBulkImportBrowser } = await import("./bulkImportBrowserEngine.js");
  return launchBulkImportBrowser({
    engine: job?.engine || "camoufox",
    proxyUrl: job?.proxyUrl || undefined,
    headless: false,
    args: ["--start-maximized"],
  });
}

async function defaultSaveZarkLabConnection({ tokens, email }) {
  const { createProviderConnection } = await import("../../../models/index.js");
  const token = tokens?.token || tokens?.apiKey || tokens?.accessToken;
  if (!token) throw new Error("No ZarkLab auth token extracted");

  const connection = await createProviderConnection({
    provider: ZARKLAB_PROVIDER_ID,
    authType: "apikey",
    apiKey: token,
    name: email ? email.split("@")[0] : "zarklab",
    email: email || tokens?.email || null,
    providerSpecificData: {
      automation: "gsuite-bulk",
      loginEmail: email,
      refreshToken: tokens?.refreshToken || null,
      uid: tokens?.uid || null,
      baseUrl: "https://www.zarklab.ai/api/v1",
    },
    testStatus: "active",
  });
  return { connection };
}

export class ZarkLabBulkImportManager extends KiroBulkImportManager {
  constructor({
    browserLauncher = defaultZarkLabBrowserLauncher,
    googleAutomation = runZarkLabGoogleAutomation,
    saveConnection = defaultSaveZarkLabConnection,
    storageName = "zarklab-bulk-import",
  } = {}) {
    super({
      browserLauncher,
      googleAutomation,
      socialExchange: null,
      storageName,
    });
    this.saveConnection = saveConnection;
    this.config = ZARKLAB_BULK_CONFIG;
  }

  async processAccount(job, account, workerId, browser = job.browser) {
    if (job.cancelRequested || job.status === "cancelled" || !browser) {
      this.finalizeAccount(account, "cancelled", {
        error: "Job cancelled",
        step: "cancelled",
        message: "Job cancelled",
      });
      return;
    }

    account.workerId = workerId;
    this.setAccountStep(account, "starting", "Starting ZarkLab account automation");

    let context = null;
    let page = null;

    try {
      const { context: newContext, page: newPage } = await createFreshContext(browser);
      context = newContext;
      page = newPage;

      account.runtimeSession = {
        context,
        page,
        workerId,
      };

      const tokenPromise = createZarkLabTokenMonitor(context, this.config.tokenTimeoutMs);

      this.setAccountStep(account, "starting_automation", "Starting ZarkLab Google SSO automation");
      const automationResult = await this.googleAutomation({
        page,
        email: account.email,
        password: account.password,
        callbackPromise: tokenPromise,
        shortTimeoutMs: this.config.shortTimeoutMs,
        onStep: (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      });

      if (automationResult?.status === "failed_invalid_credentials") {
        this.finalizeAccount(account, "failed_invalid_credentials", {
          error: automationResult.error || "Invalid Google credentials",
          step: "invalid_credentials",
          message: "Google rejected the email or password",
        });
        return;
      }

      if (automationResult?.status === "failed_restricted") {
        this.finalizeAccount(account, "failed_restricted", {
          error: automationResult.error || "Account is restricted",
          step: "account_restricted",
          message: "Account is restricted, suspended, or banned",
        });
        return;
      }

      if (automationResult?.status === "failed") {
        this.finalizeAccount(account, "failed", {
          error: automationResult.error || "Automation failed",
          step: "automation_failed",
          message: automationResult.error || "ZarkLab browser automation failed",
        });
        return;
      }

      // Wait or retrieve token
      this.setAccountStep(account, "extracting_token", "Extracting ZarkLab Firebase authentication session");
      const sessionData = await tokenPromise;
      if (!sessionData?.token) {
        throw new Error("Failed to extract ZarkLab session token");
      }

      account.tokens = sessionData;
      this.setAccountStep(account, "token_received", "ZarkLab session token extracted");

      // Save connection
      this.setAccountStep(account, "saving_connection", "Saving ZarkLab connection to database");
      const { connection } = await this.saveConnection({
        tokens: sessionData,
        email: account.email,
      });

      account.connectionId = connection.id;
      this.finalizeAccount(account, "success", {
        connectionId: connection.id,
        step: "completed",
        message: "ZarkLab account imported successfully",
      });

    } catch (error) {
      if (job.cancelRequested || /cancelled|closed/i.test(error?.message || "")) {
        this.finalizeAccount(account, "cancelled", {
          error: "Job cancelled",
          step: "cancelled",
          message: error.message || "Job cancelled",
        });
      } else {
        this.finalizeAccount(account, "failed", {
          error: error.message || "Unknown error",
          step: "exception",
          message: error.message || "An unexpected error occurred",
        });
      }
    } finally {
      if (context) {
        await context.close().catch(() => null);
      }
      account.runtimeSession = null;
      account.workerId = null;
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

export { parseKiroBulkAccounts as parseZarkLabBulkAccounts };
