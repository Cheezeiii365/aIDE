import { useTheme } from '../../hooks/useTheme'

function SunIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.75 3.75l1.06 1.06M11.19 11.19l1.06 1.06M3.75 12.25l1.06-1.06M11.19 4.81l1.06-1.06" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <path d="M13.36 10.03A5.5 5.5 0 0 1 5.97 2.64 6 6 0 1 0 13.36 10.03Z" />
    </svg>
  )
}

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()

  return (
    <button className="ribbon-icon-btn" onClick={toggleTheme} title="Toggle theme">
      {theme === 'one-dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}
