import type { Mode } from "../domain/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (n: number) => String(n).padStart(2, "0");

export const formatDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};
export const formatDateTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};
export const formatSessionTime = (iso: string, now = new Date()) => {
  const d = new Date(iso);
  const today = d.toDateString() === now.toDateString();
  return today ? `today ${p2(d.getHours())}:${p2(d.getMinutes())}` : formatDateTime(iso);
};

export const MODE_TEXT: Record<Mode, string> = { "take-notes": "Take notes", reproduce: "Reproduce a method" };

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const fmtNum = (n: number, digits = 1) => n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: digits });
