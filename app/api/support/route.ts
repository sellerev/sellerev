import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

/**
 * POST /api/support
 * Submit a support request and send emails via Resend
 */
export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.RESEND_SUPPORT_API_KEY;
    if (!apiKey) {
      console.error("RESEND_SUPPORT_API_KEY is not configured");
      return NextResponse.json(
        { success: false, error: "Email service is not configured" },
        { status: 500 }
      );
    }

    const resend = new Resend(apiKey);
    const body = await req.json();
    const { name, email, subject, message } = body;

    // Validate required fields
    if (!name || !email || !message) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: name, email, message" },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { success: false, error: "Invalid email format" },
        { status: 400 }
      );
    }

    // Format timestamp in UTC
    const now = new Date();
    const utcDate = new Date(now.toISOString());
    const formattedDate = utcDate.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
    const formattedTime = utcDate.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
      timeZone: "UTC",
    });
    const timestamp = `${formattedDate} at ${formattedTime} UTC`;

    // Format email body
    const emailBody = `New Sellerev Support Request



━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Name: ${name}
Email: ${email}${subject ? `\nSubject: ${subject}` : ""}
Message:

${message}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Submitted at: ${timestamp}`;

    // Send internal email to support@sellerev.com
    await resend.emails.send({
      from: "Sellerev Support <noreply@sellerev.com>",
      to: "support@sellerev.com",
      subject: "New Sellerev Support Request",
      text: emailBody,
    });

    // Send auto-reply confirmation email to user
    await resend.emails.send({
      from: "Sellerev Support <support@sellerev.com>",
      to: email,
      subject: "Thanks for contacting Sellerev",
      text: `Thanks for reaching out to Sellerev.\n\nWe've received your message and will respond within 24 hours.\n\n— Sellerev Support`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error sending support email:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to send support request",
      },
      { status: 500 }
    );
  }
}

