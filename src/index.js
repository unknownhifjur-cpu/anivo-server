import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import session from "express-session";
import MongoStore from "connect-mongo";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import authRouter from "./routes/auth.js";
import userAuthRouter from "./routes/userAuth.js";
import animeRouter from "./routes/anime.js";
import uploadsRouter from "./routes/uploads.js";

const app = express();
const port = Number(process.env.PORT) || 4000;
const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const clientBuildPath = resolve(projectRoot, "client", "dist");
const adminBuildPath = resolve(projectRoot, "Admin", "dist");
const corsOrigins = new Set(
  (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);
let isReady = false;
let server;

app.use((request, response, next) => {
  const origin = request.get("Origin");
  if (!origin || corsOrigins.size === 0) {
    return next();
  }
  if (!corsOrigins.has(origin)) {
    return response.status(403).json({ error: "Origin is not allowed." });
  }

  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.vary("Origin");
  if (request.method === "OPTIONS") {
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return response.status(204).end();
  }
  next();
});

app.use((_request, response, next) => {
  if (!isReady) {
    return response.status(503).json({ error: "The API is starting up." });
  }
  next();
});
app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
});

async function startServer() {
  if (!process.env.MONGODB_URI) {
    throw new Error(
      "MONGODB_URI is missing. Add your MongoDB connection string to server/.env."
    );
  }
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error(
      "SESSION_SECRET must be at least 32 characters. Generate one with node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"."
    );
  }

  server = app.listen(port, host);
  let listenError;
  try {
    await new Promise((resolve, reject) => {
      listenError = reject;
      server.once("error", listenError);
      server.once("listening", resolve);
    });
  } catch (error) {
    server.removeListener("error", listenError);
    throw error;
  }
  server.removeListener("error", listenError);
  server.on("error", (error) => {
    isReady = false;
    console.error("AnivoAnime API server error:", error.message);
  });

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("MongoDB connected successfully.");
  if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }

  const createSessionMiddleware = (name, collectionName) =>
    session({
      name,
      secret: process.env.SESSION_SECRET,
      store: MongoStore.create({
        client: mongoose.connection.getClient(),
        collectionName,
        ttl: 7 * 24 * 60 * 60,
      }),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    });
  const userSession = createSessionMiddleware("anivo.sid", "sessions");
  const adminSession = createSessionMiddleware("anivo.admin.sid", "admin_sessions");

  app.use("/api/auth/user", userSession, userAuthRouter);
  app.use("/api/auth", adminSession, authRouter);
  app.use("/api/anime", adminSession, animeRouter);
  app.use("/api/uploads", adminSession, uploadsRouter);
  app.use(
    "/admin",
    express.static(adminBuildPath, {
      index: false,
      maxAge: "1h",
    })
  );
  app.use(
    express.static(clientBuildPath, {
      index: false,
      maxAge: "1h",
    })
  );
  app.get(/^\/admin(?:\/.*)?$/, (_request, response) => {
    response.sendFile(resolve(adminBuildPath, "index.html"));
  });
  app.get("*", (request, response, next) => {
    if (request.path === "/api" || request.path.startsWith("/api/")) {
      return next();
    }
    response.sendFile(resolve(clientBuildPath, "index.html"));
  });
  app.use((error, _request, response, _next) => {
    console.error("API request failed:", error);
    response.status(500).json({ error: "The request could not be completed." });
  });
  isReady = true;
  console.log(`AnivoAnime API listening on http://${host}:${port}`);
}

startServer().catch(async (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${port} is already in use. Stop the existing API server or set a different PORT in server/.env.`
    );
  } else {
    console.error("Could not start AnivoAnime API:", error.message);
  }
  if (server?.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
  try {
    await mongoose.disconnect();
  } catch (disconnectError) {
    console.error("Could not disconnect MongoDB after startup failure:", disconnectError.message);
  }
  process.exitCode = 1;
});
