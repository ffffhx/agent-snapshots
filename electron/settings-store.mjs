import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export class SettingsStore {
  constructor(filePath, defaults = {}) {
    this.filePath = filePath;
    this.defaults = { ...defaults };
    this.writeSeq = 0;
    const migrated = this.migrate(this.read());
    this.data = { ...this.defaults, ...migrated.data };
    if (migrated.changed) {
      this.saveSafely();
    }
  }

  read() {
    let raw = "";
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch {
      return {};
    }

    try {
      const parsed = JSON.parse(raw);
      if (isPlainObject(parsed)) {
        return parsed;
      }
      this.backupCorruptFile("invalid-shape");
    } catch {
      this.backupCorruptFile("invalid-json");
    }
    return {};
  }

  backupCorruptFile(reason) {
    const dir = path.dirname(this.filePath);
    const name = path.basename(this.filePath);
    const backupPath = path.join(dir, `${name}.corrupt-${reason}-${process.pid}-${Date.now()}`);
    try {
      renameSync(this.filePath, backupPath);
    } catch {
      // If another process already moved it, falling back to defaults is enough.
    }
  }

  migrate(data) {
    const next = { ...data };
    let changed = false;

    if (hasOwn(this.defaults, "settingsVersion")) {
      const version = Number(next.settingsVersion || 0);
      if (version < 1) {
        if (!hasOwn(next, "openAtLogin") && hasOwn(next, "openOnLogin")) {
          next.openAtLogin = Boolean(next.openOnLogin);
          changed = true;
        }
        if (!hasOwn(next, "preventSleepWithLiveSessions") && hasOwn(next, "preventSleep")) {
          next.preventSleepWithLiveSessions = Boolean(next.preventSleep);
          changed = true;
        }
        if (!hasOwn(next, "globalShortcut") && hasOwn(next, "globalHotkey")) {
          next.globalShortcut = next.globalHotkey;
          changed = true;
        }
      }
      if (next.settingsVersion !== this.defaults.settingsVersion) {
        next.settingsVersion = this.defaults.settingsVersion;
        changed = true;
      }
    }

    return { data: next, changed };
  }

  get(key, fallback) {
    if (hasOwn(this.data, key)) {
      return this.data[key];
    }
    if (hasOwn(this.defaults, key)) {
      return this.defaults[key];
    }
    return fallback;
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  saveSafely() {
    try {
      this.save();
    } catch (error) {
      console.warn("Failed to save migrated settings:", error);
    }
  }

  save() {
    const dir = path.dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    this.writeSeq += 1;
    const tempPath = path.join(dir, `.${path.basename(this.filePath)}.${process.pid}.${Date.now()}.${this.writeSeq}.tmp`);
    writeFileSync(tempPath, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
    renameSync(tempPath, this.filePath);
  }
}
