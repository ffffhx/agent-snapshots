import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export class SettingsStore {
  constructor(filePath, defaults = {}) {
    this.filePath = filePath;
    this.defaults = { ...defaults };
    this.data = { ...this.defaults, ...this.read() };
  }

  read() {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  get(key, fallback) {
    if (Object.prototype.hasOwnProperty.call(this.data, key)) {
      return this.data[key];
    }
    if (Object.prototype.hasOwnProperty.call(this.defaults, key)) {
      return this.defaults[key];
    }
    return fallback;
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  save() {
    const dir = path.dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    const tempPath = path.join(dir, `.${path.basename(this.filePath)}.${process.pid}.${Date.now()}.tmp`);
    writeFileSync(tempPath, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
    renameSync(tempPath, this.filePath);
  }
}
