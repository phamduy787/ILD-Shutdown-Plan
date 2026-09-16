export type ClipCell = { text: string; color: string; span: number; covered?: boolean; reason?: string; kind?: "status" | "text" };
export type ClipGrid = ClipCell[][];
export const palette: Record<string, string> = { white: "#ffffff", plan: "#94a3b8", done: "#10b981", late: "#ef3340", green: "#dcfce7", blue: "#dbeafe", red: "#fee2e2", purple: "#ede9fe" };
export function normalizeColor(value: string): string {
  const s = value.trim().toLowerCase();
  if (!s || ["transparent", "none", "white", "#fff", "#ffffff", "#f8fbfd", "rgba(0, 0, 0, 0)"].includes(s)) return "white";
  if (palette[s]) return s;
  let hex = s;
  const rgb = s.match(/^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/);
  if (rgb) hex = "#" + rgb.slice(1).map(x => Number(x).toString(16).padStart(2, "0")).join("");
  if (/^#[0-9a-f]{3}$/.test(hex)) hex = "#" + hex.slice(1).split("").map(x => x + x).join("");
  return Object.keys(palette).find(k => palette[k] === hex) || ({ "#34d399": "done", "#059669": "done", "#fb7185": "late", "#dc2626": "late" } as Record<string,string>)[hex] || hex;
}
export function parseTSV(text: string): ClipGrid {
  const rows: string[][] = [[]]; let value = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && (quoted || !value)) { if (quoted && text[i+1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === '\t' || c === '\n' || c === '\r')) {
      rows[rows.length-1].push(value); value = "";
      if (c !== '\t') { if (c === '\r' && text[i+1] === '\n') i++; rows.push([]); }
    } else value += c;
  }
  rows[rows.length-1].push(value);
  if (rows.length > 1 && rows.at(-1)?.length === 1 && rows.at(-1)?.[0] === "" && /[\r\n]$/.test(text)) rows.pop();
  const width = Math.max(...rows.map(r => r.length));
  if (rows.length > 100 || width > 75) throw new Error("Vùng sao chép vượt 100 dòng hoặc 75 cột.");
  return rows.map(r => Array.from({ length: width }, (_, i) => ({ text: r[i] || "", color: "white", span: 1 })));
}
export function parseClipboard(html: string, plain: string): ClipGrid {
  if (html.length + plain.length > 2_000_000) throw new Error("Dữ liệu clipboard quá lớn.");
  if (!html) return parseTSV(plain);
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table"); if (!table) return parseTSV(plain || doc.body.textContent || "");
  // Excel puts cell fills in CSS classes rather than inline styles.
  const rules: { selector: string; color: string }[] = [];
  for (const style of doc.querySelectorAll("style")) for (const match of (style.textContent || "").matchAll(/([^{}]+)\{([^{}]+)\}/g)) {
    const color = match[2].match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;!]+)/i)?.[1];
    if (color) for (const selector of match[1].split(",")) rules.push({ selector: selector.trim(), color: color.trim().split(/\s/)[0] });
  }
  const rows: ClipGrid = [];
  for (const tr of Array.from(table.rows)) {
    const row: ClipCell[] = [];
    for (const td of Array.from(tr.cells)) {
      if (td.rowSpan > 1) throw new Error("Timeline chỉ hỗ trợ ghép ngang. Hãy tách ô ghép nhiều dòng trong Excel trước khi dán.");
      let color = "";
      for (const rule of rules) { try { if (td.matches(rule.selector)) color = rule.color; } catch { /* Ignore unsupported Excel selectors. */ } }
      color = td.style.backgroundColor || td.getAttribute("bgcolor") || color;
      const internalKind = td.getAttribute("data-ild-kind");
      for (const br of td.querySelectorAll("br")) br.replaceWith(doc.createTextNode("\n"));
      const text = (td.textContent || "").replaceAll("\u00a0", " ");
      const span = Math.max(1, td.colSpan);
      row.push({ text, span, reason: td.getAttribute("data-ild-reason") || undefined, color: normalizeColor(color), kind: internalKind === "status" || internalKind === "text" ? internalKind : undefined });
      for (let i = 1; i < span; i++) row.push({ text: "", color: normalizeColor(color), span: 1, covered: true });
      if (row.length > 75) throw new Error("Vùng sao chép vượt 75 cột.");
    }
    rows.push(row); if (rows.length > 100) throw new Error("Vùng sao chép vượt 100 dòng.");
  }
  const width = Math.max(0, ...rows.map(r => r.length));
  if (!width) throw new Error("Không tìm thấy ô để dán.");
  return rows.map(r => Array.from({ length: width }, (_, i) => r[i] || { text: "", color: "white", span: 1 }));
}
export function encodeClipboard(grid: ClipGrid): { html: string; plain: string } {
  const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const plain = grid.map(r => r.map(c => { const s = c.covered ? "" : c.text; return /[\t\r\n"]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s; }).join('\t')).join('\r\n');
  const html = '<html><body><table>' + grid.map(r => '<tr>' + r.filter(c => !c.covered).map(c => `<td data-ild-kind="${c.kind || "text"}" data-ild-reason="${escape(c.reason || "")}" colspan="${c.span}" style="background-color:${palette[c.color] || "#ffffff"};white-space:pre-wrap;text-align:center">${escape(c.text)}</td>`).join('') + '</tr>').join('') + '</table></body></html>';
  return { html, plain };
}
export function statusValue(cell: ClipCell, colors: Record<string,string> = {}): number {
  const text = cell.text.trim();
  if (text && !/^[123]$/.test(text)) throw new Error(`Ô Plan/Actual chỉ nhận 1, 2, 3 hoặc ô trống; nhận được “${text.slice(0,30)}”.`);
  if (text) return Number(text);
  const color = colors[cell.color] || cell.color;
  if (color === "white") return 0;
  if (color === "plan") return 1;
  if (["done", "green"].includes(color)) return 2;
  if (["late", "red"].includes(color)) return 3;
  throw new Error(`Chọn trạng thái tương ứng cho màu ${cell.color} trước khi dán.`);
}
export function detailColorFor(color: string, colors: Record<string,string> = {}): string {
  const mapped = colors[color] || color;
  if (["white", "green", "blue", "red", "purple"].includes(mapped)) return mapped;
  if (mapped === "done") return "green";
  if (mapped === "late") return "red";
  throw new Error(`Chọn màu Detail tương ứng cho ${color} trước khi dán.`);
}
