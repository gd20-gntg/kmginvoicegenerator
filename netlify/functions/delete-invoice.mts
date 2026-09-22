import type { Context, Config } from "@netlify/functions";

const NOTION_VERSION = "2025-09-03";

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const passcode = req.headers.get("x-admin-passcode") || "";
  const expectedPasscode = Netlify.env.get("ADMIN_PASSCODE");
  if (!expectedPasscode || passcode !== expectedPasscode) {
    return new Response(JSON.stringify({ error: "Passcode salah" }), { status: 401 });
  }

  const token = Netlify.env.get("NOTION_TOKEN");
  if (!token) {
    return new Response(JSON.stringify({ error: "NOTION_TOKEN belum di-set di environment variables" }), { status: 500 });
  }

  let payload: { pageId?: string };
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Payload tidak valid" }), { status: 400 });
  }

  if (!payload.pageId) {
    return new Response(JSON.stringify({ error: "pageId wajib diisi" }), { status: 400 });
  }

  try {
    // "archived: true" moves the page to Notion's Trash — reversible from
    // there, unlike a true permanent delete, so this is the safer option.
    const res = await fetch(`https://api.notion.com/v1/pages/${payload.pageId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ archived: true }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || `Notion API error (${res.status})`);

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Gagal menghapus invoice di Notion" }), { status: 500 });
  }
};

export const config: Config = {
  path: "/api/delete-invoice",
};
