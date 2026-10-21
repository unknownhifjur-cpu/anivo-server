import { Router } from "express";
import { requireAdmin } from "../middleware/requireAdmin.js";

const router = Router();

router.get("/config", requireAdmin, (_request, response) => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET?.trim();

  const missingSettings = [
    ["CLOUDINARY_CLOUD_NAME", cloudName],
    ["CLOUDINARY_UPLOAD_PRESET", uploadPreset],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missingSettings.length) {
    return response.status(503).json({
      error: `Cloudinary unsigned uploads are not configured. Set ${missingSettings.join(", ")} in server/.env and restart the API server.`,
    });
  }

  response.json({ cloudName, uploadPreset });
});

export default router;
