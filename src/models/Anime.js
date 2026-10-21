import mongoose from "mongoose";

const animeSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    genres: {
      type: [String],
      default: [],
    },
    coverImage: {
      type: String,
      default: "",
      trim: true,
    },
    videoUrl: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2000,
    },
    episodes: {
      type: Number,
      min: 0,
      default: 0,
    },
    status: {
      type: String,
      enum: ["ongoing", "completed", "upcoming"],
      default: "upcoming",
    },
  },
  { timestamps: true }
);

export default mongoose.model("Anime", animeSchema);
