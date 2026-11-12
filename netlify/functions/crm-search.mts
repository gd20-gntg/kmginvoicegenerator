import type { Context, Config } from "@netlify/functions";

// Cari kontak di CRM yang ada di akun/workspace Notion LAIN.
// Butuh env var CRM_NOTION_TOKEN (token integration di workspace CRM, yang sudah
// di-connect ke database kontak). Opsional: CRM_DATA_SOURCE_ID untuk membatasi
// hasil ke satu database kontak saja.
const NOTION_VERSION = "2025-09-03";

function plain(rich: any[]): string {
  return (rich || []).map((t: any) => t.plain_text ?? "").join("").trim();
}

function readContact(page: any) {
  const props = page.properties || {};
  let name = "";
  let phone = "";
  let fallbackPhone = "";
  for (const [key, prop] of Object.entries<any>(props)) {
    if (prop.type === "title") name = plain(prop.title);
    else if (prop.type === "phone_number" && prop.phone_number) phone = phone || prop.phone_number;
    else if (prop.type === "rich_text" && /(hp|wa|whatsapp|phone|telp|telepon)/i.test(key)) {
      fallbackPhone = fallbackPhone || plain(prop.rich_text);
    }
  }
  return { name, phone: phone || fallbackPhone, url: page.url };
}

export default async (req: Request, context: Context) => {
  const passcode = req.headers.get("x-admin-passcode") || "";
  const expectedPasscode = Netlify.env.get("ADMIN_PASSCODE");
  if (!expectedPasscode || passcode !== expectedPasscode) {
    return new Response(JSON.stringify({ error: "Passcode salah" }), { status: 401 });
  }

  const token = Netlify.env.get("CRM_NOTION_TOKEN");
  if (!token) {
    return new Response(JSON.stringify({ enabled: false, contacts: [] }), { status: 200 });
  }
  const dataSourceId = (Netlify.env.get("CRM_DATA_SOURCE_ID") || "").replace(/-/g, "");

  const q = (new URL(req.url).searchParams.get("q") || "").trim();
  if (!q) {
    return new Response(JSON.stringify({ enabled: true, contacts: [] }), { status: 200 });
  }

  try {
    const res = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: q, filter: { property: "object", value: "page" }, page_size: 20 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || `Notion API error (${res.status})`);

    const contacts = (data.results || [])
      .filter((p: any) => {
        if (!dataSourceId) return p.parent?.type === "data_source_id" || p.parent?.type === "database_id";
        const parentId = String(p.parent?.data_source_id || p.parent?.database_id || "").replace(/-/g, "");
        return parentId === dataSourceId;
      })
      .map(readContact)
      .filter((c: any) => c.name)
      .slice(0, 8);

    return new Response(JSON.stringify({ enabled: true, contacts }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Gagal mencari di CRM" }), { status: 500 });
  }
};

export const config: Config = {
  path: "/api/crm-search",
};
