/** Maps filenames and extensions to Seti-style icon identifiers. */

const SPECIAL_FILES: Record<string, string> = {
  'package.json': 'npm',
  'package-lock.json': 'lock',
  'tsconfig.json': 'ts',
  'tsconfig.node.json': 'ts',
  'tsconfig.app.json': 'ts',
  '.gitignore': 'git',
  '.gitattributes': 'git',
  '.gitmodules': 'git',
  'dockerfile': 'docker',
  'docker-compose.yml': 'docker',
  'docker-compose.yaml': 'docker',
  '.dockerignore': 'docker',
  '.env': 'env',
  '.env.local': 'env',
  '.env.development': 'env',
  '.env.production': 'env',
  '.env.test': 'env',
  'readme.md': 'readme',
  'readme': 'readme',
  'license': 'license',
  'license.md': 'license',
  'makefile': 'shell',
  '.eslintrc': 'config',
  '.eslintrc.js': 'config',
  '.eslintrc.json': 'config',
  '.prettierrc': 'config',
  '.prettierrc.json': 'config',
  '.prettierignore': 'config',
  'vite.config.ts': 'config',
  'vite.config.js': 'config',
  'webpack.config.js': 'config',
  'rollup.config.js': 'config',
  'jest.config.js': 'config',
  'jest.config.ts': 'config',
  '.babelrc': 'config',
  'babel.config.js': 'config',
  'tailwind.config.js': 'config',
  'tailwind.config.ts': 'config',
  'postcss.config.js': 'config',
  'yarn.lock': 'lock',
  'pnpm-lock.yaml': 'lock',
  'cargo.lock': 'lock',
  'gemfile.lock': 'lock',
  'cargo.toml': 'rust',
}

const EXT_MAP: Record<string, string> = {
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  jsx: 'jsx',
  mjs: 'js',
  cjs: 'js',
  json: 'json',
  css: 'css',
  scss: 'css',
  sass: 'css',
  less: 'css',
  html: 'html',
  htm: 'html',
  md: 'md',
  mdx: 'md',
  py: 'py',
  pyw: 'py',
  rs: 'rust',
  go: 'go',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  bat: 'shell',
  cmd: 'shell',
  ps1: 'shell',
  svg: 'image',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  ico: 'image',
  webp: 'image',
  bmp: 'image',
  rb: 'ruby',
  java: 'java',
  kt: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  php: 'php',
  lua: 'lua',
  r: 'r',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  xml: 'xml',
  vue: 'vue',
  svelte: 'svelte',
  txt: 'file',
  log: 'file',
  lock: 'lock',
  env: 'env',
}

const SPECIAL_FOLDERS: Record<string, string> = {
  src: 'folder-src',
  lib: 'folder-src',
  source: 'folder-src',
  test: 'folder-test',
  tests: 'folder-test',
  __tests__: 'folder-test',
  spec: 'folder-test',
  docs: 'folder-docs',
  doc: 'folder-docs',
  documentation: 'folder-docs',
  node_modules: 'folder-node',
  '.git': 'folder-git',
  '.github': 'folder-github',
  '.vscode': 'folder-config',
  '.idea': 'folder-config',
  dist: 'folder-dist',
  build: 'folder-dist',
  out: 'folder-dist',
  public: 'folder-public',
  static: 'folder-public',
  assets: 'folder-public',
  config: 'folder-config',
  '.config': 'folder-config',
  scripts: 'folder-scripts',
  bin: 'folder-scripts',
  components: 'folder-components',
  pages: 'folder-components',
  views: 'folder-components',
  styles: 'folder-styles',
  css: 'folder-styles',
  images: 'folder-images',
  img: 'folder-images',
  icons: 'folder-images',
  packages: 'folder-packages',
}

/**
 * Map a filename to a Seti-style icon identifier.
 *
 * @param filename - The filename or path segment to map (matching is case-insensitive)
 * @returns An icon identifier string corresponding to a known special filename or file extension (for example `npm`, `js`, `image`); returns `'file'` when no mapping is found
 */
export function getFileIconId(filename: string): string {
  const lower = filename.toLowerCase()
  if (SPECIAL_FILES[lower]) return SPECIAL_FILES[lower]
  const ext = lower.split('.').pop()
  if (ext && EXT_MAP[ext]) return EXT_MAP[ext]
  return 'file'
}

/**
 * Maps a folder name to its Seti-style icon identifier.
 *
 * @param folderName - The folder name to map (case-insensitive)
 * @returns The icon identifier for the folder, or `'folder'` if no special icon is defined
 */
export function getFolderIconId(folderName: string): string {
  const lower = folderName.toLowerCase()
  return SPECIAL_FOLDERS[lower] ?? 'folder'
}
