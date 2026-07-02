import { NextResponse } from "next/server";
import { getChatReply, type ChatMessage } from "@/lib/chat";

export const maxDuration = 300; // la herramienta buscar_nuevas_empresas corre el pipeline completo

type RequestBody = {
  messages: ChatMessage[];
};

export async function POST(request: Request) {
  let body: RequestBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body, JSON expected." }, { status: 400 });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ ok: false, error: "Missing 'messages' (non-empty array)." }, { status: 400 });
  }

  try {
    const reply = await getChatReply(body.messages);
    return NextResponse.json({ ok: true, reply });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
