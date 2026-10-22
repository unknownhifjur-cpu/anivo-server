import { Router } from "express";
import Anime from "../models/Anime.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import mongoose from "mongoose";
import { resolveVideoSource } from "../../../shared/videoSource.js";

const router = Router();
const allowedStatuses = ["ongoing", "completed", "upcoming"];

function withLegacyVideoUrl(anime) {
  if (!anime || anime.videoUrl) return anime;
  return {
    ...anime,
    videoUrl: anime.embedUrl || anime.video || anime.video_url || "",
  };
}

function validateAnime(body) {
  const {
    title,
    description,
    genres,
    coverImage,
    videoUrl,
    episodes,
    status,
  } = body ?? {};
  const cleanTitle = typeof title === "string" ? title.trim() : "";
  const cleanDescription = typeof description === "string" ? description.trim() : "";
  const cleanGenres = Array.isArray(genres)
    ? genres
        .filter((genre) => typeof genre === "string")
        .map((genre) => genre.trim())
        .filter(Boolean)
    : [];
  const coverUrl = typeof coverImage === "string" ? coverImage.trim() : "";
  const cleanVideoUrl = typeof videoUrl === "string" ? videoUrl.trim() : "";
  if (videoUrl !== undefined && typeof videoUrl !== "string") {
    return { error: "Video URL must be a string." };
  }
  let coverHost = "";

  try {
    coverHost = new URL(coverUrl).hostname;
  } catch {
    coverHost = "";
  }

  if (!cleanTitle || cleanTitle.length > 120) {
    return { error: "Title is required and must be 120 characters or fewer." };
  }
  if (cleanDescription.length > 1000 || cleanGenres.length > 12) {
    return { error: "Description or genre list exceeds the allowed length." };
  }
  if (cleanGenres.some((genre) => genre.length > 40)) {
    return { error: "Each genre must be 40 characters or fewer." };
  }
  const videoResult = resolveVideoSource(cleanVideoUrl, body?.videoType || "auto", {
    requireHttps: process.env.NODE_ENV === "production",
  });
  if (videoResult.error) return { error: videoResult.error };
  if (
    !coverUrl.startsWith("https://") ||
    coverHost !== "res.cloudinary.com" ||
    !coverUrl.includes("/image/upload/")
  ) {
    return { error: "Upload a cover image to Cloudinary before saving the title." };
  }
  if (status && !allowedStatuses.includes(status)) {
    return { error: "Invalid anime status." };
  }

  const parsedEpisodes = Number(episodes || 0);
  if (!Number.isInteger(parsedEpisodes) || parsedEpisodes < 0) {
    return { error: "Episode count must be a non-negative whole number." };
  }
  return {
    value: {
      title: cleanTitle,
      description: cleanDescription,
      genres: cleanGenres,
      coverImage: coverUrl,
      videoUrl: videoResult.source?.url || "",
      videoProvider: videoResult.source?.provider || "",
      videoType: videoResult.source?.type || "",
      episodes: parsedEpisodes,
      status: status || "upcoming",
    },
  };
}

router.get("/", async (request, response, next) => {
  try {
    const anime = await Anime.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    response.json({ anime: anime.map(withLegacyVideoUrl) });
  } catch (error) {
    next(error);
  }
});

router.get("/manage", requireAdmin, async (_request, response, next) => {
  try {
    const anime = await Anime.find().sort({ createdAt: -1 }).lean();
    response.json({ anime: anime.map(withLegacyVideoUrl) });
  } catch (error) {
    next(error);
  }
});

router.post("/", requireAdmin, async (request, response, next) => {
  try {
    const validated = validateAnime(request.body);
    if (validated.error) return response.status(400).json({ error: validated.error });
    const anime = await Anime.create(validated.value);

    response.status(201).json({ anime });
  } catch (error) {
    next(error);
  }
});

router.put("/:id", requireAdmin, async (request, response, next) => {
  try {
    if (!mongoose.isValidObjectId(request.params.id)) {
      return response.status(400).json({ error: "Invalid catalog item ID." });
    }
    const validated = validateAnime(request.body);
    if (validated.error) return response.status(400).json({ error: validated.error });

    const anime = await Anime.findByIdAndUpdate(request.params.id, validated.value, {
      new: true,
      runValidators: true,
    });
    if (!anime) return response.status(404).json({ error: "Catalog item not found." });
    response.json({ anime });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", requireAdmin, async (request, response, next) => {
  try {
    if (!mongoose.isValidObjectId(request.params.id)) {
      return response.status(400).json({ error: "Invalid catalog item ID." });
    }
    const anime = await Anime.findByIdAndDelete(request.params.id);
    if (!anime) return response.status(404).json({ error: "Catalog item not found." });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
