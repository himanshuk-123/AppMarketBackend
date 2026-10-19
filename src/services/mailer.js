// Transactional email via Brevo's HTTP API (works on hosts that block SMTP ports).
// Without BREVO_API_KEY the email is printed to the console so local dev still works.
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

const sendEmail = async ({ to, subject, html, text }) => {
  if (!process.env.BREVO_API_KEY) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Email is not configured — set BREVO_API_KEY and MAIL_FROM_EMAIL');
    }
    console.log(`\n[mail:dev] to=${to} subject="${subject}"\n${text}\n`);
    return;
  }

  const res = await fetch(BREVO_URL, {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: {
        email: process.env.MAIL_FROM_EMAIL,
        name: process.env.MAIL_FROM_NAME || 'Appure',
      },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Email send failed (${res.status}): ${body.slice(0, 200)}`);
  }
};

const codeEmail = ({ heading, intro, code, minutes }) => ({
  text: `${heading}\n\n${intro}\n\nYour code: ${code}\n\nIt expires in ${minutes} minutes. ` +
    `If you didn't request this, you can ignore this email.`,
  html: `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f4f4f7;font-family:Arial,sans-serif;">
  <div style="max-width:440px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;">
    <div style="font-size:22px;font-weight:800;color:#6C63FF;margin-bottom:20px;">Appure</div>
    <div style="font-size:18px;font-weight:700;color:#111;margin-bottom:8px;">${heading}</div>
    <div style="font-size:14px;color:#444;line-height:1.5;margin-bottom:20px;">${intro}</div>
    <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#111;background:#f0efff;border-radius:10px;padding:16px;text-align:center;">${code}</div>
    <div style="font-size:12px;color:#777;margin-top:20px;line-height:1.5;">This code expires in ${minutes} minutes.
      If you didn't request it, you can safely ignore this email.</div>
  </div></body></html>`,
});

module.exports = { sendEmail, codeEmail };
