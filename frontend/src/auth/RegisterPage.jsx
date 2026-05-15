import React, { useState } from "react";
import RegenesysLogo from "../assets/RegenesysLogo.jsx";
import { apiPost } from "../api.js";

export default function RegisterPage({ onLogin, onGoLogin }) {
  const [form, setForm] = useState({ name: "", email: "", username: "", password: "", confirmPassword: "" });
  const [showPw, setShowPw] = useState(false);
  const [showCPw, setShowCPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function set(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const { name, email, username, password, confirmPassword } = form;
    if (!name.trim() || !email.trim() || !username.trim() || !password) {
      setError("All fields are required.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    try {
      const data = await apiPost("/api/auth/register", { name: name.trim(), email: email.trim(), username: username.trim(), password, confirmPassword });
      localStorage.setItem("rgs_token", data.token);
      localStorage.setItem("rgs_user", JSON.stringify(data.user));
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="corner-circle-tl" />
      <div className="corner-circle-tr" />

      <div className="brand-header">
        <div className="brand-logo">
          <RegenesysLogo size={72} />
        </div>
        <div className="brand-name">Regenesys</div>
        <div className="brand-subtitle">Business School</div>
      </div>

      <div className="auth-card auth-card-wide">
        <div className="auth-card-header">
          <h2 className="auth-card-title">Create Account</h2>
        </div>

        <div className="auth-card-body">
          {error && <div className="form-error">{error}</div>}

          <form onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label className="form-label" htmlFor="reg-name">Full Name</label>
              <input
                id="reg-name"
                className="form-input"
                type="text"
                placeholder="Enter your full name"
                value={form.name}
                onChange={set("name")}
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="reg-email">Email Address</label>
              <input
                id="reg-email"
                className="form-input"
                type="email"
                placeholder="Enter your email"
                value={form.email}
                onChange={set("email")}
                autoComplete="email"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="reg-username">Desired Username</label>
              <input
                id="reg-username"
                className="form-input"
                type="text"
                placeholder="Choose a username"
                value={form.username}
                onChange={set("username")}
                autoComplete="username"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="reg-pw">Password</label>
              <div className="input-wrap">
                <input
                  id="reg-pw"
                  className="form-input"
                  type={showPw ? "text" : "password"}
                  placeholder="Min. 8 characters"
                  value={form.password}
                  onChange={set("password")}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="pw-toggle"
                  onClick={() => setShowPw((p) => !p)}
                  tabIndex={-1}
                >
                  {showPw ? "🙈" : "👁"}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="reg-cpw">Confirm Password</label>
              <div className="input-wrap">
                <input
                  id="reg-cpw"
                  className="form-input"
                  type={showCPw ? "text" : "password"}
                  placeholder="Re-enter your password"
                  value={form.confirmPassword}
                  onChange={set("confirmPassword")}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="pw-toggle"
                  onClick={() => setShowCPw((p) => !p)}
                  tabIndex={-1}
                >
                  {showCPw ? "🙈" : "👁"}
                </button>
              </div>
            </div>

            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? "Registering…" : "Register"}
            </button>
          </form>

          <div className="auth-links">
            <span style={{ color: "var(--text-muted)" }}>Already have an account?</span>
            <button className="auth-link" type="button" onClick={onGoLogin}>
              Sign in here
            </button>
          </div>
        </div>
        <div className="accent-bar" />
      </div>
    </div>
  );
}
