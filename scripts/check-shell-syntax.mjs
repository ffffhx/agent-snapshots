#!/usr/bin/env node

import { readdir } from "node:fs/promises";
import path from "node:path";
import { runBash } from "./bash-runner.mjs";

const deployDir = path.join("deploy", "aliyun");
const deployScripts = (await readdir(deployDir))
  .filter((name) => name.endsWith(".sh"))
  .sort()
  .map((name) => path.join(deployDir, name));

runBash(["-n", ...deployScripts, path.join("scripts", "test-aliyun-deploy-config.sh")], {
  label: "shell-syntax",
});
