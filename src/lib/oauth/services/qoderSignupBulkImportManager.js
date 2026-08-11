/**
 * Qoder signup bulk automation manager — ports the harness `farm_one.py`
 * register → PAT stage into the 9Router bulk-import architecture.
 *
 * Per account:
 *   1. generate a disposable temp email via catchmail.io + password
 *      (mirrors the Blackbox bulk signup flow)
 *   2. pure-HTTP signup: baxia tokens → Aliyun captcha (solver sidecar) →
 *      verificationCodes → OTP (catchmail.io) → /users → PAT
 *   3. save the PAT as a Qoder connection (authMethod "pat")
 *
 * Unlike Blackbox (browser signup) this path is headless HTTP; the browser is
 * only used briefly to harvest baxia fingerprint tokens.
 */

import {
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY,
  KiroBulkImportManager,
  buildLookupResponse,
  resolveFinishedJobStatus,
} from "./kiroBulkImportManager.js";
import { generateEmail, waitForOtp } from "./catchmailClient.js";
import { generatePassword } from "./blackboxAutomation.js";
import { runQoderSignup } from "./qoderSignupClient.js";

const QODER_SIGNUP_PROVIDER_ID = "qoder";
const DEFAULT_COUNT = 1;
const MAX_COUNT = 20;
const DEFAULT_OTP_TIMEOUT_MS = 60_000;
const DEFAULT_OTP_POLL_INTERVAL_MS = 3_000;

function clampCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_COUNT;
  return Math.min(MAX_COUNT, Math.max(1, parsed));
}

async function defaultSaveQoderSignupConnection({ tokens, email, password }) {
  const { createProviderConnection } = await import("../../../models/index.js");
  const providerSpecificData = {
    authMethod: "pat",
    userId: tokens.userId || "",
    organizationId: tokens.organizationId || "",
    planTier: tokens.planTier || "",
    loginEmail: email,
    automation: "signup-bulk",
  };

  const connectionData = {
    provider: QODER_SIGNUP_PROVIDER_ID,
    authType: "oauth",
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || "",
    email,
    displayName: tokens.displayName || email.split("@")[0],
    providerSpecificData,
    expiresAt: tokens.expireTime
      ? new Date(tokens.expireTime).toISOString()
      : null,
    testStatus: "active",
  };

  const connection = await createProviderConnection(connectionData);
  return { connection };
}

export class QoderSignupBulkImportManager extends KiroBulkImportManager {
  constructor({
    saveConnection = defaultSaveQoderSignupConnection,
    qoderServiceFactory = null,
    storageName = "qoder-signup-bulk-import",
    solverBase = process.env.QODER_SOLVER_HTTP || process.env.SOLVER_HTTP || "http://127.0.0.1:8878",
  } = {}) {
    super({
      browserLauncher: null,
      googleAutomation: null,
      socialExchange: null,
      storageName,
    });
    this.saveConnection = saveConnection;
    this.qoderServiceFactory = qoderServiceFactory;
    this.solverBase = solverBase;
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
    otpTimeoutMs,
    visionProvider,
    visionModel,
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
        qoderSignup: {
          domain: domain || "random",
          otpTimeoutMs: Number(otpTimeoutMs) || DEFAULT_OTP_TIMEOUT_MS,
          otpIntervalMs: DEFAULT_OTP_POLL_INTERVAL_MS,
          visionProvider: visionProvider || "",
          visionModel: visionModel || "",
        },
      },
    });
    return job;
  }

  async processAccount(job, account, workerId, browser = job.browser) {
    if (job.cancelRequested) {
      this.finalizeAccount(account, "cancelled", { error: "Job cancelled" });
      return;
    }

    account.runtimeSession = {
      context: null,
      page: null,
      proxyUrl: browser?.__ninerouterProxyUrl || job.proxyUrl || null,
    };

    try {
      const config = job.qoderSignup || {};
      const email = account.email;
      const proxyUrl = account.runtimeSession.proxyUrl;
      const solverBase = this.solverBase;
      const visionProvider = config.visionProvider || "";
      const visionModel = config.visionModel || "";

      this.setAccountStep(account, "preparing_signup", `Worker ${workerId} preparing Qoder signup for ${email}`);
      await this.persistJobSnapshot(job, { forcePreview: true });

      this.setAccountStep(account, "generating_temp_email", `Using temporary mailbox ${email}`);
      await this.persistJobSnapshot(job, { forcePreview: false });

      // Launch a browser only when a vision provider is configured (needed to
      // solve the TMD image-click captcha live).
      let tmdBrowser = null;
      let visionSolver = null;
      if (visionProvider && visionModel) {
        try {
          const { launchBulkImportBrowser } = await import("./bulkImportBrowserEngine.js");
          tmdBrowser = await launchBulkImportBrowser({
            engine: job.engine || "chromium",
            proxyUrl: proxyUrl || undefined,
            headless: true,
          });
          visionSolver = (captured, { page }) => {
            const { visionSolveCaptchaGrid } = requireVisionSolver();
            return visionSolveCaptchaGrid({
              grids: captured.grids,
              questionDataUrl: captured.questionDataUrl || "",
              promptText: "select all images that match the description",
              provider: visionProvider,
              model: visionModel,
              log: this._visionLog,
            });
          };
        } catch (error) {
          this.setAccountStep(account, "vision_browser_failed", `Vision browser launch failed: ${error.message}`);
          await this.persistJobSnapshot(job, { forcePreview: false });
        }
      }

      const result = await runQoderSignup({
        email,
        password: account.password,
        name: email.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        waitForOtp: (opts) => waitForOtp(email, {
          timeoutMs: opts?.timeoutMs || config.otpTimeoutMs || DEFAULT_OTP_TIMEOUT_MS,
          intervalMs: opts?.intervalMs || DEFAULT_OTP_POLL_INTERVAL_MS,
        }),
        solverBase,
        proxyUrl: proxyUrl || undefined,
        browser: tmdBrowser || undefined,
        visionSolver: visionSolver || undefined,
        onStep: (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      }).finally(() => {
        if (tmdBrowser) {
          void tmdBrowser.close().catch(() => null);
          tmdBrowser = null;
        }
      });

      this.setAccountStep(account, "fetching_profile", "Fetching Qoder profile");
      await this.persistJobSnapshot(job, { forcePreview: true });

      let userInfo = { id: "", name: "", email: "", organizationId: "" };
      let quotaActive = true;
      let tokens = null;
      try {
        const { QoderService } = await import("./qoder.js");
        const service = this.qoderServiceFactory ? this.qoderServiceFactory() : new QoderService();
        tokens = await service.exchangePersonalToken(result.pat);
        const info = await service.fetchUserInfo(tokens.accessToken);
        if (info.id) userInfo = info;
        const quota = await service.fetchQuotaUsage(tokens.accessToken).catch(() => ({ active: true }));
        quotaActive = quota.active !== false;
      } catch (error) {
        this.setAccountStep(account, "profile_fetch_failed", `Profile fetch warning: ${error.message}`);
        await this.persistJobSnapshot(job, { forcePreview: false });
      }

      const fallbackTokens = tokens || {
        accessToken: "",
        refreshToken: "",
        expireTime: null,
      };

      this.setAccountStep(account, "saving_connection", "Saving Qoder connection");
      await this.persistJobSnapshot(job, { forcePreview: true });

      const { connection } = await this.saveConnection({
        tokens: {
          accessToken: fallbackTokens.accessToken,
          refreshToken: fallbackTokens.refreshToken || "",
          userId: userInfo.id || "",
          machineId: "",
          organizationId: userInfo.organizationId || "",
          expireTime: fallbackTokens.expireTime || null,
          displayName: userInfo.name || userInfo.email || email.split("@")[0],
          planTier: "",
        },
        email,
        password: account.password,
      });

      this.finalizeAccount(account, "success", {
        connectionId: connection.id,
        step: "connection_saved",
        message: `Qoder account registered and connection saved${quotaActive ? "" : " (quota inactive)"}`,
      });
    } catch (error) {
      this.finalizeAccount(account, "failed", {
        error: error.message || "Qoder signup failed",
        step: "failed",
        message: error.message || "Qoder signup failed",
      });
    } finally {
      account.password = undefined;
      account.runtimeSession = null;
      await this.persistJobSnapshot(job, { forcePreview: true });
    }
  }

  /**
   * Qoder signup is pure HTTP — no persistent browser is needed, so we never
   * launch one. Workers dequeue accounts and run the HTTP flow directly.
   */
  async runWorker(job, workerId, _browser = null) {
    while (!job.cancelRequested && job.status !== "cancelled") {
      const account = this.dequeueAccount(job, workerId);
      if (!account) return;
      if (job.cancelRequested) {
        this.finalizeAccount(account, "cancelled", {
          error: "Job cancelled",
          step: "cancelled",
          message: "Job cancelled before account started",
        });
        return;
      }
      await this.processAccount(job, account, workerId, null);
    }
  }

  async runJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    try {
      job.accounts.forEach((account) => {
        if (account.status === "queued" && (account.logs || []).length === 1) {
          this.setAccountStep(account, "waiting_for_worker", "Waiting for a free worker");
        }
      });
      await this.persistJobSnapshot(job, { forcePreview: false });

      const workerCount = Math.min(job.concurrency, Math.max(job.accounts.length, 1));
      const workers = Array.from({ length: workerCount }, (_, index) => this.runWorker(job, index + 1, null));
      await Promise.allSettled(workers);

      if (job.manualFollowups.size > 0) {
        await Promise.allSettled([...job.manualFollowups]);
      }

      if (job.cancelRequested) {
        job.status = "cancelled";
        job.accounts.forEach((account) => {
          if (account.status === "queued" || account.status === "running" || account.status === "needs_manual") {
            this.finalizeAccount(account, "cancelled", {
              error: "Job cancelled",
              step: "cancelled",
              message: "Job cancelled before completion",
            });
          }
        });
      } else if (job.status !== "cancelled") {
        job.status = resolveFinishedJobStatus(job.accounts);
        if (job.status === "failed") {
          job.error = "All accounts failed.";
        }
      }
      await this.persistJobSnapshot(job, { forcePreview: true });
    } catch (error) {
      if (job.cancelRequested) {
        job.status = "cancelled";
      } else {
        job.status = "failed";
        job.error = error.message || "Failed to start Qoder signup bulk job.";
        job.accounts.forEach((account) => {
          if (account.status === "queued" || account.status === "running") {
            this.finalizeAccount(account, "failed", {
              error: job.error,
              step: "failed",
              message: job.error,
            });
            account.password = undefined;
          }
        });
      }
      await this.persistJobSnapshot(job, { forcePreview: true });
    } finally {
      if (job.cancelRequested) job.status = "cancelled";
      job.finishedAt = job.status === "needs_manual" ? null : new Date().toISOString();
      await this.persistJobSnapshot(job, { forcePreview: true });
    }
  }
}

function requireVisionSolver() {
  return import("./qoderVisionSolver.js");
}

function getSingletonStore() {
  if (!globalThis.__qoderSignupBulkImportSingleton) {
    globalThis.__qoderSignupBulkImportSingleton = {
      manager: new QoderSignupBulkImportManager(),
    };
  }
  return globalThis.__qoderSignupBulkImportSingleton;
}

export function getQoderSignupBulkImportManager() {
  return getSingletonStore().manager;
}

export {
  buildLookupResponse,
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY as QODER_SIGNUP_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY as QODER_SIGNUP_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY as QODER_SIGNUP_MIN_CONCURRENCY,
};
