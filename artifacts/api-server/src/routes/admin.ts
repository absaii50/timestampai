import { Router, type IRouter } from "express";
import { eq, desc, count, sql } from "drizzle-orm";
import { db, jobsTable, paymentsTable, userCreditsTable, paymentSettingsTable } from "@workspace/db";
import { testApiConnection } from "../lib/timestamps-client.js";
import { testSmtpConnection, sendTestEmail, sendCreditNotificationEmail } from "../lib/mailer.js";

const router: IRouter = Router();

function checkAdmin(req: any, res: any): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
  const key = req.headers["x-admin-key"];
  if (key !== adminPassword) {
    res.status(401).json({ error: "Invalid admin key" });
    return false;
  }
  return true;
}

// ── Stats (enhanced with revenue) ────────────────────────────────────────────
router.get("/admin/stats", async (req, res): Promise<void> => {
  if (!checkAdmin(req, res)) return;

  const rows = await db
    .select({ status: jobsTable.status, count: count() })
    .from(jobsTable)
    .groupBy(jobsTable.status);

  const stats: Record<string, number> = { total: 0, pending: 0, processing: 0, finished: 0, failed: 0 };
  for (const row of rows) {
    stats[row.status] = Number(row.count);
    stats.total += Number(row.count);
  }

  const usersResult = await db
    .selectDistinct({ userEmail: jobsTable.userEmail })
    .from(jobsTable)
    .where(sql`${jobsTable.userEmail} IS NOT NULL`);
  stats.uniqueUsers = usersResult.length;

  // Payment stats
  const payRows = await db
    .select({ provider: paymentsTable.provider, amountUsd: paymentsTable.amountUsd, credits: paymentsTable.creditsAwarded, count: count() })
    .from(paymentsTable)
    .where(eq(paymentsTable.status, "paid"))
    .groupBy(paymentsTable.provider, paymentsTable.amountUsd, paymentsTable.creditsAwarded);

  let totalRevenue = 0;
  let lsRevenue = 0;
  let cryptoRevenue = 0;
  let totalCreditsIssued = 0;
  let totalPayments = 0;

  for (const row of payRows) {
    const amount = parseFloat(row.amountUsd || "0") * Number(row.count);
    const credits = Number(row.credits) * Number(row.count);
    totalRevenue += amount;
    totalCreditsIssued += credits;
    totalPayments += Number(row.count);
    if (row.provider === "lemonsqueezy") lsRevenue += amount;
    if (row.provider === "cryptomus") cryptoRevenue += amount;
  }

  stats.totalRevenue = Math.round(totalRevenue * 100) / 100;
  stats.lsRevenue = Math.round(lsRevenue * 100) / 100;
  stats.cryptoRevenue = Math.round(cryptoRevenue * 100) / 100;
  stats.totalCreditsIssued = totalCreditsIssued;
  stats.totalPayments = totalPayments;

  res.json(stats);
});

// ── All Jobs ──────────────────────────────────────────────────────────────────
router.get("/admin/jobs", async (req, res): Promise<void> => {
  if (!checkAdmin(req, res)) return;
  const jobs = await db.select().from(jobsTable).orderBy(desc(jobsTable.createdAt));
  res.json(jobs);
});

router.delete("/admin/jobs/:id", async (req, res): Promise<void> => {
  if (!checkAdmin(req, res)) return;
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid job ID" }); return; }
  const [deleted] = await db.delete(jobsTable).where(eq(jobsTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Job not found" }); return; }
  res.json({ success: true });
});

// ── Users ─────────────────────────────────────────────────────────────────────
router.get("/admin/users", async (req, res): Promise<void> => {
  if (!checkAdmin(req, res)) return;

  const users = await db
    .selectDistinct({ userEmail: jobsTable.userEmail, userName: jobsTable.userName })
    .from(jobsTable)
    .where(sql`${jobsTable.userEmail} IS NOT NULL`)
    .orderBy(jobsTable.userEmail);

  const userStats = await db
    .select({ userEmail: jobsTable.userEmail, jobCount: count() })
    .from(jobsTable)
    .groupBy(jobsTable.userEmail);

  const countMap: Record<string, number> = {};
  for (const u of userStats) {
    if (u.userEmail) countMap[u.userEmail] = Number(u.jobCount);
  }

  const result = users.map((u) => ({
    email: u.userEmail,
    name: u.userName,
    jobCount: countMap[u.userEmail ?? ""] ?? 0,
  }));

  res.json(result);
});

// ── Payments ──────────────────────────────────────────────────────────────────
router.get("/admin/payments", async (req, res): Promise<void> => {
  if (!checkAdmin(req, res)) return;
  const payments = await db.select().from(paymentsTable).orderBy(desc(paymentsTable.createdAt));
  res.json(payments);
});

router.delete("/admin/payments/:id", async (req, res): Promise<void> => {
  if (!checkAdmin(req, res)) return;
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [deleted] = await db.delete(paymentsTable).where(eq(paymentsTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Payment not found" }); return; }
  res.json({ success: true });
});

// ── Credits ───────────────────────────────────────────────────────────────────
router.get("/admin/credits", async (req, res): Promise<void> => {
  if (!checkAdmin(req, res)) return;

  const credits = await db
    .select()
    .from(userCreditsTable)
    .orderBy(desc(userCreditsTable.credits));

  // Enrich with user names from jobs table
  const users = await db
    .selectDistinct({ userEmail: jobsTable.userEmail, userName: jobsTable.userName })
    .from(jobsTable)
    .where(sql`${jobsTable.userEmail} IS NOT NULL`);

  const nameMap: Record<string, string> = {};
  for (const u of users) { if (u.userEmail && u.userName) nameMap[u.userEmail] = u.userName; }

  res.json(credits.map(c => ({ ...c, userName: nameMap[c.userEmail] || null })));
});

router.post("/admin/credits/adjust", async (req, res): Promise<void> => {
  if (!checkAdmin(req, res)) return;

  const { email, amount, action } = req.body as { email: string; amount: number; action: "set" | "add" | "subtract" };
  if (!email || typeof amount !== "number") {
    res.status(400).json({ error: "email and amount required" }); return;
  }

  if (action === "set") {
    await db
      .insert(userCreditsTable)
      .values({ userEmail: email.toLowerCase(), credits: amount })
      .onConflictDoUpdate({ target: userCreditsTable.userEmail, set: { credits: amount } });
  } else {
    const delta = action === "subtract" ? -Math.abs(amount) : Math.abs(amount);
    await db
      .insert(userCreditsTable)
      .values({ userEmail: email.toLowerCase(), credits: Math.max(0, delta) })
      .onConflictDoUpdate({
        target: userCreditsTable.userEmail,
        set: { credits: sql`GREATEST(0, ${userCreditsTable.credits} + ${delta})` },
      });
  }

  const [row] = await db.select().from(userCreditsTable).where(eq(userCreditsTable.userEmail, email.toLowerCase()));

  // Notify user of credit change
  sendCreditNotificationEmail({
    to: row.userEmail,
    name: row.userEmail.split("@")[0],
    credits: Math.abs(amount),
    action: "adjusted",
    newBalance: row.credits,
  }).catch(() => {});

  res.json({ email: row.userEmail, credits: row.credits });
});

// ── Payment Settings (read/write gateway config) ──────────────────────────────
const PAYMENT_SETTING_KEYS = [
  "LS_API_KEY", "LS_STORE_ID", "LS_WEBHOOK_SECRET",
  "LS_VARIANT_10", "LS_VARIANT_50", "LS_VARIANT_200",
  "CRYPTO_PAYMENT_KEY", "CRYPTO_MERCHANT_ID", "APP_URL",
] as const;

const MASKED_KEYS = new Set(["LS_API_KEY", "LS_WEBHOOK_SECRET", "CRYPTO_PAYMENT_KEY"]);

router.get("/admin/payment-settings", async (req, res): Promise<void> => {
  if (!checkAdmin(req, res)) return;
  const rows = await db.select().from(paymentSettingsTable);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;

  // Merge with env vars as fallback (env = default, DB = override)
  const defaults: Record<string, string> = {
    LS_API_KEY:            process.env.LEMONSQUEEZY_API_KEY        || "",
    LS_STORE_ID:           process.env.LEMONSQUEEZY_STORE_ID       || "",
    LS_WEBHOOK_SECRET:     process.env.LEMONSQUEEZY_WEBHOOK_SECRET  || "",
    LS_VARIANT_10:         process.env.LEMONSQUEEZY_VARIANT_10     || "",
    LS_VARIANT_50:         process.env.LEMONSQUEEZY_VARIANT_50     || "",
    LS_VARIANT_200:        process.env.LEMONSQUEEZY_VARIANT_200    || "",
    CRYPTO_PAYMENT_KEY:    process.env.CRYPTOMUS_PAYMENT_KEY       || "",
    CRYPTO_MERCHANT_ID:    process.env.CRYPTOMUS_MERCHANT_ID       || "",
    APP_URL:               process.env.APP_URL                     || "",
  };

  const result: Record<string, string> = {};
  for (const k of PAYMENT_SETTING_KEYS) {
    const val = map[k] || defaults[k] || "";
    result[k] = MASKED_KEYS.has(k) && val ? "••••••••" + val.slice(-4) : val;
  }
  result["_sources"] = JSON.stringify(Object.fromEntries(
    PAYMENT_SETTING_KEYS.map(k => [k, map[k] ? "db" : (defaults[k] ? "env" : "unset")])
  ));
  res.json(result);
});

router.post("/admin/payment-settings", async (req, res): Promise<void> => {
  if (!checkAdmin(req, res)) return;
  const body = req.body as Record<string, string>;
  const updated: string[] = [];

  for (const k of PAYMENT_SETTING_KEYS) {
    const val = body[k];
    if (val === undefined) continue;
    // Skip if placeholder masking was sent back
    if (typeof val === "string" && val.startsWith("••")) continue;
    if (val === "") {
      // Delete the key → fall back to env
      await db.delete(paymentSettingsTable).where(eq(paymentSettingsTable.key, k));
    } else {
      await db.insert(paymentSettingsTable)
        .values({ key: k, value: val })
        .onConflictDoUpdate({ target: paymentSettingsTable.key, set: { value: val } });
    }
    updated.push(k);
  }
  res.json({ updated });
});

// ── Payment Settings Test endpoints ──────────────────────────────────────────
async function getPaySetting(key: string): Promise<string> {
  const [row] = await db.select().from(paymentSettingsTable).where(eq(paymentSettingsTable.key, key));
  return row?.value || "";
}

router.post("/admin/payment-settings/test-lemon", async (req, res): Promise<void> => {
  if (!checkAdmin(req, res)) return;
  const apiKey  = (await getPaySetting("LS_API_KEY"))  || process.env.LEMONSQUEEZY_API_KEY || "";
  const storeId = (await getPaySetting("LS_STORE_ID")) || process.env.LEMONSQUEEZY_STORE_ID || "";
  if (!apiKey) { res.status(400).json({ ok: false, error: "API Key not configured" }); return; }

  try {
    const r = await fetch("https://api.lemonsqueezy.com/v1/stores", {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/vnd.api+json" },
    });
    if (!r.ok) { res.json({ ok: false, error: `HTTP ${r.status}` }); return; }
    const data = await r.json() as { data?: Array<{ id: string; attributes: { name: string } }> };
    const store = storeId ? data.data?.find(s => s.id === storeId) : data.data?.[0];
    res.json({ ok: true, storeName: store?.attributes?.name || "Connected", storeId: store?.id || "" });
  } catch (e: any) {
    res.json({ ok: false, error: e.message });
  }
});

router.post("/admin/payment-settings/test-crypto", async (req, res): Promise<void> => {
  if (!checkAdmin(req, res)) return;
  const payKey    = (await getPaySetting("CRYPTO_PAYMENT_KEY")) || process.env.CRYPTOMUS_PAYMENT_KEY || "";
  const merchantId = (await getPaySetting("CRYPTO_MERCHANT_ID")) || process.env.CRYPTOMUS_MERCHANT_ID || "";
  if (!payKey || !merchantId) { res.status(400).json({ ok: false, error: "Keys not configured" }); return; }

  try {
    const body = { currency: "USDT", network: "tron" };
    const encoded = Buffer.from(JSON.stringify(body)).toString("base64");
    const crypto = await import("crypto");
    const sign = crypto.createHash("md5").update(encoded + payKey).digest("hex");
    const r = await fetch("https://api.cryptomus.com/v1/wallet", {
      method: "POST",
      headers: { merchant: merchantId, sign, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json() as { state?: number; message?: string; result?: { address?: string } };
    if (data.state === 0 || data.result?.address) {
      res.json({ ok: true, message: "Connected — wallet address generated" });
    } else {
      res.json({ ok: false, error: data.message || "Unknown error" });
    }
  } catch (e: any) {
    res.json({ ok: false, error: e.message });
  }
});

// ── Timestamp API Settings ────────────────────────────────────────────────────
const API_SETTING_KEYS = ["TIMESTAMPS_API_KEY", "TIMESTAMPS_BASE_URL"] as const;
const API_MASKED_KEYS = new Set(["TIMESTAMPS_API_KEY"]);

router.get("/admin/api-settings", async (req, res): Promise<void> => {
  if (!checkAdmin(req, res)) return;
  const rows = await db.select().from(paymentSettingsTable);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;

  const defaults: Record<string, string> = {
    TIMESTAMPS_API_KEY:  process.env.TIMESTAMPS_API_KEY  || "",
    TIMESTAMPS_BASE_URL: process.env.TIMESTAMPS_BASE_URL || "https://api.timestamps.video",
  };

  const result: Record<string, string> = {};
  for (const k of API_SETTING_KEYS) {
    const val = map[k] || defaults[k] || "";
    result[k] = API_MASKED_KEYS.has(k) && val ? "••••••••" + val.slice(-4) : val;
  }
  result["_sources"] = JSON.stringify(Object.fromEntries(
    API_SETTING_KEYS.map(k => [k, map[k] ? "db" : (defaults[k] ? "env" : "unset")])
  ));
  res.json(result);
});

router.post("/admin/api-settings", async (req, res): Promise<void> => {
  if (!checkAdmin(req, res)) return;
  const body = req.body as Record<string, string>;
  const updated: string[] = [];

  for (const k of API_SETTING_KEYS) {
    const val = body[k];
    if (val === undefined) continue;
    if (typeof val === "string" && val.startsWith("••")) continue;
    if (val === "") {
      await db.delete(paymentSettingsTable).where(eq(paymentSettingsTable.key, k));
    } else {
      await db.insert(paymentSettingsTable)
        .values({ key: k, value: val })
        .onConflictDoUpdate({ target: paymentSettingsTable.key, set: { value: val } });
    }
    updated.push(k);
  }
  res.json({ updated });
});

router.post("/admin/api-settings/test", async (req, res): Promise<void> => {
  if (!checkAdmin(req, res)) return;
  const result = await testApiConnection();
  res.json(result);
});

// ── Email / SMTP Settings ──────────────────────────────────────────────────────
const SMTP_SETTING_KEYS = [
  "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS",
  "SMTP_FROM_NAME", "SMTP_FROM_EMAIL", "SMTP_SECURE", "SMTP_ADMIN_EMAIL",
] as const;
const SMTP_MASKED_KEYS = new Set(["SMTP_PASS"]);

router.get("/admin/email-settings", async (req, res): Promise<void> => {
  if (!checkAdmin(req, res)) return;
  const rows = await db.select().from(paymentSettingsTable);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;

  const defaults: Record<string, string> = {
    SMTP_HOST:        process.env.SMTP_HOST        || "",
    SMTP_PORT:        process.env.SMTP_PORT        || "465",
    SMTP_USER:        process.env.SMTP_USER        || "",
    SMTP_PASS:        process.env.SMTP_PASS        || "",
    SMTP_FROM_NAME:   process.env.SMTP_FROM_NAME   || "TimestampAI",
    SMTP_FROM_EMAIL:  process.env.SMTP_FROM_EMAIL  || "",
    SMTP_SECURE:      process.env.SMTP_SECURE      || "true",
    SMTP_ADMIN_EMAIL: process.env.SMTP_ADMIN_EMAIL || "",
  };

  const result: Record<string, string> = {};
  for (const k of SMTP_SETTING_KEYS) {
    const val = map[k] || defaults[k] || "";
    result[k] = SMTP_MASKED_KEYS.has(k) && val ? "••••••••" + val.slice(-4) : val;
  }
  result["_sources"] = JSON.stringify(Object.fromEntries(
    SMTP_SETTING_KEYS.map(k => [k, map[k] ? "db" : (defaults[k] ? "env" : "unset")])
  ));
  res.json(result);
});

router.post("/admin/email-settings", async (req, res): Promise<void> => {
  if (!checkAdmin(req, res)) return;
  const body = req.body as Record<string, string>;
  const updated: string[] = [];

  for (const k of SMTP_SETTING_KEYS) {
    const val = body[k];
    if (val === undefined) continue;
    if (typeof val === "string" && val.startsWith("••")) continue;
    if (val === "") {
      await db.delete(paymentSettingsTable).where(eq(paymentSettingsTable.key, k));
    } else {
      await db.insert(paymentSettingsTable)
        .values({ key: k, value: val })
        .onConflictDoUpdate({ target: paymentSettingsTable.key, set: { value: val } });
    }
    updated.push(k);
  }
  res.json({ updated });
});

router.post("/admin/email-settings/test-smtp", async (req, res): Promise<void> => {
  if (!checkAdmin(req, res)) return;
  const result = await testSmtpConnection();
  res.json(result);
});

router.post("/admin/email-settings/send-test", async (req, res): Promise<void> => {
  if (!checkAdmin(req, res)) return;
  const { to } = req.body as { to?: string };
  if (!to) { res.status(400).json({ ok: false, message: "Email address required" }); return; }
  const result = await sendTestEmail(to);
  res.json(result);
});

// ── Public contact form submission ────────────────────────────────────────────
router.post("/contact", async (req, res): Promise<void> => {
  const { name, email, subject, message } = req.body as {
    name?: string; email?: string; subject?: string; message?: string;
  };

  if (!name || !email || !message) {
    res.status(400).json({ error: "Name, email, and message are required" });
    return;
  }

  // Get admin email from settings
  const [adminRow] = await db.select().from(paymentSettingsTable)
    .where(eq(paymentSettingsTable.key, "SMTP_ADMIN_EMAIL"));
  const adminEmail = adminRow?.value || process.env.SMTP_ADMIN_EMAIL || process.env.SMTP_USER || "";

  if (!adminEmail) {
    res.status(503).json({ error: "Contact email not configured" });
    return;
  }

  const { sendContactFormEmail } = await import("../lib/mailer.js");
  try {
    await sendContactFormEmail({
      fromName: name,
      fromEmail: email,
      subject: subject || "Contact Form Submission",
      message,
      adminEmail,
    });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to send email: " + err.message });
  }
});

export default router;
