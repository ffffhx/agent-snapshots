import { readFile, writeFile } from "node:fs/promises";
import { scoreReviews } from "./lib/rag-eval.mjs";
const [runPath, reviewsPath, output] = process.argv.slice(2);
if (!output) throw new Error("Usage: node scripts/score-rag-quality.mjs generation.json reviews.json scores.json");
const score = scoreReviews(JSON.parse(await readFile(runPath, "utf8")), JSON.parse(await readFile(reviewsPath, "utf8")));
await writeFile(output, JSON.stringify(score, null, 2));
console.log(JSON.stringify({ reviewerType: score.reviewerType, summary: score.summary }));
