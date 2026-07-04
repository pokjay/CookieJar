import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8083";
const API_SECRET = process.env.API_SECRET;

// All browser traffic reaches the backend through this server-side proxy, so
// request.client.host on the FastAPI side is always this Next.js container's
// IP unless we forward the real one. Prefer the first hop of an incoming
// X-Forwarded-For (set by a load balancer/reverse proxy in front of Next.js),
// falling back to NextRequest's own remote-address field when available.
function clientIp(request: NextRequest): string | undefined {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  // NextRequest.ip was removed in newer Next.js versions but some runtimes
  // (or middleware) still populate it; read it defensively.
  return (request as unknown as { ip?: string }).ip;
}

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
  const ip = clientIp(request);
  if (ip) headers["X-Forwarded-For"] = ip;

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
