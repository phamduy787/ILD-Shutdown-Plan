export type EditRole = "admin" | "prod" | "main";
export const productionProcesses = ["tipping", "roasting", "extraction", "evaporation", "freeze-drying", "fandp"];
export const utilityProcesses = ["boiler", "grasso", "wtp-wwtp", "facility", "electric"];
const prodActual = new Set(productionProcesses.map(p => `${p}-${p === "tipping" ? "tipping" : "prod"}-actual`));
const mainActual = new Set([...productionProcesses.map(p => `${p}-${p === "tipping" ? "maintenance" : "maintenance-prod"}-actual`), ...utilityProcesses.map(p => `${p}-actual`)]);
const prodNotes = new Set(productionProcesses.map(p => `${p}-prod-note`));
const mainNotes = new Set([...productionProcesses, ...utilityProcesses].map(p => `${p}-note`));
const planRows = new Set([...productionProcesses.flatMap(p => [ `${p}-${p === "tipping" ? "tipping" : "prod"}-plan`, `${p}-${p === "tipping" ? "maintenance" : "maintenance-prod"}-plan` ]), ...utilityProcesses.map(p => `${p}-plan`)]);
const detailRows = new Set([...planRows].map(p => `${p}-detail`));
export function isActualRow(key: string) { return prodActual.has(key) || mainActual.has(key); }
export function canWriteCell(role: EditRole | null, key: string) {
  if (role === "admin") return planRows.has(key) || isActualRow(key);
  return role === "prod" ? prodActual.has(key) : role === "main" ? mainActual.has(key) : false;
}
export function canWriteNote(role: EditRole | null, key: string) {
  const reason = key.match(/^(.*)-reason-(\d+)$/);
  if (reason) return Number(reason[2]) < 96 && isActualRow(reason[1]) && canWriteCell(role, reason[1]);
  const match = key.match(/^(.*?)(?:-(?:h|color)-(\d+)|-merges)?$/);
  if (!match || (match[2] !== undefined && Number(match[2]) > 95)) return false;
  const row = match[1];
  return role === "admin" ? prodNotes.has(row) || mainNotes.has(row) || detailRows.has(row) : role === "prod" ? prodNotes.has(row) : role === "main" ? mainNotes.has(row) : false;
}
export function reasonKey(id: string) { const split = id.lastIndexOf(":"); return `${id.slice(0,split)}-reason-${id.slice(split+1)}`; }
export function reconcileReasons(before: Record<string,number>, after: Record<string,number>, notes: Record<string,string>) {
  const next = { ...notes };
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if ((before[id] || 0) !== (after[id] || 0) && after[id] !== 3 && isActualRow(id.slice(0,id.lastIndexOf(":")))) next[reasonKey(id)] = "";
  }
  return next;
}
