// Background worker — drains sms_queue and email_queue on an interval.
// Single-process, in-memory. For multi-instance deploys, run ONE worker pod
// or switch to a leased/locked queue (FOR UPDATE SKIP LOCKED).
import { drainSms, drainEmail, stubSms, stubEmail,
  type SmsProvider, type EmailProvider } from "./notifications.js";

let timer: NodeJS.Timeout | null = null;
let running = false;

export interface WorkerOpts {
  intervalMs?: number;
  sms?: SmsProvider;
  email?: EmailProvider;
  log?: (msg: string, meta?: unknown) => void;
}

export function startWorker(opts: WorkerOpts = {}): void {
  if (timer) return;
  const interval = opts.intervalMs ?? 10_000;
  const sms = opts.sms ?? stubSms;
  const email = opts.email ?? stubEmail;
  const log = opts.log ?? (() => {});
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const [s, e] = await Promise.all([drainSms(sms), drainEmail(email)]);
      if (s.sent || s.failed || e.sent || e.failed) {
        log("queue_tick", { sms: s, email: e });
      }
    } catch (err) {
      log("queue_tick_error", { error: (err as Error).message });
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => { void tick(); }, interval);
  // Don't keep the event loop alive solely for the worker.
  if (typeof timer.unref === "function") timer.unref();
}

export function stopWorker(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
