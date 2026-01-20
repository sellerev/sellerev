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

    // Send internal email to support@sellerev.com (CRITICAL - must succeed)
    let supportEmailSent = false;
    try {
      const supportEmailResult = await resend.emails.send({
        from: "Sellerev Support <noreply@sellerev.com>",
        to: "support@sellerev.com",
        replyTo: email, // Allow support to reply directly to the user
        subject: "New Sellerev Support Request",
        text: emailBody,
      });
      supportEmailSent = true;
      console.log("Support email sent successfully to support@sellerev.com:", {
        result: supportEmailResult,
      });
    } catch (error) {
      console.error("CRITICAL: Failed to send email to support@sellerev.com:", error);
      // Re-throw to fail the request - support email MUST be sent
      throw new Error(`Failed to send support email: ${error instanceof Error ? error.message : "Unknown error"}`);
    }

    // Send auto-reply confirmation email to user (non-critical - log but don't fail)
    try {
      await resend.emails.send({
        from: "Sellerev Support <support@sellerev.com>",
        to: email,
        subject: "Thanks for contacting Sellerev",
        text: `Thanks for reaching out to Sellerev.\n\nWe've received your message and will respond within 24 hours.\n\n— Sellerev Support`,
      });
      console.log("Confirmation email sent successfully to user");
    } catch (error) {
      // Log but don't fail - confirmation email failure shouldn't block support email
      console.error("Warning: Failed to send confirmation email to user:", error);
    }

    if (!supportEmailSent) {
      throw new Error("Support email was not sent successfully");
    }

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

