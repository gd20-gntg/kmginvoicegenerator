import type { Context, Config } from "@netlify/functions";

const NOTION_VERSION = "2025-09-03";
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];

interface FileInput {
  name: string;
  type: string;
  data: string; // base64, without the "data:...;base64," prefix
}

interface UpdatePayload {
  pageId: string;
  action: "dp_received" | "full_payment_received" | "undo_dp" | "undo_full_payment";
  date: string | null; // YYYY-MM-DD, defaults to today if omitted
  brand: "melanao" | "omoji" | string;
  invoiceName: string;
  clientName?: string; // "Nama Klien" from Notion; falls back to invoiceName
  total: number;
  dpAmount: number; // dp_received: DP just received. full_payment_received: DP received earlier (0 if none)
  metodePembayaran: string | null;
  file?: FileInput | null; // bukti pembayaran
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

// Uploads a file to Notion (single-part upload) and returns its file_upload id,
// which can then be attached to a Files property.
async function uploadToNotion(token: string, file: FileInput): Promise<string> {
  const created = await notionFetch("/file_uploads", token, {
    method: "POST",
    body: JSON.stringify({ mode: "single_part", filename: file.name, content_type: file.type }),
  });
  const bytes = Buffer.from(file.data, "base64");
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: file.type }), file.name);
  const res = await fetch(`https://api.notion.com/v1/file_uploads/${created.id}/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION },
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Upload file gagal (${res.status})`);
  return created.id;
}

function filesValue(uploadId: string, name: string) {
  return { files: [{ type: "file_upload", file_upload: { id: uploadId }, name }] };
}

function cashflowDataSourceId() {
  return Netlify.env.get("NOTION_CASHFLOW_DATA_SOURCE_ID") || "342ca0f3-d681-82c5-b915-0708d152c4d8";
}

// Creates the matching Income row in Cashflow CV, linked to the invoice.
// Returns a warning string, or null when everything went fine.
async function logToCashflow(token: string, payload: UpdatePayload, date: string): Promise<string | null> {
  const brandName = payload.brand === "melanao" ? "Melanao" : payload.brand === "omoji" ? "Omoji" : payload.brand;
  const clientName = (payload.clientName || "").trim() || deriveClientName(payload.invoiceName || "Client");

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

  if (nominal <= 0) {
    return `nominal ${prefix} Rp0, jadi tidak dicatat ke Cashflow CV — cek lagi total/DP invoice ini`;
  }

  const properties: Record<string, any> = {
    "Nama Transaksi": { title: [{ text: { content: `${prefix} - ${clientName} - ${ddmmyyyy(date)}` } }] },
    "Tanggal Transaksi": { date: { start: date } },
    "Brand": { select: { name: brandName } },
    "Jenis Transaksi": { select: { name: "Income" } },
    "Kategori": { select: { name: brandName === "Melanao" ? "Project Photoshoot" : "Kelas/Workshop" } },
    "Nominal": { number: nominal },
    "Kategori Pemasukan": { select: { name: kategoriPemasukan } },
    "Bulan Income": { multi_select: [{ name: monthNameEN(date) }] },
    "Invoice": { relation: [{ id: payload.pageId }] },
  };

  if (brandName === "Melanao") {
    properties["Nama Project Photoshoot - Melanao"] = { rich_text: [{ text: { content: clientName } }] };
  } else if (brandName === "Omoji") {
    properties["Nama Kelas/Workshop - Omoji"] = { rich_text: [{ text: { content: clientName } }] };
  }

  let fileWarning: string | null = null;
  if (payload.file) {
    try {
      const uploadId = await uploadToNotion(token, payload.file);
      properties["Bukti Transaksi"] = filesValue(uploadId, payload.file.name);
    } catch (err: any) {
      fileWarning = `bukti transfer gagal dilampirkan ke Cashflow CV (${err.message})`;
    }
  }

  try {
    await notionFetch("/pages", token, {
      method: "POST",
      body: JSON.stringify({ parent: { type: "data_source_id", data_source_id: cashflowDataSourceId() }, properties }),
    });
    return fileWarning;
  } catch (err: any) {
    return err.message || "Gagal mencatat ke Cashflow CV";
  }
}

// On undo: moves the Cashflow CV income rows linked to this invoice to Trash.
async function archiveCashflow(token: string, pageId: string, kategori: string[]): Promise<{ count: number; warning: string | null }> {
  try {
    const data = await notionFetch(`/data_sources/${cashflowDataSourceId()}/query`, token, {
      method: "POST",
      body: JSON.stringify({
        filter: {
          and: [
            { property: "Invoice", relation: { contains: pageId } },
            { or: kategori.map((k) => ({ property: "Kategori Pemasukan", select: { equals: k } })) },
          ],
        },
        page_size: 20,
      }),
    });
    const rows = data.results || [];
    for (const row of rows) {
      await notionFetch(`/pages/${row.id}`, token, { method: "PATCH", body: JSON.stringify({ archived: true }) });
    }
    if (!rows.length) {
      return { count: 0, warning: "entri Cashflow CV yang terhubung ke invoice ini tidak ditemukan (entri lama sebelum update ini belum terhubung) — hapus manual di Cashflow CV kalau ada" };
    }
    return { count: rows.length, warning: null };
  } catch (err: any) {
    return { count: 0, warning: `gagal membersihkan Cashflow CV (${err.message})` };
  }
}

function validateFile(file: FileInput | null | undefined): string | null {
  if (!file) return null;
  if (!file.name || !file.data || !file.type) return "File bukti pembayaran tidak lengkap";
  if (!ALLOWED_FILE_TYPES.includes(file.type)) return "Bukti pembayaran harus foto (JPG/PNG/WEBP) atau PDF";
  const approxBytes = Math.floor((file.data.length * 3) / 4);
  if (approxBytes > MAX_FILE_BYTES) return "File bukti pembayaran terlalu besar (maks 5 MB)";
  return null;
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
  const fileError = validateFile(payload.file);
  if (fileError) {
    return new Response(JSON.stringify({ error: fileError }), { status: 400 });
  }
  if (payload.action === "dp_received" && !((payload.dpAmount || 0) > 0)) {
    return new Response(JSON.stringify({ error: "Nominal DP wajib diisi" }), { status: 400 });
  }

  const date = payload.date || todayISO();
  const properties: Record<string, any> = {};
  const isPaymentAction = payload.action === "dp_received" || payload.action === "full_payment_received";

  switch (payload.action) {
    case "dp_received":
      properties["DP Status"] = { checkbox: true };
      properties["DP Date"] = { date: { start: date } };
      properties["DP Amount"] = { number: payload.dpAmount };
      break;
    case "full_payment_received":
      properties["Pelunasan Status"] = { checkbox: true };
      properties["Full Payment Date"] = { date: { start: date } };
      break;
    case "undo_dp":
      properties["DP Status"] = { checkbox: false };
      properties["DP Date"] = { date: null };
      properties["DP Amount"] = { number: null };
      break;
    case "undo_full_payment":
      properties["Pelunasan Status"] = { checkbox: false };
      properties["Full Payment Date"] = { date: null };
      break;
    default:
      return new Response(JSON.stringify({ error: "action tidak dikenali" }), { status: 400 });
  }
  if (isPaymentAction && payload.metodePembayaran) {
    properties["Metode Pembayaran"] = { select: { name: payload.metodePembayaran } };
  }

  try {
    const warnings: string[] = [];

    if (isPaymentAction && payload.file) {
      try {
        const uploadId = await uploadToNotion(token, payload.file);
        const prop = payload.action === "dp_received" ? "Bukti Transfer" : "Bukti Pelunasan";
        properties[prop] = filesValue(uploadId, payload.file.name);
      } catch (err: any) {
        warnings.push(`bukti transfer gagal diupload ke invoice (${err.message})`);
      }
    }

    const updated = await notionFetch(`/pages/${payload.pageId}`, token, {
      method: "PATCH",
      body: JSON.stringify({ properties }),
    });

    let cashflowArchived = 0;
    if (isPaymentAction) {
      const w = await logToCashflow(token, payload, date);
      if (w) warnings.push(w);
    } else {
      const kategori = payload.action === "undo_dp" ? ["DP"] : ["Settlement", "Full Payment"];
      const result = await archiveCashflow(token, payload.pageId, kategori);
      cashflowArchived = result.count;
      if (result.warning) warnings.push(result.warning);
    }

    return new Response(
      JSON.stringify({ ok: true, url: updated.url, cashflowWarning: warnings.length ? warnings.join("; ") : null, cashflowArchived }),
      { status: 200 }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Gagal update status di Notion" }), { status: 500 });
  }
};

export const config: Config = {
  path: "/api/update-payment-status",
};
