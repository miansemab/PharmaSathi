
import { useState, type FormEvent } from "react";
import "./AuthScreen.css";

type AuthScreenProps = {
  onAuthenticated: (payload: AuthenticatedPayload) => void;
};

type AuthMode =
  | "login"
  | "register"
  | "verify-email"
  | "forgot-password"
  | "reset-password";

type AuthResponse = {
  success?: boolean;
  message?: string;
  code?: string;
  user?: {
    id: string;
    name: string;
    email: string;
    memberships?: Array<{
      role: string;
      pharmacy: {
        id: string;
        name: string;
        slug: string;
      };
    }>;
  };
};

type AuthenticatedPayload = {
  user: NonNullable<AuthResponse["user"]>;
  offline: boolean;
  registeredPharmacies?: string[];
};

export default function AuthScreen({
  onAuthenticated,
}: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>("login");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [otp, setOtp] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  const [pharmacyName, setPharmacyName] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function clearMessages() {
    setError("");
    setSuccess("");
  }

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    clearMessages();
    setPassword("");
    setNewPassword("");
    setOtp("");
    setShowPassword(false);
    setShowNewPassword(false);
  }

  async function postRequest(
    endpoint: string,
    payload: Record<string, string>,
  ): Promise<AuthResponse> {
    let response: Response;

    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(payload),
      });
    } catch (error) {
      const networkError = new Error(
        "Could not reach the PharmaSathi server.",
      );
      networkError.name = "NetworkError";
      throw networkError;
    }

    const result = (await response.json()) as AuthResponse;

    if (!response.ok || result.success === false) {
      const apiError = new Error(
        result.message || "Something went wrong. Please try again.",
      ) as Error & { status?: number };

      apiError.status = response.status;
      throw apiError;
    }

    return result;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    clearMessages();
    setLoading(true);

    try {
      if (mode === "register") {
        try {
          const result = await postRequest("/api/auth/register", {
            name: name.trim(),
            email: email.trim(),
            password,
            pharmacyName: pharmacyName.trim(),
          });

          setOtp("");
          setPassword("");
          setMode("verify-email");

          setSuccess(
            result.message ||
              "Account created. Check your email for the verification code.",
          );
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "";

          // The API may create the account but fail to deliver its first email.
          if (
            message.toLowerCase().includes("account was created")
          ) {
            setPassword("");
            setOtp("");
            setMode("verify-email");
            setSuccess(message);
            return;
          }

          throw err;
        }
      } else if (mode === "login") {
        const result = await postRequest("/api/auth/login", {
          email: email.trim(),
          password,
        });

        if (result.user) {
          let authenticatedUser = result.user;

          try {
            const profileResponse = await fetch("/api/auth/me", {
              credentials: "include",
            });
            if (profileResponse.ok) {
              const profile = (await profileResponse.json()) as AuthResponse;
              if (profile.user) authenticatedUser = profile.user;
            }
          } catch (profileError) {
            console.warn("Could not refresh user profile:", profileError);
          }

          if (Array.isArray(authenticatedUser.memberships)) {
            try {
              const saved = await window.pharmaSathi.saveOfflineAccount({
                email: authenticatedUser.email || email.trim(),
                password,
                user: {
                  ...authenticatedUser,
                  memberships: authenticatedUser.memberships,
                },
              });
              if (!saved.success) {
                console.warn("Offline account could not be saved:", saved.message);
              }
            } catch (saveError) {
              console.warn("Offline account could not be saved:", saveError);
            }
          } else {
            console.warn("Offline cache skipped: pharmacy memberships unavailable.");
          }

          onAuthenticated({ user: authenticatedUser, offline: false });
        }
      } else if (mode === "verify-email") {
        const result = await postRequest("/api/auth/verify-email", {
          email: email.trim(),
          code: otp.trim(),
        });

        setOtp("");
        setMode("login");
        setPassword("");

        setSuccess(
          result.message ||
            "Email verified successfully. You can now sign in.",
        );
      } else if (mode === "forgot-password") {
        const result = await postRequest(
          "/api/auth/forgot-password",
          {
            email: email.trim(),
          },
        );

        setOtp("");
        setMode("reset-password");

        setSuccess(
          result.message ||
            "If your account is eligible, a reset code has been sent to your email.",
        );
      } else if (mode === "reset-password") {
        const result = await postRequest(
          "/api/auth/reset-password",
          {
            email: email.trim(),
            code: otp.trim(),
            newPassword,
          },
        );

        setOtp("");
        setPassword("");
        setNewPassword("");
        setMode("login");

        setSuccess(
          result.message ||
            "Password reset successfully. Please sign in.",
        );
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "";

      if (
        mode === "login" &&
        err instanceof Error &&
        (
          err.name === "NetworkError" ||
          (
            "status" in err &&
            typeof err.status === "number" &&
            err.status >= 500 &&
            err.status <= 599
          )
        )
      ) {
        try {
          const offlineResult =
            await window.pharmaSathi.authenticateOffline({
              email: email.trim(),
              password,
            });

          if (offlineResult.success && offlineResult.user) {
            setSuccess("Offline login successful. Cloud sync will resume when internet is available.");
            onAuthenticated({
              user: offlineResult.user,
              offline: true,
              registeredPharmacies: offlineResult.registeredPharmacies || [],
            });
            return;
          }

          setError(
            offlineResult.message ||
              "Offline login failed. Connect to the internet and try again.",
          );
          return;
        } catch (offlineError) {
          setError(
            offlineError instanceof Error
              ? offlineError.message
              : "Offline login is unavailable on this device.",
          );
          return;
        }
      }

      const needsVerification =
        mode === "login" &&
        /confirm your email|verify your email|email.*not verified|not verified/i.test(
          message,
        );

      if (needsVerification) {
        setPassword("");
        setMode("verify-email");
        setError("");
        setSuccess(
          "Your account exists, but your email is not verified. Request a new verification code below.",
        );
      } else {
        setError(
          message ||
            "Could not connect to PharmaSathi. Check that the API server is running.",
        );
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResendVerification() {
    clearMessages();
    setLoading(true);

    try {
      const result = await postRequest(
        "/api/auth/resend-verification",
        {
          email: email.trim(),
        },
      );

      setSuccess(
        result.message ||
          "If an unverified account exists, a new verification code will be sent.",
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not resend the verification code.",
      );
    } finally {
      setLoading(false);
    }
  }

  const isLogin = mode === "login";
  const isRegister = mode === "register";
  const isVerifyEmail = mode === "verify-email";
  const isForgotPassword = mode === "forgot-password";
  const isResetPassword = mode === "reset-password";

  const showEmailField =
    isLogin ||
    isRegister ||
    isVerifyEmail ||
    isForgotPassword ||
    isResetPassword;

  const showPasswordField = isLogin || isRegister;
  const showOtpField = isVerifyEmail || isResetPassword;

  let eyebrow = "WELCOME BACK";
  let heading = "Sign in to your account";
  let description =
    "Enter your details to continue to your workspace.";

  if (isRegister) {
    eyebrow = "GET STARTED";
    heading = "Create your pharmacy account";
    description =
      "Set up your account to get started with PharmaSathi.";
  } else if (isVerifyEmail) {
    eyebrow = "EMAIL VERIFICATION";
    heading = "Verify your email";
    description =
      "Enter the 6-digit verification code sent to your email address.";
  } else if (isForgotPassword) {
    eyebrow = "ACCOUNT RECOVERY";
    heading = "Forgot your password?";
    description =
      "Enter your registered email address to receive a password reset code.";
  } else if (isResetPassword) {
    eyebrow = "SECURE YOUR ACCOUNT";
    heading = "Reset your password";
    description =
      "Enter the 6-digit reset code from your email and choose a new password.";
  }

  return (
    <main className="auth-page">
      <section className="auth-visual">
        <div className="auth-brand">
          <div className="auth-brand-mark">✚</div>
          <span>PharmaSathi</span>
        </div>

        <div className="auth-hero">
          <span className="auth-eyebrow">
            PHARMACY MANAGEMENT, REIMAGINED
          </span>

          <h1>
            Your pharmacy.
            <br />
            One smarter workspace.
          </h1>

          <p>
            Manage medicines, monitor stock, track expiry dates, and bring
            your pharmacy operations together in one place.
          </p>

          <div className="auth-feature-list">
            <div>
              <span>✓</span>
              <div>
                <strong>Inventory visibility</strong>
                <small>Medicines and batches in one view</small>
              </div>
            </div>

            <div>
              <span>✓</span>
              <div>
                <strong>Stock &amp; expiry awareness</strong>
                <small>Spot important stock issues sooner</small>
              </div>
            </div>

            <div>
              <span>✓</span>
              <div>
                <strong>Built for pharmacy teams</strong>
                <small>A workspace for your daily operations</small>
              </div>
            </div>
          </div>
        </div>

        <div className="auth-visual-footer">
          <span>PHARMACY OPERATIONS PLATFORM</span>
          <span>Simple · Clear · Connected</span>
        </div>
      </section>

      <section className="auth-form-side">
        <div className="auth-form-wrap">
          <div className="auth-mobile-brand">
            <div className="auth-brand-mark">✚</div>
            <span>PharmaSathi</span>
          </div>

          <div className="auth-heading">
            <span className="auth-eyebrow">{eyebrow}</span>
            <h2>{heading}</h2>
            <p>{description}</p>
          </div>

          {(isLogin || isRegister) && (
            <div
              className="auth-mode-switch"
              role="tablist"
              aria-label="Authentication mode"
            >
              <button
                type="button"
                role="tab"
                aria-selected={isLogin}
                className={isLogin ? "active" : ""}
                onClick={() => changeMode("login")}
              >
                Sign in
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={isRegister}
                className={isRegister ? "active" : ""}
                onClick={() => changeMode("register")}
              >
                Create account
              </button>
            </div>
          )}

          {showEmailField && (
            <form className="auth-form" onSubmit={handleSubmit}>
              {isRegister && (
                <>
                  <label htmlFor="auth-name">Your full name</label>
                  <input
                    id="auth-name"
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="e.g. Muhammad Semab"
                    required
                    maxLength={100}
                  />

                  <label htmlFor="auth-pharmacy">Pharmacy name</label>
                  <input
                    id="auth-pharmacy"
                    autoComplete="organization"
                    value={pharmacyName}
                    onChange={(event) =>
                      setPharmacyName(event.target.value)
                    }
                    placeholder="e.g. City Care Pharmacy"
                    required
                    maxLength={120}
                  />
                </>
              )}

              <label htmlFor="auth-email">Email address</label>
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
                maxLength={254}
                readOnly={isVerifyEmail || isResetPassword}
              />

              {showPasswordField && (
                <>
                  <label htmlFor="auth-password">Password</label>

                  <div className="auth-password-wrap">
                    <input
                      id="auth-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete={
                        isLogin ? "current-password" : "new-password"
                      }
                      value={password}
                      onChange={(event) =>
                        setPassword(event.target.value)
                      }
                      placeholder={
                        isRegister
                          ? "At least 12 characters"
                          : "Enter your password"
                      }
                      required
                      minLength={isRegister ? 12 : 1}
                      maxLength={72}
                    />

                    <button
                      className="auth-password-toggle"
                      type="button"
                      onClick={() =>
                        setShowPassword((current) => !current)
                      }
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                      aria-pressed={showPassword}
                    >
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </>
              )}

              {showOtpField && (
                <>
                  <label htmlFor="auth-otp">6-digit verification code</label>
                  <input
                    id="auth-otp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={otp}
                    onChange={(event) =>
                      setOtp(
                        event.target.value.replace(/\D/g, "").slice(0, 6),
                      )
                    }
                    placeholder="Enter 6-digit code"
                    required
                    minLength={6}
                    maxLength={6}
                  />
                </>
              )}

              {isResetPassword && (
                <>
                  <label htmlFor="auth-new-password">New password</label>

                  <div className="auth-password-wrap">
                    <input
                      id="auth-new-password"
                      type={showNewPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(event) =>
                        setNewPassword(event.target.value)
                      }
                      placeholder="At least 12 characters"
                      required
                      minLength={12}
                      maxLength={72}
                    />

                    <button
                      className="auth-password-toggle"
                      type="button"
                      onClick={() =>
                        setShowNewPassword((current) => !current)
                      }
                      aria-label={
                        showNewPassword ? "Hide password" : "Show password"
                      }
                    >
                      {showNewPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </>
              )}

              {isLogin && (
                <div className="auth-extra-actions">
                  <button
                    type="button"
                    onClick={() => changeMode("forgot-password")}
                  >
                    Forgot password?
                  </button>

                  <button
                    type="button"
                    onClick={() => changeMode("verify-email")}
                  >
                    Verify email
                  </button>
                </div>
              )}

              {error && (
                <p className="auth-message auth-error" role="alert">
                  {error}
                </p>
              )}

              {success && (
                <p className="auth-message auth-success" role="status">
                  {success}
                </p>
              )}

              <button
                className="auth-submit"
                type="submit"
                disabled={loading}
              >
                {loading
                  ? "Please wait…"
                  : isLogin
                    ? "Sign in to PharmaSathi →"
                    : isRegister
                      ? "Create pharmacy account →"
                      : isVerifyEmail
                        ? "Verify email →"
                        : isForgotPassword
                          ? "Send reset code →"
                          : "Reset password →"}
              </button>
            </form>
          )}

          {!showEmailField && (
            <form className="auth-form" onSubmit={handleSubmit}>
              {error && (
                <p className="auth-message auth-error" role="alert">
                  {error}
                </p>
              )}

              {success && (
                <p className="auth-message auth-success" role="status">
                  {success}
                </p>
              )}
            </form>
          )}

          {isVerifyEmail && (
            <div className="auth-extra-actions auth-resend">
              <span>Didn't receive the code?</span>
              <button
                type="button"
                onClick={handleResendVerification}
                disabled={loading}
              >
                Resend verification code
              </button>
            </div>
          )}

          {isResetPassword && (
            <div className="auth-extra-actions auth-resend">
              <button
                type="button"
                onClick={() => changeMode("forgot-password")}
                disabled={loading}
              >
                Request another reset code
              </button>
            </div>
          )}

          {isLogin || isRegister ? (
            <p className="auth-switch-copy">
              {isLogin
                ? "New to PharmaSathi?"
                : "Already have an account?"}{" "}
              <button
                type="button"
                onClick={() =>
                  changeMode(isLogin ? "register" : "login")
                }
              >
                {isLogin ? "Create an account" : "Sign in"}
              </button>
            </p>
          ) : (
            <p className="auth-switch-copy">
              Remember your password?{" "}
              <button
                type="button"
                onClick={() => changeMode("login")}
              >
                Back to sign in
              </button>
            </p>
          )}

          <p className="auth-security-note">
            Your session is protected with a secure, HTTP-only cookie.
          </p>
        </div>
      </section>
    </main>
  );
}
