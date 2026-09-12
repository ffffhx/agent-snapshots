#!/usr/bin/env node

import { runBash } from "./bash-runner.mjs";

const script = process.argv[2];
if (!script) {
  throw new Error("missing bash test script");
}
runBash([script], { label: "bash-test" });
