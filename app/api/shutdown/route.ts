import { env } from "cloudflare:workers";
import { currentRole } from "@/lib/shutdown-auth";
import { canWriteCell, canWriteNote } from "@/lib/shutdown-permissions";
export async function GET() {
  const [cells, settings, notes] = await Promise.all([
    env.DB.prepare("SELECT row_key AS rowKey, hour_index AS hourIndex, value FROM schedule_cells WHERE value <> 0 ORDER BY row_key, hour_index").all(),
    env.DB.prepare("SELECT key, value FROM shutdown_settings").all(),
    env.DB.prepare("SELECT row_key AS rowKey, content FROM shutdown_notes WHERE content <> ''").all(),
  ]); return Response.json({ cells: cells.results, settings: settings.results, notes: notes.results });
}
type Payload = { cells?: { rowKey: string; hourIndex: number; value: number }[]; settings?: { key: string; value: string }[]; notes?: { rowKey: string; content: string }[] };
export async function PATCH(request: Request) {
  const role = await currentRole(); if (!role) return Response.json({ message: "Cần mở khóa chỉnh sửa" }, { status: 403 });
  const body = (await request.json()) as Payload; const now = new Date().toISOString(); const statements: D1PreparedStatement[] = [];
  // Reject the entire request rather than silently acknowledging skipped cells.
  if ((body.cells && (!Array.isArray(body.cells) || body.cells.length > 500)) || (body.notes && (!Array.isArray(body.notes) || body.notes.length > 50)) || (body.settings && (!Array.isArray(body.settings) || body.settings.length > 10))) return Response.json({ message: "Vùng cập nhật quá lớn" }, { status: 400 });
  for (const cell of body.cells || []) {
    if (!cell || !/^[a-z0-9-]{2,60}$/.test(cell.rowKey) || !Number.isInteger(cell.hourIndex) || cell.hourIndex < 0 || cell.hourIndex > 95 || !Number.isInteger(cell.value) || cell.value < 0 || cell.value > 3) return Response.json({ message: "Ô timeline không hợp lệ" }, { status: 400 });
    if (!canWriteCell(role, cell.rowKey)) return Response.json({ message: "Dòng bị khóa" }, { status: 403 });
  }
  for (const note of body.notes || []) {
    if (!note || !/^[a-z0-9-]{2,60}$/.test(note.rowKey) || typeof note.content !== "string" || note.content.length > (note.rowKey.endsWith("-merges") ? 10000 : 300)) return Response.json({ message: "Nội dung ô không hợp lệ hoặc quá dài" }, { status: 400 });
    if (!canWriteNote(role, note.rowKey)) return Response.json({ message: "Dòng bị khóa" }, { status: 403 });
    if (note.rowKey.endsWith("-merges") && note.content) {
      try {
        const ranges = JSON.parse(note.content); let last = -1;
        if (!Array.isArray(ranges) || ranges.length > 75) throw new Error();
        for (const range of ranges) { if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start <= last || range.end < range.start || range.end > 74) throw new Error(); last = range.end; }
      } catch { return Response.json({ message: "Ô ghép không hợp lệ" }, { status: 400 }); }
    }
  }
  for (const setting of body.settings || []) if (role !== "admin" || !setting || !/^[a-zA-Z0-9_-]{2,40}$/.test(setting.key) || typeof setting.value !== "string" || setting.value.length > 100) return Response.json({ message: "Không được cập nhật thiết lập" }, { status: 403 });
  for (const cell of (body.cells || []).slice(0, 500)) { if (!/^[a-z0-9-]{2,60}$/.test(cell.rowKey) || (!canWriteCell(role, cell.rowKey)) || !Number.isInteger(cell.hourIndex) || cell.hourIndex < 0 || cell.hourIndex > 95) continue; const value = Number.isFinite(cell.value) ? Math.max(0, Math.min(999, Math.trunc(cell.value))) : 0; statements.push(env.DB.prepare("INSERT INTO schedule_cells (row_key, hour_index, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(row_key, hour_index) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(cell.rowKey, cell.hourIndex, value, now)); }
  for (const setting of (body.settings || []).slice(0, 10)) { if (role !== "admin" || !/^[a-zA-Z0-9_-]{2,40}$/.test(setting.key) || setting.value.length > 100) continue; statements.push(env.DB.prepare("INSERT INTO shutdown_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(setting.key, setting.value, now)); }
  for (const note of (body.notes || []).slice(0, 50)) { if (!/^[a-z0-9-]{2,60}$/.test(note.rowKey) || (!canWriteNote(role, note.rowKey)) || note.content.length > (note.rowKey.endsWith("-merges") ? 10000 : 300)) continue; statements.push(env.DB.prepare("INSERT INTO shutdown_notes (row_key, content, updated_at) VALUES (?, ?, ?) ON CONFLICT(row_key) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at").bind(note.rowKey, note.content, now)); }
  if (statements.length) await env.DB.batch(statements); return Response.json({ ok: true, updatedAt: now });
}
