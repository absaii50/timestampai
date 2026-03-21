import { Router, type IRouter } from "express";
import { eq, desc, sql, count } from "drizzle-orm";
import { db, jobsTable, userCreditsTable } from "@workspace/db";
import { sendWelcomeEmail } from "../lib/mailer.js";
import {
  ListJobsResponse,
  SubmitYoutubeBody,
  UploadInitBody,
  UploadCompleteBody,
  GetJobParams,
  GetJobTimestampsParams,
  GetJobResponse,
  UploadInitResponse,
  GetJobTimestampsResponse,
} from "@workspace/api-zod";
import {
  submitYoutube,
  uploadInit,
  uploadComplete,
  getJobStatus,
  getJobTimestamps,
} from "../lib/timestamps-client.js";

const router: IRouter = Router();

function getUserEmail(req: any): string | null {
  const v = req.headers["x-user-email"];
  return typeof v === "string" && v.trim() ? v.trim().toLowerCase() : null;
}
function getUserName(req: any): string | null {
  const v = req.headers["x-user-name"];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

async function getUserCredits(email: string | null): Promise<number> {
  if (!email) return 0;
  const [row] = await db.select().from(userCreditsTable).where(eq(userCreditsTable.userEmail, email));
  return row?.credits ?? 0;
}

async function deductCredit(email: string): Promise<void> {
  await db
    .update(userCreditsTable)
    .set({ credits: sql`${userCreditsTable.credits} - 1` })
    .where(eq(userCreditsTable.userEmail, email));
}

router.get("/jobs", async (req, res): Promise<void> => {
  const userEmail = getUserEmail(req);
  const query = userEmail
    ? db.select().from(jobsTable).where(eq(jobsTable.userEmail, userEmail)).orderBy(desc(jobsTable.createdAt))
    : db.select().from(jobsTable).orderBy(desc(jobsTable.createdAt));
  const jobs = await query;
  res.json(ListJobsResponse.parse(jobs));
});

router.post("/jobs/submit-youtube", async (req, res): Promise<void> => {
  const email = getUserEmail(req);
  const credits = await getUserCredits(email);
  if (credits < 1) {
    res.status(402).json({ error: "You have no credits. Please purchase a plan to continue." });
    return;
  }

  const parsed = SubmitYoutubeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let externalResp;
  try {
    externalResp = await submitYoutube(parsed.data.youtubeUrl);
  } catch (err: unknown) {
    const e = err as { status?: number; message: string };
    const status = e.status === 402 ? 402 : 400;
    res.status(status).json({ error: e.message });
    return;
  }

  const [job] = await db
    .insert(jobsTable)
    .values({
      externalJobId: externalResp.job_id,
      title: null,
      sourceType: "youtube",
      sourceUrl: parsed.data.youtubeUrl,
      status: "pending",
      userEmail: email,
      userName: getUserName(req),
    })
    .returning();

  if (email) await deductCredit(email);

  // Send welcome email on first job ever
  if (email) {
    const [jobCount] = await db.select({ total: count() }).from(jobsTable).where(eq(jobsTable.userEmail, email));
    if (Number(jobCount?.total) === 1) {
      sendWelcomeEmail(email, getUserName(req) || "").catch(() => {});
    }
  }

  res.status(201).json(GetJobResponse.parse(job));
});

router.post("/jobs/upload-init", async (req, res): Promise<void> => {
  const parsed = UploadInitBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let externalResp;
  try {
    externalResp = await uploadInit({
      filename: parsed.data.filename,
      contentType: parsed.data.contentType,
      contentMd5: parsed.data.contentMd5,
      fileSizeBytes: parsed.data.fileSizeBytes,
    });
  } catch (err: unknown) {
    const e = err as { status?: number; message: string };
    res.status(400).json({ error: e.message });
    return;
  }

  res.json(
    UploadInitResponse.parse({
      videoId: externalResp.video_id,
      presignedUrl: externalResp.presigned_url,
      requiredHeaders: externalResp.required_headers,
    })
  );
});

router.post("/jobs/upload-complete", async (req, res): Promise<void> => {
  const email = getUserEmail(req);
  const credits = await getUserCredits(email);
  if (credits < 1) {
    res.status(402).json({ error: "You have no credits. Please purchase a plan to continue." });
    return;
  }

  const parsed = UploadCompleteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let externalResp;
  try {
    externalResp = await uploadComplete(parsed.data.videoId);
  } catch (err: unknown) {
    const e = err as { status?: number; message: string };
    res.status(400).json({ error: e.message });
    return;
  }

  const [job] = await db
    .insert(jobsTable)
    .values({
      externalJobId: externalResp.job_id,
      title: parsed.data.title ?? null,
      sourceType: "upload",
      sourceUrl: null,
      status: "pending",
      userEmail: email,
      userName: getUserName(req),
    })
    .returning();

  if (email) await deductCredit(email);
  res.status(201).json(GetJobResponse.parse(job));
});

router.get("/jobs/:id", async (req, res): Promise<void> => {
  const params = GetJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, params.data.id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (job.status === "pending" || job.status === "processing") {
    try {
      const externalStatus = await getJobStatus(job.externalJobId);
      const newStatus =
        externalStatus.status === "finished"
          ? "finished"
          : externalStatus.status === "failed"
            ? "failed"
            : externalStatus.status === "processing"
              ? "processing"
              : "pending";

      if (newStatus !== job.status) {
        const [updated] = await db
          .update(jobsTable)
          .set({ status: newStatus })
          .where(eq(jobsTable.id, job.id))
          .returning();
        res.json(GetJobResponse.parse(updated));
        return;
      }
    } catch {
      // Return what we have if external call fails
    }
  }

  res.json(GetJobResponse.parse(job));
});

router.get("/jobs/:id/timestamps", async (req, res): Promise<void> => {
  const params = GetJobTimestampsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, params.data.id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (job.timestampsJson) {
    const timestamps = JSON.parse(job.timestampsJson);
    res.json(
      GetJobTimestampsResponse.parse({
        jobId: job.id,
        externalJobId: job.externalJobId,
        title: job.title,
        timestamps,
      })
    );
    return;
  }

  if (job.status !== "finished") {
    res.status(404).json({ error: "Job is not finished yet" });
    return;
  }

  let externalTimestamps;
  try {
    externalTimestamps = await getJobTimestamps(job.externalJobId);
  } catch (err: unknown) {
    const e = err as { message: string };
    res.status(400).json({ error: e.message });
    return;
  }

  const timestamps = externalTimestamps.timestamps;
  await db
    .update(jobsTable)
    .set({ timestampsJson: JSON.stringify(timestamps) })
    .where(eq(jobsTable.id, job.id));

  res.json(
    GetJobTimestampsResponse.parse({
      jobId: job.id,
      externalJobId: job.externalJobId,
      title: job.title,
      timestamps,
    })
  );
});

export default router;
