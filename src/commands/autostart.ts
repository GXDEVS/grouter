import { mkdirSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { execSync } from "node:child_process";
import chalk from "chalk";
import { getProxyPort, getSetting, setSetting } from "../db/index.ts";

const SERVICE_NAME = "grouter";
const SYSTEMD_DIR = join(homedir(), ".config/systemd/user");
const SERVICE_PATH = join(SYSTEMD_DIR, `${SERVICE_NAME}.service`);

function isDocker(): boolean {
  return process.env.GROUTER_IN_DOCKER === "1" || existsSync("/.dockerenv");
}

function isLinux(): boolean {
  return platform() === "linux";
}

function hasSystemd(): boolean {
  try {
    execSync("systemctl --user daemon-reload 2>/dev/null", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function getGrouterBinary(): string {
  try {
    return execSync("which grouter 2>/dev/null", { encoding: "utf-8" }).trim();
  } catch {
    return "grouter";
  }
}

export function installAutoStart(): { ok: boolean; message: string } {
  if (isDocker()) {
    return {
      ok: false,
      message: "Docker containers handle restart via restart policy. Auto-start is not needed.",
    };
  }

  if (!isLinux()) {
    return {
      ok: false,
      message: `System auto-start is only supported on Linux. Current platform: ${platform()}.`,
    };
  }

  if (!hasSystemd()) {
    return {
      ok: false,
      message: "systemd user service not available. Install systemd or use a different init system.",
    };
  }

  const binary = getGrouterBinary();
  const port = getProxyPort();

  const serviceContent = `[Unit]
Description=grouter-auth proxy
After=network.target

[Service]
Type=simple
ExecStart=${binary} serve fg --port ${port}
Restart=on-failure
RestartSec=5
Environment=HOME=${homedir()}

[Install]
WantedBy=default.target
`;

  try {
    mkdirSync(SYSTEMD_DIR, { recursive: true });
    writeFileSync(SERVICE_PATH, serviceContent);
    execSync("systemctl --user daemon-reload", { stdio: "ignore" });
    execSync("systemctl --user enable grouter.service", { stdio: "ignore" });
    setSetting("auto_start", "true");
    return {
      ok: true,
      message: `Auto-start installed. grouter will start on boot (port ${port}).`,
    };
  } catch (err) {
    return {
      ok: false,
      message: `Failed to install auto-start: ${(err as Error).message}`,
    };
  }
}

export function uninstallAutoStart(): { ok: boolean; message: string } {
  if (isDocker()) {
    return { ok: false, message: "Docker containers handle restart via restart policy." };
  }

  if (!isLinux()) {
    return { ok: false, message: `System auto-start is only supported on Linux.` };
  }

  try {
    execSync("systemctl --user disable grouter.service 2>/dev/null", { stdio: "ignore" });
    if (existsSync(SERVICE_PATH)) unlinkSync(SERVICE_PATH);
    execSync("systemctl --user daemon-reload 2>/dev/null", { stdio: "ignore" });
    setSetting("auto_start", "false");
    return { ok: true, message: "Auto-start uninstalled." };
  } catch (err) {
    return {
      ok: false,
      message: `Failed to uninstall auto-start: ${(err as Error).message}`,
    };
  }
}

export function getAutoStartStatus(): { enabled: boolean; installed: boolean; platform: string; isDocker: boolean } {
  return {
    enabled: getSetting("auto_start") === "true",
    installed: existsSync(SERVICE_PATH),
    platform: platform(),
    isDocker: isDocker(),
  };
}
