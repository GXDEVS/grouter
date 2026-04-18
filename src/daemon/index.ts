import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";

const DAEMON_DIR = join(homedir(), ".grouter");

export const PID_FILE = join(DAEMON_DIR, "server.pid");
export const LOG_FILE = join(DAEMON_DIR, "server.log");

export function readPid(): number | null {
  try {
    if (!existsSync(PID_FILE)) return null;
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch { return null; }
}

export function writePid(pid: number): void {
  writeFileSync(PID_FILE, String(pid), "utf-8");
}

export function removePid(): void {
  try { unlinkSync(PID_FILE); } catch {}
}

export function isRunning(): boolean {
  const pid = readPid();
  if (!pid) return false;
  try {
    process.kill(pid, 0); // signal 0 = existence check
    return true;
  } catch {
    removePid();
    return false;
  }
}
