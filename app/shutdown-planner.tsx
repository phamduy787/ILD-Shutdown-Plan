"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
]; }

function productionRows(prefix: string): ActivityRow[] {
  return [
    { label: `${prefix} Plan`, key: "prod-plan", kind: "plan" },
    { label: "Detail activity", key: "prod-plan-detail", kind: "detail-plan" },
    { label: `${prefix} Actual`, key: "prod-actual", kind: "actual" },
    { label: "Maintenance Prod Plan", key: "maintenance-prod-plan", kind: "maintenance" },
    { label: "Detail activity", key: "maintenance-prod-plan-detail", kind: "detail-maintenance" },
    { label: "Maintenance Prod Actual", key: "maintenance-prod-actual", kind: "actual" },
    { label: "Note", key: "note", kind: "note" },
  ];
}

const PROCESSES: Process[] = [
  { name: "Tipping", tone: "blue", rows: [
    { label: "Tipping Plan", key: "tipping-plan", kind: "plan" },
    { label: "Detail activity", key: "tipping-plan-detail", kind: "detail-plan" },
    { label: "Tipping Actual", key: "tipping-actual", kind: "actual" },
    { label: "Maintenance Plan", key: "maintenance-plan", kind: "maintenance" },
    { label: "Detail activity", key: "maintenance-plan-detail", kind: "detail-maintenance" },
    { label: "Maintenance Actual", key: "maintenance-actual", kind: "actual" },
    { label: "Note", key: "note", kind: "note" },
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
type EditRole = "admin" | "input" | null;
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
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());const clipboardCellsRef = useRef<Map<string, number>>(new Map());
  const [selectedTextCell, setSelectedTextCell] = useState<{ key: string; hour: number } | null>(null);
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

  async function loadData(showLoading = true) {
    if (showLoading) setLoading(true);
    const [dataResponse, authResponse] = await Promise.all([fetch("/api/shutdown", { cache: "no-store" }), fetch("/api/auth", { cache: "no-store" })]);
    const data = await dataResponse.json(); const auth = await authResponse.json();
    const nextCells: CellMap = {}; for (const cell of data.cells || []) nextCells[`${cell.rowKey}:${cell.hourIndex}`] = Number(cell.value) || 0;
    const nextNotes: NoteMap = {}; for (const note of data.notes || []) nextNotes[note.rowKey] = note.content;
    const settings = Object.fromEntries((data.settings || []).map((item: { key: string; value: string }) => [item.key, item.value]));
    setCells(nextCells); setNotes(nextNotes); if (settings.startDate) setStartDate(settings.startDate); if (settings.timelineStartHour) setTimelineStartHour(Math.max(1, Math.min(24, Number(settings.timelineStartHour) || 1))); undoStack.current = []; setEditRole(auth.role === "admin" || auth.role === "input" ? auth.role : null); setLoading(false);
  }
  useEffect(() => { loadData(); const timer = window.setInterval(() => { if (!dirtyRef.current) loadData(false); }, 5000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    const stopSelecting = () => { selectingRef.current = false; };
    const handleKeyboard = (event: KeyboardEvent) => {
      
  if (
    canEdit &&
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "z" &&
    !event.shiftKey
  ) {
    event.preventDefault();
    undoLastAction();
    return;
  }

  if (
    canEdit &&
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "c" &&
    selectedCells.size
  ) {
    event.preventDefault();console.log("COPY", [...selectedCells]);

    const copied = new Map<string, number>();

    for (const id of selectedCells) {
      copied.set(id, cells[id] || 0);
    }

    clipboardCellsRef.current = copied;
    return;
  }

  if (
    canEdit &&
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "v" &&
    selectedCells.size &&
    clipboardCellsRef.current.size
  ) {
    event.preventDefault();console.log("PASTE", [...selectedCells]);

    rememberUndo();

    const copiedValues = [
      ...clipboardCellsRef.current.values(),
    ];

    let index = 0;

    setCells((current) => {
      const next = { ...current };

      for (const id of selectedCells) {
        const value =
          copiedValues[
            Math.min(index, copiedValues.length - 1)
          ];

        next[id] = value;

        const split = id.lastIndexOf(":");

        stageCell(
          id.slice(0, split),
          Number(id.slice(split + 1)),
          value
        );

        index++;
      }

      return next;
    });

    markDirty();
    return;
  }

  if (event.key === "Delete" && canEdit && selectedCells.size) {
    event.preventDefault();
    clearSelectedCells();
  }
};

    window.addEventListener("pointerup", stopSelecting); window.addEventListener("keydown", handleKeyboard);
    return () => { window.removeEventListener("pointerup", stopSelecting); window.removeEventListener("keydown", handleKeyboard); };
  }, [canEdit, selectedCells]);

  async function unlock() {
    setPinError("");
    const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
    if (!response.ok) { setPinError("Mã PIN không đúng"); return; }
    const data = await response.json(); setEditRole(data.role === "admin" || data.role === "input" ? data.role : null); setPin("");
  }
  async function lock() { await fetch("/api/auth", { method: "DELETE" }); setEditRole(null); }
  function canEditRow(row: ActivityRow) { return editRole === "admin" || (editRole === "input" && (row.kind === "actual" || row.kind === "note")); }
  function markDirty() { dirtyRef.current = true; setDirty(true); }
  function rememberUndo() { undoStack.current.push({ cells: { ...cells }, notes: { ...notes }, startDate, timelineStartHour }); if (undoStack.current.length > 50) undoStack.current.shift(); }
  function undoLastAction() {
    const previous = undoStack.current.pop(); if (!previous || !canEdit) return;
    const cellKeys = new Set([...Object.keys(cells), ...Object.keys(previous.cells)]); for (const id of cellKeys) { if ((cells[id] || 0) !== (previous.cells[id] || 0)) { const split = id.lastIndexOf(":"); stageCell(id.slice(0, split), Number(id.slice(split + 1)), previous.cells[id] || 0); } }
    const noteKeys = new Set([...Object.keys(notes), ...Object.keys(previous.notes)]); for (const key of noteKeys) if ((notes[key] || "") !== (previous.notes[key] || "")) stageNote(key, previous.notes[key] || "");
    if (startDate !== previous.startDate) stageSetting("startDate", previous.startDate); if (timelineStartHour !== previous.timelineStartHour) stageSetting("timelineStartHour", String(previous.timelineStartHour));
    setCells(previous.cells); setNotes(previous.notes); setStartDate(previous.startDate); setTimelineStartHour(previous.timelineStartHour); setSelectedCells(new Set()); selectedTextCellRef.current = null; setSelectedTextCell(null);
  }
  function stageCell(rowKey: string, hourIndex: number, value: number) { pendingCells.current.set(`${rowKey}:${hourIndex}`, { rowKey, hourIndex, value }); markDirty(); }
  function stageNote(rowKey: string, content: string) { pendingNotes.current.set(rowKey, { rowKey, content }); markDirty(); }
  function stageSetting(key: string, value: string) { pendingSettings.current.set(key, { key, value }); markDirty(); }
  async function saveChanges() {
  if (!canEdit || !dirtyRef.current) return;

  try {
    setSaving(true);

    const cellUpdates = [...pendingCells.current.values()];
    const noteUpdates = [...pendingNotes.current.values()];
    const settingUpdates = [...pendingSettings.current.values()];

    const requests: object[] = [];

    for (let i = 0; i < cellUpdates.length; i += 500) {
      requests.push({ cells: cellUpdates.slice(i, i + 500) });
    }

    for (let i = 0; i < noteUpdates.length; i += 50) {
      requests.push({ notes: noteUpdates.slice(i, i + 50) });
    }

    if (settingUpdates.length) {
      requests.push({ settings: settingUpdates });
    }

    let ok = true;

    for (const payload of requests) {
  const response = await fetch("/api/shutdown", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  console.log(
    "SAVE STATUS",
    response.status,
    payload
  );

  if (!response.ok) {
    console.log(
      "SAVE RESPONSE",
      await response.text()
    );
  }

  if (!response.ok) {
    ok = false;
  }

  if (response.status === 403) {
    setEditRole(null);
  }
}

      if (!response.ok) {
        ok = false;
        console.error(await response.text());
      }

      if (response.status === 403) {
        setEditRole(null);
      }
    }

    if (ok) {
      pendingCells.current.clear();
      pendingNotes.current.clear();
      pendingSettings.current.clear();

      dirtyRef.current = false;
      setDirty(false);

      setLastSaved(
        new Date().toLocaleTimeString("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
        })
      );
    }
  } catch (error) {
    console.error("SAVE ERROR:", error);
  } finally {
    setSaving(false);
  }
}
  function updateCell(key: string, hourIndex: number, raw: string) {
    if (!canEdit) return; const value = raw === "" ? 0 : Math.max(0, Math.min(3, Number.parseInt(raw.replace(/\D/g, ""), 10) || 0));
    rememberUndo();
    setCells((current) => ({ ...current, [`${key}:${hourIndex}`]: value })); stageCell(key, hourIndex, value);
  }
  function beginCellSelection(id: string, additive: boolean) { if (!canEdit) return; selectingRef.current = true; setSelectedCells((current) => { const next = additive ? new Set(current) : new Set<string>(); if (additive && next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function extendCellSelection(id: string, buttons: number) { if (!canEdit || !selectingRef.current || buttons !== 1) return; setSelectedCells((current) => new Set(current).add(id)); }
  function clearSelectedCells() { rememberUndo(); const selected = [...selectedCells]; setCells((current) => { const next = { ...current }; for (const id of selected) next[id] = 0; return next; }); for (const id of selected) { const split = id.lastIndexOf(":"); stageCell(id.slice(0, split), Number(id.slice(split + 1)), 0); } setSelectedCells(new Set()); }

  function resetRow(key: string, isTextRow: boolean) {
    if (isTextRow) {
      const keys = [`${key}-merges`, ...STORED_HOURS.flatMap((hour) => [`${key}-h-${hour}`, `${key}-color-${hour}`])];
      setNotes((current) => { const next = { ...current }; for (const noteKey of keys) delete next[noteKey]; return next; });
      for (const noteKey of keys) stageNote(noteKey, "");
    } else {
      setCells((current) => { const next = { ...current }; for (const hour of STORED_HOURS) next[`${key}:${hour}`] = 0; return next; });
      for (const hour of STORED_HOURS) stageCell(key, hour, 0);
    }
  }
  function resetAllInputs() {
    rememberUndo();
    for (const process of PROCESSES) for (const row of process.rows) resetRow(rowKey(process.name, row), row.kind.startsWith("detail") || row.kind === "note");
    setSelectedCells(new Set()); selectedTextCellRef.current = null; setSelectedTextCell(null);
  }
  function resetRowWithConfirm(key: string, isTextRow: boolean, label: string) { if (window.confirm(`Reset toàn bộ dữ liệu dòng “${label}”?`)) { rememberUndo(); resetRow(key, isTextRow); } }
  function rowHasData(key: string, row: ActivityRow) { return row.kind.startsWith("detail") || row.kind === "note" ? HOURS.some((hour) => Boolean(notes[`${key}-h-${hour}`] || notes[`${key}-color-${hour}`])) || mergesFor(key).length > 0 : HOURS.some((hour) => Boolean(cells[`${key}:${hour}`])); }

  function mergesFor(key: string): MergeRange[] {
    try { const parsed = JSON.parse(notes[`${key}-merges`] || "[]") as MergeRange[]; return parsed.filter((item) => Number.isInteger(item.start) && Number.isInteger(item.end) && item.start >= 0 && item.end < HOURS.length && item.start < item.end).sort((a, b) => a.start - b.start); } catch { return []; }
  }
  function openMerge(key: string, mode: MergeMode) { setMergeMode(mode); setMergeTarget(key); setMergeStart(1); setMergeDuration(4); setDetailColor("green"); }
  function splitSelectedMerge(key: string) {
    const selected = selectedTextCellRef.current;
    if (!selected || selected.key !== key) { openMerge(key, "split"); return; }
    const selectedMerge = mergesFor(key).find((range) => selected.hour >= range.start && selected.hour <= range.end);
    if (!selectedMerge) { openMerge(key, "split"); return; }
    rememberUndo();
    const mergeKey = `${key}-merges`; const ranges = mergesFor(key).filter((range) => range.start !== selectedMerge.start || range.end !== selectedMerge.end);
    const updates = [{ rowKey: mergeKey, content: JSON.stringify(ranges) }, ...HOURS.slice(selectedMerge.start, selectedMerge.end + 1).map((hour) => ({ rowKey: `${key}-color-${hour}`, content: "" }))];
    setNotes((current) => { const next = { ...current, [mergeKey]: JSON.stringify(ranges) }; for (let hour = selectedMerge.start; hour <= selectedMerge.end; hour++) delete next[`${key}-color-${hour}`]; return next; });
    for (const update of updates) stageNote(update.rowKey, update.content); selectedTextCellRef.current = null; setSelectedTextCell(null);
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
  function openAutoFill(key: string) { setAutoTarget(key); setAutoStart(1); setAutoDuration(1); setAutoStatus(1); }
  function applyAutoFill() {
    if (!autoTarget) return; const start = Math.max(0, Math.min(HOURS.length - 1, autoStart - 1)); const duration = Math.max(1, Math.min(HOURS.length - start, autoDuration)); const value = Math.max(1, Math.min(3, autoStatus));
    rememberUndo();
    const updates = HOURS.slice(start, start + duration).map((hourIndex) => ({ rowKey: autoTarget, hourIndex, value }));
    setCells((current) => { const next = { ...current }; for (const item of updates) next[`${item.rowKey}:${item.hourIndex}`] = item.value; return next; });
    for (const update of updates) stageCell(update.rowKey, update.hourIndex, update.value); setAutoTarget(null);
  }
  function renderTextTimeline(process: Process, row: ActivityRow, key: string) {
    const editable = canEditRow(row); const merges = mergesFor(key); const output = []; let hour = 0;
    while (hour < HOURS.length) {
      const cellHour = hour;
      const merge = merges.find((item) => item.start === cellHour); const span = merge ? merge.end - merge.start + 1 : 1; const textKey = `${key}-h-${cellHour}`;
      const selectedColor = row.kind.startsWith("detail") ? DETAIL_COLORS[notes[`${key}-color-${cellHour}`] || "white"] : undefined;
      const selectCell = () => { if (editable) { const selected = { key, hour: cellHour }; selectedTextCellRef.current = selected; setSelectedTextCell(selected); } };
      output.push(<div key={textKey} onPointerDown={selectCell} style={{ gridColumn: `span ${span}`, backgroundColor: selectedColor }} className={`timeline-text ${span > 1 ? "merged-text" : ""} ${selectedTextCell?.key === key && selectedTextCell.hour === cellHour ? "selected-text-cell" : ""} ${(timelineStartHour - 1 + cellHour) % 24 === 0 ? "day-start" : ""}`}><div role="textbox" aria-label={`${process.name} ${row.label}, giờ ${cellHour + 1}`} contentEditable={editable} suppressContentEditableWarning onFocus={rememberUndo} onInput={(event) => { const editor = event.currentTarget; const content = (editor.textContent || "").slice(0, 300); setNotes((current) => ({ ...current, [textKey]: content })); stageNote(textKey, content); window.requestAnimationFrame(() => { const selection = window.getSelection(); if (!selection || !editor.isConnected) return; const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false); selection.removeAllRanges(); selection.addRange(range); }); }} data-placeholder={cellHour === 0 ? (row.kind === "note" ? "Ghi chú…" : "Chi tiết…") : ""} className="timeline-text-editor">{notes[textKey] || ""}</div></div>);
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
    const xCell = (value: string | number, style = "Text") => `<Cell ss:StyleID="${style}"><Data ss:Type="${typeof value === "number" ? "Number" : "String"}">${escapeXml(value)}</Data></Cell>`;
    const summary = processSummary.map((item) => `<Row>${xCell(item.name, "Process")}${xCell(item.plan)}${xCell(item.actual)}${xCell(item.late, item.late > 0 ? "Late-Hours" : "Text")}${xCell(`${item.progress}%`)}</Row>`).join("");
    const timelineRows = filteredProcesses.flatMap((process) => process.rows.filter((row) => !hideEmptyRows || rowHasData(rowKey(process.name, row), row)).map((row) => { const key = rowKey(process.name, row); const isText = row.kind.startsWith("detail") || row.kind === "note"; const timeline = HOURS.map((hour) => { if (isText) { const color = notes[`${key}-color-${hour}`] || "white"; return xCell(notes[`${key}-h-${hour}`] || "", color === "white" ? "Text" : `Detail-${color}`); } const value = cells[`${key}:${hour}`] || ""; return xCell(value, value === 1 ? "Plan" : value === 2 ? "Done" : value === 3 ? "Late" : "Text"); }).join(""); return `<Row>${xCell(process.name, `Process-${process.tone}`)}${xCell(row.label, `Process-${process.tone}`)}${timeline}${xCell(isText ? "" : HOURS.filter((hour) => cells[`${key}:${hour}`]).length)}</Row>`; })).join("");
    const processStyles = Object.entries({blue:"#DBEAFE",orange:"#FFEDD5",emerald:"#D1FAE5",cyan:"#CFFAFE",lime:"#ECFCCB",green:"#BBF7D0"}).map(([name,color]) => `<Style ss:ID="Process-${name}"><Font ss:Bold="1"/><Interior ss:Color="${color}" ss:Pattern="Solid"/><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>`).join("");
    const styles = `<Styles><Style ss:ID="Default"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Calibri" ss:Size="10"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9E5EB"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9E5EB"/></Borders></Style><Style ss:ID="Text"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/></Style><Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#0284C7" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style><Style ss:ID="Process"><Font ss:Bold="1"/></Style><Style ss:ID="Plan"><Font ss:Color="#94A3B8"/><Interior ss:Color="#94A3B8" ss:Pattern="Solid"/></Style><Style ss:ID="Done"><Font ss:Color="#10B981"/><Interior ss:Color="#10B981" ss:Pattern="Solid"/></Style><Style ss:ID="Late"><Font ss:Color="#EF3340"/><Interior ss:Color="#EF3340" ss:Pattern="Solid"/></Style><Style ss:ID="Late-Hours"><Font ss:Bold="1" ss:Color="#DC2626"/><Interior ss:Color="#FEE2E2" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style><Style ss:ID="Detail-blue"><Interior ss:Color="#DBEAFE" ss:Pattern="Solid"/></Style><Style ss:ID="Detail-green"><Interior ss:Color="#DCFCE7" ss:Pattern="Solid"/></Style><Style ss:ID="Detail-red"><Interior ss:Color="#FEE2E2" ss:Pattern="Solid"/></Style><Style ss:ID="Detail-purple"><Interior ss:Color="#EDE9FE" ss:Pattern="Solid"/></Style>${processStyles}</Styles>`;
    const hours = HOURS.map((hour) => xCell(((timelineStartHour - 1 + hour) % 24) + 1, "Header")).join(""); const dates = dateBands.map((band) => `<Cell ss:StyleID="Header" ss:MergeAcross="${band.span - 1}"><Data ss:Type="String">${shortDate(startDate, band.offset)}</Data></Cell>`).join(""); const counts = HOURS.map((hour) => xCell(hour + 1, "Header")).join("");
    const workbook = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><DocumentProperties xmlns="urn:schemas-microsoft-com:office:office"><Title>ILD Shutdown Plan</Title></DocumentProperties>${styles}<Worksheet ss:Name="Shutdown Plan"><Table><Column ss:Width="85"/><Column ss:Width="145"/><Column ss:Index="3" ss:Width="25" ss:Span="74"/><Row><Cell ss:StyleID="Header" ss:MergeAcross="4"><Data ss:Type="String">SUMMARY - ${escapeXml(startDate)}</Data></Cell></Row><Row>${xCell("Process","Header")}${xCell("Plan (h)","Header")}${xCell("Actual (h)","Header")}${xCell("Late (h)","Header")}${xCell("Progress","Header")}</Row>${summary}<Row/><Row>${xCell("Process","Header")}${xCell("Activities","Header")}${dates}${xCell("Counter","Header")}</Row><Row>${xCell("","Header")}${xCell("Time","Header")}${hours}${xCell("","Header")}</Row><Row>${xCell("","Header")}${xCell("Count","Header")}${counts}${xCell("","Header")}</Row>${timelineRows}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>3</SplitHorizontal><TopRowBottomPane>3</TopRowBottomPane><SplitVertical>2</SplitVertical><LeftColumnRightPane>2</LeftColumnRightPane></WorksheetOptions></Worksheet></Workbook>`;
    const blob = new Blob([workbook], { type: "application/vnd.ms-excel;charset=utf-8" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `ILD-Shutdown-Plan-${startDate}.xls`; anchor.click(); URL.revokeObjectURL(url);
  }
  return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#e0f2fe_0,transparent_30%),linear-gradient(145deg,#f8fbff,#effcf7)] text-slate-900">
    <header className="border-b border-sky-100 bg-white/90 backdrop-blur-xl"><div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
      <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-sky-500 to-emerald-400 text-white shadow-lg shadow-sky-200"><Activity size={23}/></div><div><h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">ILD Shutdown Plan</h1><p className="text-sm text-slate-500">Theo dõi kế hoạch & thực tế theo từng giờ</p></div></div>
      <div className="flex items-center gap-2">{canEdit && <Button variant="outline" className="rounded-xl border-sky-200 bg-white text-sky-700" onClick={undoLastAction} disabled={!undoStack.current.length}><Undo2/> Undo</Button>}{editRole === "admin" && <AlertDialog><AlertDialogTrigger asChild><Button variant="outline" className="rounded-xl border-red-200 bg-white text-red-600 hover:bg-red-50"><RotateCcw/> Reset tất cả</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Xóa toàn bộ dữ liệu đã nhập?</AlertDialogTitle><AlertDialogDescription>Plan, Actual, Detail activity, Note, màu và ô ghép sẽ trở về mặc định. Ngày bắt đầu được giữ nguyên và chỉ lưu chính thức khi bấm Cập nhật.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Hủy</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={resetAllInputs}>Reset toàn bộ</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}<Button variant="outline" className="rounded-xl border-emerald-200 bg-white text-emerald-700" onClick={exportExcel}><Download/> Export Excel</Button><Button className="rounded-xl bg-sky-600 text-white" onClick={() => canEdit ? saveChanges() : loadData()} disabled={saving || (canEdit && !dirty)}><RefreshCw className={saving || loading ? "animate-spin" : ""}/> {saving ? "Đang lưu" : "Cập nhật"}</Button>{canEdit && <Button className="rounded-xl bg-slate-900 text-white" onClick={lock}><LockKeyhole/> Khóa chỉnh sửa</Button>}</div>
    </div></header>

    <section className="mx-auto max-w-[1800px] space-y-4 px-4 py-5 sm:px-6">
      {!canEdit && <div className="pin-bar"><div><strong><UnlockKeyhole size={18}/> Nhập PIN để chỉnh sửa</strong><span>Người không có PIN vẫn xem được toàn bộ tiến độ.</span></div><form onSubmit={(event) => { event.preventDefault(); unlock(); }}><input type="password" value={pin} onChange={(event) => setPin(event.target.value.slice(0, 20))} placeholder="Nhập PIN" aria-label="Mã PIN chỉnh sửa"/><Button type="submit" className="bg-sky-600 text-white">Mở khóa</Button></form>{pinError && <p>{pinError}</p>}</div>}

      <div className="max-w-sm"><div className="card-bright"><span className="kpi-icon bg-sky-100 text-sky-700"><CalendarDays size={20}/></span><div><p className="kpi-label">Ngày bắt đầu</p><input type="date" value={startDate} disabled={editRole !== "admin"} onChange={(e) => { rememberUndo(); setStartDate(e.target.value); stageSetting("startDate", e.target.value); }} className="mt-1 bg-transparent text-lg font-bold outline-none disabled:opacity-100"/></div></div></div>

      <div className="process-summary-grid">{processSummary.map((item) => <article key={item.name} className={`process-summary-card ${item.late > 0 ? "has-late" : ""}`}><div><strong>{item.name}</strong><span>{item.progress}%</span></div><dl><div><dt>Plan</dt><dd>{item.plan}h</dd></div><div><dt>Actual</dt><dd>{item.actual}h</dd></div><div className="late-summary"><dt>Late</dt><dd>{item.late}h</dd></div></dl><Progress value={item.progress} className="h-2 bg-slate-100"/></article>)}</div>

      <div className="status-bars"><div className="status-group"><strong>Trạng thái:</strong><span className="legend"><i className="bg-slate-400"/>1 · Plan</span><span className="legend"><i className="bg-emerald-500"/>2 · Done</span><span className="legend"><i className="bg-red-500"/>3 · Late</span></div><div className="status-group detail-status"><strong>Detail activity:</strong><span className="legend"><i className="bg-green-200"/>Có sản phẩm</span><span className="legend"><i className="bg-blue-200"/>Flushing / Manual cleaning</span><span className="legend"><i className="bg-red-200"/>Hoạt động nguy hiểm</span><span className="legend"><i className="bg-purple-200"/>Hoạt động bảo trì</span></div><div className="status-actions">{canEdit && <label className="empty-filter"><input type="checkbox" checked={hideEmptyRows} onChange={(event) => setHideEmptyRows(event.target.checked)}/>Ẩn dòng timeline trống</label>}{canEdit && selectedCells.size > 0 && <button type="button" className="delete-selection" onClick={clearSelectedCells}>Xóa {selectedCells.size} ô đã chọn</button>}<span>{saving ? "Đang lưu…" : dirty ? "Có thay đổi chưa lưu — bấm Cập nhật" : lastSaved ? `Đã lưu lúc ${lastSaved}` : canEdit ? "Kéo chọn ô; Delete để xóa" : "Chế độ chỉ xem"}</span></div></div>

      <div className="overflow-hidden rounded-3xl border border-sky-100 bg-white shadow-xl shadow-sky-100/70"><div className="timeline-scroll"><div className="schedule-grid min-w-max">
        <div className="sticky-head sticky-process top-row process-filter-head" style={{ gridRow: "span 3" }}><span>Process</span><button type="button" onClick={() => setFilterOpen(true)} aria-label="Lọc process"><Filter size={12}/> Lọc</button></div><div className="sticky-head sticky-activity top-row">Activities</div>{dateBands.map((band) => <div key={`${band.offset}-${band.start}`} className="date-band" style={{ gridColumn: `${3 + band.start} / span ${band.span}` }}>{shortDate(startDate, band.offset)}</div>)}<div className="sticky-head sticky-activity hour-row">Time</div>{HOURS.map((hour) => hour === 0 ? <input key="time-start" className="hour-cell header-start-input day-start" type="number" min="1" max="24" disabled={editRole !== "admin"} value={timelineStartHour} onChange={(event) => { const value = Math.max(1, Math.min(24, Number(event.target.value) || 1)); rememberUndo(); setTimelineStartHour(value); stageSetting("timelineStartHour", String(value)); }} aria-label="Giờ bắt đầu timeline"/> : <div key={hour} className={`hour-cell ${(timelineStartHour - 1 + hour) % 24 === 0 ? "day-start" : ""}`}>{((timelineStartHour - 1 + hour) % 24) + 1}</div>)}<div className="counter-head">Counter</div><div className="reset-head">Reset</div><div className="sticky-head sticky-activity count-row">Count</div>{HOURS.map((hour) => <div key={`count-${hour}`} className={`count-cell ${(timelineStartHour - 1 + hour) % 24 === 0 ? "day-start" : ""}`}>{hour + 1}</div>)}
        {filteredProcesses.flatMap((process) => { const rows = process.rows.filter((row) => !hideEmptyRows || rowHasData(rowKey(process.name, row), row)); return rows.flatMap((row, index) => { const key = rowKey(process.name, row); const count = HOURS.filter((hour) => cells[`${key}:${hour}`] > 0).length; const isTextRow = row.kind.startsWith("detail") || row.kind === "note"; const editable = canEditRow(row); return [index === 0 ? <div key={`${key}-process`} className={`process-cell process-${process.tone}`} style={{ gridRow: `span ${rows.length}` }}>{process.name}</div> : null,<div key={`${key}-activity`} className={`activity-cell process-${process.tone} ${isTextRow ? "detail-row" : ""}`}><span>{row.label}</span>{editable && (isTextRow ? <span className="merge-actions"><button type="button" onClick={() => openMerge(key, "merge")}>Ghép & màu</button><button type="button" onClick={() => splitSelectedMerge(key)}>Tách</button></span> : <button type="button" className="auto-fill-button" onClick={() => openAutoFill(key)}>Tự điền</button>)}</div>,...(isTextRow ? renderTextTimeline(process, row, key) : HOURS.map((hour) => { const id = `${key}:${hour}`; const value = cells[id] || 0; return <input key={id} aria-label={`${process.name} ${row.label}, giờ ${((timelineStartHour - 1 + hour) % 24) + 1}`} inputMode="numeric" disabled={!editable} value={value || ""} onChange={(e) => updateCell(key, hour, e.target.value)} onPointerDown={(e) => beginCellSelection(id, e.ctrlKey || e.metaKey)} onPointerEnter={(e) => extendCellSelection(id, e.buttons)} className={`timeline-input ${fillClass(value)} ${selectedCells.has(id) ? "selected-cell" : ""} ${(timelineStartHour - 1 + hour) % 24 === 0 ? "day-start" : ""}`}/>;})),<div key={`${key}-counter`} className={`counter-cell ${isTextRow ? "detail-timeline" : ""}`}>{isTextRow ? "—" : count || "—"}</div>,<div key={`${key}-reset`} className={`row-reset-cell ${isTextRow ? "detail-timeline" : ""}`}>{editable && <button type="button" onClick={() => resetRowWithConfirm(key, isTextRow, `${process.name} – ${row.label}`)} title={`Reset ${row.label}`}><RotateCcw size={12}/></button>}</div>]; }); })}
      </div></div></div>
    </section>
    <Dialog open={Boolean(mergeTarget)} onOpenChange={(open) => { if (!open) setMergeTarget(null); }}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>{mergeMode === "merge" ? "Ghép ô và tô màu" : "Tách vùng timeline"}</DialogTitle><DialogDescription>Chọn cột bắt đầu và số ô trong phạm vi 1–75.</DialogDescription></DialogHeader><div className="auto-fill-form"><label>Cột bắt đầu (1–75)<input type="number" min="1" max="75" value={mergeStart} onChange={(event) => setMergeStart(Number(event.target.value))}/></label><label>Số ô<input type="number" min="1" max="75" value={mergeDuration} onChange={(event) => setMergeDuration(Number(event.target.value))}/></label>{mergeMode === "merge" && <label>Màu Detail activity<select value={detailColor} onChange={(event) => setDetailColor(event.target.value)}><option value="white">Không màu</option><option value="green">Xanh lá · Có sản phẩm</option><option value="blue">Xanh dương · Flushing / Manual cleaning</option><option value="red">Đỏ · Hoạt động nguy hiểm</option><option value="purple">Tím · Hoạt động bảo trì</option></select></label>}</div><DialogFooter><Button variant="outline" onClick={() => setMergeTarget(null)}>Hủy</Button><Button onClick={applyMergeAction}>{mergeMode === "merge" ? "Ghép và tô màu" : "Tách vùng"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(autoTarget)} onOpenChange={(open) => { if (!open) setAutoTarget(null); }}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>Tự động điền timeline</DialogTitle><DialogDescription>Nhập vị trí bắt đầu, số giờ và trạng thái. Bạn vẫn có thể sửa từng ô thủ công.</DialogDescription></DialogHeader><div className="auto-fill-form"><label>Vị trí bắt đầu (1–75)<input type="number" min="1" max="75" value={autoStart} onChange={(event) => setAutoStart(Number(event.target.value))}/></label><label>Số giờ<input type="number" min="1" max="75" value={autoDuration} onChange={(event) => setAutoDuration(Number(event.target.value))}/></label><label>Trạng thái<select value={autoStatus} onChange={(event) => setAutoStatus(Number(event.target.value))}><option value={1}>1 · Plan</option><option value={2}>2 · Done</option><option value={3}>3 · Late</option></select></label></div><DialogFooter><Button variant="outline" onClick={() => setAutoTarget(null)}>Hủy</Button><Button onClick={applyAutoFill}>Điền timeline</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={filterOpen} onOpenChange={setFilterOpen}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Lọc timeline</DialogTitle><DialogDescription>Chọn process và có thể ẩn những dòng chưa có dữ liệu.</DialogDescription></DialogHeader><label className="empty-row-filter"><input type="checkbox" checked={hideEmptyRows} onChange={(event) => setHideEmptyRows(event.target.checked)}/><span>Ẩn các dòng timeline trống</span></label><div className="process-filter-list">{PROCESSES.map((process) => <label key={process.name}><input type="checkbox" checked={visibleProcesses.has(process.name)} onChange={() => setVisibleProcesses((current) => { const next = new Set(current); if (next.has(process.name)) next.delete(process.name); else next.add(process.name); return next; })}/><span>{process.name}</span></label>)}</div><DialogFooter><Button variant="outline" className="text-red-600" onClick={() => setVisibleProcesses(new Set())}>Clear all</Button><Button variant="outline" onClick={() => setVisibleProcesses(new Set(PROCESSES.map((process) => process.name)))}>Chọn tất cả</Button><Button onClick={() => setFilterOpen(false)}>Áp dụng ({visibleProcesses.size})</Button></DialogFooter></DialogContent></Dialog>
  </main>;
}
