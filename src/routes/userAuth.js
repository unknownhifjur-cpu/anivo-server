import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import User from "../models/User.js";
import { hashPassword, isValidPassword, verifyPassword } from "../auth/passwords.js";

const router = Router();

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Try again in 15 minutes." },
});

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isValidEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function regenerateSession(request) {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function saveSession(request) {
  return new Promise((resolve, reject) => {
    request.session.save((error) => (error ? reject(error) : resolve()));
  });
}

router.get("/me", (request, response) => {
  const sessionUser = request.session?.user;
  const user = sessionUser?.role === "user"
    ? { email: sessionUser.email }
    : null;
  response.json({ user });
});

router.post("/signup", authRateLimit, async (request, response, next) => {
  try {
    const email = normalizeEmail(request.body?.email);
    const password = request.body?.password;

    if (!isValidEmail(email)) {
      return response.status(400).json({ error: "Enter a valid email address." });
    }
    if (!isValidPassword(password)) {
      return response.status(400).json({
        error: "Password must be at least 12 characters and no more than 72 UTF-8 bytes.",
      });
    }
    if (email === normalizeEmail(process.env.ADMIN_EMAIL)) {
      return response.status(409).json({ error: "An account with this email cannot be created here." });
    }

    const passwordHash = await hashPassword(password);
    const user = await User.create({ email, passwordHash });
    await regenerateSession(request);
    request.session.user = { email: user.email, role: "user" };
    await saveSession(request);
    response.status(201).json({ user: { email: user.email } });
  } catch (error) {
    if (error?.code === 11000) {
      return response.status(409).json({ error: "An account with this email already exists." });
    }
    next(error);
  }
});

router.post("/login", authRateLimit, async (request, response, next) => {
  try {
    const email = normalizeEmail(request.body?.email);
    const password = request.body?.password;

    if (
      !isValidEmail(email) ||
      typeof password !== "string" ||
      !password ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      return response.status(400).json({ error: "Enter a valid email and password." });
    }
    if (email === normalizeEmail(process.env.ADMIN_EMAIL)) {
      return response.status(401).json({ error: "Email or password is incorrect." });
    }

    const user = await User.findOne({ email }).select("+passwordHash");
    const validPassword = user && await verifyPassword(password, user.passwordHash);
    if (!validPassword) {
      return response.status(401).json({ error: "Email or password is incorrect." });
    }

    await regenerateSession(request);
    request.session.user = { email: user.email, role: "user" };
    await saveSession(request);
    response.json({ user: { email: user.email } });
  } catch (error) {
    next(error);
  }
});

router.post("/logout", async (request, response, next) => {
  try {
    if (request.session) {
      await new Promise((resolve, reject) => {
        request.session.destroy((error) => (error ? reject(error) : resolve()));
      });
    }
    response.clearCookie("anivo.sid", {
      httpOnly: true,
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
