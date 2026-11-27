import hljs from 'highlight.js/lib/common'

// Syntax highlighting for file previews. Colours come from the theme (see
// .code-hl in globals.css), so they follow light, dark and any brand.

const BY_EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json', json5: 'json', map: 'json', webmanifest: 'json',
  css: 'css', scss: 'scss', sass: 'scss', less: 'less',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml', svelte: 'xml', astro: 'xml', xaml: 'xml', csproj: 'xml', plist: 'xml',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  py: 'python', pyi: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', cs: 'csharp', php: 'php', m: 'objectivec',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash', env: 'bash',
  yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini', editorconfig: 'ini',
  sql: 'sql', diff: 'diff', patch: 'diff', lua: 'lua', pl: 'perl', r: 'r', graphql: 'graphql', gql: 'graphql',
  mk: 'makefile', vb: 'vbnet', wasm: 'wasm',
}

const BY_NAME: Record<string, string> = {
  makefile: 'makefile',
  '.gitignore': 'bash',
  '.npmrc': 'ini',
  '.env': 'bash',
  'cmakelists.txt': 'cmake',
}

const NAMES: Record<string, string> = {
  typescript: 'TypeScript', javascript: 'JavaScript', json: 'JSON', css: 'CSS', scss: 'SCSS', less: 'Less', xml: 'HTML/XML',
  markdown: 'Markdown', python: 'Python', ruby: 'Ruby', go: 'Go', rust: 'Rust', java: 'Java', kotlin: 'Kotlin', swift: 'Swift',
  c: 'C', cpp: 'C++', csharp: 'C#', php: 'PHP', objectivec: 'Objective-C', bash: 'Shell', yaml: 'YAML', ini: 'INI', sql: 'SQL',
  diff: 'Diff', lua: 'Lua', perl: 'Perl', r: 'R', graphql: 'GraphQL', makefile: 'Makefile', vbnet: 'VB.NET', wasm: 'WebAssembly',
  cmake: 'CMake',
}

export function languageOf(path: string): string | undefined {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  if (BY_NAME[name]) return BY_NAME[name]
  if (name.startsWith('.env')) return 'bash'
  const ext = name.includes('.') ? name.split('.').pop()! : ''
  const lang = BY_EXT[ext]
  return lang && hljs.getLanguage(lang) ? lang : undefined
}

export const languageName = (lang?: string) => (lang ? (NAMES[lang] ?? lang) : undefined)

/** Highlighted HTML (already escaped), or null to show plain text. */
export function highlight(text: string, lang?: string): string | null {
  if (!lang || text.length > 512 * 1024) return null
  try {
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value
  } catch {
    return null
  }
}
