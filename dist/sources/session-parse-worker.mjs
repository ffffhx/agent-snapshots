// @ts-nocheck
import { parentPort } from "node:worker_threads";
import { serialize } from "node:v8";
import { parseSessionFile } from "agent-session-core";
parentPort.on("message", ({ id, file, maxLines }) => {
    try {
        let warning;
        const session = parseSessionFile(file, { maxLines, onWarn: (_file, error) => { warning = error.message; } });
        if (warning)
            throw new Error(warning);
        // Serialized size is a cache budget, not a claim about V8 heap usage.
        const bytes = session ? serialize(session).byteLength : 0;
        parentPort.postMessage({ id, session, bytes });
    }
    catch (error) {
        parentPort.postMessage({ id, error: error.message });
    }
});
