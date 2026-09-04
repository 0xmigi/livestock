export type Activity = {
  sig: string;
  action: string;
  ts: number;
};

const KEY = "season-activity";

export function readActivity(): Activity[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Activity[];
  } catch {
    return [];
  }
}

export function pushActivity(action: string, sig: string) {
  const next = [{ sig, action, ts: Date.now() }, ...readActivity()].slice(0, 20);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
