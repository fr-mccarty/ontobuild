import app from "@/server/app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handler(request: Request) {
  return app.fetch(request);
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;
