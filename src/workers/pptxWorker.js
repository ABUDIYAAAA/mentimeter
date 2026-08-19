import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { connectMongo } from "../core/database/connect.js";
import env from "../core/env/env.js";
import { redis } from "../core/database/redis.js";
import { PowerPointImport, Slide, PresentationAsset } from "../core/database/models/index.js";
import { storageService } from "../core/storage/storage.service.js";

// Helper for execFile commands to prevent shell command injection
function execFilePromise(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error, stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            `Command failed: ${file} ${args.join(" ")}\nError: ${error.message}\nStderr: ${stderr}\nStdout: ${stdout}`
          )
        );
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// Locate LibreOffice (soffice) executable
function getSofficePath() {
  if (process.env.SOFFICE_PATH) {
    return process.env.SOFFICE_PATH;
  }
  if (process.platform === "darwin") {
    // Check common Mac installation path
    const macPath = "/Applications/LibreOffice.app/Contents/MacOS/soffice";
    if (existsSync(macPath)) {
      return macPath;
    }
  }
  return "soffice"; // Default to system PATH
}

// Locate pdftoppm executable
function getPdftoppmPath() {
  return process.env.PDFTOPPM_PATH || "pdftoppm";
}

// Publish progress helper
async function publishProgress(pptxImport) {
  const payload = {
    userId: pptxImport.userId.toString(),
    presentationId: pptxImport.presentationId.toString(),
    importId: pptxImport._id.toString(),
    status: pptxImport.status,
    processedSlides: pptxImport.processedSlides,
    totalSlides: pptxImport.totalSlides,
    errorInfo: pptxImport.errorInfo || null,
  };
  try {
    await redis.publish("import:progress", JSON.stringify(payload));
  } catch (err) {
    console.error("[Worker] Failed to publish progress to Redis:", err.message);
  }
}

// Cancellation check helper
async function checkCancelled(importId) {
  const pptxImport = await PowerPointImport.findById(importId).select("status");
  if (pptxImport && pptxImport.status === "CANCELLED") {
    console.log(`[Worker] Job ${importId} was cancelled by user.`);
    return true;
  }
  return false;
}

// Rollback partial changes (clean up database slides and local uploads)
async function rollbackImport(pptxImport) {
  console.log(`[Worker] Rolling back partial changes for import job: ${pptxImport._id}`);

  // 1. Delete Slides created by this import
  const deletedSlides = await Slide.find({
    presentationId: pptxImport.presentationId,
    "metadata.importId": pptxImport._id,
  }).lean();

  if (deletedSlides.length > 0) {
    console.log(`[Worker] Deleting ${deletedSlides.length} partial slides...`);
    await Slide.deleteMany({
      presentationId: pptxImport.presentationId,
      "metadata.importId": pptxImport._id,
    });
  }

  // 2. Delete PresentationAsset records & files from storage
  const assets = await PresentationAsset.find({ importId: pptxImport._id }).lean();
  for (const asset of assets) {
    console.log(`[Worker] Deleting asset file: ${asset.storageKey}`);
    await storageService.deleteFile(asset.storageKey);
  }
  if (assets.length > 0) {
    await PresentationAsset.deleteMany({ importId: pptxImport._id });
  }

  // 3. Shift remaining slides back if they were shifted forward
  if (pptxImport.hasShiftedSlides && pptxImport.totalSlides > 0) {
    console.log(
      `[Worker] Rolling back slide positions: shifting back by ${pptxImport.totalSlides} from position ${pptxImport.targetPosition}...`
    );
    await Slide.updateMany(
      {
        presentationId: pptxImport.presentationId,
        position: { $gte: pptxImport.targetPosition },
      },
      { $inc: { position: -pptxImport.totalSlides } }
    );
    pptxImport.hasShiftedSlides = false;
    await pptxImport.save();
  }
}

// Core processing logic
async function processImport(importId) {
  console.log(`[Worker] Starting import job: ${importId}`);
  const pptxImport = await PowerPointImport.findById(importId);
  if (!pptxImport) {
    console.error(`[Worker] Import record not found: ${importId}`);
    return;
  }

  if (pptxImport.status === "CANCELLED") {
    console.log(`[Worker] Job ${importId} was cancelled before processing started.`);
    return;
  }

  // Set processing status
  pptxImport.status = "PROCESSING";
  pptxImport.startedAt = new Date();
  await pptxImport.save();
  await publishProgress(pptxImport);

  let tempDir = null;
  try {
    // 1. Create a temporary folder
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `pptx-import-${importId}-`));

    // 2. Retrieve original PowerPoint file path from storage
    const originalPptxPath = path.join(storageService.uploadDir, pptxImport.storageKey);
    if (!existsSync(originalPptxPath)) {
      throw new Error(`Original PowerPoint file not found in storage at ${originalPptxPath}`);
    }

    const tempPptxPath = path.join(tempDir, "input.pptx");
    await fs.copyFile(originalPptxPath, tempPptxPath);

    // 3. Convert to PDF using LibreOffice headless safely
    const soffice = getSofficePath();
    console.log(`[Worker] Converting PPTX to PDF using ${soffice}...`);
    await execFilePromise(soffice, [
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      tempDir,
      tempPptxPath,
    ]);

    const tempPdfPath = path.join(tempDir, "input.pdf");
    if (!existsSync(tempPdfPath)) {
      throw new Error("LibreOffice conversion failed: PDF file was not generated.");
    }

    // 4. Render PDF pages to PNG images using pdftoppm safely
    const pdftoppm = getPdftoppmPath();
    console.log(`[Worker] Rendering PDF to PNG images using ${pdftoppm}...`);
    await execFilePromise(pdftoppm, [
      "-png",
      "-r",
      "150",
      tempPdfPath,
      path.join(tempDir, "slide"),
    ]);

    // 5. Read temp directory and sort slide image files
    const files = await fs.readdir(tempDir);
    const slideImageFiles = files
      .filter((f) => f.startsWith("slide-") && f.endsWith(".png"))
      .sort((a, b) => {
        const numA = parseInt(a.match(/slide-(\d+)\.png/)[1], 10);
        const numB = parseInt(b.match(/slide-(\d+)\.png/)[1], 10);
        return numA - numB;
      });

    const totalSlidesCount = slideImageFiles.length;
    if (totalSlidesCount === 0) {
      throw new Error("No slides were extracted from the PowerPoint file.");
    }

    console.log(`[Worker] Successfully rendered ${totalSlidesCount} slide images.`);
    pptxImport.totalSlides = totalSlidesCount;
    await pptxImport.save();
    await publishProgress(pptxImport);

    // Check cancellation
    if (await checkCancelled(importId)) {
      await rollbackImport(pptxImport);
      return;
    }

    // 6. Shift positions of existing slides (Idempotent: only run once)
    if (!pptxImport.hasShiftedSlides) {
      console.log(
        `[Worker] Shifting slide positions by ${totalSlidesCount} from position ${pptxImport.targetPosition}...`
      );
      await Slide.updateMany(
        {
          presentationId: pptxImport.presentationId,
          position: { $gte: pptxImport.targetPosition },
        },
        { $inc: { position: totalSlidesCount } }
      );
      pptxImport.hasShiftedSlides = true;
      await pptxImport.save();
    }

    // Check cancellation
    if (await checkCancelled(importId)) {
      await rollbackImport(pptxImport);
      return;
    }

    // 7. Sequentially upload slides to storage and insert into presentation
    for (let index = 0; index < totalSlidesCount; index++) {
      const slideNum = index + 1;
      const slideFilename = slideImageFiles[index];
      const localSlidePath = path.join(tempDir, slideFilename);

      // Check cancellation before processing this slide
      if (await checkCancelled(importId)) {
        await rollbackImport(pptxImport);
        return;
      }

      // Check if PresentationAsset already exists (Retry Safety)
      let asset = await PresentationAsset.findOne({
        importId: pptxImport._id,
        slideNumber: slideNum,
      });

      const destKey = `imports/${pptxImport.presentationId}/${importId}/slide-${slideNum}.png`;

      if (!asset) {
        console.log(`[Worker] Uploading slide image ${slideNum}/${totalSlidesCount}...`);
        await storageService.uploadFile(localSlidePath, destKey);

        asset = await PresentationAsset.create({
          presentationId: pptxImport.presentationId,
          url: storageService.getUrl(destKey),
          storageKey: destKey,
          source: "pptx_import",
          importId: pptxImport._id,
          slideNumber: slideNum,
        });
      }

      // Check if Slide already exists (Idempotency)
      const targetSlidePos = pptxImport.targetPosition + index;
      let slide = await Slide.findOne({
        presentationId: pptxImport.presentationId,
        "metadata.importId": pptxImport._id,
        "metadata.originalSlideNumber": slideNum,
      });

      if (!slide) {
        console.log(
          `[Worker] Creating CONTENT slide for slide ${slideNum}/${totalSlidesCount} at position ${targetSlidePos}...`
        );
        slide = await Slide.create({
          presentationId: pptxImport.presentationId,
          type: "CONTENT",
          position: targetSlidePos,
          question: `Slide ${slideNum}`,
          designSettings: {
            contentImageUrl: asset.url,
            backgroundColor: "#ffffff",
            textColor: "#1a1d29",
          },
          metadata: {
            source: "pptx_import",
            importId: pptxImport._id,
            originalSlideNumber: slideNum,
            assetId: asset._id,
          },
        });
      }

      // Update progress
      pptxImport.processedSlides = slideNum;
      await pptxImport.save();
      await publishProgress(pptxImport);
    }

    // 8. Mark completed
    pptxImport.status = "COMPLETED";
    pptxImport.completedAt = new Date();
    await pptxImport.save();
    await publishProgress(pptxImport);
    console.log(`[Worker] PowerPoint import completed successfully for ${importId}`);

  } catch (error) {
    console.error(`[Worker] Import job failed for ${importId}:`, error.message);

    // Roll back changes to ensure database and presentation state remains consistent
    try {
      await rollbackImport(pptxImport);
    } catch (rollbackErr) {
      console.error(`[Worker] Rollback failed:`, rollbackErr.message);
    }

    pptxImport.status = "FAILED";
    pptxImport.errorInfo = error.message;
    pptxImport.completedAt = new Date();
    await pptxImport.save();
    await publishProgress(pptxImport);
  } finally {
    // 9. Clean up temporary files
    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (err) {
        console.error(`[Worker] Failed to clean up temp dir ${tempDir}:`, err.message);
      }
    }
  }
}

// Connect to MongoDB and run loop
async function startWorker() {
  console.log("[Worker] Connecting to MongoDB...");
  const [connection, error] = await connectMongo(env.MONGO_URI);
  if (error) {
    console.error("[Worker] MongoDB connection failed:", error);
    process.exit(1);
  }
  console.log("[Worker] MongoDB connected.");

  let isShuttingDown = false;

  // Handle graceful shutdowns
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log("[Worker] Shutting down worker process...");
    try {
      await redis.quit();
    } catch (err) {}
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("[Worker] PPTX background worker initialized. Polling for jobs...");
  while (!isShuttingDown) {
    try {
      const job = await redis.brpop("pptx_import_jobs", 2);
      if (job) {
        const importId = job[1];
        await processImport(importId);
      }
    } catch (err) {
      if (err.message && err.message.includes("Connection is closed")) {
        console.error("[Worker] Redis connection lost. Retrying in 5 seconds...");
        await new Promise((resolve) => setTimeout(resolve, 5000));
      } else {
        console.error("[Worker] Error in worker loop:", err);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }
}

startWorker();
