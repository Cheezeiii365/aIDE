/**
 * Seti-style file and folder icons (Cursor/VS Code default theme).
 * SVG paths inspired by the Seti UI icon set (MIT-licensed).
 */

import type { ReactNode } from 'react'
import { getFileIconId, getFolderIconId } from './fileIcons'

// ── Color palette (Seti theme) ──────────────────

const ICON_COLORS: Record<string, string> = {
  ts: '#519aba',
  tsx: '#519aba',
  js: '#cbcb41',
  jsx: '#cbcb41',
  json: '#cbcb41',
  html: '#e37933',
  css: '#519aba',
  md: '#519aba',
  py: '#519aba',
  rust: '#a2573a',
  go: '#519aba',
  yaml: '#a074c4',
  toml: '#a074c4',
  shell: '#4d5a5e',
  docker: '#519aba',
  git: '#cc3e44',
  image: '#a074c4',
  env: '#cbcb41',
  npm: '#cc3e44',
  config: '#4d5a5e',
  lock: '#4d5a5e',
  readme: '#519aba',
  license: '#cbcb41',
  ruby: '#cc3e44',
  java: '#cc3e44',
  c: '#519aba',
  cpp: '#519aba',
  csharp: '#519aba',
  swift: '#e37933',
  php: '#a074c4',
  lua: '#519aba',
  r: '#519aba',
  sql: '#e37933',
  graphql: '#e535ab',
  xml: '#e37933',
  vue: '#41b883',
  svelte: '#ff3e00',
  file: '#4d5a5e',
}

/**
 * Provide the SVG JSX fragment for the specified icon identifier.
 *
 * @param iconId - The icon identifier (for example: `ts`, `js`, `json`, `image`, `folder`, etc.) used to select which SVG content to render.
 * @returns A JSX.Element containing the SVG nodes for the requested icon; returns a generic document-shaped SVG when `iconId` is not recognized.
 */

function iconPath(iconId: string): ReactNode {
  switch (iconId) {
    case 'ts':
      return (
        <>
          <rect x="2" y="2" width="12" height="12" rx="1" fill="currentColor" opacity="0.15" />
          <text x="8" y="11.5" textAnchor="middle" fontSize="8" fontWeight="bold" fill="currentColor">TS</text>
        </>
      )
    case 'tsx':
      return (
        <>
          <rect x="2" y="2" width="12" height="12" rx="1" fill="currentColor" opacity="0.15" />
          <text x="8" y="11" textAnchor="middle" fontSize="6.5" fontWeight="bold" fill="currentColor">TSX</text>
        </>
      )
    case 'js':
      return (
        <>
          <rect x="2" y="2" width="12" height="12" rx="1" fill="currentColor" opacity="0.15" />
          <text x="8" y="11.5" textAnchor="middle" fontSize="8" fontWeight="bold" fill="currentColor">JS</text>
        </>
      )
    case 'jsx':
      return (
        <>
          <rect x="2" y="2" width="12" height="12" rx="1" fill="currentColor" opacity="0.15" />
          <text x="8" y="11" textAnchor="middle" fontSize="6.5" fontWeight="bold" fill="currentColor">JSX</text>
        </>
      )
    case 'json':
      return (
        <path d="M5.5 2C4.67 2 4 2.67 4 3.5v1C4 5.33 3.33 6 2.5 6v4c.83 0 1.5.67 1.5 1.5v1c0 .83.67 1.5 1.5 1.5M10.5 2c.83 0 1.5.67 1.5 1.5v1c0 .83.67 1.5 1.5 1.5v4c-.83 0-1.5.67-1.5 1.5v1c0 .83-.67 1.5-1.5 1.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
      )
    case 'html':
      return (
        <path d="M3 2l1 12 4 2 4-2 1-12H3zm2.5 3h5l-.2 2H6.2l.2 2h4.1l-.3 3.5L8 13.5l-2.2-1L5.5 10h1.5l.2 1.2 1 .5 1-.5.2-1.2H6l-.5-5z" fill="currentColor" />
      )
    case 'css':
      return (
        <path d="M3 2l1 12 4 2 4-2 1-12H3zm3 4h4.5l-.1 1.5H6.5l.1 1.5h4.3l-.3 3.5L8 13.5l-2.6-1-.2-2h1.5l.1 1 1.2.4 1.2-.4.1-1.5H6.1L5.8 6z" fill="currentColor" />
      )
    case 'md':
      return (
        <path d="M2 4v8h12V4H2zm2 6V6.5l1.5 2 1.5-2V10h-1V8l-.5.75L5 8v2H4zm7 0l-2-2.5h1.5V6h1v1.5H12L11 10z" fill="currentColor" />
      )
    case 'py':
      return (
        <path d="M8 2C5.5 2 5.5 3.2 5.5 3.2V5H8v.5H4S2 5.2 2 8s1.7 2.5 1.7 2.5H5V9s-.1-1.7 1.7-1.7h2.6S11 7.4 11 5.7V3.5S11.2 2 8 2zM6.3 3.2a.6.6 0 110 1.2.6.6 0 010-1.2zM8 14c2.5 0 2.5-1.2 2.5-1.2V11H8v-.5h4s2 .3 2-2.5-1.7-2.5-1.7-2.5H11V7s.1 1.7-1.7 1.7H6.7S5 8.6 5 10.3v2.2S4.8 14 8 14zm1.7-1.2a.6.6 0 110-1.2.6.6 0 010 1.2z" fill="currentColor" />
      )
    case 'rust':
      return (
        <path d="M8 1.5a.7.7 0 01.7.7v.3A5.5 5.5 0 0113.5 8 5.5 5.5 0 018 13.5 5.5 5.5 0 012.5 8a5.5 5.5 0 014.8-5.5V2.2a.7.7 0 01.7-.7zM5 7h2v2H5zm4 0h2v2H9zM6 10.5c0 1 .9 1.5 2 1.5s2-.5 2-1.5" stroke="currentColor" strokeWidth="0.8" fill="none" />
      )
    case 'go':
      return (
        <path d="M1 8.5s.5.3 1.5.3S4 8 4 8M12 8.5s.5.3 1.5.3 1.5-.8 1.5-.8M4.5 6C4.5 4 6 2.5 8 2.5S11.5 4 11.5 6v2c0 2.5-1.5 4.5-3.5 4.5S4.5 10.5 4.5 8V6zM6.5 6a.5.5 0 100-1 .5.5 0 000 1zM9.5 6a.5.5 0 100-1 .5.5 0 000 1z" stroke="currentColor" strokeWidth="0.8" fill="currentColor" fillOpacity="0.15" />
      )
    case 'shell':
      return (
        <path d="M3 4l4 4-4 4M9 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      )
    case 'docker':
      return (
        <path d="M1.5 7.5h2v-2h2v-2h2v2h2v-2h2v2h1.5a2 2 0 010 4H1.5a2 2 0 010-4zM3.5 7.5V6h1v1.5zM5.5 5.5V4h1v1.5zM5.5 7.5V6h1v1.5zM7.5 7.5V6h1v1.5zM9.5 5.5V4h1v1.5zM9.5 7.5V6h1v1.5z" fill="currentColor" />
      )
    case 'git':
      return (
        <path d="M14.3 7.3L8.7 1.7a1 1 0 00-1.4 0L5.8 3.2l1.8 1.8a1.2 1.2 0 011.5 1.5l1.7 1.7a1.2 1.2 0 11-.7.7L8.5 7.3v3.5a1.2 1.2 0 11-1-.1V7.1a1.2 1.2 0 01-.6-1.6L5.1 3.8 1.7 7.3a1 1 0 000 1.4l5.6 5.6a1 1 0 001.4 0l5.6-5.6a1 1 0 000-1.4z" fill="currentColor" />
      )
    case 'image':
      return (
        <>
          <rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" strokeWidth="1" fill="none" />
          <circle cx="5.5" cy="6.5" r="1.5" fill="currentColor" opacity="0.5" />
          <path d="M2 11l3-3 2 2 3-4 4 5H2z" fill="currentColor" opacity="0.3" />
        </>
      )
    case 'npm':
      return (
        <path d="M2 3h12v10H8V5.5H5.5V13H2V3z" fill="currentColor" />
      )
    case 'config':
      return (
        <path d="M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM8 4V2M8 14v-2M12 8h2M2 8h2M11 5l1.4-1.4M3.6 12.4L5 11M11 11l1.4 1.4M3.6 3.6L5 5" stroke="currentColor" strokeWidth="1.2" fill="none" />
      )
    case 'lock':
      return (
        <path d="M5 7V5a3 3 0 016 0v2M4 7h8a1 1 0 011 1v4a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1z" stroke="currentColor" strokeWidth="1" fill="currentColor" fillOpacity="0.15" />
      )
    case 'readme':
      return (
        <path d="M2 3v10l6-2 6 2V3l-6 2-6-2zm6 2v8" stroke="currentColor" strokeWidth="1" fill="currentColor" fillOpacity="0.1" />
      )
    case 'license':
      return (
        <path d="M8 2L3 5v3c0 3.5 2.1 6.1 5 7 2.9-.9 5-3.5 5-7V5L8 2z" stroke="currentColor" strokeWidth="1" fill="currentColor" fillOpacity="0.15" />
      )
    case 'env':
      return (
        <>
          <rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" strokeWidth="1" fill="currentColor" fillOpacity="0.1" />
          <path d="M4 6h3M4 8h5M4 10h2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        </>
      )
    case 'ruby':
      return (
        <path d="M2 12L6 2h4l4 10-6 2-6-2z" fill="currentColor" fillOpacity="0.3" stroke="currentColor" strokeWidth="0.8" />
      )
    case 'java':
      return (
        <path d="M5.5 2h5L13 5v6l-2.5 3h-5L3 11V5l2.5-3zM6 7h4M6 9h4" stroke="currentColor" strokeWidth="0.8" fill="currentColor" fillOpacity="0.15" />
      )
    case 'c':
      return (
        <>
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1" fill="currentColor" fillOpacity="0.1" />
          <text x="8" y="11" textAnchor="middle" fontSize="8" fontWeight="bold" fill="currentColor">C</text>
        </>
      )
    case 'cpp':
      return (
        <>
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1" fill="currentColor" fillOpacity="0.1" />
          <text x="8" y="10.5" textAnchor="middle" fontSize="6.5" fontWeight="bold" fill="currentColor">C++</text>
        </>
      )
    case 'csharp':
      return (
        <>
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1" fill="currentColor" fillOpacity="0.1" />
          <text x="8" y="11" textAnchor="middle" fontSize="7" fontWeight="bold" fill="currentColor">C#</text>
        </>
      )
    case 'swift':
      return (
        <path d="M12 3.5S9 6 6 8c3-1 5.5.5 5.5.5S9 12 4 13c5 1 9-2.5 9-5S12 3.5 12 3.5zM3 3s5 4 7.5 7C8 8 4 5.5 4 5.5S6 8.5 5 11C3 8 3 3 3 3z" fill="currentColor" />
      )
    case 'php':
      return (
        <>
          <ellipse cx="8" cy="8" rx="6.5" ry="4.5" stroke="currentColor" strokeWidth="0.8" fill="currentColor" fillOpacity="0.1" />
          <text x="8" y="10" textAnchor="middle" fontSize="5.5" fontWeight="bold" fill="currentColor">PHP</text>
        </>
      )
    case 'lua':
      return (
        <path d="M8 2a6 6 0 100 12 6 6 0 000-12zM10 4a1 1 0 110 2 1 1 0 010-2z" stroke="currentColor" strokeWidth="0.8" fill="currentColor" fillOpacity="0.15" />
      )
    case 'sql':
      return (
        <path d="M3 4c0-1.1 2.2-2 5-2s5 .9 5 2v8c0 1.1-2.2 2-5 2s-5-.9-5-2V4zM3 4c0 1.1 2.2 2 5 2s5-.9 5-2M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" stroke="currentColor" strokeWidth="1" fill="currentColor" fillOpacity="0.1" />
      )
    case 'graphql':
      return (
        <path d="M8 2l5 3v6l-5 3-5-3V5l5-3zM8 2v3M8 11v3M3 5l3.5 2M9.5 9L13 11M3 11l3.5-2M9.5 7L13 5" stroke="currentColor" strokeWidth="0.8" fill="currentColor" fillOpacity="0.1" />
      )
    case 'xml':
      return (
        <path d="M5 4L2 8l3 4M11 4l3 4-3 4M9 3L7 13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" />
      )
    case 'vue':
      return (
        <path d="M1 2h4l3 5 3-5h4L8 14 1 2zM4 2l4 7 4-7" stroke="currentColor" strokeWidth="0.8" fill="currentColor" fillOpacity="0.15" />
      )
    case 'svelte':
      return (
        <path d="M12 3.5C10.5 1.5 7.5 1 5.5 2.5S2.5 6.5 4 8.5l4 3c1.5 1 3.5.5 4-1s-.5-3-2-3.5" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.15" />
      )
    case 'yaml':
      return (
        <path d="M2 4l3 4v4M14 4l-3 4v4M8 4v8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      )
    case 'toml':
      return (
        <>
          <rect x="2" y="2" width="12" height="12" rx="1" fill="currentColor" opacity="0.1" />
          <path d="M4 5h8M4 8h5M4 11h6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        </>
      )
    case 'r':
      return (
        <>
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1" fill="currentColor" fillOpacity="0.1" />
          <text x="8" y="11" textAnchor="middle" fontSize="8" fontWeight="bold" fill="currentColor">R</text>
        </>
      )
    default: // 'file'
      return (
        <path d="M4.5 1.5A1.5 1.5 0 016 0h4.88a1.5 1.5 0 011.06.44l2.12 2.12a1.5 1.5 0 01.44 1.06V14.5A1.5 1.5 0 0113 16H6a1.5 1.5 0 01-1.5-1.5v-13z"
          fill="currentColor" opacity="0.4"
        />
      )
  }
}

/**
 * Render a 16×16 SVG icon that represents a file, chosen from its filename.
 *
 * @param name - The file name (or path) used to derive the icon identifier
 * @returns An SVG JSX element sized 16×16, containing the icon path for the file type and styled with the corresponding Seti-themed color
 */

export function FileTypeIcon({ name }: { name: string }) {
  const iconId = getFileIconId(name)
  const color = ICON_COLORS[iconId] ?? ICON_COLORS.file

  return (
    <svg
      className="file-tree__icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      style={{ color }}
    >
      {iconPath(iconId)}
    </svg>
  )
}

/**
 * Render a 16×16 SVG folder icon for a given folder name.
 *
 * @param name - Folder name used to determine the icon variant (e.g., special folders like `src`, `test`, `images`)
 * @param expanded - When true, render the "open/expanded" folder silhouette; otherwise render the "closed" silhouette
 * @returns An SVG React element representing the folder icon; special folder variants are tinted with a predefined color
 */
export function FolderTypeIcon({ name, expanded }: { name: string; expanded: boolean }) {
  const iconId = getFolderIconId(name)
  const isSpecial = iconId !== 'folder'

  // Special folders get a tinted color
  const folderColors: Record<string, string> = {
    'folder-src': '#519aba',
    'folder-test': '#a074c4',
    'folder-docs': '#519aba',
    'folder-node': '#4d5a5e',
    'folder-git': '#cc3e44',
    'folder-github': '#4d5a5e',
    'folder-config': '#4d5a5e',
    'folder-dist': '#cbcb41',
    'folder-public': '#e37933',
    'folder-scripts': '#4d5a5e',
    'folder-components': '#519aba',
    'folder-styles': '#519aba',
    'folder-images': '#a074c4',
    'folder-packages': '#cc3e44',
  }

  const color = isSpecial ? folderColors[iconId] : undefined

  return (
    <svg
      className="file-tree__icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      style={color ? { color } : undefined}
    >
      {expanded ? (
        <path d="M1.5 3A1.5 1.5 0 013 1.5h3.38a.5.5 0 01.35.15l1.12 1.12a.5.5 0 00.36.15H13A1.5 1.5 0 0114.5 4.5V5H3.5a2 2 0 00-2 2v5L1.5 3zM3.5 6H14l-1.5 8H2L3.5 6z"
          opacity="0.7"
        />
      ) : (
        <path d="M1.5 2A1.5 1.5 0 003 3.5h3.379a.5.5 0 01.354.146L7.854 4.77a.5.5 0 00.353.146H13A1.5 1.5 0 0114.5 6.5v6A1.5 1.5 0 0113 14H3a1.5 1.5 0 01-1.5-1.5v-10z"
          opacity="0.7"
        />
      )}
    </svg>
  )
}
