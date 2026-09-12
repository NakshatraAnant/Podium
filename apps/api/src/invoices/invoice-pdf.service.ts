import { Injectable } from "@nestjs/common";
import PDFDocument from "pdfkit";

/**
 * The exact shape this renderer needs. Declared explicitly rather than
 * reusing a Prisma type so it is obvious at a glance that every value on the
 * page comes from a stored invoice row — never from a request body. A
 * client-supplied total on a tax document would be a forgery vector, so the
 * caller must load the invoice from the database and hand it over whole.
 */
export interface InvoicePdfData {
  invoiceNo: string;
  issueDate: Date | null;
  dueDate: Date;
  status: string;
  placeOfSupply: string;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  workspace: { name: string; gstin: string | null };
  city: { name: string; state: string; gstStateCode: string };
  client: { name: string; address: string | null; gstin: string | null; gstStateCode: string | null };
  project: { name: string };
  items: Array<{ description: string; qty: number; rate: number; hsnSac: string | null }>;
  payments: Array<{ amount: number; receivedAt: Date; method: string }>;
  creditNotes: Array<{ amount: number; reason: string }>;
  debitNotes: Array<{ amount: number; reason: string }>;
}

const INR = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number) => INR.format(n);
const date = (d: Date | null) =>
  d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

/**
 * Server-side invoice PDF rendering.
 *
 * Library choice: `pdfkit`. It is a mature, pure-Node streaming PDF writer
 * with no browser engine and no React runtime behind it. The alternatives
 * considered were `@react-pdf/renderer` (pulls in a React reconciler plus a
 * yoga-layout wasm binary — a lot of machinery for a fixed-layout tax
 * document that no one is composing interactively) and HTML-to-PDF via
 * Puppeteer (a full Chromium per render, which is a heavy and fragile
 * dependency to put on the critical path of issuing an invoice). pdfkit
 * draws exactly what it is told, in-process, with no headless browser to
 * keep alive.
 *
 * The layout mirrors the real AMM Brands tax invoice: letterhead with GSTIN,
 * bill-to block, invoice metadata, line items with HSN/SAC, the GST
 * breakdown, and the payment position. It is deliberately NOT pixel-chasing
 * the designed PDF Anant supplied — that document's full styling (the UPI QR
 * block, the two-column terms, the signature panel) is a separate template
 * concern, and inventing its legal boilerplate here would be fabricating
 * text AMM never wrote. What is rendered is exactly what the database holds.
 */
@Injectable()
export class InvoicePdfService {
  render(data: InvoicePdfData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margin: 40 });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      try {
        this.draw(doc, data);
        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  private draw(doc: PDFKit.PDFDocument, d: InvoicePdfData): void {
    const left = 40;
    const right = 555;

    // ----------------------------------------------------------- letterhead
    doc.fontSize(16).font("Helvetica-Bold").text(d.workspace.name.toUpperCase(), left, 40);
    doc.fontSize(8).font("Helvetica").fillColor("#444");
    if (d.workspace.gstin) doc.text(`GSTIN ${d.workspace.gstin}`, left, doc.y + 2);
    doc.text(`${d.city.name}, ${d.city.state} — branch state code ${d.city.gstStateCode}`);

    doc.fontSize(18).font("Helvetica-Bold").fillColor("#000").text("TAX INVOICE", left, 40, { align: "right", width: right - left });
    doc.fontSize(9).font("Helvetica").fillColor("#444").text(d.invoiceNo, { align: "right", width: right - left });
    doc.text(`Status: ${d.status}`, { align: "right", width: right - left });

    doc.moveTo(left, 100).lineTo(right, 100).strokeColor("#ccc").stroke();

    // ------------------------------------------------------- bill-to / meta
    let y = 115;
    doc.fillColor("#666").fontSize(7).font("Helvetica-Bold").text("BILL TO", left, y);
    doc.fillColor("#000").fontSize(10).font("Helvetica-Bold").text(d.client.name, left, y + 11, { width: 250 });
    doc.fontSize(8).font("Helvetica").fillColor("#333");
    if (d.client.address) doc.text(d.client.address, left, doc.y + 1, { width: 250 });
    doc.text(`GSTIN ${d.client.gstin ?? "—"}`, left, doc.y + 1);
    doc.text(`Place of supply: ${d.placeOfSupply}`, left, doc.y + 1);

    const metaX = 340;
    doc.fillColor("#666").fontSize(7).font("Helvetica-Bold").text("INVOICE DETAILS", metaX, y);
    doc.fontSize(8).font("Helvetica").fillColor("#333");
    const meta: Array<[string, string]> = [
      ["Invoice date", date(d.issueDate)],
      ["Due date", date(d.dueDate)],
      ["Project", d.project.name],
    ];
    let metaY = y + 13;
    for (const [k, v] of meta) {
      doc.fillColor("#666").text(k, metaX, metaY, { width: 80 });
      doc.fillColor("#000").text(v, metaX + 85, metaY, { width: right - metaX - 85 });
      metaY = doc.y + 3;
    }

    // ------------------------------------------------------------ line items
    y = Math.max(doc.y, metaY) + 18;
    const cols = { desc: left, hsn: 300, qty: 355, rate: 400, amount: 470 };
    doc.rect(left, y, right - left, 16).fill("#f2f2f2");
    doc.fillColor("#333").fontSize(7).font("Helvetica-Bold");
    doc.text("DESCRIPTION", cols.desc + 4, y + 5);
    doc.text("HSN/SAC", cols.hsn, y + 5);
    doc.text("QTY", cols.qty, y + 5, { width: 35, align: "right" });
    doc.text("RATE", cols.rate, y + 5, { width: 60, align: "right" });
    doc.text("AMOUNT", cols.amount, y + 5, { width: right - cols.amount - 4, align: "right" });
    y += 20;

    doc.font("Helvetica").fontSize(8).fillColor("#000");
    for (const item of d.items) {
      const amount = item.qty * item.rate;
      const h = doc.heightOfString(item.description, { width: cols.hsn - cols.desc - 10 });
      doc.text(item.description, cols.desc + 4, y, { width: cols.hsn - cols.desc - 10 });
      doc.text(item.hsnSac ?? "—", cols.hsn, y);
      doc.text(String(item.qty), cols.qty, y, { width: 35, align: "right" });
      doc.text(money(item.rate), cols.rate, y, { width: 60, align: "right" });
      doc.text(money(amount), cols.amount, y, { width: right - cols.amount - 4, align: "right" });
      y += Math.max(h, 10) + 6;
      if (y > 680) {
        doc.addPage();
        y = 50;
      }
    }

    doc.moveTo(left, y).lineTo(right, y).strokeColor("#ccc").stroke();
    y += 10;

    // -------------------------------------------------------- GST breakdown
    // Intra-state invoices carry CGST+SGST and no IGST; inter-state the
    // reverse. Rendering only the non-zero side keeps the document honest
    // about which treatment actually applied.
    const totalsX = 340;
    const rows: Array<[string, string]> = [["Taxable value", money(d.taxableAmount)]];
    if (d.igst > 0) {
      rows.push(["IGST @ 18%", money(d.igst)]);
    } else {
      rows.push(["CGST @ 9%", money(d.cgst)], ["SGST @ 9%", money(d.sgst)]);
    }

    doc.fontSize(8).font("Helvetica");
    for (const [k, v] of rows) {
      doc.fillColor("#555").text(k, totalsX, y, { width: 120 });
      doc.fillColor("#000").text(v, totalsX + 125, y, { width: right - totalsX - 125, align: "right" });
      y += 14;
    }
    doc.moveTo(totalsX, y).lineTo(right, y).strokeColor("#999").stroke();
    y += 6;
    doc.fontSize(11).font("Helvetica-Bold").fillColor("#000");
    doc.text("TOTAL", totalsX, y, { width: 120 });
    doc.text(`INR ${money(d.total)}`, totalsX + 125, y, { width: right - totalsX - 125, align: "right" });
    y += 22;

    // ------------------------------------------------------ payment position
    const paid = d.payments.reduce((s, p) => s + p.amount, 0);
    const credited = d.creditNotes.reduce((s, n) => s + n.amount, 0);
    const debited = d.debitNotes.reduce((s, n) => s + n.amount, 0);
    // The balance a customer actually owes: the invoice total, less what they
    // have paid, less any credit note, plus any debit note. Credit/debit
    // notes never alter the issued invoice row itself (it is immutable), so
    // this is the only place the net position is expressed.
    const balance = d.total - paid - credited + debited;

    doc.fontSize(8).font("Helvetica").fillColor("#555");
    doc.text(`Paid to date: INR ${money(paid)}`, totalsX, y, { width: right - totalsX, align: "right" });
    y = doc.y + 2;
    if (credited > 0) {
      doc.text(`Credit notes: −INR ${money(credited)}`, totalsX, y, { width: right - totalsX, align: "right" });
      y = doc.y + 2;
    }
    if (debited > 0) {
      doc.text(`Debit notes: +INR ${money(debited)}`, totalsX, y, { width: right - totalsX, align: "right" });
      y = doc.y + 2;
    }
    doc.fontSize(9).font("Helvetica-Bold").fillColor(balance > 0 ? "#b00" : "#070");
    doc.text(`Balance due: INR ${money(balance)}`, totalsX, y, { width: right - totalsX, align: "right" });

    if (d.payments.length > 0) {
      y = doc.y + 16;
      doc.fillColor("#666").fontSize(7).font("Helvetica-Bold").text("PAYMENTS RECEIVED", left, y);
      doc.font("Helvetica").fontSize(8).fillColor("#333");
      y += 11;
      for (const p of d.payments) {
        doc.text(`${date(p.receivedAt)} · ${p.method} · INR ${money(p.amount)}`, left, y);
        y = doc.y + 2;
      }
    }

    // -------------------------------------------------------------- footer
    doc.fontSize(7).fillColor("#888").font("Helvetica");
    doc.text(
      `${d.workspace.name} · GSTIN ${d.workspace.gstin ?? "—"} · Computer-generated invoice. ` +
        `Contents are confidential and intended for the addressee.`,
      left,
      790,
      { width: right - left, align: "center" },
    );
  }
}
