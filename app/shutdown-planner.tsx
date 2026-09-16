"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { canWriteCell, canWriteNote, isActualRow, reasonKey, reconcileReasons } from "@/lib/shutdown-permissions";
import { parseClipboard, encodeClipboard, statusValue, detailColorFor, palette, type ClipGrid } from "@/lib/timeline-clipboard";
import { Activity, CalendarDays, Download, Filter, LockKeyhole, RefreshCw, RotateCcw, Save, ShieldCheck, Undo2, UnlockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const HOURS = Array.from({ length: 75 }, (_, index) => index);
const STORED_HOURS = Array.from({ length: 96 }, (_, index) => index);
type RowKind = "plan" | "actual" | "maintenance" | "detail-plan" | "detail-maintenance" | "note";
type ActivityRow = { label: string; key: string; kind: RowKind };
type Process = { name: string; tone: string; rows: ActivityRow[]; showInSummary?: boolean };

function utilityRows(): ActivityRow[] { return [
  { label: "Plan", key: "plan", kind: "plan" },
  { label: "Detail activity", key: "plan-detail", kind: "detail-plan" },
  { label: "Actual", key: "actual", kind: "actual" },
  { label: "Utility Note", key: "note", kind: "note" },
]; }

function productionRows(prefix: string): ActivityRow[] {
  return [
    { label: `${prefix} Plan`, key: "prod-plan", kind: "plan" },
    { label: "Detail activity", key: "prod-plan-detail", kind: "detail-plan" },
    { label: `${prefix} Actual`, key: "prod-actual", kind: "actual" },
    { label: "Prod Note", key: "prod-note", kind: "note" },
    { label: "Maintenance Prod Plan", key: "maintenance-prod-plan", kind: "maintenance" },
    { label: "Detail activity", key: "maintenance-prod-plan-detail", kind: "detail-maintenance" },
    { label: "Maintenance Prod Actual", key: "maintenance-prod-actual", kind: "actual" },
    { label: "Main Note", key: "note", kind: "note" },
  ];
}

const PROCESSES: Process[] = [
  { name: "Tipping", tone: "blue", rows: [
    { label: "Tipping Plan", key: "tipping-plan", kind: "plan" },
    { label: "Detail activity", key: "tipping-plan-detail", kind: "detail-plan" },
    { label: "Tipping Actual", key: "tipping-actual", kind: "actual" },
    { label: "Prod Note", key: "prod-note", kind: "note" },
    { label: "Maintenance Plan", key: "maintenance-plan", kind: "maintenance" },
    { label: "Detail activity", key: "maintenance-plan-detail", kind: "detail-maintenance" },
    { label: "Maintenance Actual", key: "maintenance-actual", kind: "actual" },
    { label: "Main Note", key: "note", kind: "note" },
  ] },
  { name: "Roasting", tone: "orange", rows: productionRows("Prod") },
  { name: "Extraction", tone: "emerald", rows: productionRows("Prod") },
  { name: "Evaporation", tone: "cyan", rows: productionRows("Prod") },
  { name: "Freeze Drying", tone: "lime", rows: productionRows("Prod") },
  { name: "F&P", tone: "green", rows: productionRows("Prod") },
  { name: "Boiler", tone: "blue", rows: utilityRows(), showInSummary: false },
  { name: "Grasso", tone: "orange", rows: utilityRows(), showInSummary: false },
  { name: "WTP/WWTP", tone: "emerald", rows: utilityRows(), showInSummary: false },
  { name: "Facility", tone: "cyan", rows: utilityRows(), showInSummary: false },
  { name: "Electric", tone: "lime", rows: utilityRows(), showInSummary: false },
];

type CellMap = Record<string, number>;
type NoteMap = Record<string, string>;
type MergeRange = { start: number; end: number };
type MergeMode = "merge" | "split";
type EditRole = "admin" | "prod" | "main" | null;
const DETAIL_COLORS: Record<string, string> = { blue: "#dbeafe", green: "#dcfce7", red: "#fee2e2", purple: "#ede9fe", white: "#f8fbfd" };
function slug(value: string) { return value.toLowerCase().replaceAll("&", "and").replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/(^-|-$)/g, ""); }
function rowKey(process: string, row: ActivityRow) { return `${slug(process)}-${row.key}`; }
function isoDate(date: Date) { return date.toISOString().slice(0, 10); }
function shortDate(value: string, amount: number) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(date); }
function timelineDateBands(startHour: number) {
  const bands: { offset: number; start: number; span: number }[] = []; let start = 0;
  while (start < HOURS.length) { const absoluteHour = startHour - 1 + start; const offset = Math.floor(absoluteHour / 24); const span = Math.min(24 - (absoluteHour % 24), HOURS.length - start); bands.push({ offset, start, span }); start += span; }
  return bands;
}
function fillClass(value: number) { if (value === 1) return "status-plan"; if (value === 2) return "status-done"; if (value === 3) return "status-late"; return ""; }

function TimelineTextEditor({ value, editable, label, placeholder, hours, onBegin, onChange }: { value: string; editable: boolean; label: string; placeholder: string; hours?: number; onBegin: () => void; onChange: (value: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing && ref.current && ref.current.textContent !== value) ref.current.textContent = value; }, [value, editing]);
  useEffect(() => { if (editing) { ref.current?.focus(); const range = document.createRange(); range.selectNodeContents(ref.current!); range.collapse(false); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); } }, [editing]);
  return <div className="detail-content"><div ref={ref} role="textbox" aria-label={label} contentEditable={editable && editing} suppressContentEditableWarning data-editing={editing ? "true" : "false"} data-placeholder={placeholder} className="timeline-text-editor" onDoubleClick={() => { if (editable) { onBegin(); setEditing(true); } }} onBlur={() => setEditing(false)} onKeyDown={e => { if (e.key === "Escape") { setEditing(false); e.currentTarget.blur(); } }} onInput={e => { const text = e.currentTarget.textContent || ""; if (text.length > 300) { e.currentTarget.textContent = text.slice(0,300); } onChange(text.slice(0,300)); }} />{hours !== undefined && <span className="activity-hours" aria-label={`${hours} giờ`}>({hours})</span>}</div>;
}
type GridPoint = { row: number; hour: number };
type GridSelection = { anchor: GridPoint; end: GridPoint };

export default function ShutdownPlanner() {
  const [cells, setCells] = useState<CellMap>({});
  const [notes, setNotes] = useState<NoteMap>({});
  const [startDate, setStartDate] = useState(isoDate(new Date()));
  const [timelineStartHour, setTimelineStartHour] = useState(1);
  const [editRole, setEditRole] = useState<EditRole>(null);
  const canEdit = editRole !== null;
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const [mergeStart, setMergeStart] = useState(1);
  const [mergeDuration, setMergeDuration] = useState(4);
  const [mergeMode, setMergeMode] = useState<MergeMode>("merge");
  const [autoTarget, setAutoTarget] = useState<string | null>(null);
  const [autoStart, setAutoStart] = useState(1);
  const [autoDuration, setAutoDuration] = useState(1);
  const [autoStatus, setAutoStatus] = useState(1);
  const [detailColor, setDetailColor] = useState("green");
  const [dirty, setDirty] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [hideEmptyRows, setHideEmptyRows] = useState(false);
  const [visibleProcesses, setVisibleProcesses] = useState<Set<string>>(() => new Set(PROCESSES.map((process) => process.name)));
  const selectingRef = useRef(false);
  const dirtyRef = useRef(false);
  const pendingCells = useRef(new Map<string, { rowKey: string; hourIndex: number; value: number }>());
  const pendingNotes = useRef(new Map<string, { rowKey: string; content: string }>());
  const pendingSettings = useRef(new Map<string, { key: string; value: string }>());
  const undoStack = useRef<Array<{ cells: CellMap; notes: NoteMap; startDate: string; timelineStartHour: number }>>([]);
  const selectedTextCellRef = useRef<{ key: string; hour: number } | null>(null);
  const redoStack = useRef<typeof undoStack.current>([]);
  const revisionRef = useRef(0);
  const loadingRef = useRef(false);
  const savedFingerprint = useRef("");
  const timelineRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<GridSelection | null>(null);
  const selectionRef = useRef<GridSelection | null>(null);
  const [pasteDraft, setPasteDraft] = useState<{ grid: ClipGrid; row: number; hour: number } | null>(null);
  const [colorMapping, setColorMapping] = useState<Record<string,string>>({});
  const [message, setMessage] = useState("");
  const [lateDraft, setLateDraft] = useState<{ ids: string[]; cells: CellMap; notes: NoteMap; editing: boolean } | null>(null);
  const [lateReason, setLateReason] = useState("");
  const [lateView, setLateView] = useState<{ id: string; label: string; left: number; top: number } | null>(null);
  const lateViewRef = useRef<HTMLDivElement>(null);
  const pointerStart = useRef({ x: 0, y: 0, dragged: false });
  useEffect(() => {
    if (!lateView) return;
    const outside = (event: PointerEvent) => { if (!lateViewRef.current?.contains(event.target as Node)) setLateView(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setLateView(null); };
    const dismiss = () => setLateView(null);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", dismiss);
    const timeline = timelineRef.current;
    timeline?.addEventListener("scroll", dismiss);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); window.removeEventListener("resize", dismiss); timeline?.removeEventListener("scroll", dismiss); };
  }, [lateView]);
  function viewLate(event: React.MouseEvent<HTMLButtonElement>, id: string, label: string) {
    if (event.shiftKey || (event.detail !== 0 && pointerStart.current.dragged)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setLateView({ id, label, left: Math.max(8, Math.min(rect.left, window.innerWidth - 336)), top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 280)) });
  }
  function commitEdit(nextCells: CellMap, nextNotes: NoteMap) { rememberUndo(); stageSnapshot({ cells: nextCells, notes: nextNotes, startDate, timelineStartHour }); }
  function requestStatusEdit(nextCells: CellMap, nextNotes: NoteMap, ids: string[]) {
    const late = ids.filter(id => { const key = id.slice(0,id.lastIndexOf(":")); return isActualRow(key) && nextCells[id] === 3 && canWriteCell(editRole,key); });
    if (late.length) { setLateReason(""); setLateDraft({ ids: late, cells: nextCells, notes: nextNotes, editing: false }); }
    else commitEdit(nextCells,nextNotes);
  }
  function editLateReason(ids: string[]) {
    setLateView(null);
    const valid = ids.filter(id => { const key = id.slice(0,id.lastIndexOf(":")); return cells[id] === 3 && isActualRow(key) && canWriteCell(editRole,key); });
    if (!valid.length) { setMessage("Chọn ô Late trên dòng Actual thuộc quyền chỉnh sửa."); return; }
    const reasons = new Set(valid.map(id => notes[reasonKey(id)] || ""));
    setLateReason(reasons.size === 1 ? [...reasons][0] : "");
    setLateDraft({ ids: valid, cells: { ...cells }, notes: { ...notes }, editing: true });
  }
  function selectedLateIds() { return bounds ? visibleRows.slice(bounds.top,bounds.bottom+1).flatMap(item => HOURS.slice(bounds.left,bounds.right+1).map(hour => `${item.key}:${hour}`)) : []; }
  function confirmLate(skip = false) {
    if (!lateDraft) return;
    if (lateDraft.ids.some(id => !canWriteNote(editRole,reasonKey(id)))) { setMessage("Quyền chỉnh sửa đã thay đổi."); setLateDraft(null); return; }
    const nextNotes = { ...lateDraft.notes };
    if (!skip) for (const id of lateDraft.ids) nextNotes[reasonKey(id)] = lateReason.trim();
    commitEdit(lateDraft.cells,nextNotes); setLateDraft(null);
    setMessage("Đã cập nhật vùng Late. Bấm Cập nhật để lưu.");
  }

  const [jumpDate, setJumpDate] = useState(0);
  const [jumpHour, setJumpHour] = useState(1);
  const visibleRows = PROCESSES.filter(p => visibleProcesses.has(p.name)).flatMap(process => process.rows.filter(row => !hideEmptyRows || rowHasData(rowKey(process.name, row), row)).map(row => ({ process, row, key: rowKey(process.name, row) })));
  function selectRange(value: GridSelection | null) { selectionRef.current = value; setSelection(value); }
  const bounds = selection ? { top: Math.min(selection.anchor.row, selection.end.row), bottom: Math.max(selection.anchor.row, selection.end.row), left: Math.min(selection.anchor.hour, selection.end.hour), right: Math.max(selection.anchor.hour, selection.end.hour) } : null;
  function inRange(row: number, hour: number, span = 1) { return Boolean(bounds && row >= bounds.top && row <= bounds.bottom && hour <= bounds.right && hour + span - 1 >= bounds.left); }
  function selectPoint(point: GridPoint, extend: boolean) {
    const initial = extend && selectionRef.current ? selectionRef.current.anchor : point;
    let left = Math.min(initial.hour, point.hour), right = Math.max(initial.hour, point.hour);
    const top = Math.min(initial.row, point.row), bottom = Math.max(initial.row, point.row);
    let changed = true;
    while (changed) { changed = false; for (const item of visibleRows.slice(top, bottom + 1)) for (const merge of mergesFor(item.key)) if (merge.end >= left && merge.start <= right) { const l = Math.min(left, merge.start), r = Math.max(right, merge.end); if (l !== left || r !== right) changed = true; left = l; right = r; } }
    selectRange({ anchor: { row: initial.row, hour: initial.hour <= point.hour ? left : right }, end: { row: point.row, hour: initial.hour <= point.hour ? right : left } });
  }
  function gridPointer(event: React.PointerEvent, move = false) {
    if (!move) pointerStart.current = { x: event.clientX, y: event.clientY, dragged: false };
    else if (Math.abs(event.clientX-pointerStart.current.x) + Math.abs(event.clientY-pointerStart.current.y) > 5) pointerStart.current.dragged = true;
    const target = event.target as HTMLElement;
    if (target.closest('[data-editing="true"]')) return;
    const cell = target.closest<HTMLElement>('[data-grid-row]'); if (!cell) return;
    if (move && (!selectingRef.current || event.buttons !== 1)) return;
    if (!move) { if (event.button !== 0) return; event.preventDefault(); selectingRef.current = true; timelineRef.current?.focus({ preventScroll: true }); }
    selectPoint({ row: Number(cell.dataset.gridRow), hour: Number(cell.dataset.gridHour) }, move || event.shiftKey);
  }
  function selectedGrid(): ClipGrid {
    if (!bounds) throw new Error("Chọn vùng timeline cần copy.");
    return visibleRows.slice(bounds.top, bounds.bottom + 1).map(item => HOURS.slice(bounds.left, bounds.right + 1).map(hour => {
      const text = item.row.kind.startsWith("detail") || item.row.kind === "note";
      const merge = mergesFor(item.key).find(m => hour >= m.start && hour <= m.end);
      const v = cells[`${item.key}:${hour}`] || 0;
      return { reason: !text && v === 3 ? notes[reasonKey(`${item.key}:${hour}`)] || "" : undefined, kind: text ? "text" as const : "status" as const, text: text ? notes[`${item.key}-h-${hour}`] || "" : v ? String(v) : "", color: text ? notes[`${item.key}-color-${hour}`] || "white" : v === 1 ? "plan" : v === 2 ? "done" : v === 3 ? "late" : "white", span: text && merge?.start === hour ? merge.end - merge.start + 1 : 1, covered: Boolean(text && merge && merge.start !== hour) };
    }));
  }
  async function copyGrid() { try { const data = encodeClipboard(selectedGrid()); await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([data.html], { type: "text/html" }), "text/plain": new Blob([data.plain], { type: "text/plain" }) })]); setMessage("Đã copy. Chọn ô đích rồi Ctrl+V trong web hoặc Excel."); } catch { setMessage("Hãy chọn vùng và nhấn Ctrl+C để copy."); timelineRef.current?.focus(); } }
  function preparePaste(html: string, plain: string) {
    try {
      if (!canEdit || !bounds) throw new Error("Mở khóa và chọn ô đích trước khi dán.");
      const grid = parseClipboard(html, plain);
      if (!grid.length || !grid[0].length) throw new Error("Clipboard không có dữ liệu.");
      if (bounds.top + grid.length > visibleRows.length || bounds.left + grid[0].length > 75) throw new Error("Vùng dán vượt số dòng đang hiển thị hoặc 75 cột.");
      const rows = visibleRows.slice(bounds.top, bounds.top + grid.length);
      if (rows.some(item => !canEditRow(item.row))) throw new Error("Vùng dán có dòng không được phép chỉnh sửa. Hãy chọn vùng Actual/Note phù hợp với quyền bộ phận của anh.");
      for (const item of rows) if (mergesFor(item.key).some(m => m.end >= bounds.left && m.start < bounds.left + grid[0].length && (m.start < bounds.left || m.end >= bounds.left + grid[0].length))) throw new Error("Vùng đích cắt ngang ô ghép. Hãy tách ô ghép hoặc chọn đích khác.");
      setColorMapping({}); setPasteDraft({ grid, row: bounds.top, hour: bounds.left }); setMessage("");
    } catch (error) { setMessage((error as Error).message); }
  }
  async function pasteFromClipboard() { try { const items = await navigator.clipboard.read(); let html = "", plain = ""; for (const item of items) { if (item.types.includes("text/html")) html = await (await item.getType("text/html")).text(); if (item.types.includes("text/plain")) plain = await (await item.getType("text/plain")).text(); } preparePaste(html, plain); } catch { setMessage("Trình duyệt chưa cho đọc clipboard. Chọn ô đích rồi nhấn Ctrl+V."); timelineRef.current?.focus(); } }
  function applyPaste() {
    if (!pasteDraft) return;
    try {
      const { grid, row: firstRow, hour: firstHour } = pasteDraft;
      const nextCells = { ...cells }, nextNotes = { ...notes };
      for (let r = 0; r < grid.length; r++) {
        const item = visibleRows[firstRow+r]; if (!item || !canEditRow(item.row)) throw new Error("Vùng đích hoặc quyền chỉnh sửa đã thay đổi.");
        const isText = item.row.kind.startsWith("detail") || item.row.kind === "note";
        const merges = mergesFor(item.key).filter(m => m.end < firstHour || m.start >= firstHour + grid[r].length);
        for (let c = 0; c < grid[r].length; c++) {
          const cell = grid[r][c], hour = firstHour+c;
          if (cell.kind && cell.kind !== (isText ? "text" : "status")) throw new Error("Không thể dán Detail/Note vào Plan/Actual hoặc ngược lại.");
          if (!isText) {
            if (cell.span > 1 || cell.covered) throw new Error("Ô ghép chỉ được dán vào Detail/Note.");
            nextCells[`${item.key}:${hour}`] = statusValue(cell, colorMapping);
            if ((cell.reason || "").length > 300) throw new Error("Lý do Late vượt 300 ký tự.");
            if (isActualRow(item.key)) nextNotes[reasonKey(`${item.key}:${hour}`)] = nextCells[`${item.key}:${hour}`] === 3 ? cell.reason || "" : "";
          } else {
            if (cell.text.length > 300) throw new Error("Nội dung một ô vượt 300 ký tự. Hãy chia nhỏ trong Excel trước khi dán.");
            nextNotes[`${item.key}-h-${hour}`] = cell.covered ? "" : cell.text;
            nextNotes[`${item.key}-color-${hour}`] = detailColorFor(cell.color, colorMapping);
            if (cell.span > 1) merges.push({ start: hour, end: hour+cell.span-1 });
          }
        }
        if (isText) nextNotes[`${item.key}-merges`] = JSON.stringify(merges.sort((a,b) => a.start-b.start));
      }
      const pastedLate = grid.flatMap((row,r) => row.flatMap((cell,c) => {
        const item = visibleRows[firstRow+r], id = `${item.key}:${firstHour+c}`;
        return isActualRow(item.key) && nextCells[id] === 3 && !nextNotes[reasonKey(id)] ? [id] : [];
      }));
      requestStatusEdit(nextCells,nextNotes,pastedLate);
      selectRange({ anchor: { row: firstRow, hour: firstHour }, end: { row: firstRow + grid.length - 1, hour: firstHour + grid[0].length - 1 } });
      setPasteDraft(null); setMessage(pastedLate.length ? "Có thể thêm lý do Late hoặc để trống." : "Đã dán. Bấm Cập nhật để lưu; Undo để hoàn tác toàn bộ lần dán.");
    } catch (error) { setMessage((error as Error).message); }
  }
  function clearRange() {
    if (!bounds || !canEdit) return;
    const rows = visibleRows.slice(bounds.top, bounds.bottom+1);
    if (rows.some(item => !canEditRow(item.row))) { setMessage("Vùng chọn có dòng bị khóa; chưa xóa dữ liệu."); return; }
    const nextCells = { ...cells }, nextNotes = { ...notes };
    for (const item of rows) {
      const text = item.row.kind.startsWith("detail") || item.row.kind === "note";
      for (const hour of HOURS.slice(bounds.left,bounds.right+1)) if (text) { nextNotes[`${item.key}-h-${hour}`] = ""; nextNotes[`${item.key}-color-${hour}`] = ""; } else nextCells[`${item.key}:${hour}`] = 0;
      if (text) nextNotes[`${item.key}-merges`] = JSON.stringify(mergesFor(item.key).filter(m => m.end < bounds.left || m.start > bounds.right));
    }
    rememberUndo(); stageSnapshot({ cells: nextCells, notes: nextNotes, startDate, timelineStartHour });
  }
  function jumpToTime() { const index = jumpDate*24 + jumpHour-timelineStartHour; if (index < 0 || index >= 75) { setMessage("Ngày/giờ này nằm ngoài timeline."); return; } const el = timelineRef.current; const cell = el?.querySelector<HTMLElement>(`[data-grid-hour="${index}"]`); if (el && cell) el.scrollTo({ left: Math.max(0, cell.offsetLeft - 208), behavior: "smooth" }); }
  useEffect(() => { undoStack.current = []; redoStack.current = []; selectRange(null); setPasteDraft(null); setLateView(null); setLateDraft(null); }, [editRole]);
  const visibleRowSignature = visibleRows.map(item => item.key).join("|");
  useEffect(() => { selectRange(null); setPasteDraft(null); setLateView(null); }, [visibleRowSignature]);


  async function loadData(showLoading = true) {
    if (loadingRef.current) return;
    loadingRef.current = true; const revision = revisionRef.current;
    if (showLoading) setLoading(true);
    try {
      const [dataResponse, authResponse] = await Promise.all([fetch("/api/shutdown", { cache: "no-store" }), fetch("/api/auth", { cache: "no-store" })]);
      if (!dataResponse.ok || !authResponse.ok) throw new Error("Không tải được dữ liệu. Vui lòng thử lại.");
      const data = await dataResponse.json(), auth = await authResponse.json();
      if (dirtyRef.current || revision !== revisionRef.current) return;
      const nextCells: CellMap = {}; for (const cell of data.cells || []) nextCells[`${cell.rowKey}:${cell.hourIndex}`] = Number(cell.value) || 0;
      const nextNotes: NoteMap = {}; for (const note of data.notes || []) nextNotes[note.rowKey] = note.content;
      const settings = Object.fromEntries((data.settings || []).map((item: { key: string; value: string }) => [item.key, item.value]));
      const fingerprint = dataFingerprint(nextCells, nextNotes, settings.startDate || startDate, Number(settings.timelineStartHour) || timelineStartHour);
      if (savedFingerprint.current && fingerprint !== savedFingerprint.current) { undoStack.current = []; redoStack.current = []; }
      savedFingerprint.current = fingerprint;
      setCells(nextCells); setNotes(nextNotes); if (settings.startDate) setStartDate(settings.startDate); if (settings.timelineStartHour) setTimelineStartHour(Math.max(1, Math.min(24, Number(settings.timelineStartHour) || 1)));
      setEditRole(auth.role === "admin" || auth.role === "prod" || auth.role === "main" ? auth.role : null);
    } catch (error) { setMessage((error as Error).message); }
    finally { loadingRef.current = false; setLoading(false); }
  }
  useEffect(() => { loadData(); }, []);
  useEffect(() => {
    const stopSelecting = () => { selectingRef.current = false; };
    const nativeEditing = (target: EventTarget | null) => target instanceof HTMLElement && Boolean(target.closest('input:not(.timeline-input),textarea,[contenteditable="true"]'));
    const ownsFocus = () => document.activeElement instanceof HTMLElement && Boolean(document.activeElement.closest('.timeline-scroll,.meeting-tools'));
    const copy = (event: ClipboardEvent) => { if (!ownsFocus() || nativeEditing(event.target) || !bounds) return; try { const data = encodeClipboard(selectedGrid()); event.preventDefault(); event.clipboardData?.setData("text/plain", data.plain); event.clipboardData?.setData("text/html", data.html); setMessage("Đã copy vùng timeline."); } catch (error) { setMessage((error as Error).message); } };
    const paste = (event: ClipboardEvent) => { if (!ownsFocus() || nativeEditing(event.target)) return; event.preventDefault(); preparePaste(event.clipboardData?.getData("text/html") || "", event.clipboardData?.getData("text/plain") || ""); };
    const keyboard = (event: KeyboardEvent) => {
      if (nativeEditing(event.target) || !ownsFocus()) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "a") { event.preventDefault(); if (visibleRows.length) selectRange({ anchor: { row: 0, hour: 0 }, end: { row: visibleRows.length-1, hour: 74 } }); return; }
      if (canEdit && mod && (event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey))) { event.preventDefault(); redoLastAction(); return; }
      if (canEdit && mod && event.key.toLowerCase() === "z") { event.preventDefault(); undoLastAction(); return; }
      if (event.key === "Escape") selectRange(null);
      if (event.key === "Delete" && canEdit && bounds) { event.preventDefault(); clearRange(); }
      if (bounds && /^Arrow/.test(event.key)) { event.preventDefault(); const end = selection!.end; selectPoint({ row: Math.max(0, Math.min(visibleRows.length-1, end.row + (event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0))), hour: Math.max(0, Math.min(74, end.hour + (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0))) }, event.shiftKey); }
      if (canEdit && bounds && /^[123]$/.test(event.key) && !mod) { const rows = visibleRows.slice(bounds.top,bounds.bottom+1); if (rows.every(i => canEditRow(i.row) && !i.row.kind.startsWith("detail") && i.row.kind !== "note")) { event.preventDefault(); const next = { ...cells }; const ids: string[] = []; for (const item of rows) for (const h of HOURS.slice(bounds.left,bounds.right+1)) { const id = `${item.key}:${h}`; next[id] = Number(event.key); ids.push(id); } requestStatusEdit(next, { ...notes }, ids); } }
    };
    const leave = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("pointerup", stopSelecting); window.addEventListener("keydown", keyboard); window.addEventListener("copy", copy); window.addEventListener("paste", paste); window.addEventListener("beforeunload", leave);
    return () => { window.removeEventListener("pointerup", stopSelecting); window.removeEventListener("keydown", keyboard); window.removeEventListener("copy", copy); window.removeEventListener("paste", paste); window.removeEventListener("beforeunload", leave); };
  });

  async function unlock() {
    setPinError("");
    const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
    if (!response.ok) { setPinError("Mã PIN không đúng"); return; }
    const data = await response.json(); setEditRole(data.role === "admin" || data.role === "prod" || data.role === "main" ? data.role : null); setPin("");
  }
  async function lock() { if (dirtyRef.current) { setMessage("Bấm Cập nhật trước khi khóa chỉnh sửa."); return; } await fetch("/api/auth", { method: "DELETE" }); setEditRole(null); }
  function canEditRow(row: ActivityRow) { if (editRole === "admin") return true; if (row.kind !== "actual" && row.kind !== "note") return false; const owner = ["prod-actual", "tipping-actual", "prod-note"].includes(row.key) ? "prod" : "main"; return editRole === owner; }
  function markDirty() { dirtyRef.current = true; setDirty(true); }
  function dataFingerprint(c: CellMap, n: NoteMap, date: string, hour: number) { return JSON.stringify([Object.entries(c).filter(([,v]) => v).sort(([a],[b]) => a.localeCompare(b)), Object.entries(n).filter(([,v]) => v).sort(([a],[b]) => a.localeCompare(b)), date, hour]); }
  function snapshot() { return { cells: { ...cells }, notes: { ...notes }, startDate, timelineStartHour }; }
  function rememberUndo() { revisionRef.current++; undoStack.current.push(snapshot()); redoStack.current = []; if (undoStack.current.length > 50) undoStack.current.shift(); }
  function stageSnapshot(previous: ReturnType<typeof snapshot>) {
    previous = { ...previous, notes: reconcileReasons(cells,previous.cells,previous.notes) };
    const cellKeys = new Set([...Object.keys(cells), ...Object.keys(previous.cells)]); for (const id of cellKeys) if ((cells[id] || 0) !== (previous.cells[id] || 0)) { const split = id.lastIndexOf(":"); stageCell(id.slice(0, split), Number(id.slice(split+1)), previous.cells[id] || 0); }
    const noteKeys = new Set([...Object.keys(notes), ...Object.keys(previous.notes)]); for (const key of noteKeys) if ((notes[key] || "") !== (previous.notes[key] || "")) stageNote(key, previous.notes[key] || "");
    if (startDate !== previous.startDate) stageSetting("startDate", previous.startDate); if (timelineStartHour !== previous.timelineStartHour) stageSetting("timelineStartHour", String(previous.timelineStartHour));
    setCells(previous.cells); setNotes(previous.notes); setStartDate(previous.startDate); setTimelineStartHour(previous.timelineStartHour);
  }
  function undoLastAction() { if (!canEdit || saving) return; const previous = undoStack.current.pop(); if (!previous) return; redoStack.current.push(snapshot()); revisionRef.current++; stageSnapshot(previous); }
  function redoLastAction() { if (!canEdit || saving) return; const next = redoStack.current.pop(); if (!next) return; undoStack.current.push(snapshot()); revisionRef.current++; stageSnapshot(next); }
  function stageCell(rowKey: string, hourIndex: number, value: number) { pendingCells.current.set(`${rowKey}:${hourIndex}`, { rowKey, hourIndex, value }); markDirty(); }
  function stageNote(rowKey: string, content: string) { pendingNotes.current.set(rowKey, { rowKey, content }); markDirty(); }
  function stageSetting(key: string, value: string) { pendingSettings.current.set(key, { key, value }); markDirty(); }
  async function saveChanges() {
    if (!canEdit || !dirtyRef.current || saving) return;
    setSaving(true); setMessage("");
    const cellUpdates = [...pendingCells.current.values()], noteUpdates = [...pendingNotes.current.values()], settingUpdates = [...pendingSettings.current.values()];
    const requests: object[] = []; for (let i=0;i<cellUpdates.length;i+=500) requests.push({ cells: cellUpdates.slice(i,i+500) }); for (let i=0;i<noteUpdates.length;i+=50) requests.push({ notes: noteUpdates.slice(i,i+50) }); if (settingUpdates.length) requests.push({ settings: settingUpdates });
    try {
      for (const payload of requests) { const response = await fetch("/api/shutdown", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); if (!response.ok) throw new Error("Chưa lưu hết dữ liệu. Các thay đổi vẫn được giữ; hãy bấm Cập nhật để thử lại."); }
      for (const item of cellUpdates) { const id = `${item.rowKey}:${item.hourIndex}`; if (pendingCells.current.get(id) === item) pendingCells.current.delete(id); }
      for (const item of noteUpdates) if (pendingNotes.current.get(item.rowKey) === item) pendingNotes.current.delete(item.rowKey);
      for (const item of settingUpdates) if (pendingSettings.current.get(item.key) === item) pendingSettings.current.delete(item.key);
      const remaining = Boolean(pendingCells.current.size || pendingNotes.current.size || pendingSettings.current.size); dirtyRef.current = remaining; setDirty(remaining);
      // Acknowledge this saved snapshot so unchanged polling does not erase Undo.
      savedFingerprint.current = dataFingerprint(cells, notes, startDate, timelineStartHour);
      setLastSaved(new Date().toLocaleTimeString("vi-VN", { hour:"2-digit", minute:"2-digit" }));
    } catch (error) { setMessage((error as Error).message); }
    finally { setSaving(false); }
  }
  function updateCell(key: string, hourIndex: number, raw: string) {
    if (!canWriteCell(editRole,key)) return;
    const value = raw === "" ? 0 : Math.max(0,Math.min(3,Number.parseInt(raw.replace(/\D/g,""),10)||0));
    const id = `${key}:${hourIndex}`; requestStatusEdit({ ...cells, [id]:value },{ ...notes },[id]);
  }
  function resetRow(key: string, isTextRow: boolean) {
    if (isTextRow) {
      const keys = [`${key}-merges`, ...STORED_HOURS.flatMap((hour) => [`${key}-h-${hour}`, `${key}-color-${hour}`])];
      setNotes((current) => { const next = { ...current }; for (const noteKey of keys) delete next[noteKey]; return next; });
      for (const noteKey of keys) stageNote(noteKey, "");
    } else {
      setCells((current) => { const next = { ...current }; for (const hour of STORED_HOURS) next[`${key}:${hour}`] = 0; return next; });
      for (const hour of STORED_HOURS) stageCell(key, hour, 0);
      if (isActualRow(key)) { setNotes(current => { const next = { ...current }; for (const hour of STORED_HOURS) next[reasonKey(`${key}:${hour}`)] = ""; return next; }); for (const hour of STORED_HOURS) stageNote(reasonKey(`${key}:${hour}`),""); }

    }
  }
  function resetAllInputs() {
    rememberUndo();
    for (const process of PROCESSES) for (const row of process.rows) resetRow(rowKey(process.name, row), row.kind.startsWith("detail") || row.kind === "note");
    selectedTextCellRef.current = null;
  }
  function resetRowWithConfirm(key: string, isTextRow: boolean, label: string) { if (window.confirm(`Reset toàn bộ dữ liệu dòng “${label}”?`)) { rememberUndo(); resetRow(key, isTextRow); } }
  function rowHasData(key: string, row: ActivityRow) { return row.kind.startsWith("detail") || row.kind === "note" ? HOURS.some((hour) => Boolean(notes[`${key}-h-${hour}`] || notes[`${key}-color-${hour}`])) || mergesFor(key).length > 0 : HOURS.some((hour) => Boolean(cells[`${key}:${hour}`])); }

  function mergesFor(key: string): MergeRange[] {
    try { const parsed = JSON.parse(notes[`${key}-merges`] || "[]") as MergeRange[]; return parsed.filter((item) => Number.isInteger(item.start) && Number.isInteger(item.end) && item.start >= 0 && item.end < HOURS.length && item.start < item.end).sort((a, b) => a.start - b.start); } catch { return []; }
  }
  function openMerge(key: string, mode: MergeMode) { setMergeMode(mode); setMergeTarget(key); setMergeStart(bounds ? bounds.left+1 : 1); setMergeDuration(bounds ? bounds.right-bounds.left+1 : 4); setDetailColor("green"); }
  function splitSelectedMerge(key: string) {
    const selected = selectedTextCellRef.current;
    if (!selected || selected.key !== key) { openMerge(key, "split"); return; }
    const selectedMerge = mergesFor(key).find((range) => selected.hour >= range.start && selected.hour <= range.end);
    if (!selectedMerge) { openMerge(key, "split"); return; }
    rememberUndo();
    const mergeKey = `${key}-merges`; const ranges = mergesFor(key).filter((range) => range.start !== selectedMerge.start || range.end !== selectedMerge.end);
    const updates = [{ rowKey: mergeKey, content: JSON.stringify(ranges) }, ...HOURS.slice(selectedMerge.start, selectedMerge.end + 1).map((hour) => ({ rowKey: `${key}-color-${hour}`, content: "" }))];
    setNotes((current) => { const next = { ...current, [mergeKey]: JSON.stringify(ranges) }; for (let hour = selectedMerge.start; hour <= selectedMerge.end; hour++) delete next[`${key}-color-${hour}`]; return next; });
    for (const update of updates) stageNote(update.rowKey, update.content); selectedTextCellRef.current = null;
  }
  function applyMergeAction() {
    if (!mergeTarget) return;
    rememberUndo();
    const start = Math.max(0, Math.min(HOURS.length - 1, mergeStart - 1)); const duration = Math.max(1, Math.min(HOURS.length - start, mergeDuration)); const end = start + duration - 1;
    const existing = mergesFor(mergeTarget); const remaining = existing.filter((item) => item.end < start || item.start > end);
    const ranges = mergeMode === "merge" ? [...remaining, { start, end }].sort((a, b) => a.start - b.start) : remaining;
    const mergeKey = `${mergeTarget}-merges`; const combined = HOURS.slice(start, end + 1).map((hour) => notes[`${mergeTarget}-h-${hour}`] || "").filter(Boolean).join(" ");
    const colorUpdates = HOURS.slice(start, end + 1).map((hour) => ({ rowKey: `${mergeTarget}-color-${hour}`, content: mergeMode === "merge" ? detailColor : "" }));
    const updates = mergeMode === "merge" ? [{ rowKey: mergeKey, content: JSON.stringify(ranges) }, { rowKey: `${mergeTarget}-h-${start}`, content: combined.slice(0, 300) }, ...HOURS.slice(start + 1, end + 1).map((hour) => ({ rowKey: `${mergeTarget}-h-${hour}`, content: "" })), ...colorUpdates] : [{ rowKey: mergeKey, content: JSON.stringify(ranges) }, ...colorUpdates];
    setNotes((current) => { const next = { ...current, [mergeKey]: JSON.stringify(ranges) }; if (mergeMode === "merge") { next[`${mergeTarget}-h-${start}`] = combined.slice(0, 300); for (let hour = start + 1; hour <= end; hour++) delete next[`${mergeTarget}-h-${hour}`]; for (let hour = start; hour <= end; hour++) next[`${mergeTarget}-color-${hour}`] = detailColor; } else { for (let hour = start; hour <= end; hour++) delete next[`${mergeTarget}-color-${hour}`]; } return next; });
    for (const update of updates) stageNote(update.rowKey, update.content); setMergeTarget(null);
  }
  function openAutoFill(key: string) { setAutoTarget(key); setAutoStart(bounds ? bounds.left+1 : 1); setAutoDuration(bounds ? bounds.right-bounds.left+1 : 1); setAutoStatus(1); }
  function applyAutoFill() {
    if (!autoTarget || !canWriteCell(editRole,autoTarget)) return;
    const start = Math.max(0,Math.min(74,autoStart-1)), duration = Math.max(1,Math.min(75-start,autoDuration));
    const next = { ...cells }; const ids = HOURS.slice(start,start+duration).map(hour=>`${autoTarget}:${hour}`);
    for (const id of ids) next[id] = Math.max(1,Math.min(3,autoStatus));
    setAutoTarget(null); requestStatusEdit(next,{ ...notes },ids);
  }
  function renderTextTimeline(process: Process, row: ActivityRow, key: string) {
    const editable = canEditRow(row); const merges = mergesFor(key); const output = []; let hour = 0;
    while (hour < HOURS.length) {
      const cellHour = hour;
      const merge = merges.find((item) => item.start === cellHour); const span = merge ? merge.end - merge.start + 1 : 1; const textKey = `${key}-h-${cellHour}`;
      const selectedColor = DETAIL_COLORS[notes[`${key}-color-${cellHour}`] || "white"];
      const selectCell = () => { if (editable) { const selected = { key, hour: cellHour }; selectedTextCellRef.current = selected;  } };
      const rowIndex = visibleRows.findIndex(item => item.key === key);
      output.push(<div key={textKey} data-grid-row={rowIndex} data-grid-hour={cellHour} onPointerDown={selectCell} style={{ gridColumn: `span ${span}`, backgroundColor: selectedColor }} className={`timeline-text ${span > 1 ? "merged-text" : ""} ${inRange(rowIndex,cellHour,span) ? "selected-text-cell" : ""} ${(timelineStartHour - 1 + cellHour) % 24 === 0 ? "day-start" : ""}`}><TimelineTextEditor hours={row.kind.startsWith("detail") && (span > 1 || Boolean(notes[textKey])) ? span : undefined} value={notes[textKey] || ""} editable={editable} label={`${process.name} ${row.label}, cột ${cellHour+1}`} placeholder={cellHour === 0 ? (row.kind === "note" ? "Ghi chú…" : "Chi tiết…") : ""} onBegin={rememberUndo} onChange={content => { setNotes(current => ({ ...current, [textKey]: content })); stageNote(textKey,content); }} /></div>);
      hour += span;
    }
    return output;
  }

  const filteredProcesses = useMemo(() => PROCESSES.filter((process) => visibleProcesses.has(process.name)), [visibleProcesses]);
  const dateBands = useMemo(() => timelineDateBands(timelineStartHour), [timelineStartHour]);
  const processSummary = useMemo(() => PROCESSES.filter((process) => process.showInSummary !== false).map((process) => {
    const firstPlan = process.rows.find((row) => row.kind === "plan"); const firstActual = process.rows.find((row) => row.kind === "actual");
    const plan = firstPlan ? HOURS.filter((hour) => cells[`${rowKey(process.name, firstPlan)}:${hour}`]).length : 0;
    const actual = firstActual ? HOURS.filter((hour) => cells[`${rowKey(process.name, firstActual)}:${hour}`]).length : 0;
    return { name: process.name, plan, actual, late: Math.max(0, actual - plan), progress: plan ? Math.min(100, Math.round(actual / plan * 100)) : 0 };
  }), [cells]);
  function exportExcel() {
    const escapeXml = (value: string | number) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const xCell = (value: string | number, style = "Text", comment = "") => `<Cell ss:StyleID="${style}"><Data ss:Type="${typeof value === "number" ? "Number" : "String"}">${escapeXml(value)}</Data>${comment ? `<Comment ss:Author="ILD"><Data xmlns="http://www.w3.org/TR/REC-html40">${escapeXml(comment)}</Data></Comment>` : ""}</Cell>`;
    const summary = processSummary.map((item) => `<Row>${xCell(item.name, "Process")}${xCell(item.plan)}${xCell(item.actual)}${xCell(item.late, item.late > 0 ? "Late-Hours" : "Text")}${xCell(`${item.progress}%`)}</Row>`).join("");
    const timelineRows = filteredProcesses.flatMap((process) => process.rows.filter((row) => !hideEmptyRows || rowHasData(rowKey(process.name, row), row)).map((row) => { const key = rowKey(process.name, row); const isText = row.kind.startsWith("detail") || row.kind === "note"; const timeline = HOURS.map((hour) => { if (isText) { const color = notes[`${key}-color-${hour}`] || "white"; return xCell(notes[`${key}-h-${hour}`] || "", color === "white" ? "Text" : `Detail-${color}`); } const value = cells[`${key}:${hour}`] || ""; return xCell(value, value === 1 ? "Plan" : value === 2 ? "Done" : value === 3 ? "Late" : "Text", value === 3 ? notes[reasonKey(`${key}:${hour}`)] || "" : ""); }).join(""); return `<Row>${xCell(process.name, `Process-${process.tone}`)}${xCell(row.label, `Process-${process.tone}`)}${timeline}${xCell(isText ? "" : HOURS.filter((hour) => cells[`${key}:${hour}`]).length)}</Row>`; })).join("");
    const processStyles = Object.entries({blue:"#DBEAFE",orange:"#FFEDD5",emerald:"#D1FAE5",cyan:"#CFFAFE",lime:"#ECFCCB",green:"#BBF7D0"}).map(([name,color]) => `<Style ss:ID="Process-${name}"><Font ss:Bold="1"/><Interior ss:Color="${color}" ss:Pattern="Solid"/><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>`).join("");
    const styles = `<Styles><Style ss:ID="Default"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Calibri" ss:Size="10"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9E5EB"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9E5EB"/></Borders></Style><Style ss:ID="Text"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/></Style><Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#0284C7" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style><Style ss:ID="Process"><Font ss:Bold="1"/></Style><Style ss:ID="Plan"><Font ss:Color="#94A3B8"/><Interior ss:Color="#94A3B8" ss:Pattern="Solid"/></Style><Style ss:ID="Done"><Font ss:Color="#10B981"/><Interior ss:Color="#10B981" ss:Pattern="Solid"/></Style><Style ss:ID="Late"><Font ss:Color="#EF3340"/><Interior ss:Color="#EF3340" ss:Pattern="Solid"/></Style><Style ss:ID="Late-Hours"><Font ss:Bold="1" ss:Color="#DC2626"/><Interior ss:Color="#FEE2E2" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style><Style ss:ID="Detail-blue"><Interior ss:Color="#DBEAFE" ss:Pattern="Solid"/></Style><Style ss:ID="Detail-green"><Interior ss:Color="#DCFCE7" ss:Pattern="Solid"/></Style><Style ss:ID="Detail-red"><Interior ss:Color="#FEE2E2" ss:Pattern="Solid"/></Style><Style ss:ID="Detail-purple"><Interior ss:Color="#EDE9FE" ss:Pattern="Solid"/></Style>${processStyles}</Styles>`;
    const hours = HOURS.map((hour) => xCell(((timelineStartHour - 1 + hour) % 24) + 1, "Header")).join(""); const dates = dateBands.map((band) => `<Cell ss:StyleID="Header" ss:MergeAcross="${band.span - 1}"><Data ss:Type="String">${shortDate(startDate, band.offset)}</Data></Cell>`).join(""); const counts = HOURS.map((hour) => xCell(hour + 1, "Header")).join("");
    const workbook = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><DocumentProperties xmlns="urn:schemas-microsoft-com:office:office"><Title>shutdown-plan.ild</Title></DocumentProperties>${styles}<Worksheet ss:Name="Shutdown Plan"><Table><Column ss:Width="85"/><Column ss:Width="145"/><Column ss:Index="3" ss:Width="25" ss:Span="74"/><Row><Cell ss:StyleID="Header" ss:MergeAcross="4"><Data ss:Type="String">SUMMARY - ${escapeXml(startDate)}</Data></Cell></Row><Row>${xCell("Process","Header")}${xCell("Plan (h)","Header")}${xCell("Actual (h)","Header")}${xCell("Late (h)","Header")}${xCell("Progress","Header")}</Row>${summary}<Row/><Row>${xCell("Process","Header")}${xCell("Activities","Header")}${dates}${xCell("Counter","Header")}</Row><Row>${xCell("","Header")}${xCell("Time","Header")}${hours}${xCell("","Header")}</Row><Row>${xCell("","Header")}${xCell("Count","Header")}${counts}${xCell("","Header")}</Row>${timelineRows}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>3</SplitHorizontal><TopRowBottomPane>3</TopRowBottomPane><SplitVertical>2</SplitVertical><LeftColumnRightPane>2</LeftColumnRightPane></WorksheetOptions></Worksheet></Workbook>`;
    const blob = new Blob([workbook], { type: "application/vnd.ms-excel;charset=utf-8" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `ILD-Shutdown-Plan-${startDate}.xls`; anchor.click(); URL.revokeObjectURL(url);
  }
  return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#e0f2fe_0,transparent_30%),linear-gradient(145deg,#f8fbff,#effcf7)] text-slate-900">
    <header className="border-b border-sky-100 bg-white/90 backdrop-blur-xl"><div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
      <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-sky-500 to-emerald-400 text-white shadow-lg shadow-sky-200"><Activity size={23}/></div><div><h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">shutdown-plan.ild</h1><p className="text-sm text-slate-500">Theo dõi kế hoạch & thực tế theo từng giờ</p></div></div>
      <div className="flex items-center gap-2">{canEdit && <Button variant="outline" className="rounded-xl border-sky-200 bg-white text-sky-700" onClick={undoLastAction} disabled={!undoStack.current.length}><Undo2/> Undo</Button>}{editRole === "admin" && <AlertDialog><AlertDialogTrigger asChild><Button variant="outline" className="rounded-xl border-red-200 bg-white text-red-600 hover:bg-red-50"><RotateCcw/> Reset tất cả</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Xóa toàn bộ dữ liệu đã nhập?</AlertDialogTitle><AlertDialogDescription>Plan, Actual, Detail activity, Note, màu và ô ghép sẽ trở về mặc định. Ngày bắt đầu được giữ nguyên và chỉ lưu chính thức khi bấm Cập nhật.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Hủy</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={resetAllInputs}>Reset toàn bộ</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}<Button variant="outline" className="rounded-xl border-emerald-200 bg-white text-emerald-700" onClick={exportExcel}><Download/> Export Excel</Button><Button className="rounded-xl bg-sky-600 text-white" onClick={() => canEdit ? saveChanges() : loadData()} disabled={saving || (canEdit && !dirty)}><RefreshCw className={saving || loading ? "animate-spin" : ""}/> {saving ? "Đang lưu" : "Cập nhật"}</Button>{canEdit && <Button className="rounded-xl bg-slate-900 text-white" onClick={lock}><LockKeyhole/> Khóa chỉnh sửa</Button>}</div>
    </div></header>

    <section className="mx-auto max-w-[1800px] space-y-4 px-4 py-5 sm:px-6">
      {!canEdit && <div className="pin-bar"><div><strong><UnlockKeyhole size={18}/> Nhập PIN để chỉnh sửa</strong><span>Người không có PIN vẫn xem được toàn bộ tiến độ.</span></div><form onSubmit={(event) => { event.preventDefault(); unlock(); }}><input type="password" value={pin} onChange={(event) => setPin(event.target.value.slice(0, 20))} placeholder="Nhập PIN" aria-label="Mã PIN chỉnh sửa"/><Button type="submit" className="bg-sky-600 text-white">Mở khóa</Button></form>{pinError && <p>{pinError}</p>}</div>}

      <div className="meeting-overview"><div className="meeting-date"><div className="card-bright"><span className="kpi-icon bg-sky-100 text-sky-700"><CalendarDays size={20}/></span><div><p className="kpi-label">Ngày bắt đầu</p><input type="date" value={startDate} disabled={editRole !== "admin"} onChange={(e) => { rememberUndo(); setStartDate(e.target.value); stageSetting("startDate", e.target.value); }} className="mt-1 bg-transparent text-lg font-bold outline-none disabled:opacity-100"/></div></div></div><div className="status-bars"><div className="status-group"><strong>Trạng thái:</strong><span className="legend"><i className="bg-slate-400"/>1 · Plan</span><span className="legend"><i className="bg-emerald-500"/>2 · Done</span><span className="legend"><i className="bg-red-500"/>3 · Late</span></div><div className="status-group detail-status"><strong>Detail activity:</strong><span className="legend"><i className="bg-green-200"/>Có sản phẩm</span><span className="legend"><i className="bg-blue-200"/>Flushing / Manual cleaning</span><span className="legend"><i className="bg-red-200"/>Hoạt động nguy hiểm</span><span className="legend"><i className="bg-purple-200"/>Hoạt động bảo trì</span></div></div></div>

      <div className="process-summary-grid">{processSummary.map((item) => <article key={item.name} className={`process-summary-card ${item.late > 0 ? "has-late" : ""}`}><div><strong>{item.name}</strong><span>{item.progress}%</span></div><dl><div><dt>Plan</dt><dd>{item.plan}h</dd></div><div><dt>Actual</dt><dd>{item.actual}h</dd></div><div className="late-summary"><dt>Late</dt><dd>{item.late}h</dd></div></dl><Progress value={item.progress} className="h-2 bg-slate-100"/></article>)}</div>



      <div className="meeting-tools">
        {canEdit && <span className="role-label">{editRole === "admin" ? "Admin" : editRole === "prod" ? "Production" : "Maintenance / Utility"}</span>}
        <button onClick={() => { if (visibleRows.length) { selectRange({ anchor: { row:0,hour:0 },end:{row:visibleRows.length-1,hour:74} }); timelineRef.current?.focus(); } }}>Chọn toàn bộ ({visibleRows.length} dòng)</button>
        <button disabled={!bounds} onClick={() => { if (bounds) selectRange({ anchor: {row:bounds.top,hour:0},end:{row:bounds.bottom,hour:74} }); }}>Chọn cả dòng</button>
        <button disabled={!bounds} onClick={copyGrid}>Copy</button>
        <button disabled={!canEdit || !bounds} onClick={pasteFromClipboard}>Paste</button>
        <button disabled={!canEdit || !bounds} onClick={clearRange}>Xóa vùng</button>
        <button disabled={!canEdit || !bounds} onClick={()=>editLateReason(selectedLateIds())}>Lý do Late</button>
        <button disabled={!canEdit || saving || !undoStack.current.length} onClick={undoLastAction}>Undo</button>
        <button disabled={!canEdit || saving || !redoStack.current.length} onClick={redoLastAction}>Redo</button>
        <button className="save-action" disabled={!canEdit || !dirty || saving} onClick={saveChanges}>{saving ? "Đang lưu…" : "Cập nhật"}</button>
        <label>Đến <select aria-label="Ngày cần xem" value={jumpDate} onChange={e => setJumpDate(Number(e.target.value))}>{dateBands.map(b => <option key={b.offset} value={b.offset}>{shortDate(startDate,b.offset)}</option>)}</select></label>
        <input aria-label="Giờ cần xem" type="number" min={1} max={24} value={jumpHour} onChange={e=>setJumpHour(Math.max(1,Math.min(24,Number(e.target.value)||1)))}/><button onClick={jumpToTime}>Đến giờ</button>
        <span>{bounds ? `${bounds.bottom-bounds.top+1} dòng × ${bounds.right-bounds.left+1} cột · cột ${bounds.left+1}–${bounds.right+1}` : "Chọn vùng hoặc Shift + chọn ô cuối; nhấp đúp để sửa chữ"}</span>
        <div className="status-actions">{<label className="empty-filter"><input type="checkbox" checked={hideEmptyRows} onChange={(event) => setHideEmptyRows(event.target.checked)}/>Ẩn dòng timeline trống</label>}<span>{saving ? "Đang lưu…" : dirty ? "Có thay đổi chưa lưu — bấm Cập nhật" : lastSaved ? `Đã lưu lúc ${lastSaved}` : canEdit ? "Kéo chọn ô; Delete để xóa" : "Chế độ chỉ xem"}</span></div>
      </div>
      {message && <div role="status" className="meeting-message">{message}</div>}
      <div className="overflow-hidden rounded-3xl border border-sky-100 bg-white shadow-xl shadow-sky-100/70"><div className="timeline-scroll" ref={timelineRef} tabIndex={0} onPointerDownCapture={e => gridPointer(e)} onPointerMove={e => gridPointer(e,true)} aria-label="Timeline: chọn vùng, Ctrl+C, Ctrl+V; nhấp đúp để sửa chữ"><div className="schedule-grid min-w-max">
        <div className="sticky-head sticky-process top-row process-filter-head" style={{ gridRow: "span 3" }}><span>Process</span><button type="button" onClick={() => setFilterOpen(true)} aria-label="Lọc process"><Filter size={12}/> Lọc</button></div><div className="sticky-head sticky-activity top-row">Activities</div>{dateBands.map((band) => <div key={`${band.offset}-${band.start}`} className="date-band" style={{ gridColumn: `${3 + band.start} / span ${band.span}` }}>{shortDate(startDate, band.offset)}</div>)}<div className="sticky-head sticky-activity hour-row">Time</div>{HOURS.map((hour) => hour === 0 ? <input key="time-start" className="hour-cell header-start-input day-start" type="number" min="1" max="24" disabled={editRole !== "admin"} value={timelineStartHour} onChange={(event) => { const value = Math.max(1, Math.min(24, Number(event.target.value) || 1)); rememberUndo(); setTimelineStartHour(value); stageSetting("timelineStartHour", String(value)); }} aria-label="Giờ bắt đầu timeline"/> : <div key={hour} className={`hour-cell ${(timelineStartHour - 1 + hour) % 24 === 0 ? "day-start" : ""}`}>{((timelineStartHour - 1 + hour) % 24) + 1}</div>)}<div className="counter-head">Counter</div><div className="reset-head">Reset</div><div className="sticky-head sticky-activity count-row">Count</div>{HOURS.map((hour) => <div key={`count-${hour}`} className={`count-cell ${(timelineStartHour - 1 + hour) % 24 === 0 ? "day-start" : ""}`}>{hour + 1}</div>)}
        {filteredProcesses.flatMap((process) => { const rows = process.rows.filter((row) => !hideEmptyRows || rowHasData(rowKey(process.name, row), row)); return rows.flatMap((row, index) => { const key = rowKey(process.name, row); const count = HOURS.filter((hour) => cells[`${key}:${hour}`] > 0).length; const isTextRow = row.kind.startsWith("detail") || row.kind === "note"; const editable = canEditRow(row); return [index === 0 ? <div key={`${key}-process`} className={`process-cell process-${process.tone}`} style={{ gridRow: `span ${rows.length}` }}>{process.name}</div> : null,<div key={`${key}-activity`} className={`activity-cell process-${process.tone} ${isTextRow ? "detail-row" : ""}`}><span>{row.label}</span>{editable && (isTextRow ? <span className="merge-actions"><button type="button" onClick={() => openMerge(key, "merge")}>Ghép & màu</button><button type="button" onClick={() => splitSelectedMerge(key)}>Tách</button></span> : <button type="button" className="auto-fill-button" onClick={() => openAutoFill(key)}>Tự điền</button>)}</div>,...(isTextRow ? renderTextTimeline(process, row, key) : HOURS.map((hour) => { const id = `${key}:${hour}`; const value = cells[id] || 0; const reason = value === 3 && row.kind === "actual" ? notes[reasonKey(id)] || "" : "";
          return <button type="button" key={id} data-grid-row={visibleRows.findIndex(item => item.key === key)} data-grid-hour={hour} tabIndex={-1} aria-label={`${process.name} ${row.label}, giờ ${((timelineStartHour-1+hour)%24)+1}${value === 3 ? `, Late: ${reason || "Chưa có lý do"}` : ""}`} title={value === 3 && row.kind === "actual" ? `Late: ${reason || "Chưa bổ sung lý do — bấm để xem"}` : undefined} onClick={event => { if (value === 3 && row.kind === "actual") viewLate(event,id,`${process.name} · ${row.label} · ${shortDate(startDate,Math.floor((timelineStartHour-1+hour)/24))} · Giờ ${((timelineStartHour-1+hour)%24)+1}`); }} onDoubleClick={() => { if (value === 3 && row.kind === "actual" && editable) editLateReason([id]); }} className={`timeline-input ${fillClass(value)} ${inRange(visibleRows.findIndex(item => item.key === key),hour) ? "selected-cell" : ""} ${(timelineStartHour-1+hour)%24 === 0 ? "day-start" : ""}`}>
            {value === 3 && row.kind === "actual" && <span className={`late-note-marker ${reason ? "has-reason" : ""}`} aria-hidden="true">{reason ? "●" : "+"}</span>}
          </button>;})),<div key={`${key}-counter`} className={`counter-cell ${isTextRow ? "detail-timeline" : ""}`}>{isTextRow ? "—" : count || "—"}</div>,<div key={`${key}-reset`} className={`row-reset-cell ${isTextRow ? "detail-timeline" : ""}`}>{editable && <button type="button" onClick={() => resetRowWithConfirm(key, isTextRow, `${process.name} – ${row.label}`)} title={`Reset ${row.label}`}><RotateCcw size={12}/></button>}</div>]; }); })}
      </div></div></div>
    </section>
    {lateView && cells[lateView.id] === 3 && <div ref={lateViewRef} role="dialog" aria-label="Thông tin Late" className="late-view" style={{ left: lateView.left, top: lateView.top }}>
      <div className="late-view-heading"><strong>Lý do Late</strong><button type="button" aria-label="Đóng thông tin Late" onClick={() => setLateView(null)}>×</button></div>
      <p className="late-view-meta">{lateView.label}</p>
      <p className="late-view-reason">{notes[reasonKey(lateView.id)] || "Chưa bổ sung lý do"}</p>
      {canWriteNote(editRole,reasonKey(lateView.id)) && <Button size="sm" onClick={() => editLateReason([lateView.id])}>Sửa lý do</Button>}
    </div>}
    <Dialog open={Boolean(lateDraft)} onOpenChange={open=>{if(!open)setLateDraft(null);}}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>{lateDraft?.editing ? "Chỉnh sửa lý do Late" : "Lý do Late (không bắt buộc)"}</DialogTitle><DialogDescription>Áp dụng cho {lateDraft?.ids.length || 0} ô Actual. Có thể để trống và bổ sung sau bằng cách nhấp đúp ô đỏ hoặc chọn vùng rồi bấm Lý do Late.</DialogDescription></DialogHeader><label className="late-reason-label">Lý do<textarea value={lateReason} onChange={e=>setLateReason(e.target.value.slice(0,300))} maxLength={300} rows={4} placeholder="Ví dụ: Chờ maintenance xử lý van…"/></label><small>{lateReason.length}/300 ký tự · Chỉ lưu chính thức khi bấm Cập nhật.</small><DialogFooter><Button variant="outline" onClick={()=>setLateDraft(null)}>Hủy</Button>{!lateDraft?.editing && <Button variant="outline" onClick={()=>confirmLate(true)}>Để trống / Bổ sung sau</Button>}<Button onClick={()=>confirmLate(false)}>Xác nhận</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(pasteDraft)} onOpenChange={open => { if (!open) setPasteDraft(null); }}><DialogContent className="paste-dialog"><DialogHeader><DialogTitle>Xem trước vùng dán</DialogTitle><DialogDescription>Dán vào các dòng đang hiển thị. Nội dung, màu và ô ghép hiện có trong vùng này sẽ được thay thế, kể cả ô trống.</DialogDescription></DialogHeader>{pasteDraft && <div data-paste-preview><p>{visibleRows[pasteDraft.row]?.process.name} · {visibleRows[pasteDraft.row]?.row.label} · cột {pasteDraft.hour+1}–{pasteDraft.hour+pasteDraft.grid[0].length} · {pasteDraft.grid.length} dòng</p><div className="paste-table"><table><tbody>{pasteDraft.grid.map((row,r)=><tr key={r}>{row.map((cell,c)=>cell.covered ? null : <td key={c} colSpan={cell.span} style={{background:palette[colorMapping[cell.color] || cell.color] || "#ffffff"}}>{cell.text || " "}</td>)}</tr>)}</tbody></table></div>{Array.from(new Set(pasteDraft.grid.flatMap((row,r)=>row.filter(cell => { const target=visibleRows[pasteDraft.row+r]; try { if (target.row.kind.startsWith("detail") || target.row.kind === "note") detailColorFor(cell.color); else if (!cell.text.trim()) statusValue(cell); return false; } catch { return true; } }).map(cell=>cell.color)))).map(color=><label className="color-map" key={color}>Màu {color}<select value={colorMapping[color] || ""} onChange={e=>setColorMapping(m=>({...m,[color]:e.target.value}))}><option value="">Chọn cách chuyển đổi…</option><option value="white">Không màu / Trống</option><option value="plan">Plan (1)</option><option value="green">Xanh lá / Done (2)</option><option value="red">Đỏ / Late (3)</option><option value="blue">Xanh dương · Cleaning</option><option value="purple">Tím · Maintenance</option></select></label>)}{message && <p role="alert">{message}</p>}</div>}<DialogFooter><Button variant="outline" onClick={()=>setPasteDraft(null)}>Hủy</Button><Button onClick={applyPaste}>Dán và thay thế vùng</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(mergeTarget)} onOpenChange={(open) => { if (!open) setMergeTarget(null); }}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>{mergeMode === "merge" ? "Ghép ô và tô màu" : "Tách vùng timeline"}</DialogTitle><DialogDescription>Chọn cột bắt đầu và số ô trong phạm vi 1–75.</DialogDescription></DialogHeader><div className="auto-fill-form"><label>Cột bắt đầu (1–75)<input type="number" min="1" max="75" value={mergeStart} onChange={(event) => setMergeStart(Number(event.target.value))}/></label><label>Số ô<input type="number" min="1" max="75" value={mergeDuration} onChange={(event) => setMergeDuration(Number(event.target.value))}/></label>{mergeMode === "merge" && <label>Màu Detail activity<select value={detailColor} onChange={(event) => setDetailColor(event.target.value)}><option value="white">Không màu</option><option value="green">Xanh lá · Có sản phẩm</option><option value="blue">Xanh dương · Flushing / Manual cleaning</option><option value="red">Đỏ · Hoạt động nguy hiểm</option><option value="purple">Tím · Hoạt động bảo trì</option></select></label>}</div><DialogFooter><Button variant="outline" onClick={() => setMergeTarget(null)}>Hủy</Button><Button onClick={applyMergeAction}>{mergeMode === "merge" ? "Ghép và tô màu" : "Tách vùng"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(autoTarget)} onOpenChange={(open) => { if (!open) setAutoTarget(null); }}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>Tự động điền timeline</DialogTitle><DialogDescription>Nhập vị trí bắt đầu, số giờ và trạng thái. Bạn vẫn có thể sửa từng ô thủ công.</DialogDescription></DialogHeader><div className="auto-fill-form"><label>Vị trí bắt đầu (1–75)<input type="number" min="1" max="75" value={autoStart} onChange={(event) => setAutoStart(Number(event.target.value))}/></label><label>Số giờ<input type="number" min="1" max="75" value={autoDuration} onChange={(event) => setAutoDuration(Number(event.target.value))}/></label><label>Trạng thái<select value={autoStatus} onChange={(event) => setAutoStatus(Number(event.target.value))}><option value={1}>1 · Plan</option><option value={2}>2 · Done</option><option value={3}>3 · Late</option></select></label></div><DialogFooter><Button variant="outline" onClick={() => setAutoTarget(null)}>Hủy</Button><Button onClick={applyAutoFill}>Điền timeline</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={filterOpen} onOpenChange={setFilterOpen}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Lọc timeline</DialogTitle><DialogDescription>Chọn process và có thể ẩn những dòng chưa có dữ liệu.</DialogDescription></DialogHeader><label className="empty-row-filter"><input type="checkbox" checked={hideEmptyRows} onChange={(event) => setHideEmptyRows(event.target.checked)}/><span>Ẩn các dòng timeline trống</span></label><div className="process-filter-list">{PROCESSES.map((process) => <label key={process.name}><input type="checkbox" checked={visibleProcesses.has(process.name)} onChange={() => setVisibleProcesses((current) => { const next = new Set(current); if (next.has(process.name)) next.delete(process.name); else next.add(process.name); return next; })}/><span>{process.name}</span></label>)}</div><DialogFooter><Button variant="outline" className="text-red-600" onClick={() => setVisibleProcesses(new Set())}>Clear all</Button><Button variant="outline" onClick={() => setVisibleProcesses(new Set(PROCESSES.map((process) => process.name)))}>Chọn tất cả</Button><Button onClick={() => setFilterOpen(false)}>Áp dụng ({visibleProcesses.size})</Button></DialogFooter></DialogContent></Dialog>
  </main>;
}
