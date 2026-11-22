// Rename the CommonJS build to .cjs/.d.cts so it loads next to "type": "module".
import { readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const dir = "dist/cjs"
for (const f of readdirSync(dir)) {
  const p = join(dir, f)
  if (f.endsWith(".js")) {
    writeFileSync(p, readFileSync(p, "utf8").replace(/require\("(\.\/[^"]+)\.js"\)/g, 'require("$1.cjs")'))
    renameSync(p, p.replace(/\.js$/, ".cjs"))
  } else if (f.endsWith(".d.ts")) {
    renameSync(p, p.replace(/\.d\.ts$/, ".d.cts"))
  }
}
