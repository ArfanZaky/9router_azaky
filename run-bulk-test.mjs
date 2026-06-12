import { KiroBulkImportManager } from "./src/lib/oauth/services/kiroBulkImportManager.js";

const manager = new KiroBulkImportManager();
const job = manager.startJob({
  accounts: [
    "hanifherlinadema@gamaa.id|kiropalingenak123",
    "andinajannahzogo@gamaa.id|kiropalingenak123",
  ],
  concurrency: 2,
});

console.log(JSON.stringify({ event: "started", jobId: job.jobId, summary: job.summary }));

const start = Date.now();
while (Date.now() - start < 12 * 60_000) {
  const current = manager.getJob(job.jobId);
  console.log(JSON.stringify({
    event: "poll",
    at: new Date().toISOString(),
    status: current?.status,
    summary: current?.summary,
    accounts: current?.accounts?.map((account) => ({
      email: account.email,
      status: account.status,
      error: account.error,
      workerId: account.workerId,
      manualSessionAvailable: account.manualSessionAvailable,
      manualSessionOpened: account.manualSessionOpened,
    })),
  }));

  if (current && ["completed", "cancelled", "failed"].includes(current.status)) {
    console.log(JSON.stringify({ event: "final", job: current }, null, 2));
    process.exit(0);
  }

  await new Promise((resolve) => setTimeout(resolve, 5000));
}

console.log(JSON.stringify({ event: "timeout", job: manager.getJob(job.jobId) }, null, 2));
process.exit(1);
