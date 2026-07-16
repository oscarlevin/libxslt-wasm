// Stack-depth stress harness for libxslt-wasm.
//
// libxslt recurses roughly once per XML node during a transform, so a deeply
// nested document drives the WebAssembly stack proportionally deep. On a build
// with too small a `-sSTACK_SIZE`, a sufficiently deep document overflows the
// stack and traps at the WASM level ("memory access out of bounds" /
// RuntimeError) instead of returning a clean, catchable result.
//
// Two modes:
//   node --experimental-wasm-jspi scripts/stress-stack.mjs --depth <N>
//       Runs a single transform on an N-deep tree. Exit codes:
//         0   transform completed (prints "OK <byteLength>")
//         3   libxslt returned a clean, catchable error (prints "CLEAN-ERROR")
//         !=0/3 (typically 134/139/1) the WASM module trapped/aborted — i.e. a
//               stack overflow crash. Running each depth in its own child
//               process (see the binary-search mode) keeps such a crash from
//               taking the searcher down with it.
//
//   node --experimental-wasm-jspi scripts/stress-stack.mjs --search [--min A] [--max B]
//       Binary-searches for the smallest depth that crashes the current build
//       by spawning the single-depth mode in child processes.
//
// The build under test is whatever is currently in ./dist (import resolves via
// the package's own "exports"). Rebuild before running to test a new build.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);

/** Build a right-nested tree `<a><a>...<a>x</a>...</a></a>` of the given depth. */
const buildDeepXml = (depth) => {
  const open = "<a>".repeat(depth);
  const close = "</a>".repeat(depth);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<root>${open}x${close}</root>\n`;
};

// Recursive identity transform: one apply-templates recursion per nesting level.
const STYLESHEET = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:template match="@*|node()">
    <xsl:copy>
      <xsl:apply-templates select="@*|node()"/>
    </xsl:copy>
  </xsl:template>
</xsl:stylesheet>
`;

const runSingle = async (depth) => {
  // Dynamic (non-literal) specifier: resolves to the built package entry at
  // runtime via the package's own "exports", and keeps static import resolvers
  // (import-x / eslint-plugin-n) from trying to resolve it before dist exists.
  const pkg = "libxslt-wasm";
  const { XmlDocument, XsltStylesheet } = await import(pkg);

  const xml = buildDeepXml(depth);
  using doc = await XmlDocument.fromString(xml);
  using sheet = await XsltStylesheet.fromString(STYLESHEET);
  using result = await sheet.apply(doc);
  const out = result.toString();
  process.stdout.write(`OK ${out.length}\n`);
};

const spawnDepth = (depth) => {
  const res = spawnSync(
    process.execPath,
    ["--experimental-wasm-jspi", SELF, "--depth", String(depth)],
    { encoding: "utf8" },
  );
  return res; // { status, signal, stdout, stderr }
};

const classify = (res) => {
  if (res.status === 0) return "ok";
  if (res.status === 3) return "clean-error";
  return "crash"; // trap/abort/signal
};

const search = (min, max) => {
  process.stdout.write(
    `Binary-searching crash threshold in [${min}, ${max}]\n`,
  );

  // First confirm the bounds behave as expected.
  const lo = spawnDepth(min);
  process.stdout.write(
    `  depth ${min}: ${classify(lo)} (${lo.stdout.trim() || lo.stderr.trim().split("\n").pop()})\n`,
  );
  const hi = spawnDepth(max);
  process.stdout.write(
    `  depth ${max}: ${classify(hi)} (${hi.stdout.trim() || hi.stderr.trim().split("\n").pop()})\n`,
  );

  if (classify(hi) !== "crash") {
    process.stdout.write(
      `Max depth ${max} did not crash (result: ${classify(hi)}). ` +
        `Either the build is fixed or the ceiling is higher than ${max}.\n`,
    );
    return;
  }
  if (classify(lo) === "crash") {
    process.stdout.write(
      `Min depth ${min} already crashes; lower the --min bound.\n`,
    );
    return;
  }

  let good = min; // highest known-surviving depth
  let bad = max; // lowest known-crashing depth
  while (bad - good > 1) {
    const mid = Math.floor((good + bad) / 2);
    const res = spawnDepth(mid);
    const cls = classify(res);
    process.stdout.write(`  depth ${mid}: ${cls}\n`);
    if (cls === "crash") bad = mid;
    else good = mid;
  }
  process.stdout.write(
    `\nThreshold: depth ${good} survives, depth ${bad} crashes (this build).\n`,
  );
};

const args = process.argv.slice(2);
const getFlag = (name, def) => {
  const i = args.indexOf(name);
  return i === -1 ? def : args[i + 1];
};

if (args.includes("--depth")) {
  const depth = Number(getFlag("--depth"));
  // The exit code is this script's interface (see the header comment), and the
  // -pthread module keeps the event loop alive, so an explicit exit is required.
  try {
    await runSingle(depth);
    // eslint-disable-next-line n/no-process-exit
    process.exit(0);
  } catch (err) {
    // A clean libxslt failure surfaces as a thrown JS Error we can catch here.
    process.stderr.write(`CLEAN-ERROR ${err?.message ?? err}\n`);
    // eslint-disable-next-line n/no-process-exit
    process.exit(3);
  }
} else if (args.includes("--search")) {
  const min = Number(getFlag("--min", "100"));
  const max = Number(getFlag("--max", "50000"));
  search(min, max);
} else {
  process.stderr.write(
    "usage: stress-stack.mjs --depth <N> | --search [--min A] [--max B]\n",
  );
  // eslint-disable-next-line n/no-process-exit
  process.exit(2);
}
