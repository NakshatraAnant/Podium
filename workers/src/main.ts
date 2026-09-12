import { NestFactory } from "@nestjs/core";
import { Queue, Worker, type Job } from "bullmq";
import { config as loadEnv } from "dotenv";
import { resolve } from "path";
import { AppModule } from "@podium/api/src/app.module";
import { InvoicesService } from "@podium/api/src/invoices/invoices.service";
import { createRedisConnection, QUEUE_NAMES, SCHEDULED_JOBS } from "./queues";

loadEnv({ path: resolve(__dirname, "../../.env") });

/**
 * The Podium background worker.
 *
 * Why this process exists at all: the automation engine, the flow-engine SLA
 * sweep and the invoice overdue sweep were (or would have been) `@nestjs/schedule`
 * crons running inside the API process. That is only correct while exactly
 * one API instance is running — the moment there are two, every scheduled
 * task fires twice. The existing idempotency keys made that survivable, but
 * "survivable because the second run is a no-op" is a mitigation, not a
 * design: it still doubles the load, and any future job without an
 * idempotency key silently double-executes.
 *
 * Here, the schedule lives in Redis as a BullMQ job scheduler. However many
 * worker processes are running, the scheduler produces ONE job per interval
 * and exactly one worker claims it. Correct because only one process runs
 * it, not because running it twice happens to be harmless.
 *
 * The worker bootstraps the API's own Nest module as an *application
 * context* (no HTTP server, no ports bound) so every job runs the exact same
 * service methods the HTTP API and the e2e tests do. There is no second copy
 * of any business logic in this package.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn", "log"],
  });
  const log = (msg: string) => console.log(`[worker] ${msg}`);

  const connection = createRedisConnection();
  const queue = new Queue(QUEUE_NAMES.scheduled, { connection });

  /**
   * Register the repeatable schedules. `upsertJobScheduler` is idempotent on
   * the scheduler id, so every worker instance booting registers the SAME
   * schedule rather than adding another one.
   */
  await queue.upsertJobScheduler(
    SCHEDULED_JOBS.invoiceOverdueSweep,
    { pattern: "0 2 * * *" }, // 02:00 daily — after midnight, so "past due date" means a whole day has elapsed
    { name: SCHEDULED_JOBS.invoiceOverdueSweep },
  );
  log(`scheduled ${SCHEDULED_JOBS.invoiceOverdueSweep} (daily 02:00)`);

  const invoices = app.get(InvoicesService);

  const worker = new Worker(
    QUEUE_NAMES.scheduled,
    async (job: Job) => {
      switch (job.name) {
        case SCHEDULED_JOBS.invoiceOverdueSweep: {
          const result = await invoices.sweepOverdue();
          log(`${job.name}: ${result.transitioned} invoice(s) -> OVERDUE`);
          return result;
        }
        default:
          // An unknown job name is a deployment mismatch (a newer API
          // enqueued something this worker doesn't understand). Throw so it
          // lands in the failed set and is visible, rather than being
          // silently acknowledged and lost.
          throw new Error(`Unknown scheduled job "${job.name}"`);
      }
    },
    {
      connection: createRedisConnection(),
      // One job at a time: these sweeps touch shared financial rows and
      // there is no benefit to running two of them concurrently.
      concurrency: 1,
    },
  );

  worker.on("failed", (job, err) => console.error(`[worker] job ${job?.name} failed:`, err.message));

  const shutdown = async (signal: string) => {
    log(`${signal} received — draining`);
    await worker.close();
    await queue.close();
    await connection.quit();
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  log("ready");
}

bootstrap().catch((err) => {
  console.error("[worker] failed to start:", err);
  process.exit(1);
});
