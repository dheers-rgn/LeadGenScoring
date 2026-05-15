import React, { useState } from "react";
import RegenesysLogo from "../assets/RegenesysLogo.jsx";
import { apiPost } from "../api.js";

export default function ForgotPasswordPage({ onGoLogin }) {
  const [step, setStep] = useState("email"); // "email" | "reset"
  const [email, setEmail] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleRequestReset(e) {
    e.preventDefault();
    setError("");
    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }
    setLoading(true);
    try {
      const data = await apiPost("/api/auth/forgot-password", { email: email.trim() });
      if (data.resetToken) {
        // Dev mode: token returned in response
        setResetToken(data.resetToken);
        setSuccess(`Reset token: ${data.resetToken} (use this below, or check your email in production)`);
      } else {
        setSuccess(data.message || "If that email is registered, a reset link has been sent.");
      }
      setStep("reset");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    setError("");
    const token = resetToken || tokenInput.trim();
    if (!token || !password) {
      setError("Reset token and new password are required.");
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
      await apiPost("/api/auth/reset-password", { resetToken: token, password, confirmPassword });
      setSuccess("Password updated successfully. You can now sign in.");
      setTimeout(onGoLogin, 2000);
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
          <h2 className="auth-card-title">
            {step === "email" ? "Forgot Password" : "Reset Password"}
          </h2>
        </div>

        <div className="auth-card-body">
          {error && <div className="form-error">{error}</div>}
          {success && <div className="form-success">{success}</div>}

          {step === "email" ? (
            <form onSubmit={handleRequestReset} noValidate>
              <p style={{ color: "var(--text-muted)", fontSize: "13px", marginTop: 0, marginBottom: "18px" }}>
                Enter the email address associated with your account and we will send you a reset token.
              </p>
              <div className="form-group">
                <label className="form-label" htmlFor="fp-email">Email Address</label>
                <input
                  id="fp-email"
                  className="form-input"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                />
              </div>
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? "Sending…" : "Send Reset Token"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleResetPassword} noValidate>
              {!resetToken && (
                <div className="form-group">
                  <label className="form-label" htmlFor="fp-token">Reset Token</label>
                  <input
                    id="fp-token"
                    className="form-input"
                    type="text"
                    placeholder="Paste reset token here"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                  />
                </div>
              )}
              <div className="form-group">
                <label className="form-label" htmlFor="fp-pw">New Password</label>
                <div className="input-wrap">
                  <input
                    id="fp-pw"
                    className="form-input"
                    type={showPw ? "text" : "password"}
                    placeholder="Min. 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    autoFocus
                  />
                  <button type="button" className="pw-toggle" onClick={() => setShowPw((p) => !p)} tabIndex={-1}>
                    {showPw ? "🙈" : "👁"}
                  </button>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="fp-cpw">Confirm Password</label>
                <input
                  id="fp-cpw"
                  className="form-input"
                  type="password"
                  placeholder="Re-enter new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? "Updating…" : "Reset Password"}
              </button>
            </form>
          )}

          <hr className="divider" />
          <div className="auth-links" style={{ justifyContent: "center" }}>
            <button className="auth-link" type="button" onClick={onGoLogin}>
              ← Back to Sign In
            </button>
          </div>
        </div>
        <div className="accent-bar" />
      </div>
    </div>
  );
}
