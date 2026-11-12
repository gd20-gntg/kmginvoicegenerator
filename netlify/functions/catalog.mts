import type { Context, Config } from "@netlify/functions";

// Katalog produk disimpan sebagai simple table di halaman Notion
// "Katalog Produk Invoice" (bukan database). Kolom: Brand | Nama Produk | Harga | Kategori Kelas | Detail
const NOTION_VERSION = "2025-09-03";
const TABLE_WIDTH = 5;

async function notionFetch(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Notion API error (${res.status})`);
  return data;
}

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

function cellText(cell: any[]): string {
  return (cell || []).map((t: any) => t.plain_text ?? t.text?.content ?? "").join("").trim();
}

function cell(content: string) {
  return content ? [{ type: "text", text: { content } }] : [];
}

async function findTable(pageId: string, token: string) {
  const children = await fetchAllChildren(pageId, token);
  const table = children.find((b: any) => b.type === "table");
  if (!table) throw new Error("Tabel katalog tidak ditemukan di halaman Katalog Produk Invoice");
  return table;
}

export default async (req: Request, context: Context) => {
  const passcode = req.headers.get("x-admin-passcode") || "";
  const expectedPasscode = Netlify.env.get("ADMIN_PASSCODE");
  if (!expectedPasscode || passcode !== expectedPasscode) {
    return new Response(JSON.stringify({ error: "Passcode salah" }), { status: 401 });
  }

  const token = Netlify.env.get("NOTION_TOKEN");
  const pageId = Netlify.env.get("NOTION_CATALOG_PAGE_ID") || "416ca0f3-d681-81fb-b7c2-f4679af904e8";
  if (!token) {
    return new Response(JSON.stringify({ error: "NOTION_TOKEN belum di-set di environment variables" }), { status: 500 });
  }

  try {
    const table = await findTable(pageId, token);

    if (req.method === "GET") {
      const rows = await fetchAllChildren(table.id, token);
      const dataRows = table.table?.has_column_header ? rows.slice(1) : rows;
      const products = dataRows
        .map((row: any) => {
          const cells = row.table_row?.cells || [];
          return {
            brand: cellText(cells[0]),
            name: cellText(cells[1]),
            price: parseInt(cellText(cells[2]).replace(/[^0-9]/g, "") || "0", 10),
            category: cellText(cells[3]),
            detail: cellText(cells[4]),
          };
        })
        .filter((p: any) => p.name);
      return new Response(JSON.stringify({ products }), { status: 200 });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const brand = body.brand === "Omoji" ? "Omoji" : body.brand === "Melanao" ? "Melanao" : "";
      const name = String(body.name || "").trim();
      const price = Math.round(Number(body.price) || 0);
      const category = brand === "Omoji" ? String(body.category || "").trim() : "";
      const detail = String(body.detail || "").trim();
      if (!brand || !name || price <= 0) {
        return new Response(JSON.stringify({ error: "Brand, nama produk, dan harga wajib diisi" }), { status: 400 });
      }
      const width = table.table?.table_width || TABLE_WIDTH;
      const cells = [cell(brand), cell(name), cell(String(price)), cell(category), cell(detail)].slice(0, width);
      while (cells.length < width) cells.push([]);
      await notionFetch(`/blocks/${table.id}/children`, token, {
        method: "PATCH",
        body: JSON.stringify({ children: [{ object: "block", type: "table_row", table_row: { cells } }] }),
      });
      return new Response(JSON.stringify({ ok: true, product: { brand, name, price, category, detail } }), { status: 200 });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Gagal mengakses katalog" }), { status: 500 });
  }
};

export const config: Config = {
  path: "/api/catalog",
};
