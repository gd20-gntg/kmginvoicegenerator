import type { Context, Config } from "@netlify/functions";

// ===================== Brand config (mirrors app.js) =====================
const BRANDS: Record<string, {
  label: string; tagline: string; phone: string; email: string;
  selectName: string; logoFile: string;
  dpTerms: (dp: number) => string;
  remainingTerms: (remaining: number) => string;
  quotationTerms: string[];
}> = {
  melanao: {
    label: "Melanao Indonesia",
    tagline: "Halal Food Photographer",
    phone: "0813 8748 3295",
    email: "melanaoproject@gmail.com",
    selectName: "Melanao",
    logoFile: "logo-melanao.png",
    dpTerms: (dp) => `**Down Payment (DP) sebesar ${dp}%** dari total invoice dibayarkan sebagai konfirmasi jadwal dan penguncian slot produksi.`,
    remainingTerms: (remaining) => `**Sisa pembayaran ${remaining}%** dilakukan maksimal **3 hari kalender** setelah klien menerima hasil preview foto dan sebelum file final dikirimkan.`,
    quotationTerms: [
      "**Down Payment (DP) sebesar 50% atau Full Payment** dari total invoice dibayarkan sebagai konfirmasi jadwal dan penguncian slot produksi.",
      "**Sisa pembayaran 50%** dilakukan maksimal **3 hari kalender** setelah klien menerima hasil preview foto dan sebelum file final dikirimkan.",
    ],
  },
  omoji: {
    label: "Omoji Indonesia",
    tagline: "Hair Care & Skin Care Learning Hub",
    phone: "0877 4148 2699",
    email: "omojimask.id@gmail.com",
    selectName: "Omoji",
    logoFile: "logo-omoji.png",
    dpTerms: (dp) => `**Down Payment (DP) sebesar ${dp}%** dari total invoice dibayarkan sebagai konfirmasi jadwal dan kelas yang dipelajari.`,
    remainingTerms: () => `**Sisa pembayaran** dilakukan maksimal **7 hari sebelum** kelas dilaksanakan.`,
    quotationTerms: [
      "Pembayaran kelas dilakukan secara penuh (full payment) sebelum pelaksanaan kelas.",
      "Pendaftaran dinyatakan sah setelah pembayaran diterima.",
    ],
  },
};

const PAYMENT_INFO = {
  bank: "BCA",
  accountName: "CV Karya Mudra Gemilang",
  accountNumber: "6080757814",
  qrFile: "qr-bca.jpg",
};

const NOTION_VERSION = "2025-09-03";

interface ItemInput { service: string; detail?: string; price: number; qty: number; }
interface InvoicePayload {
  brand: "melanao" | "omoji";
  type: "quotation" | "dp" | "final";
  invoiceCode: string;
  clientName: string;
  contactPerson: string;
  clientPhone: string;
  invoiceDate: string;
  dueDate: string | null;
  items: ItemInput[];
  subtotal: number;
  additionalFee: number;
  additionalFeeNote: string;
  promoType: "percent" | "nominal";
  promoValueRaw: number;
  discountAmount: number;
  promoNote: string;
  total: number;
  dpPercent: number;
  dpAmount: number;
  paidAmount: number;
  remainingBalance: number;
  dpPaidDate: string | null;
  existingPageUrl: string | null;
  internalNotes: string;
}

function rupiah(n: number) {
  return "Rp" + Math.round(n || 0).toLocaleString("id-ID");
}

function fmtDate(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
}

// Turns "**bold** plain" into Notion rich_text spans.
function mdToRichText(md: string) {
  const parts = md.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((p) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return { type: "text", text: { content: p.slice(2, -2) }, annotations: { bold: true } };
    }
    return { type: "text", text: { content: p } };
  });
}

function text(content: string, bold = false) {
  return bold
    ? [{ type: "text", text: { content }, annotations: { bold: true } }]
    : [{ type: "text", text: { content } }];
}

function extractPageId(urlOrId: string): string | null {
  const match = urlOrId.replace(/-/g, "").match(/([0-9a-f]{32})(?:\?|$)/i);
  return match ? match[1] : null;
}

// ===================== Property builder =====================
function buildProperties(p: InvoicePayload, isUpdate: boolean) {
  const brand = BRANDS[p.brand];
  const typeLabel = p.type === "quotation" ? "Quotation" : p.type === "dp" ? "Invoice DP" : "Invoice Lunas";

  const props: Record<string, any> = {
    // Net of discount, so Notion's own Total Invoice Amount formula
    // (Invoice Amount + Additional Fee) still lands on the real total.
    "Invoice Amount": { number: (p.subtotal || 0) - (p.discountAmount || 0) },
    "Additional Fee": { number: p.additionalFee || 0 },
    "Invoice Date": { date: { start: p.invoiceDate } },
  };

  if (!isUpdate) {
    props["Invoice Name"] = { title: [{ text: { content: p.clientName || "Client" } }] };
    props["Brand"] = { select: { name: brand.selectName } };
  }

  if (p.dueDate) props["Due Date"] = { date: { start: p.dueDate } };
  if (p.additionalFeeNote) props["Notes Additional Fee"] = { rich_text: text(p.additionalFeeNote) };

  const noteParts: string[] = [];
  if (p.internalNotes) noteParts.push(p.internalNotes);
  if (p.discountAmount) {
    const promoLabel = p.promoType === "percent" ? `${p.promoValueRaw}%` : rupiah(p.discountAmount);
    noteParts.push(`Diskon ${promoLabel}${p.promoNote ? ` (${p.promoNote})` : ""}: -${rupiah(p.discountAmount)}`);
  }
  if (noteParts.length) props["Notes"] = { rich_text: text(noteParts.join(" | ")) };

  if (p.type === "dp") {
    props["DP Amount"] = { number: p.dpAmount || 0 };
  } else if (p.type === "final") {
    // A final-payment invoice implies the DP has already been received.
    props["DP Amount"] = { number: p.paidAmount || 0 };
    props["DP Status"] = { checkbox: true };
    if (p.dpPaidDate) props["DP Date"] = { date: { start: p.dpPaidDate } };
  }
  // "quotation": no DP/payment fields set yet — nothing has been paid.

  return props;
}

// ===================== Content block builder =====================
function buildContentBlocks(p: InvoicePayload, origin: string): any[] {
  const brand = BRANDS[p.brand];
  const logoUrl = `${origin}/assets/${brand.logoFile}`;
  const qrUrl = `${origin}/assets/${PAYMENT_INFO.qrFile}`;

  const headerBlock = {
    object: "block",
    type: "column_list",
    column_list: {
      children: [
        {
          object: "block", type: "column",
          column: { children: [{ object: "block", type: "image", image: { type: "external", external: { url: logoUrl } } }] },
        },
        {
          object: "block", type: "column",
          column: {
            children: [
              { object: "block", type: "heading_3", heading_3: { rich_text: text(brand.label) } },
              { object: "block", type: "paragraph", paragraph: { rich_text: text(`${brand.tagline} | ${brand.phone} | ${brand.email}`) } },
            ],
          },
        },
      ],
    },
  };

  const isQuotation = p.type === "quotation";

  const metaBlock = {
    object: "block",
    type: "column_list",
    column_list: {
      children: [
        {
          object: "block", type: "column",
          column: {
            children: isQuotation
              ? [
                  { object: "block", type: "paragraph", paragraph: { rich_text: text("Quotation Date :", true) } },
                  { object: "block", type: "paragraph", paragraph: { rich_text: text(fmtDate(p.invoiceDate)) } },
                ]
              : [
                  { object: "block", type: "paragraph", paragraph: { rich_text: text("Invoice Code :", true) } },
                  { object: "block", type: "paragraph", paragraph: { rich_text: text(p.invoiceCode) } },
                  { object: "block", type: "paragraph", paragraph: { rich_text: text(fmtDate(p.invoiceDate)) } },
                  { object: "block", type: "paragraph", paragraph: { rich_text: text("Due Date :", true) } },
                  { object: "block", type: "paragraph", paragraph: { rich_text: text(fmtDate(p.dueDate)) } },
                ],
          },
        },
        {
          object: "block", type: "column",
          column: {
            children: [
              { object: "block", type: "paragraph", paragraph: { rich_text: text("Bill to :", true) } },
              { object: "block", type: "paragraph", paragraph: { rich_text: text(`${p.clientName}\n${p.contactPerson}`) } },
              { object: "block", type: "paragraph", paragraph: { rich_text: text(p.clientPhone) } },
            ],
          },
        },
      ],
    },
  };

  const tableRows = p.items.map((it) => ({
    object: "block",
    type: "table_row",
    table_row: {
      cells: [
        it.detail ? [...text(it.service, true), { type: "text", text: { content: `\n${it.detail}` } }] : text(it.service),
        text(rupiah(it.price)),
        text(String(it.qty)),
        text(rupiah(it.price * it.qty)),
      ],
    },
  }));

  const tableBlock = {
    object: "block",
    type: "table",
    table: {
      table_width: 4,
      has_column_header: true,
      has_row_header: false,
      children: [
        {
          object: "block", type: "table_row",
          table_row: { cells: [text("SERVICE", true), text(isQuotation ? "RATE" : "PRICE", true), text("QUANTITY", true), text("TOTAL", true)] },
        },
        ...tableRows,
      ],
    },
  };

  const showBreakdown = !!p.additionalFee || !!p.discountAmount;
  const promoTag = p.promoType === "percent" && p.promoValueRaw ? ` ${p.promoValueRaw}%` : "";
  const feeBreakdownLines = showBreakdown
    ? [
        `Subtotal : ${rupiah(p.subtotal)}`,
        ...(p.discountAmount ? [`Diskon${promoTag}${p.promoNote ? ` (${p.promoNote})` : ""} : -${rupiah(p.discountAmount)}`] : []),
        ...(p.additionalFee ? [`Biaya Tambahan${p.additionalFeeNote ? ` (${p.additionalFeeNote})` : ""} : ${rupiah(p.additionalFee)}`] : []),
      ]
    : [];

  const summaryLines = [
    ...feeBreakdownLines,
    ...(isQuotation
      ? [`Total Quotation : ${rupiah(p.total)}`]
      : p.type === "dp"
        ? [
            `Total Invoice : ${rupiah(p.total)}`,
            `DP (${p.dpPercent}%) — Due Now : ${rupiah(p.dpAmount)}`,
            `Remaining Balance : ${rupiah(p.remainingBalance)}`,
          ]
        : [
            `Total Invoice : ${rupiah(p.total)}`,
            `Paid (DP) : ${rupiah(p.paidAmount)}`,
            `Remaining Balance — Due Now : ${rupiah(p.remainingBalance)}`,
          ]),
  ];

  const summaryBlock = {
    object: "block",
    type: "column_list",
    column_list: {
      children: [
        { object: "block", type: "column", column: { children: [{ object: "block", type: "paragraph", paragraph: { rich_text: [] } }] } },
        {
          object: "block", type: "column",
          column: {
            children: [
              { object: "block", type: "paragraph", paragraph: { rich_text: text("Total Summary :", true) } },
              ...summaryLines.map((line) => ({ object: "block", type: "paragraph", paragraph: { rich_text: text(line) } })),
            ],
          },
        },
      ],
    },
  };

  const dpPercentForTerms = p.type === "dp" ? (p.dpPercent || 50) : 50;
  const remainingPercentForTerms = 100 - dpPercentForTerms;
  const termsBullets = isQuotation
    ? brand.quotationTerms
    : [
        brand.dpTerms(dpPercentForTerms),
        p.brand === "melanao" ? brand.remainingTerms(remainingPercentForTerms) : brand.remainingTerms(0),
      ];

  const termsBlock = [
    { object: "block", type: "divider", divider: {} },
    { object: "block", type: "paragraph", paragraph: { rich_text: text("Payment Terms :", true) } },
    ...termsBullets.map((b) => ({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: mdToRichText(b) } })),
    { object: "block", type: "divider", divider: {} },
  ];

  const paymentInfoBlock = {
    object: "block",
    type: "column_list",
    column_list: {
      children: [
        { object: "block", type: "column", column: { children: [{ object: "block", type: "image", image: { type: "external", external: { url: qrUrl } } }] } },
        {
          object: "block", type: "column",
          column: {
            children: [
              {
                object: "block", type: "paragraph",
                paragraph: {
                  rich_text: text(
                    `Bank : ${PAYMENT_INFO.bank}\nAccount Name : ${PAYMENT_INFO.accountName}\nAccount Number : ${PAYMENT_INFO.accountNumber}\nEmail : ${brand.email}`
                  ),
                },
              },
            ],
          },
        },
      ],
    },
  };

  return [
    headerBlock,
    metaBlock,
    tableBlock,
    summaryBlock,
    ...termsBlock,
    { object: "block", type: "paragraph", paragraph: { rich_text: text("Payment Information", true) } },
    paymentInfoBlock,
  ];
}

// ===================== Notion API calls =====================
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
  if (!res.ok) {
    throw new Error(data?.message || `Notion API error (${res.status})`);
  }
  return data;
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
  const dataSourceId = Netlify.env.get("NOTION_DATA_SOURCE_ID") || "2e2ca0f3-d681-80fc-b823-000b45bfb140";
  if (!token) {
    return new Response(JSON.stringify({ error: "NOTION_TOKEN belum di-set di environment variables" }), { status: 500 });
  }

  let payload: InvoicePayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Payload tidak valid" }), { status: 400 });
  }

  const origin = new URL(req.url).origin;

  try {
    const existingId = payload.existingPageUrl ? extractPageId(payload.existingPageUrl) : null;
    const blocks = buildContentBlocks(payload, origin);

    if (existingId) {
      // Update an existing page (e.g. a Quotation or Invoice DP that already
      // exists in Notion): patch properties, then append this new document
      // underneath the existing content instead of creating a duplicate row.
      const props = buildProperties(payload, true);
      const sectionTitle = payload.type === "quotation" ? "Quotation" : payload.type === "dp" ? "Invoice DP" : "Invoice Lunas";
      await notionFetch(`/pages/${existingId}`, token, {
        method: "PATCH",
        body: JSON.stringify({ properties: props }),
      });
      await notionFetch(`/blocks/${existingId}/children`, token, {
        method: "PATCH",
        body: JSON.stringify({
          children: [
            { object: "block", type: "divider", divider: {} },
            { object: "block", type: "heading_2", heading_2: { rich_text: text(sectionTitle) } },
            ...blocks,
          ],
        }),
      });
      return new Response(JSON.stringify({ ok: true, url: payload.existingPageUrl }), { status: 200 });
    }

    const props = buildProperties(payload, false);
    const created = await notionFetch("/pages", token, {
      method: "POST",
      body: JSON.stringify({
        parent: { type: "data_source_id", data_source_id: dataSourceId },
        properties: props,
        children: blocks,
      }),
    });

    return new Response(JSON.stringify({ ok: true, url: created.url }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Gagal menyimpan ke Notion" }), { status: 500 });
  }
};

export const config: Config = {
  path: "/api/save-invoice",
};
