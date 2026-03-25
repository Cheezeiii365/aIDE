import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from './hooks/useTheme'
import { EditorStatusProvider } from './hooks/useEditorStatus'
import { App } from './App'
import './styles/global.css'
import './styles/themes.css'
import './styles/app-shell.css'
import './styles/file-tree.css'
import './styles/context-menu.css'
import './styles/editor-pane.css'
import './styles/sidebar-section.css'
import './styles/worktree-panel.css'
import './styles/modal.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <EditorStatusProvider>
        <App />
      </EditorStatusProvider>
    </ThemeProvider>
  </StrictMode>,
)
