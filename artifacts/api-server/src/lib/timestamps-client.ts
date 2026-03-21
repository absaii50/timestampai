import { eq } from "drizzle-orm";
import { db, paymentSettingsTable } from "@workspace/db";

const DEFAULT_BASE_URL = "https://api.timestamps.video";

async function getConfig(): Promise<{ baseUrl: string; apiKey: string }> {
  const rows = await db.select().from(paymentSettingsTable)
    .where(eq(paymentSettingsTable.key, "TIMESTAMPS_API_KEY"));
  const urlRows = await db.select().from(paymentSettingsTable)
    .where(eq(paymentSettingsTable.key, "TIMESTAMPS_BASE_URL"));

  const apiKey = rows[0]?.value || process.env.TIMESTAMPS_API_KEY || "";
  const baseUrl = urlRows[0]?.value || process.env.TIMESTAMPS_BASE_URL || DEFAULT_BASE_URL;

  if (!apiKey) throw new Error("TIMESTAMPS_API_KEY is not configured. Set it in Admin → API Settings.");
  return { apiKey, baseUrl };
}

async function headers(): Promise<Record<string, string>> {
  const { apiKey } = await getConfig();
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
  };
}

async function getBaseUrl(): Promise<string> {
  const { baseUrl } = await getConfig();
  return baseUrl;
}

function parseExternalError(text: string, status: number): Error {
  let message = text;
  try {
    const json = JSON.parse(text);
    if (json.message) {
      message = json.message;
    } else if (Array.isArray(json.detail) && json.detail[0]?.msg) {
      message = json.detail.map((d: { msg: string }) => d.msg).join(", ");
    }
  } catch {
    // not JSON — use raw text
  }
  return Object.assign(new Error(message), { status });
}

export interface ExternalJobSubmitResponse {
  job_id: string;
}

export interface ExternalJobStatusResponse {
  job_id: string;
  status: string;
}

export interface ExternalUploadInitResponse {
  video_id: string;
  presigned_url: string;
  required_headers: Record<string, string>;
}

export interface ExternalTimestampEntry {
  time: string;
  label: string;
}

export interface ExternalTimestampsResponse {
  job_id: string;
  timestamps: ExternalTimestampEntry[];
}

export async function submitYoutube(youtubeUrl: string): Promise<ExternalJobSubmitResponse> {
  const [hdrs, base] = await Promise.all([headers(), getBaseUrl()]);
  const res = await fetch(`${base}/api/v1/submit-youtube`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({ video_url: youtubeUrl }),
  });
  if (!res.ok) { const text = await res.text(); throw parseExternalError(text, res.status); }
  return res.json() as Promise<ExternalJobSubmitResponse>;
}

export async function uploadInit(params: {
  filename: string;
  contentType: string;
  contentMd5: string;
  fileSizeBytes: number;
}): Promise<ExternalUploadInitResponse> {
  const [hdrs, base] = await Promise.all([headers(), getBaseUrl()]);
  const res = await fetch(`${base}/api/v1/upload-init`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      filename: params.filename,
      content_type: params.contentType,
      content_md5: params.contentMd5,
      file_size_bytes: params.fileSizeBytes,
    }),
  });
  if (!res.ok) { const text = await res.text(); throw parseExternalError(text, res.status); }
  return res.json() as Promise<ExternalUploadInitResponse>;
}

export async function uploadComplete(videoId: string): Promise<ExternalJobSubmitResponse> {
  const [hdrs, base] = await Promise.all([headers(), getBaseUrl()]);
  const res = await fetch(`${base}/api/v1/upload-complete`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({ video_id: videoId }),
  });
  if (!res.ok) { const text = await res.text(); throw parseExternalError(text, res.status); }
  return res.json() as Promise<ExternalJobSubmitResponse>;
}

export async function getJobStatus(externalJobId: string): Promise<ExternalJobStatusResponse> {
  const [hdrs, base] = await Promise.all([headers(), getBaseUrl()]);
  const res = await fetch(`${base}/api/v1/jobs/${externalJobId}`, { headers: hdrs });
  if (!res.ok) { const text = await res.text(); throw parseExternalError(text, res.status); }
  return res.json() as Promise<ExternalJobStatusResponse>;
}

export async function getJobTimestamps(externalJobId: string): Promise<ExternalTimestampsResponse> {
  const [hdrs, base] = await Promise.all([headers(), getBaseUrl()]);
  const res = await fetch(`${base}/api/v1/jobs/${externalJobId}/timestamps`, { headers: hdrs });
  if (!res.ok) { const text = await res.text(); throw parseExternalError(text, res.status); }
  return res.json() as Promise<ExternalTimestampsResponse>;
}

export async function testApiConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const [hdrs, base] = await Promise.all([headers(), getBaseUrl()]);
    const res = await fetch(`${base}/api/v1/jobs`, { headers: hdrs });
    if (res.ok || res.status === 404 || res.status === 422) {
      return { ok: true, message: "Connection successful" };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: "Invalid API key — authentication failed" };
    }
    return { ok: false, message: `Server responded with ${res.status}` };
  } catch (err: any) {
    if (err.message?.includes("not configured")) return { ok: false, message: err.message };
    return { ok: false, message: `Connection failed: ${err.message}` };
  }
}
