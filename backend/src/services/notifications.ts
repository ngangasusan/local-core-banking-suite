// Notification + SMS/Email queue service.
// Providers are pluggable; default is a console "stub" provider so the worker
// runs end-to-end without external credentials. Wire a real provider by
// implementing SmsProvider / EmailProvider and registering it in worker.ts.
import { exec, query, type RowDataPacket } from "../db.js";
import { newId } from "../util/uuid.js";

const MAX_ATTEMPTS = 5;

export interface SmsProvider {
  send(to: string, message: string): Promise<{ id?: string }>;
}
export interface EmailProvider {
  send(to: string, subject: string, body: string): Promise<{ id?: string }>;
}

export const stubSms: SmsProvider = {
  async send(to, message) {
    // eslint-disable-next-line no-console
    console.log(`[sms.stub] -> ${to}: ${message.slice(0, 120)}`);
    return {};
  },
};
export const stubEmail: EmailProvider = {
  async send(to, subject) {
    // eslint-disable-next-line no-console
    console.log(`[email.stub] -> ${to}: ${subject}`);
    return {};
  },
};

// ---------- Enqueue helpers ----------
export async function enqueueSms(opts: {
  to: string; message: string; customer_id?: string | null; loan_id?: string | null;
}): Promise<string> {
  const id = newId();
  await exec(
    `INSERT INTO sms_queue (id, to_phone, message, customer_id, loan_id)
     VALUES (?, ?, ?, ?, ?)`,
    [id, opts.to, opts.message, opts.customer_id ?? null, opts.loan_id ?? null]
  );
  return id;
}

export async function enqueueEmail(opts: {
  to: string; subject: string; body: string;
  customer_id?: string | null; loan_id?: string | null;
}): Promise<string> {
  const id = newId();
  await exec(
    `INSERT INTO email_queue (id, to_email, subject, body, customer_id, loan_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, opts.to, opts.subject, opts.body, opts.customer_id ?? null, opts.loan_id ?? null]
  );
  return id;
}

export async function pushNotification(opts: {
  user_id: string; title: string; body?: string | null;
  link?: string | null; category?: string | null;
}): Promise<string> {
  const id = newId();
  await exec(
    `INSERT INTO notifications (id, user_id, title, body, link, category)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, opts.user_id, opts.title, opts.body ?? null, opts.link ?? null, opts.category ?? null]
  );
  return id;
}

// ---------- Worker drain ----------
interface SmsRow extends RowDataPacket {
  id: string; to_phone: string; message: string; attempts: number;
}
interface EmailRow extends RowDataPacket {
  id: string; to_email: string; subject: string; body: string; attempts: number;
}

export async function drainSms(provider: SmsProvider, batch = 25): Promise<{ sent: number; failed: number }> {
  const rows = await query<SmsRow>(
    `SELECT id, to_phone, message, attempts FROM sms_queue
      WHERE status = 'pending' AND attempts < ?
      ORDER BY created_at ASC LIMIT ?`,
    [MAX_ATTEMPTS, batch]
  );
  let sent = 0, failed = 0;
  for (const row of rows) {
    try {
      await provider.send(row.to_phone, row.message);
      await exec(
        `UPDATE sms_queue SET status = 'sent', sent_at = NOW(3), attempts = attempts + 1
          WHERE id = ?`, [row.id]
      );
      sent++;
    } catch (e) {
      const err = (e as Error).message.slice(0, 500);
      const next = row.attempts + 1;
      await exec(
        `UPDATE sms_queue
            SET status = CASE WHEN ? >= ? THEN 'failed' ELSE 'pending' END,
                attempts = ?, last_error = ?
          WHERE id = ?`,
        [next, MAX_ATTEMPTS, next, err, row.id]
      );
      failed++;
    }
  }
  return { sent, failed };
}

export async function drainEmail(provider: EmailProvider, batch = 25): Promise<{ sent: number; failed: number }> {
  const rows = await query<EmailRow>(
    `SELECT id, to_email, subject, body, attempts FROM email_queue
      WHERE status = 'pending' AND attempts < ?
      ORDER BY created_at ASC LIMIT ?`,
    [MAX_ATTEMPTS, batch]
  );
  let sent = 0, failed = 0;
  for (const row of rows) {
    try {
      await provider.send(row.to_email, row.subject, row.body);
      await exec(
        `UPDATE email_queue SET status = 'sent', sent_at = NOW(3), attempts = attempts + 1
          WHERE id = ?`, [row.id]
      );
      sent++;
    } catch (e) {
      const err = (e as Error).message.slice(0, 500);
      const next = row.attempts + 1;
      await exec(
        `UPDATE email_queue
            SET status = CASE WHEN ? >= ? THEN 'failed' ELSE 'pending' END,
                attempts = ?, last_error = ?
          WHERE id = ?`,
        [next, MAX_ATTEMPTS, next, err, row.id]
      );
      failed++;
    }
  }
  return { sent, failed };
}
