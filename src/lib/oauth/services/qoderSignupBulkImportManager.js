/**
 * Qoder signup bulk automation manager — ports the harness `farm_one.py`
 * register → PAT stage into the 9Router bulk-import architecture.
 *
 * Per account:
 *   1. generate a disposable temp email or use provided email + password
 *   2. pure-HTTP signup: baxia tokens → Aliyun captcha (solver sidecar / optional) →
 *      verificationCodes → OTP (catchmail.io auto or manual input) → /users → PAT
 *   3. save the PAT as a Qoder connection (authMethod "pat")
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
const DEFAULT_OTP_TIMEOUT_MS = 180_000; // 3 minutes for manual input or auto
const DEFAULT_OTP_POLL_INTERVAL_MS = 2_000;

function clampCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_COUNT;
  return Math.min(MAX_COUNT, Math.max(1, parsed));
}

async function defaultSaveQoderSignupConnection({ tokens, email, password, pat = "" }) {
  const { createProviderConnection } = await import("../../../models/index.js");
  const providerSpecificData = {
    authMethod: "pat",
    userId: tokens.userId || "",
    organizationId: tokens.organizationId || "",
    planTier: tokens.planTier || "",
    loginEmail: email,
    automation: "signup-bulk",
    ...(pat ? { personalToken: pat } : {}),
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
    this.pendingOtps = new Map(); // key: `${jobId}:${email}` -> resolve function
  }

  submitManualOtp(jobId, email, otpCode) {
    const key = `${jobId}:${String(email || "").trim().toLowerCase()}`;
    const entry = this.pendingOtps.get(key);
    if (entry && typeof entry.resolve === "function") {
      entry.resolve(String(otpCode || "").trim());
      this.pendingOtps.delete(key);
      return true;
    }
    return false;
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
    otpMode = "auto", // "auto" (catchmail) or "manual"
    accountsList = [], // optional explicit list of emails/accounts
    otpTimeoutMs,
    visionProvider,
    visionModel,
    showTmdBrowser,
  }) {
    const total = clampCount(count);
    let generated;
    if (Array.isArray(accountsList) && accountsList.length > 0) {
      generated = accountsList.slice(0, total).map((acc) => {
        if (acc.includes("|")) return acc;
        return `${acc}|${generatePassword()}`;
      });
    } else {
      generated = Array.from({ length: total }, () => {
        const email = generateEmail(domain || "random");
        const password = generatePassword();
        return `${email}|${password}`;
      });
    }

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
          otpMode: otpMode === "manual" ? "manual" : "auto",
          otpTimeoutMs: Number(otpTimeoutMs) || (otpMode === "manual" ? 180_000 : DEFAULT_OTP_TIMEOUT_MS),
          otpIntervalMs: DEFAULT_OTP_POLL_INTERVAL_MS,
          visionProvider: visionProvider || "",
          visionModel: visionModel || "",
          showTmdBrowser: Boolean(showTmdBrowser),
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

    const config = job.qoderSignup || {};
    const email = account.email;
    const isManualOtp = config.otpMode === "manual";
    const otpKey = `${job.jobId}:${String(email || "").trim().toLowerCase()}`;

    try {
      const proxyUrl = account.runtimeSession.proxyUrl;
      const solverBase = this.solverBase;
      const visionProvider = config.visionProvider || "";
      const visionModel = config.visionModel || "";
      const showTmdBrowser = config.showTmdBrowser === true;

      this.setAccountStep(account, "preparing_signup", `Worker ${workerId} preparing Qoder signup for ${email}`);
      await this.persistJobSnapshot(job, { forcePreview: true });

      let tmdBrowser = null;
      let visionSolver = null;
      const hasVision = Boolean(visionProvider && visionModel);
      if (hasVision || showTmdBrowser) {
        try {
          const { launchBulkImportBrowser } = await import("./bulkImportBrowserEngine.js");
          tmdBrowser = await launchBulkImportBrowser({
            engine: job.engine || "chromium",
            proxyUrl: proxyUrl || undefined,
            headless: false,
            args: ["--start-maximized"],
          });
          if (hasVision) {
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
          }
        } catch (error) {
          this.setAccountStep(account, "vision_browser_failed", `TMD browser launch failed: ${error.message}`);
          await this.persistJobSnapshot(job, { forcePreview: false });
        }
      }

      // OTP resolver logic: auto catchmail polling or manual UI input
      const otpFetcher = async (opts) => {
        if (!isManualOtp) {
          return waitForOtp(email, {
            timeoutMs: opts?.timeoutMs || config.otpTimeoutMs || DEFAULT_OTP_TIMEOUT_MS,
            intervalMs: opts?.intervalMs || DEFAULT_OTP_POLL_INTERVAL_MS,
          });
        }

        // Manual OTP Mode: mark step and wait on promise
        account.status = "needs_manual";
        account.waitingForOtp = true;
        this.setAccountStep(account, "waiting_manual_otp", `Please enter the OTP sent to ${email}`);
        await this.persistJobSnapshot(job, { forcePreview: true });

        const timeoutMs = opts?.timeoutMs || config.otpTimeoutMs || 180_000;
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            this.pendingOtps.delete(otpKey);
            account.waitingForOtp = false;
            reject(new Error(`Manual OTP timeout after ${Math.round(timeoutMs / 1000)}s`));
          }, timeoutMs);

          this.pendingOtps.set(otpKey, {
            resolve: (code) => {
              clearTimeout(timer);
              account.waitingForOtp = false;
              account.status = "running";
              resolve(code);
            },
          });
        });
      };

      const result = await runQoderSignup({
        email,
        password: account.password,
        name: email.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        waitForOtp: otpFetcher,
        solverBase,
        proxyUrl: proxyUrl || undefined,
        browser: tmdBrowser || undefined,
        visionSolver: visionSolver || undefined,
        onStep: (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      }).finally(() => {
        this.pendingOtps.delete(otpKey);
        account.waitingForOtp = false;
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
        pat: result.pat || "",
      });

      // Auto-grant Pro Trial + claim qwen38 800 for the new account
      let autoGrant = null;
      try {
        if (result.pat) {
          this.setAccountStep(account, "auto_grant", "Granting Pro Trial + claiming Qwen38 800");
          await this.persistJobSnapshot(job, { forcePreview: false });
          const { grantProTrial } = await import("./qoderGrantService.js");
          autoGrant = await grantProTrial(result.pat, {
            harnessRoot: process.env.QODER_HARNESS_ROOT || undefined,
            timeoutMs: 240_000,
          });
          if (autoGrant?.ok) {
            try {
              const { updateProviderConnection } = await import("../../db/repos/connectionsRepo.js");
              await updateProviderConnection(connection.id, {
                providerSpecificData: {
                  ...(connection.providerSpecificData || {}),
                  planTier: autoGrant.plan || "",
                  creditsTotal: autoGrant.creditsTotal || 0,
                  creditsRemaining: autoGrant.creditsRemaining || 0,
                  qwen38: autoGrant.qwen38 || null,
                },
              });
            } catch {}
          }
        }
      } catch (error) {
        autoGrant = { ok: false, error: error.message };
      }

      this.finalizeAccount(account, "success", {
        connectionId: connection.id,
        step: "connection_saved",
        message: `Qoder account registered and connection saved${quotaActive ? "" : " (quota inactive)"}${autoGrant?.ok ? " + Pro Trial granted" : ""}`,
      });
    } catch (error) {
      this.pendingOtps.delete(otpKey);
      account.waitingForOtp = false;
      this.finalizeAccount(account, "failed", {
        error: error.message || "Qoder signup failed",
        step: "failed",
        message: error.message || "Qoder signup failed",
      });
    } finally {
      this.pendingOtps.delete(otpKey);
      account.password = undefined;
      account.runtimeSession = null;
      await this.persistJobSnapshot(job, { forcePreview: true });
    }
  }

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
          if (account.status === "queued" || account.status === "running" || account.status === "needs_manual") {
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
