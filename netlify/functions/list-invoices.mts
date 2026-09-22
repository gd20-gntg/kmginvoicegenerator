import type { Context, Config } from "@netlify/functions";

const NOTION_VERSION = "2025-09-03";

function pad(n: number) { return String(n).padStart(2, "0"); }

function monthRange(year: number, month: number) {
  // month is 1-12
  const start = `${year}-${pad(month)}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const end = `${nextYear}-${pad(nextMonth)}-01`;
  return { start, end };
}

function readNumber(prop: any): number {
  if (!prop) return 0;
  if (prop.type === "number") return prop.number || 0;
  if (prop.type === "formula" && prop.formula?.type === "number") return prop.formula.number || 0;
  return 0;
}
function readText(prop: any): string {
  if (!prop) return "";
  if (prop.type === "formula" && prop.formula?.type === "string") return prop.formula.string || "";
  if (prop.type === "rich_text") return (prop.rich_text || []).map((t: any) => t.plain_text).join("");
  return "";
}
function readSelect(prop: any): string {
  return prop?.select?.name || "";
}
function readCheckbox(prop: any): boolean {
  return !!prop?.checkbox;
}
function readDate(prop: any): string | null {
  return prop?.date?.start || null;
}
function readTitle(prop: any): string {
  return (prop?.title || []).map((t: any) => t.plain_text).join("");
}

export default async (req: Request, context: Context) => {
  const passcode = req.headers.get("x-admin-passcode") || "";
  const expectedPasscode = Netlify.env.get("ADMIN_PASSCODE");
  if (!expectedPasscode || passcode !== expectedPasscode) {
    return new Response(JSON.stringify({ error: "Passcode salah" }), { status: 401 });
  }

  const token = Netlify.env.get("NOTION_TOKEN");
  const dataSourceId = Netlify.env.get("NOTION_DATA_SOURCE_ID") || "2e2ca0f3-d681-80fc-b823-000b45bfb140";
  if (!token) {
    return new Response(JSON.stringify({ error: "NOTION_TOKEN belum di-set di environment variables" }), { status: 500 });
  }

  const url = new URL(req.url);
  const now = new Date();
  const year = Number(url.searchParams.get("year")) || now.getUTCFullYear();
  const month = Number(url.searchParams.get("month")) || now.getUTCMonth() + 1;
  const { start, end } = monthRange(year, month);

  try {
    const res = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filter: {
          and: [
            { property: "Invoice Date", date: { on_or_after: start } },
            { property: "Invoice Date", date: { before: end } },
          ],
        },
        sorts: [{ property: "Invoice Date", direction: "ascending" }],
        page_size: 100,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || `Notion API error (${res.status})`);

    const invoices = (data.results || []).map((page: any) => {
      const p = page.properties;
      const invoiceAmount = readNumber(p["Invoice Amount"]);
      const additionalFee = readNumber(p["Additional Fee"]);
      const total = readNumber(p["Total Invoice Amount"]) || invoiceAmount + additionalFee;
      const dpStatus = readCheckbox(p["DP Status"]);
      const pelunasanStatus = readCheckbox(p["Pelunasan Status"]);
      const status = readText(p["Status Invoice"]) || (pelunasanStatus ? "Lunas" : dpStatus ? "DP Masuk" : "Belum Bayar");
      return {
        id: page.id,
        name: readTitle(p["Invoice Name"]),
        brand: readSelect(p["Brand"]),
        invoiceDate: readDate(p["Invoice Date"]),
        dueDate: readDate(p["Due Date"]),
        dpDate: readDate(p["DP Date"]),
        fullPaymentDate: readDate(p["Full Payment Date"]),
        invoiceAmount,
        additionalFee,
        total,
        dpAmount: readNumber(p["DP Amount"]),
        dpStatus,
        pelunasanStatus,
        status,
        metodePembayaran: readSelect(p["Metode Pembayaran"]),
        url: page.url,
      };
    });

    return new Response(JSON.stringify({ ok: true, year, month, invoices }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Gagal mengambil data dari Notion" }), { status: 500 });
  }
};

export const config: Config = {
  path: "/api/list-invoices",
};
