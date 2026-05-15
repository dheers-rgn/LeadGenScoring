import React, { useState } from "react";
import RegenesysLogo from "../assets/RegenesysLogo.jsx";
import { apiPost } from "../api.js";

export default function LoginPage({ onLogin, onGoRegister, onGoForgot }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!login.trim() || !password) {
      setError("Please enter your email/username and password.");
      return;
    }
    setLoading(true);
    try {
      const data = await apiPost("/api/auth/login", { login: login.trim(), password });
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

      <div className="auth-card">
        <div className="auth-card-header">
          <h2 className="auth-card-title">Sign In</h2>
        </div>

        <div className="auth-card-body">
          {error && <div className="form-error">{error}</div>}

          <form onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label className="form-label" htmlFor="login-id">Email or Username</label>
              <input
                id="login-id"
                className="form-input"
                type="text"
                placeholder="Enter email or username"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                autoComplete="username"
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="login-pw">Password</label>
              <div className="input-wrap">
                <input
                  id="login-pw"
                  className="form-input"
                  type={showPw ? "text" : "password"}
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="pw-toggle"
                  onClick={() => setShowPw((p) => !p)}
                  tabIndex={-1}
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? "🙈" : "👁"}
                </button>
              </div>
            </div>

            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>

          <div className="auth-links">
            <button className="auth-link" type="button" onClick={onGoRegister}>
              Create an account
            </button>
            <button className="auth-link" type="button" onClick={onGoForgot}>
              Forgot password?
            </button>
          </div>
        </div>
        <div className="accent-bar" />
      </div>
    </div>
  );
}
