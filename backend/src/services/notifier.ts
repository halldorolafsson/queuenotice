import nodemailer from "nodemailer";
import webpush from "web-push";
import { config } from "../config.js";
import type { Db } from "../db/index.js";
import type { NotificationSettings } from "../domain/types.js";
import { logger } from "../logger.js";
import * as repo from "./repo.js";

export interface OutgoingMessage {
  userId: string;
  segmentId: string | null;
  itemKey: string | null;
  kind: "new" | "update" | "resolved" | "test";
  title: string;
  body: string;
  isDemo: boolean;
}

export interface PushSender {
  send(sub: repo.PushSubscriptionRow, payload: string): Promise<{ ok: boolean; gone: boolean; error?: string }>;
}
export interface EmailSender {
  send(to: string, subject: string, text: string): Promise<void>;
}

export function createPushSender(): PushSender | null {
  if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY || !config.VAPID_SUBJECT) return null;
  webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY);
  return {
    async send(sub, payload) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 3600, urgency: "high" },
        );
        return { ok: true, gone: false };
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        return { ok: false, gone: status === 404 || status === 410, error: `Push feilet (${status ?? "nettverk"})` };
      }
    },
  };
}

export function createEmailSender(): EmailSender | null {
  if (!config.SMTP_HOST || !config.SMTP_FROM) return null;
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
  });
  return {
    async send(to, subject, text) {
      await transport.sendMail({ from: config.SMTP_FROM, to, subject, text });
    },
  };
}

export interface NotifierOptions {
  mode: "dry-run" | "live";
  maxPerDay: number;
  push: PushSender | null;
  email: EmailSender | null;
}

/**
 * Sender varsler på valgte kanaler. I "dry-run" sendes ingenting; meldingen
 * lagres bare i varslingsloggen slik at den kan sees i appen.
 */
export class Notifier {
  constructor(private db: Db, private opts: NotifierOptions) {}

  get mode() {
    return this.opts.mode;
  }

  async send(msg: OutgoingMessage, settings: NotificationSettings): Promise<void> {
    const log = (channel: "push" | "email" | "none", status: "dry_run" | "sent" | "failed" | "skipped", error: string | null = null) =>
      repo.insertNotification(this.db, { ...msg, channel, status, error });

    if (msg.kind !== "test") {
      const since = new Date(Date.now() - 24 * 3600 * 1000);
      if ((await repo.countSentSince(this.db, msg.userId, since)) >= this.opts.maxPerDay) {
        logger.warn({ userId: msg.userId }, "Dagsgrense for varsler nådd");
        return log("none", "skipped", `Dagsgrensen på ${this.opts.maxPerDay} varsler er nådd`);
      }
    }

    const channels: Array<"push" | "email"> = [];
    if (settings.pushEnabled) channels.push("push");
    if (settings.emailEnabled && settings.email) channels.push("email");
    if (channels.length === 0) {
      return log("none", this.opts.mode === "dry-run" ? "dry_run" : "skipped", "Ingen varslingskanal er valgt");
    }

    for (const channel of channels) {
      if (this.opts.mode === "dry-run") {
        logger.info({ channel, kind: msg.kind, title: msg.title }, "Varsel (dry-run, ikke sendt)");
        await log(channel, "dry_run");
        continue;
      }
      try {
        if (channel === "push") await this.sendPush(msg);
        else await this.sendEmail(msg, settings.email!);
        await log(channel, "sent");
      } catch (err) {
        logger.error({ channel, err: (err as Error).message }, "Varsel feilet");
        await log(channel, "failed", (err as Error).message);
      }
    }
  }

  private async sendPush(msg: OutgoingMessage): Promise<void> {
    if (!this.opts.push) throw new Error("Push er ikke konfigurert (VAPID-nøkler mangler)");
    const subs = await repo.getPushSubscriptions(this.db, msg.userId);
    if (subs.length === 0) throw new Error("Ingen enheter er registrert for push");
    const payload = JSON.stringify({ title: msg.title, body: msg.body, tag: msg.itemKey ?? msg.kind, url: "/" });
    let delivered = 0;
    const errors: string[] = [];
    for (const sub of subs) {
      const res = await this.opts.push.send(sub, payload);
      await repo.markPushResult(this.db, sub.id, res.ok, res.gone);
      if (res.ok) delivered++;
      else if (res.error) errors.push(res.error);
    }
    if (delivered === 0) throw new Error(errors.join("; ") || "Push feilet");
  }

  private async sendEmail(msg: OutgoingMessage, to: string): Promise<void> {
    if (!this.opts.email) throw new Error("E-post er ikke konfigurert (SMTP mangler)");
    const footer = "\n\n--\nSendt fra Køvarsel. Endre varsler under Varsler i appen.";
    await this.opts.email.send(to, msg.title, msg.body + footer);
  }
}

export function createNotifier(db: Db): Notifier {
  return new Notifier(db, {
    mode: config.NOTIFY_MODE,
    maxPerDay: config.MAX_NOTIFICATIONS_PER_DAY,
    push: config.NOTIFY_MODE === "live" ? createPushSender() : null,
    email: config.NOTIFY_MODE === "live" ? createEmailSender() : null,
  });
}
