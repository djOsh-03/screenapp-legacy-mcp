import { execFile, spawn } from "node:child_process";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

import { ScreenAppBridgeError } from "../errors.js";
import {
  type CredentialStore,
  type StoredCredentials,
  storedCredentialsSchema,
} from "./types.js";

const execFileAsync = promisify(execFile);

async function writeKeychainPassword(
  service: string,
  account: string,
  password: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "/usr/bin/security",
      [
        "add-generic-password",
        "-U",
        "-a",
        account,
        "-s",
        service,
        "-w",
      ],
      { stdio: ["pipe", "ignore", "ignore"] },
    );
    child.once("error", reject);
    child.stdin.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("security add-generic-password failed"));
    });
    child.stdin.end(`${password}\n`);
  });
}

function parseCredentials(raw: string, source: string): StoredCredentials {
  try {
    return storedCredentialsSchema.parse(JSON.parse(raw));
  } catch (error) {
    throw new ScreenAppBridgeError(
      `Stored ScreenApp credentials in ${source} are invalid. Run "auth login" again.`,
      "INVALID_STORED_CREDENTIALS",
      { cause: error },
    );
  }
}

export class FileCredentialStore implements CredentialStore {
  readonly description: string;

  constructor(readonly path: string) {
    this.description = `file ${path}`;
  }

  async read(): Promise<StoredCredentials | undefined> {
    try {
      return parseCredentials(await readFile(this.path, "utf8"), this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async write(credentials: StoredCredentials): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.${String(process.pid)}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(credentials, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, this.path);
    await chmod(this.path, 0o600);
  }
}

export class MacOsKeychainCredentialStore implements CredentialStore {
  readonly description: string;

  constructor(
    readonly service: string,
    readonly account: string,
  ) {
    this.description = `macOS Keychain service ${service}, account ${account}`;
  }

  async read(): Promise<StoredCredentials | undefined> {
    try {
      const { stdout } = await execFileAsync("/usr/bin/security", [
        "find-generic-password",
        "-a",
        this.account,
        "-s",
        this.service,
        "-w",
      ]);
      return parseCredentials(stdout.trim(), this.description);
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code === 44) return undefined;
      throw new ScreenAppBridgeError(
        "Unable to read ScreenApp credentials from macOS Keychain.",
        "KEYCHAIN_READ_FAILED",
        { cause: error },
      );
    }
  }

  async write(credentials: StoredCredentials): Promise<void> {
    try {
      await writeKeychainPassword(
        this.service,
        this.account,
        JSON.stringify(credentials),
      );
    } catch (error) {
      throw new ScreenAppBridgeError(
        "Unable to save ScreenApp credentials in macOS Keychain.",
        "KEYCHAIN_WRITE_FAILED",
        { cause: error },
      );
    }
  }
}
