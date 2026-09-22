import type { Context, Config } from "@netlify/functions";

const NOTION_VERSION = "2025-09-03";

interface UpdatePayload {
  pageId: string;
  action: "dp_received" | "full_payment_received" | "undo_dp" | "undo_full_payment";
  date: string | null; // YYYY-MM-DD, defaults to today if omitted
  brand: "melanao" | "omoji" | string;
  invoiceName: string; // e.g. "Invoice DP — Alamii Food" — used to derive the client name
  total: number;
  dpAmount: number;
  metodePembayaran: string | null;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function ddmmyyyy(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function monthNameEN(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "long" });
}

// "Invoice DP — Alamii Food" -> "Alamii Food"
function deriveClientName(invoiceName: string) {
  const parts = invoiceName.split("—");
  return (parts.length > 1 ? parts[parts.length - 1] : invoiceName).trim();
}

async function notionFetch(path: string, token: string, init: RequestInit) {
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

// Creates the matching Income row in Cashflow CV. Returns null on success,
// or an error message string if it failed (caller decides how to surface it).
async function logToCashflow(token: string, payload: UpdatePayload, date: string): Promise<string | null> {
  if (payload.action !== "dp_received" && payload.action !== "full_payment_received") return null;

  const cashflowDataSourceId = Netlify.env.get("NOTION_CASHFLOW_DATA_SOURCE_ID") || "342ca0f3-d681-82c5-b915-0708d152c4d8";
  const brandName = payload.brand === "melanao" ? "Melanao" : payload.brand === "omoji" ? "Omoji" : payload.brand;
  const clientName = deriveClientName(payload.invoiceName || "Client");

  let kategoriPemasukan: string;
  let prefix: string;
  let nominal: number;

  if (payload.action === "dp_received") {
    kategoriPemasukan = "DP";
    prefix = "DP";
    nominal = payload.dpAmount || 0;
  } else if ((payload.dpAmount || 0) > 0) {
    // A DP was already collected earlier — this payment is the settlement.
    kategoriPemasukan = "Settlement";
    prefix = "Pelunasan";
    nominal = (payload.total || 0) - (payload.dpAmount || 0);
  } else {
    // Paid in full in one go, no DP was ever collected.
    kategoriPemasukan = "Full Payment";
    prefix = "Full Payment";
    nominal = payload.total || 0;
  }

  const namaTransaksi = `${prefix} - ${clientName} - ${ddmmyyyy(date)}`;

  const properties: Record<string, any> = {
    "Nama Transaksi": { title: [{ text: { content: namaTransaksi } }] },
    "Tanggal Transaksi": { date: { start: date } },
    "Brand": { select: { name: brandName } },
    "Jenis Transaksi": { select: { name: "Income" } },
    "Kategori": { select: { name: brandName === "Melanao" ? "Project Photoshoot" : "Kelas/Workshop" } },
    "Nominal": { number: nominal },
    "Kategori Pemasukan": { select: { name: kategoriPemasukan } },
    "Bulan Income": { multi_select: [{ name: monthNameEN(date) }] },
  };

  if (brandName === "Melanao") {
    properties["Nama Project Photoshoot - Melanao"] = { rich_text: [{ text: { content: clientName } }] };
  } else if (brandName === "Omoji") {
    properties["Nama Kelas/Workshop - Omoji"] = { rich_text: [{ text: { content: clientName } }] };
  }

  try {
    await notionFetch("/pages", token, {
      method: "POST",
      body: JSON.stringify({
        parent: { type: "data_source_id", data_source_id: cashflowDataSourceId },
        properties,
      }),
    });
    return null;
  } catch (err: any) {
    return err.message || "Gagal mencatat ke Cashflow CV";
  }
}

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

  let payload: UpdatePayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Payload tidak valid" }), { status: 400 });
  }

  if (!payload.pageId) {
    return new Response(JSON.stringify({ error: "pageId wajib diisi" }), { status: 400 });
  }

  const date = payload.date || todayISO();
  const properties: Record<string, any> = {};

  switch (payload.action) {
    case "dp_received":
      properties["DP Status"] = { checkbox: true };
      properties["DP Date"] = { date: { start: date } };
      if (payload.metodePembayaran) properties["Metode Pembayaran"] = { select: { name: payload.metodePembayaran } };
      break;
    case "full_payment_received":
      properties["Pelunasan Status"] = { checkbox: true };
      properties["Full Payment Date"] = { date: { start: date } };
      if (payload.metodePembayaran) properties["Metode Pembayaran"] = { select: { name: payload.metodePembayaran } };
      break;
    case "undo_dp":
      properties["DP Status"] = { checkbox: false };
      properties["DP Date"] = { date: null };
      break;
    case "undo_full_payment":
      properties["Pelunasan Status"] = { checkbox: false };
      properties["Full Payment Date"] = { date: null };
      break;
    default:
      return new Response(JSON.stringify({ error: "action tidak dikenali" }), { status: 400 });
  }

  try {
    const updated = await notionFetch(`/pages/${payload.pageId}`, token, {
      method: "PATCH",
      body: JSON.stringify({ properties }),
    });

    const cashflowError = await logToCashflow(token, payload, date);

    return new Response(
      JSON.stringify({ ok: true, url: updated.url, cashflowWarning: cashflowError }),
      { status: 200 }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Gagal update status di Notion" }), { status: 500 });
  }
};

export const config: Config = {
  path: "/api/update-payment-status",
};
