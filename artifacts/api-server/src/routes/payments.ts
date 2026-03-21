import { Router, type IRouter, type Request, type Response } from "express";
import { eq, sql } from "drizzle-orm";
import { db, paymentsTable, userCreditsTable, paymentSettingsTable } from "@workspace/db";
import crypto from "crypto";
import { sendPaymentReceiptEmail } from "../lib/mailer.js";

const router: IRouter = Router();

// ── Runtime config — reads from DB first, env var as fallback ──────────────
async function cfg(dbKey: string, envKey: string): Promise<string> {
  const [row] = await db.select().from(paymentSettingsTable).where(eq(paymentSettingsTable.key, dbKey));
  return row?.value || process.env[envKey] || "";
}

// ── Plans ─────────────────────────────────────────────────────────────────────
export const PLANS = [
  { id: "starter",  name: "Starter",  credits: 10,  priceUsd: "4.99",  lsVariantKey: "LS_VARIANT_10",  cpOrderId: "starter"  },
  { id: "pro",      name: "Pro",      credits: 50,  priceUsd: "19.99", lsVariantKey: "LS_VARIANT_50",  cpOrderId: "pro"      },
  { id: "business", name: "Business", credits: 200, priceUsd: "59.99", lsVariantKey: "LS_VARIANT_200", cpOrderId: "business" },
];

function getUserEmail(req: Request): string | null {
  const v = req.headers["x-user-email"];
  return typeof v === "string" && v.trim() ? v.trim().toLowerCase() : null;
}

// ── Helper: upsert credits ────────────────────────────────────────────────────
async function addCredits(email: string, amount: number) {
  await db
    .insert(userCreditsTable)
    .values({ userEmail: email, credits: amount })
    .onConflictDoUpdate({
      target: userCreditsTable.userEmail,
      set: { credits: sql`${userCreditsTable.credits} + ${amount}` },
    });
}

// ── GET /payments/credits ─────────────────────────────────────────────────
router.get("/payments/credits", async (req: Request, res: Response): Promise<void> => {
  const email = getUserEmail(req);
  if (!email) { res.json({ credits: 0 }); return; }
  const [row] = await db.select().from(userCreditsTable).where(eq(userCreditsTable.userEmail, email));
  res.json({ credits: row?.credits ?? 0 });
});

// ── GET /payments/plans ───────────────────────────────────────────────────
router.get("/payments/plans", (_req: Request, res: Response): void => {
  res.json({ plans: PLANS.map(p => ({ id: p.id, name: p.name, credits: p.credits, priceUsd: p.priceUsd })) });
});

// ══════════════════════════════════════════════════════════════════════════════
// LEMON SQUEEZY
// ══════════════════════════════════════════════════════════════════════════════

router.post("/payments/lemon/checkout", async (req: Request, res: Response): Promise<void> => {
  const email = getUserEmail(req);
  if (!email) { res.status(401).json({ error: "Login required" }); return; }

  const { planId } = req.body as { planId: string };
  const plan = PLANS.find(p => p.id === planId);
  if (!plan) { res.status(400).json({ error: "Invalid plan" }); return; }

  const apiKey    = await cfg("LS_API_KEY",   "LEMONSQUEEZY_API_KEY");
  const storeId   = await cfg("LS_STORE_ID",  "LEMONSQUEEZY_STORE_ID");
  const lsVariant = await cfg(plan.lsVariantKey, `LEMONSQUEEZY_VARIANT_${plan.credits}`);

  if (!apiKey || !storeId || !lsVariant) {
    res.status(503).json({ error: "Lemon Squeezy is not configured on this server." });
    return;
  }

  const userName = req.headers["x-user-name"] as string | undefined;
  const checkoutRes = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
    method: "POST",
    headers: {
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      data: {
        type: "checkouts",
        attributes: {
          checkout_data: {
            email,
            name: userName || "",
            custom: { user_email: email, plan_id: planId },
          },
        },
        relationships: {
          store:   { data: { type: "stores",   id: storeId } },
          variant: { data: { type: "variants",  id: lsVariant } },
        },
      },
    }),
  });

  if (!checkoutRes.ok) {
    const txt = await checkoutRes.text();
    res.status(502).json({ error: `Lemon Squeezy error: ${txt}` });
    return;
  }

  const checkoutData = await checkoutRes.json() as { data: { attributes: { url: string } } };
  const url = checkoutData.data?.attributes?.url;
  if (!url) { res.status(502).json({ error: "No checkout URL returned" }); return; }

  res.json({ url });
});

// Lemon Squeezy webhook
router.post("/payments/lemon/webhook", async (req: Request, res: Response): Promise<void> => {
  const secret    = (await cfg("LS_WEBHOOK_SECRET", "LEMONSQUEEZY_WEBHOOK_SECRET")) || "";
  const signature = req.headers["x-signature"] as string | undefined;
  const rawBody   = (req as any).rawBody as Buffer | undefined;

  if (secret && signature && rawBody) {
    const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature))) {
      res.status(401).json({ error: "Invalid signature" }); return;
    }
  }

  const event = req.body as {
    meta?: { event_name?: string; custom_data?: { user_email?: string; plan_id?: string } };
    data?: { id?: string };
  };

  const eventName = event.meta?.event_name;
  if (eventName !== "order_created" && eventName !== "subscription_created") {
    res.json({ received: true }); return;
  }

  const email  = event.meta?.custom_data?.user_email;
  const planId = event.meta?.custom_data?.plan_id;
  const externalId = event.data?.id || "unknown";

  if (!email || !planId) { res.json({ received: true }); return; }

  const plan = PLANS.find(p => p.id === planId);
  if (!plan) { res.json({ received: true }); return; }

  const [existing] = await db.select().from(paymentsTable)
    .where(eq(paymentsTable.externalId, externalId));
  if (existing) { res.json({ received: true }); return; }

  await db.insert(paymentsTable).values({
    userEmail: email,
    provider: "lemonsqueezy",
    externalId,
    status: "paid",
    creditsAwarded: plan.credits,
    amountUsd: plan.priceUsd,
    planName: plan.name,
  });
  await addCredits(email, plan.credits);

  sendPaymentReceiptEmail({
    to: email,
    name: email.split("@")[0],
    planName: plan.name,
    credits: plan.credits,
    amountUsd: plan.priceUsd,
    provider: "lemonsqueezy",
    transactionId: externalId,
  }).catch(() => {});

  res.json({ received: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// CRYPTOMUS
// ══════════════════════════════════════════════════════════════════════════════

function cryptomusSign(body: Record<string, unknown>, paymentKey: string): string {
  const encoded = Buffer.from(JSON.stringify(body)).toString("base64");
  return crypto.createHash("md5").update(encoded + paymentKey).digest("hex");
}

router.post("/payments/crypto/checkout", async (req: Request, res: Response): Promise<void> => {
  const email = getUserEmail(req);
  if (!email) { res.status(401).json({ error: "Login required" }); return; }

  const { planId } = req.body as { planId: string };
  const plan = PLANS.find(p => p.id === planId);
  if (!plan) { res.status(400).json({ error: "Invalid plan" }); return; }

  const paymentKey = await cfg("CRYPTO_PAYMENT_KEY", "CRYPTOMUS_PAYMENT_KEY");
  const merchantId = await cfg("CRYPTO_MERCHANT_ID", "CRYPTOMUS_MERCHANT_ID");
  const appUrl     = await cfg("APP_URL", "APP_URL");

  if (!paymentKey || !merchantId) {
    res.status(503).json({ error: "Cryptomus is not configured on this server." });
    return;
  }

  const orderId = `ts-${plan.cpOrderId}-${Date.now()}-${email.replace(/[^a-z0-9]/gi, "")}`.slice(0, 100);

  const body = {
    amount: plan.priceUsd,
    currency: "USD",
    order_id: orderId,
    url_return: `${appUrl}/`,
    url_callback: `${appUrl}/api/payments/crypto/webhook`,
    additional_data: JSON.stringify({ user_email: email, plan_id: planId }),
  };

  const sign = cryptomusSign(body, paymentKey);

  const cpRes = await fetch("https://api.cryptomus.com/v1/payment", {
    method: "POST",
    headers: {
      merchant: merchantId,
      sign,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!cpRes.ok) {
    const txt = await cpRes.text();
    res.status(502).json({ error: `Cryptomus error: ${txt}` });
    return;
  }

  const cpData = await cpRes.json() as { result?: { url?: string } };
  const url = cpData.result?.url;
  if (!url) { res.status(502).json({ error: "No payment URL returned from Cryptomus" }); return; }

  res.json({ url });
});

// Cryptomus webhook
router.post("/payments/crypto/webhook", async (req: Request, res: Response): Promise<void> => {
  const paymentKey = await cfg("CRYPTO_PAYMENT_KEY", "CRYPTOMUS_PAYMENT_KEY");

  const body = req.body as {
    sign?: string;
    status?: string;
    order_id?: string;
    uuid?: string;
    additional_data?: string;
  };

  if (paymentKey && body.sign) {
    const { sign: receivedSign, ...rest } = body;
    const expected = cryptomusSign(rest, paymentKey);
    if (expected !== receivedSign) {
      res.status(401).json({ error: "Invalid signature" }); return;
    }
  }

  if (body.status !== "paid") { res.json({ received: true }); return; }

  let email: string | undefined;
  let planId: string | undefined;
  try {
    const extra = JSON.parse(body.additional_data || "{}") as { user_email?: string; plan_id?: string };
    email  = extra.user_email;
    planId = extra.plan_id;
  } catch { /* ignore */ }

  const externalId = body.uuid || body.order_id || "unknown";

  if (!email || !planId) { res.json({ received: true }); return; }

  const plan = PLANS.find(p => p.id === planId);
  if (!plan) { res.json({ received: true }); return; }

  const [existing] = await db.select().from(paymentsTable)
    .where(eq(paymentsTable.externalId, externalId));
  if (existing) { res.json({ received: true }); return; }

  await db.insert(paymentsTable).values({
    userEmail: email,
    provider: "cryptomus",
    externalId,
    status: "paid",
    creditsAwarded: plan.credits,
    amountUsd: plan.priceUsd,
    planName: plan.name,
  });
  await addCredits(email, plan.credits);

  sendPaymentReceiptEmail({
    to: email,
    name: email.split("@")[0],
    planName: plan.name,
    credits: plan.credits,
    amountUsd: plan.priceUsd,
    provider: "cryptomus",
    transactionId: externalId,
  }).catch(() => {});

  res.json({ received: true });
});

// ── Admin: list payments ──────────────────────────────────────────────────────
router.get("/admin/payments", async (req: Request, res: Response): Promise<void> => {
  const adminKey = req.headers["x-admin-key"];
  const validKey = process.env.ADMIN_PASSWORD || "admin123";
  if (adminKey !== validKey) { res.status(401).json({ error: "Unauthorized" }); return; }

  const payments = await db.select().from(paymentsTable).orderBy(paymentsTable.createdAt);
  res.json(payments);
});

export default router;
