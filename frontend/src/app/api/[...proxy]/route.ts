import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8083";
const API_SECRET = process.env.API_SECRET;

async function proxy(request: NextRequest, proxy: string[]) {
  // Middleware already gates this route; re-check here so the backend secret
  // can never be spent on an unauthenticated request if the matcher changes.
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const backendUrl = `${BACKEND_URL}/api/${proxy.join("/")}${request.nextUrl.search}`;

  const isGet = request.method === "GET" || request.method === "HEAD";
  const body = isGet ? undefined : await request.text();

  const headers: Record<string, string> = {};
  if (!isGet) headers["Content-Type"] = "application/json";
  if (API_SECRET) headers["X-API-Secret"] = API_SECRET;

  try {
    const response = await fetch(backendUrl, {
      method: request.method,
      headers,
      body,
    });
    const text = await response.text();
    try {
      return NextResponse.json(JSON.parse(text), { status: response.status });
    } catch {
      return new NextResponse(text, { status: response.status });
    }
  } catch (err) {
    console.error("[proxy] error:", err);
    return NextResponse.json({ error: "Backend unavailable" }, { status: 503 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ proxy: string[] }> }
) {
  return proxy(request, (await params).proxy);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ proxy: string[] }> }
) {
  return proxy(request, (await params).proxy);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ proxy: string[] }> }
) {
  return proxy(request, (await params).proxy);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ proxy: string[] }> }
) {
  return proxy(request, (await params).proxy);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ proxy: string[] }> }
) {
  return proxy(request, (await params).proxy);
}
