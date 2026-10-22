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
const corsOrigins = new Set([
  "https://anivo-anime.vercel.app",
  "https://anivo-admin.vercel.app",
  "https://anivo-server.onrender.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  ...(process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
]);
let databaseReady = false;
let userSession;
let adminSession;
let server;

app.use((request, response, next) => {
  const origin = request.get("Origin");
  response.vary("Origin");

  if (origin && corsOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
  }

  if (request.method === "OPTIONS" && origin) {
    if (!corsOrigins.has(origin)) {
      return response.status(403).json({ error: "Origin is not allowed." });
    }
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    response.setHeader("Access-Control-Max-Age", "600");
    return response.status(204).end();
  }

  next();
});

app.use(express.json());

app.get("/api/health", (_request, response) => {
  const databaseState = mongoose.connection.readyState;
  const configurationReady = Boolean(
    process.env.MONGODB_URI &&
      process.env.SESSION_SECRET &&
      process.env.SESSION_SECRET.length >= 32
  );
  response.json({
    status: databaseReady && configurationReady ? "ok" : "degraded",
    database:
      databaseState === 1 ? "connected" : databaseState === 2 ? "connecting" : "disconnected",
    configuration: configurationReady ? "complete" : "incomplete",
  });
});

app.use("/api", (_request, response, next) => {
  if (!databaseReady) {
    return response
      .status(503)
      .json({ error: "The API is temporarily unavailable while the database reconnects." });
  }
  next();
});

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

app.use(
  "/api/auth/user",
  (request, response, next) => userSession(request, response, next),
  userAuthRouter
);
app.use(
  "/api/auth",
  (request, response, next) => adminSession(request, response, next),
  authRouter
);
app.use(
  "/api/anime",
  (request, response, next) => adminSession(request, response, next),
  animeRouter
);
app.use(
  "/api/uploads",
  (request, response, next) => adminSession(request, response, next),
  uploadsRouter
);
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

const retryDelay = (attempt) => Math.min(1000 * (2 ** Math.min(attempt, 5)), 30_000);

async function connectDatabase() {
  let attempt = 0;
  while (!databaseReady) {
    try {
      await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
      if (!userSession) {
        userSession = createSessionMiddleware("anivo.sid", "sessions");
        adminSession = createSessionMiddleware("anivo.admin.sid", "admin_sessions");
      }
      databaseReady = true;
      console.log("MongoDB connected; API routes are ready.");
      return;
    } catch (error) {
      attempt += 1;
      console.error("MongoDB connection failed; retrying.", {
        name: error.name,
        code: error.code,
        retryInMs: retryDelay(attempt),
      });
      await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt)));
    }
  }
}

mongoose.connection.on("disconnected", () => {
  if (databaseReady) {
    databaseReady = false;
    console.error("MongoDB disconnected; database-dependent API requests are paused.");
  }
});

mongoose.connection.on("connected", () => {
  if (userSession && adminSession) {
    databaseReady = true;
  }
});

mongoose.connection.on("error", (error) => {
  console.error("MongoDB connection error.", { name: error.name, code: error.code });
});

async function startServer() {
  const sessionSecretConfigured =
    Boolean(process.env.SESSION_SECRET) && process.env.SESSION_SECRET.length >= 32;
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI is missing; the API will remain in degraded mode until configured.");
  }
  if (!sessionSecretConfigured) {
    console.error("SESSION_SECRET is missing or too short; authenticated API routes will remain unavailable.");
  }
  if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }

  server = app.listen(port, host);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", resolve);
  });
  server.on("error", (error) => {
    console.error("AnivoAnime API server error:", error.message);
  });
  console.log(`AnivoAnime API listening on http://${host}:${port}`);

  if (process.env.MONGODB_URI && sessionSecretConfigured) {
    void connectDatabase();
  }
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
  process.exitCode = 1;
});
