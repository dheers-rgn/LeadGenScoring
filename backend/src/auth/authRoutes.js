import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";

const router = Router();
const SALT_ROUNDS = 12;

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET env variable is required");
  return s;
}

function makeToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, email: user.email },
    getSecret(),
    { expiresIn: "24h" },
  );
}

export function authRoutes(pool) {
  // POST /api/auth/register
  router.post("/register", async (req, res) => {
    const { name, email, username, password, confirmPassword } = req.body ?? {};
    if (!name || !email || !username || !password) {
      return res.status(400).json({ ok: false, error: "name, email, username and password are required." });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ ok: false, error: "Passwords do not match." });
    }
    if (password.length < 8) {
      return res.status(400).json({ ok: false, error: "Password must be at least 8 characters." });
    }
    try {
      const [existing] = await pool.query(
        "SELECT id FROM users WHERE email = ? OR username = ? LIMIT 1",
        [email.trim().toLowerCase(), username.trim().toLowerCase()],
      );
      if (existing.length) {
        return res.status(409).json({ ok: false, error: "Email or username already registered." });
      }
      const hash = await bcrypt.hash(password, SALT_ROUNDS);
      const [result] = await pool.query(
        "INSERT INTO users (name, email, username, password_hash) VALUES (?, ?, ?, ?)",
        [name.trim(), email.trim().toLowerCase(), username.trim().toLowerCase(), hash],
      );
      const user = { id: result.insertId, username: username.trim().toLowerCase(), email: email.trim().toLowerCase() };
      return res.status(201).json({ ok: true, token: makeToken(user), user: { id: user.id, name: name.trim(), email: user.email, username: user.username } });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // POST /api/auth/login
  router.post("/login", async (req, res) => {
    const { login, password } = req.body ?? {};
    if (!login || !password) {
      return res.status(400).json({ ok: false, error: "Login (email or username) and password are required." });
    }
    try {
      const key = login.trim().toLowerCase();
      const [rows] = await pool.query(
        "SELECT id, name, email, username, password_hash FROM users WHERE email = ? OR username = ? LIMIT 1",
        [key, key],
      );
      if (!rows.length) {
        return res.status(401).json({ ok: false, error: "Invalid credentials." });
      }
      const user = rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ ok: false, error: "Invalid credentials." });
      }
      return res.json({ ok: true, token: makeToken(user), user: { id: user.id, name: user.name, email: user.email, username: user.username } });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // POST /api/auth/forgot-password
  router.post("/forgot-password", async (req, res) => {
    const { email } = req.body ?? {};
    if (!email) {
      return res.status(400).json({ ok: false, error: "Email is required." });
    }
    try {
      const [rows] = await pool.query(
        "SELECT id FROM users WHERE email = ? LIMIT 1",
        [email.trim().toLowerCase()],
      );
      if (!rows.length) {
        // Don't reveal whether email exists
        return res.json({ ok: true, message: "If that email is registered, a reset token has been generated." });
      }
      const token = crypto.randomBytes(32).toString("hex");
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await pool.query(
        "UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?",
        [token, expires, rows[0].id],
      );
      // In production send via email; for now return token in response for development use
      return res.json({ ok: true, message: "Reset token generated.", resetToken: token });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // POST /api/auth/reset-password
  router.post("/reset-password", async (req, res) => {
    const { resetToken, password, confirmPassword } = req.body ?? {};
    if (!resetToken || !password) {
      return res.status(400).json({ ok: false, error: "resetToken and password are required." });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ ok: false, error: "Passwords do not match." });
    }
    if (password.length < 8) {
      return res.status(400).json({ ok: false, error: "Password must be at least 8 characters." });
    }
    try {
      const [rows] = await pool.query(
        "SELECT id FROM users WHERE reset_token = ? AND reset_token_expires > NOW() LIMIT 1",
        [resetToken],
      );
      if (!rows.length) {
        return res.status(400).json({ ok: false, error: "Invalid or expired reset token." });
      }
      const hash = await bcrypt.hash(password, SALT_ROUNDS);
      await pool.query(
        "UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?",
        [hash, rows[0].id],
      );
      return res.json({ ok: true, message: "Password updated successfully." });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  return router;
}
