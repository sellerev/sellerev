import { NextRequest, NextResponse } from "next/server";

/**
 * Debug ingest endpoint for logging instrumentation data
 * Accepts POST requests with JSON payloads
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const body = await req.json();
    const { runId } = await params;
    
    // In production, you might want to write to a logging service
    // For now, we just accept the request silently
    // The debug logs are written directly to files in development
    
    return NextResponse.json(
      { success: true, runId, received: true },
      { status: 200 }
    );
  } catch (error) {
    // Silently fail - this is debug instrumentation only
    return NextResponse.json(
      { success: false, error: "Invalid request" },
      { status: 400 }
    );
  }
}

// Reject GET requests (405 Method Not Allowed)
export async function GET() {
  return NextResponse.json(
    { error: "Method not allowed. Use POST." },
    { status: 405 }
  );
}

