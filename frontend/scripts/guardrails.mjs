// Dependency-free checks run by `npm run lint`, so CI enforces them without workflow changes:
// exact pins, a portable lockfile, and the originality rules for the UI source.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const violations = []
const fail = (message) => violations.push(message)
const read = (path) => readFileSync(path, 'utf8')

// --- 1. exact pins ---
const pkg = JSON.parse(read(join(root, 'package.json')))
const EXACT = /^[0-9]+[.][0-9]+[.][0-9]+$/
const REQUIRED = { react: '19.3.1', 'react-dom': '19.3.1', vite: '8.3.4', '@vitejs/plugin-react': '6.1.2' }
const deps = { ...pkg.dependencies, ...pkg.devDependencies }
for (const [name, version] of Object.entries(deps)) {
  if (!EXACT.test(version)) fail(`package.json: ${name} "${version}" is not an exact version`)
}
for (const [name, version] of Object.entries(REQUIRED)) {
  if (deps[name] !== version) fail(`package.json: ${name} must be ${version} (found ${deps[name] ?? 'none'})`)
}

// --- 2. portable lockfile: Vite 8's native bindings for macOS, glibc and musl (CI, Docker) ---
const BINDINGS = [
  '@rolldown/binding-darwin-arm64',
  '@rolldown/binding-linux-x64-gnu',
  '@rolldown/binding-linux-x64-musl',
  '@rolldown/binding-linux-arm64-musl',
  'lightningcss-darwin-arm64',
  'lightningcss-linux-x64-gnu',
  'lightningcss-linux-x64-musl',
  'lightningcss-linux-arm64-musl',
]
const lockPath = join(root, 'package-lock.json')
if (!existsSync(lockPath)) {
  fail('package-lock.json is missing')
} else {
  const lock = JSON.parse(read(lockPath))
  if (lock.lockfileVersion !== 3) fail(`package-lock.json: lockfileVersion ${lock.lockfileVersion}, expected 3`)
  for (const binding of BINDINGS) {
    if (!lock.packages?.[`node_modules/${binding}`]) {
      fail(`package-lock.json: no entry for ${binding} (regenerate it from a clean state)`)
    }
  }
}

// --- 3. originality ---
// Assembled at runtime so this file never contains the reference project's name itself.
const REFERENCE_NAME = new RegExp(['task', 'board'].join(''), 'i')
const BANNED_COPY = ['Good morning', 'Recent activity', 'New task', 'WORKSPACE /', 'Ship with confidence', 'My Tasks']
const BANNED_CLASSES = new Set([
  'sidebar', 'brand', 'brand-mark', 'side-bottom', 'upgrade', 'profile', 'avatar', 'stats', 'stat',
  'stat-icon', 'content-grid', 'panel', 'panel-head', 'tasks-panel', 'filters', 'activity',
  'activity-row', 'activity-icon', 'pipeline', 'modal', 'modal-backdrop', 'modal-head', 'eyebrow',
  'muted', 'primary', 'priority', 'task-title', 'icon-btn', 'table-wrap', 'form-row',
])

function filesUnder(dir, pattern) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
}

// Tokens of className="…", className={'…'}, className={`…`} and the strings inside className={…}.
function jsxClassNames(text) {
  const names = []
  for (const [, quoted, expression] of text.matchAll(/className=(?:"([^"]*)"|\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\})/g)) {
    const literals = quoted !== undefined ? [quoted] : [...expression.matchAll(/(['"`])((?:(?!\1).)*)\1/g)].map((m) => m[2])
    for (const literal of literals) names.push(...literal.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/))
  }
  return names.filter(Boolean)
}

function cssClassNames(text) {
  const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...withoutComments.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1])
}

const scanned = [
  ...filesUnder(join(root, 'src'), /\.(jsx?|css)$/),
  join(root, 'index.html'),
  ...filesUnder(join(root, 'templates'), /./),
]

for (const file of scanned) {
  const text = read(file)
  const name = relative(root, file)
  const lower = text.toLowerCase()

  if (REFERENCE_NAME.test(text)) fail(`${name}: names the course reference project`)
  for (const phrase of BANNED_COPY) {
    if (lower.includes(phrase.toLowerCase())) fail(`${name}: banned copy "${phrase}"`)
  }

  const classes = name.endsWith('.css') ? cssClassNames(text) : /\.jsx?$/.test(name) ? jsxClassNames(text) : []
  for (const cls of new Set(classes)) {
    if (BANNED_CLASSES.has(cls)) fail(`${name}: banned class name "${cls}"`)
  }

  if (/\.jsx?$/.test(name)) {
    if (text.includes('dangerouslySetInnerHTML')) fail(`${name}: dangerouslySetInnerHTML is not allowed`)
    for (const [url] of text.matchAll(/https?:\/\/[^\s'"`)]+/g)) {
      if (!url.startsWith('http://www.w3.org/')) fail(`${name}: absolute URL ${url} (keep every call same-origin)`)
    }
  }
}

if (violations.length > 0) {
  for (const violation of violations) console.error(`guardrails: ${violation}`)
  process.exit(1)
}
process.stdout.write(`guardrails: OK (${scanned.length} files)\n`)
