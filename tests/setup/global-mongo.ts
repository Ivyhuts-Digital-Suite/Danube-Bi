import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    mongoUri: string | null;
    mongoUnavailableReason: string | null;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

function findMongod(): string | null {
  if (process.env.MONGOD_PATH && fs.existsSync(process.env.MONGOD_PATH)) return process.env.MONGOD_PATH;
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["mongod"], { encoding: "utf8" });
  if (probe.status === 0) return probe.stdout.split(/\r?\n/)[0].trim() || null;
  return null;
}

async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const sock = net.connect(port, "127.0.0.1");
      sock.once("connect", () => {
        sock.destroy();
        resolve(true);
      });
      sock.once("error", () => resolve(false));
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/**
 * Integration tests need a real MongoDB. Use MONGODB_TEST_URI when given; otherwise start a
 * throwaway mongod (from PATH or MONGOD_PATH) on a random local port with a temporary data dir.
 * When neither is possible the integration suites are skipped and the reason is printed.
 */
export default async function setup(project: TestProject) {
  if (process.env.MONGODB_TEST_URI) {
    project.provide("mongoUri", process.env.MONGODB_TEST_URI);
    project.provide("mongoUnavailableReason", null);
    return;
  }
  const mongod = findMongod();
  if (!mongod) {
    const reason = "mongod not found on PATH and MONGODB_TEST_URI/MONGOD_PATH not set";
    console.warn(`\n[integration] SKIPPED: ${reason}\n`);
    project.provide("mongoUri", null);
    project.provide("mongoUnavailableReason", reason);
    return;
  }
  const port = await freePort();
  const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), "danube-test-mongo-"));
  const child: ChildProcess = spawn(mongod, ["--dbpath", dbPath, "--port", String(port), "--bind_ip", "127.0.0.1", "--quiet"], {
    stdio: "ignore",
  });
  const up = await waitForPort(port, 30_000);
  if (!up) {
    child.kill();
    const reason = `test mongod did not start on port ${port}`;
    console.warn(`\n[integration] SKIPPED: ${reason}\n`);
    project.provide("mongoUri", null);
    project.provide("mongoUnavailableReason", reason);
    return;
  }
  project.provide("mongoUri", `mongodb://127.0.0.1:${port}`);
  project.provide("mongoUnavailableReason", null);
  return async () => {
    child.kill();
    await new Promise((r) => setTimeout(r, 500));
    fs.rmSync(dbPath, { recursive: true, force: true });
  };
}
