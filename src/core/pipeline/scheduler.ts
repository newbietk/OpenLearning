import { getLogger } from '../../lib/logger';

interface SyncJob {
  docId: string;
  url: string;
  callback: () => Promise<void>;
  timer: ReturnType<typeof setInterval> | null;
}

interface SchedulerConfig {
  defaultIntervalMs: number;
}

export interface Scheduler {
  jobs: Map<string, SyncJob>;
  register(docId: string, url: string, callback: () => Promise<void>): void;
  unregister(docId: string): void;
  start(): void;
  stop(): void;
}

export function createScheduler(config: SchedulerConfig): Scheduler {
  const jobs = new Map<string, SyncJob>();
  const log = getLogger();

  return {
    jobs,

    register(docId, url, callback) {
      const job: SyncJob = { docId, url, callback, timer: null };
      jobs.set(docId, job);
      log.info('scheduler: registered job', { docId, url });
    },

    unregister(docId) {
      const job = jobs.get(docId);
      if (job?.timer) clearInterval(job.timer);
      jobs.delete(docId);
    },

    start() {
      for (const [, job] of jobs) {
        job.timer = setInterval(async () => {
          try {
            log.info('scheduler: running sync', { docId: job.docId, url: job.url });
            await job.callback();
          } catch (err) {
            log.error(
              'scheduler: sync failed',
              err instanceof Error ? err : new Error(String(err)),
              { docId: job.docId, url: job.url },
            );
          }
        }, config.defaultIntervalMs);
      }
    },

    stop() {
      for (const [, job] of jobs) {
        if (job.timer) clearInterval(job.timer);
      }
    },
  };
}
