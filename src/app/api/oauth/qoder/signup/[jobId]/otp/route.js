import { NextResponse } from "next/server";
import { getQoderSignupBulkImportManager } from "@/lib/oauth/services/qoderSignupBulkImportManager";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  try {
    const { jobId } = await params;
    const body = await request.json();
    const { email, otp } = body || {};

    if (!jobId || !email || !otp) {
      return NextResponse.json(
        { error: "jobId, email, and otp are required" },
        { status: 400 }
      );
    }

    const manager = getQoderSignupBulkImportManager();
    const success = manager.submitManualOtp(jobId, email, otp);

    if (!success) {
      return NextResponse.json(
        { error: "No pending OTP request found for this account/job, or already submitted." },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, message: "OTP submitted successfully" });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to submit OTP" },
      { status: 400 }
    );
  }
}
