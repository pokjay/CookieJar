import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8083";

async function proxy(request: NextRequest, proxy: string[]) {
  const backendUrl = `${BACKEND_URL}/api/${proxy.join("/")}${request.nextUrl.search}`;

  const isGet = request.method === "GET" || request.method === "HEAD";
  const body = isGet ? undefined : await request.text();

  try {
    const response = await fetch(backendUrl, {
      method: request.method,
      headers: isGet ? undefined : { "Content-Type": "application/json" },
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
