import type { Context, Config } from "@netlify/functions";

const NOTION_VERSION = "2025-09-03";

function extractPageId(urlOrId: string): string | null {
  const match = urlOrId.replace(/-/g, "").match(/([0-9a-f]{32})(?:\?|$)/i);
  return match ? match[1] : null;
}

function richTextToPlain(richText: any[]): string {
  return (richText || []).map((t: any) => t.plain_text ?? t.text?.content ?? "").join("");
}

function parseNumber(text: string): number {
  const digits = (text || "").replace(/[^0-9]/g, "");
  return digits ? parseInt(digits, 10) : 0;
}

async function notionFetch(path: string, token: string) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Notion API error (${res.status})`);
  return data;
}

// Collects every top-level child block of a page/block, following pagination.
async function fetchAllChildren(blockId: string, token: string) {
  let results: any[] = [];
  let cursor: string | undefined;
  do {
    const qs = cursor ? `?start_cursor=${cursor}&page_size=100` : `?page_size=100`;
    const data = await notionFetch(`/blocks/${blockId}/children${qs}`, token);
    results = results.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

export default async (req: Request, context: Context) => {
  const passcode = req.headers.get("x-admin-passcode") || "";
  const expectedPasscode = Netlify.env.get("ADMIN_PASSCODE");
  if (!expectedPasscode || passcode !== expectedPasscode) {
    return new Response(JSON.stringify({ error: "Passcode salah" }), { status: 401 });
  }

  const token = Netlify.env.get("NOTION_TOKEN");
  if (!token) {
    return new Response(JSON.stringify({ error: "NOTION_TOKEN belum di-set di environment variables" }), { status: 500 });
  }

  const url = new URL(req.url);
  const pageUrlParam = url.searchParams.get("pageUrl") || "";
  const pageId = extractPageId(pageUrlParam);
  if (!pageId) {
    return new Response(JSON.stringify({ error: "Link Notion gak valid" }), { status: 400 });
  }

  try {
    const topLevel = await fetchAllChildren(pageId, token);
    const tableBlocks = topLevel.filter((b: any) => b.type === "table");

    if (!tableBlocks.length) {
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }

    // The most recently appended table is the one relevant to continue from
    // (e.g. the Invoice DP's item table, appended after any earlier Quotation).
    const lastTable = tableBlocks[tableBlocks.length - 1];
    const rows = await fetchAllChildren(lastTable.id, token);

    const items = rows
      .slice(1) // drop the header row (SERVICE / PRICE / QTY / TOTAL)
      .map((row: any) => {
        const cells = row.table_row?.cells || [];
        const serviceCellText = richTextToPlain(cells[0] || []);
        const [service, ...rest] = serviceCellText.split("\n");
        const detail = rest.join("\n").trim();
        const price = parseNumber(richTextToPlain(cells[1] || []));
        const qty = parseNumber(richTextToPlain(cells[2] || [])) || 1;
        return { service: (service || "").trim(), detail, price, qty };
      })
      .filter((it) => it.service);

    return new Response(JSON.stringify({ items }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Gagal ambil item dari Notion" }), { status: 500 });
  }
};

export const config: Config = {
  path: "/api/get-invoice-items",
};
