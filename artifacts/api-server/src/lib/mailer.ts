import nodemailer from "nodemailer";
import { eq } from "drizzle-orm";
import { db, paymentSettingsTable } from "@workspace/db";

// ── SMTP config keys stored in payment_settings table ──────────────────────
const SMTP_KEYS = [
  "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS",
  "SMTP_FROM_NAME", "SMTP_FROM_EMAIL", "SMTP_SECURE",
] as const;

export type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
  secure: boolean;
};

async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const rows = await db.select().from(paymentSettingsTable);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;

  const host       = map["SMTP_HOST"]       || process.env.SMTP_HOST       || "";
  const portStr    = map["SMTP_PORT"]       || process.env.SMTP_PORT       || "465";
  const user       = map["SMTP_USER"]       || process.env.SMTP_USER       || "";
  const pass       = map["SMTP_PASS"]       || process.env.SMTP_PASS       || "";
  const fromName   = map["SMTP_FROM_NAME"]  || process.env.SMTP_FROM_NAME  || "TimestampAI";
  const fromEmail  = map["SMTP_FROM_EMAIL"] || process.env.SMTP_FROM_EMAIL || user;
  const secureStr  = map["SMTP_SECURE"]     || process.env.SMTP_SECURE     || "true";

  if (!host || !user || !pass) return null;

  return {
    host,
    port: parseInt(portStr, 10) || 465,
    user,
    pass,
    fromName,
    fromEmail: fromEmail || user,
    secure: secureStr !== "false",
  };
}

function createTransport(cfg: SmtpConfig) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    tls: { rejectUnauthorized: false },
  });
}

// ── Branded HTML wrapper ───────────────────────────────────────────────────
function htmlWrap(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:40px 20px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#7c3aed,#4f46e5);border-radius:16px 16px 0 0;padding:32px 40px;text-align:center">
            <div style="display:inline-flex;align-items:center;gap:10px">
              <div style="width:36px;height:36px;background:rgba(255,255,255,0.2);border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-size:20px">⏱</div>
              <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:-0.3px">TimestampAI</span>
            </div>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="background:#fff;padding:40px;border-radius:0 0 16px 16px;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
            ${body}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:24px 40px;text-align:center">
            <p style="margin:0;font-size:12px;color:#8e8e93">
              © ${new Date().getFullYear()} TimestampAI · <a href="https://timestampai.app" style="color:#7c3aed;text-decoration:none">timestampai.app</a><br>
              <a href="https://timestampai.app/unsubscribe" style="color:#8e8e93">Unsubscribe</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function btn(text: string, href: string): string {
  return `<a href="${href}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;font-size:15px;margin-top:8px">${text}</a>`;
}

function divider(): string {
  return `<hr style="border:none;border-top:1px solid #f0f0f5;margin:28px 0">`;
}

function badge(text: string, color = "#7c3aed"): string {
  return `<span style="display:inline-block;background:${color}1a;color:${color};padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600">${text}</span>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// Email senders
// ══════════════════════════════════════════════════════════════════════════════

export async function sendWelcomeEmail(to: string, name: string): Promise<void> {
  const cfg = await getSmtpConfig();
  if (!cfg) return;

  const displayName = name || to.split("@")[0];

  const html = htmlWrap("Welcome to TimestampAI!", `
    <h1 style="margin:0 0 8px;font-size:26px;font-weight:700;color:#1c1c1e">Welcome, ${displayName}! 🎉</h1>
    <p style="margin:0 0 24px;color:#636366;font-size:15px;line-height:1.6">
      Your account is ready. You can now generate AI-powered chapter timestamps for any YouTube video — instantly.
    </p>
    ${divider()}
    <h3 style="margin:0 0 16px;font-size:15px;font-weight:600;color:#1c1c1e">Get started in 3 easy steps:</h3>
    <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:24px">
      <tr>
        <td style="padding:10px 0;vertical-align:top">
          <span style="display:inline-block;width:28px;height:28px;background:#7c3aed1a;color:#7c3aed;border-radius:50%;text-align:center;line-height:28px;font-weight:700;font-size:13px;margin-right:12px">1</span>
          <span style="color:#3a3a3c;font-size:14px">Paste a YouTube URL or upload a video file</span>
        </td>
      </tr>
      <tr>
        <td style="padding:10px 0;vertical-align:top">
          <span style="display:inline-block;width:28px;height:28px;background:#7c3aed1a;color:#7c3aed;border-radius:50%;text-align:center;line-height:28px;font-weight:700;font-size:13px;margin-right:12px">2</span>
          <span style="color:#3a3a3c;font-size:14px">Click Generate and let AI do its magic</span>
        </td>
      </tr>
      <tr>
        <td style="padding:10px 0;vertical-align:top">
          <span style="display:inline-block;width:28px;height:28px;background:#7c3aed1a;color:#7c3aed;border-radius:50%;text-align:center;line-height:28px;font-weight:700;font-size:13px;margin-right:12px">3</span>
          <span style="color:#3a3a3c;font-size:14px">Copy your timestamps and add them to your video</span>
        </td>
      </tr>
    </table>
    <div style="text-align:center;margin-top:8px">
      ${btn("Generate My First Timestamps →", "https://timestampai.app/dashboard")}
    </div>
    ${divider()}
    <p style="margin:0;font-size:13px;color:#8e8e93;text-align:center">
      Need help? Reply to this email or visit <a href="https://timestampai.app" style="color:#7c3aed">timestampai.app</a>
    </p>
  `);

  const transport = createTransport(cfg);
  await transport.sendMail({
    from: `"${cfg.fromName}" <${cfg.fromEmail}>`,
    to,
    subject: "Welcome to TimestampAI — Your AI timestamp generator is ready!",
    html,
  });
}

export async function sendPaymentReceiptEmail(params: {
  to: string;
  name: string;
  planName: string;
  credits: number;
  amountUsd: string;
  provider: string;
  transactionId: string;
}): Promise<void> {
  const cfg = await getSmtpConfig();
  if (!cfg) return;

  const { to, name, planName, credits, amountUsd, provider, transactionId } = params;
  const displayName = name || to.split("@")[0];
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const providerLabel = provider === "lemonsqueezy" ? "LemonSqueezy" : provider === "cryptomus" ? "Cryptomus (Crypto)" : provider;

  const html = htmlWrap("Payment Receipt — TimestampAI", `
    <div style="text-align:center;margin-bottom:28px">
      <div style="width:64px;height:64px;background:#4ade801a;border-radius:50%;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-size:32px">✅</div>
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1c1c1e">Payment Confirmed!</h1>
      <p style="margin:0;color:#636366;font-size:15px">Hi ${displayName}, your purchase was successful.</p>
    </div>
    ${divider()}
    <!-- Receipt table -->
    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f8f7ff;border-radius:12px;padding:20px;margin-bottom:24px">
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#636366">Plan</td>
        <td style="padding:8px 0;font-size:14px;font-weight:600;color:#1c1c1e;text-align:right">${planName} Plan</td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#636366">Credits Added</td>
        <td style="padding:8px 0;font-size:14px;font-weight:600;color:#7c3aed;text-align:right">${credits} credits</td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#636366">Amount Paid</td>
        <td style="padding:8px 0;font-size:20px;font-weight:700;color:#1c1c1e;text-align:right">$${amountUsd}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#636366">Payment Via</td>
        <td style="padding:8px 0;font-size:14px;color:#1c1c1e;text-align:right">${providerLabel}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#636366">Date</td>
        <td style="padding:8px 0;font-size:14px;color:#1c1c1e;text-align:right">${date}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:12px;color:#8e8e93;border-top:1px solid #e5e5ea;padding-top:12px">Transaction ID</td>
        <td style="padding:8px 0;font-size:12px;color:#8e8e93;border-top:1px solid #e5e5ea;padding-top:12px;text-align:right;font-family:monospace">${transactionId.slice(-12)}</td>
      </tr>
    </table>
    <div style="text-align:center;margin:8px 0 28px">
      ${btn("Start Using Your Credits →", "https://timestampai.app/dashboard")}
    </div>
    ${divider()}
    <p style="margin:0;font-size:13px;color:#8e8e93;text-align:center">
      Questions about your purchase? Reply to this email and we'll help right away.
    </p>
  `);

  const transport = createTransport(cfg);
  await transport.sendMail({
    from: `"${cfg.fromName}" <${cfg.fromEmail}>`,
    to,
    subject: `Receipt: ${planName} Plan — $${amountUsd} (${credits} credits added)`,
    html,
  });
}

export async function sendCreditNotificationEmail(params: {
  to: string;
  name: string;
  credits: number;
  action: "added" | "adjusted";
  newBalance: number;
}): Promise<void> {
  const cfg = await getSmtpConfig();
  if (!cfg) return;

  const { to, name, credits, action, newBalance } = params;
  const displayName = name || to.split("@")[0];
  const emoji = action === "added" ? "⚡" : "🔄";

  const html = htmlWrap("Credits Update — TimestampAI", `
    <div style="text-align:center;margin-bottom:28px">
      <div style="font-size:48px;margin-bottom:12px">${emoji}</div>
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1c1c1e">
        ${credits} Credits ${action === "added" ? "Added" : "Adjusted"}
      </h1>
      <p style="margin:0;color:#636366;font-size:15px">Hi ${displayName}, your credit balance has been updated.</p>
    </div>
    ${divider()}
    <div style="background:#f8f7ff;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
      <div style="font-size:13px;color:#636366;margin-bottom:8px">Your new balance</div>
      <div style="font-size:48px;font-weight:700;color:#7c3aed">${newBalance}</div>
      <div style="font-size:14px;color:#636366">credits</div>
    </div>
    <p style="color:#636366;font-size:14px;line-height:1.6;text-align:center">
      Each credit generates timestamps for one video. Need more credits?<br>
      <a href="https://timestampai.app/pricing" style="color:#7c3aed;font-weight:600">View our plans →</a>
    </p>
    ${divider()}
    <div style="text-align:center">
      ${btn("Go to Dashboard", "https://timestampai.app/dashboard")}
    </div>
  `);

  const transport = createTransport(cfg);
  await transport.sendMail({
    from: `"${cfg.fromName}" <${cfg.fromEmail}>`,
    to,
    subject: `${credits} credits ${action} to your TimestampAI account`,
    html,
  });
}

export async function sendContactFormEmail(params: {
  fromName: string;
  fromEmail: string;
  subject: string;
  message: string;
  adminEmail: string;
}): Promise<void> {
  const cfg = await getSmtpConfig();
  if (!cfg) return;

  const { fromName, fromEmail, subject, message, adminEmail } = params;

  const html = htmlWrap("New Contact Form Submission", `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1c1c1e">📬 New Message</h1>
    <p style="margin:0 0 24px;color:#636366;font-size:15px">Someone submitted the contact form on TimestampAI.</p>
    ${divider()}
    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f8f7ff;border-radius:12px;padding:20px;margin-bottom:24px">
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#636366;width:100px">From</td>
        <td style="padding:8px 0;font-size:14px;font-weight:600;color:#1c1c1e">${fromName}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#636366">Email</td>
        <td style="padding:8px 0;font-size:14px;color:#7c3aed"><a href="mailto:${fromEmail}" style="color:#7c3aed">${fromEmail}</a></td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#636366">Subject</td>
        <td style="padding:8px 0;font-size:14px;color:#1c1c1e">${subject}</td>
      </tr>
    </table>
    <div style="background:#f0f0f5;border-radius:10px;padding:20px;margin-bottom:24px">
      <div style="font-size:12px;font-weight:600;color:#8e8e93;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px">Message</div>
      <p style="margin:0;font-size:14px;color:#3a3a3c;line-height:1.7;white-space:pre-wrap">${message.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</p>
    </div>
    <div style="text-align:center">
      ${btn(`Reply to ${fromName}`, `mailto:${fromEmail}?subject=Re: ${encodeURIComponent(subject)}`)}
    </div>
  `);

  const transport = createTransport(cfg);
  await transport.sendMail({
    from: `"${cfg.fromName}" <${cfg.fromEmail}>`,
    to: adminEmail,
    replyTo: `"${fromName}" <${fromEmail}>`,
    subject: `[Contact] ${subject}`,
    html,
  });
}

export async function testSmtpConnection(): Promise<{ ok: boolean; message: string }> {
  const cfg = await getSmtpConfig();
  if (!cfg) return { ok: false, message: "SMTP not configured — fill in all required fields first" };

  try {
    const transport = createTransport(cfg);
    await transport.verify();
    return { ok: true, message: `Connected to ${cfg.host}:${cfg.port} as ${cfg.user}` };
  } catch (err: any) {
    return { ok: false, message: err.message || "Connection failed" };
  }
}

export async function sendTestEmail(to: string): Promise<{ ok: boolean; message: string }> {
  const cfg = await getSmtpConfig();
  if (!cfg) return { ok: false, message: "SMTP not configured" };

  try {
    const transport = createTransport(cfg);
    await transport.sendMail({
      from: `"${cfg.fromName}" <${cfg.fromEmail}>`,
      to,
      subject: "Test Email from TimestampAI ✓",
      html: htmlWrap("Test Email", `
        <div style="text-align:center">
          <div style="font-size:48px;margin-bottom:16px">✅</div>
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1c1c1e">Email is working!</h1>
          <p style="margin:0;color:#636366;font-size:15px">Your TimestampAI SMTP settings are configured correctly.</p>
          ${divider()}
          <p style="font-size:13px;color:#8e8e93">
            Sent from: ${cfg.fromEmail}<br>
            SMTP Host: ${cfg.host}:${cfg.port}<br>
            Sent at: ${new Date().toUTCString()}
          </p>
        </div>
      `),
    });
    return { ok: true, message: `Test email sent to ${to}` };
  } catch (err: any) {
    return { ok: false, message: err.message || "Send failed" };
  }
}
