
import nodemailer from "nodemailer";

type OtpEmailOptions = {
  email: string;
  name: string;
  code: string;
  purpose: "VERIFY_EMAIL" | "RESET_PASSWORD";
};

function getTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error("SMTP configuration is incomplete.");
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export async function sendOtpEmail({
  email,
  name,
  code,
  purpose,
}: OtpEmailOptions): Promise<void> {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  if (!from) {
    throw new Error("SMTP sender address is missing.");
  }

  const isVerification = purpose === "VERIFY_EMAIL";

  const subject = isVerification
    ? "Verify your PharmaSathi email"
    : "Reset your PharmaSathi password";

  const heading = isVerification
    ? "Verify your email address"
    : "Password reset request";

  const message = isVerification
    ? "Use this verification code to verify your PharmaSathi account."
    : "Use this code to reset your PharmaSathi account password.";

  const transporter = getTransport();

  await transporter.sendMail({
    from: {
      name: "PharmaSathi",
      address: from,
    },
    to: email,
    subject,
    text: `${heading}\n\nHello ${name},\n\n${message}\n\nYour verification code is: ${code}\n\nThis code expires in 10 minutes. Do not share it with anyone.\n\nIf you did not request this, you can ignore this email.\n\nPharmaSathi`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:28px;color:#19352f">
        <h2 style="color:#117a5a">${heading}</h2>
        <p>Hello ${escapeHtml(name)},</p>
        <p>${message}</p>
        <div style="margin:28px 0;padding:18px;text-align:center;background:#effaf4;border-radius:12px">
          <strong style="font-size:32px;letter-spacing:9px;color:#117a5a">${code}</strong>
        </div>
        <p>This code expires in <strong>10 minutes</strong>.</p>
        <p style="color:#78857f;font-size:13px">Never share this code with anyone. If you did not request this, you can ignore this email.</p>
        <hr style="border:0;border-top:1px solid #e7eeea;margin:24px 0" />
        <p style="color:#9aa59f;font-size:12px">PharmaSathi · Pharmacy Management Platform</p>
      </div>
    `,
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[character];
  });
}
