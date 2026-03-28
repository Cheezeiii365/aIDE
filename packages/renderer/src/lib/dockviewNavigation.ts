import type { DockviewApi } from 'dockview-react'

type DockviewPanel = DockviewApi['panels'][number]

interface DockviewGroupLike {
  id?: string
  panels?: DockviewPanel[]
  activePanel?: DockviewPanel | null
}

function asGroup(panel: DockviewPanel | null | undefined): DockviewGroupLike | null {
  const value = (panel as DockviewPanel & { group?: DockviewGroupLike | null } | null | undefined)?.group
  return value ?? null
}

function getPaneId(panel: DockviewPanel | null | undefined): string | null {
  if (!panel) return null
  const group = asGroup(panel)
  return group?.id ?? panel.id
}

function getPanePanels(panel: DockviewPanel | null | undefined): DockviewPanel[] {
  const group = asGroup(panel)
  return group?.panels ? [...group.panels] : panel ? [panel] : []
}

function moveToFront(history: string[], id: string): void {
  const index = history.indexOf(id)
  if (index !== -1) history.splice(index, 1)
  history.unshift(id)
}

function cycleArray<T>(items: T[], current: T, direction: 1 | -1): T | null {
  if (items.length <= 1) return null
  const index = items.indexOf(current)
  if (index === -1) return items[0] ?? null
  return items[(index + direction + items.length) % items.length] ?? null
}

export class DockviewNavigation {
  private paneHistory: string[] = []
  private tabHistoryByPane = new Map<string, string[]>()

  private cycling: {
    type: 'pane' | 'tab'
    frozenOrder: string[]
    index: number
    paneId?: string // for tab cycling: which pane's tabs are being cycled
  } | null = null
  private suppressActivation = false
  private keyUpHandler: ((e: KeyboardEvent) => void) | null = null

  constructor(private readonly api: DockviewApi) {
    for (const panel of api.panels) {
      this.ensurePane(panel)
    }
    if (api.activePanel) {
      this.recordActivation(api.activePanel)
    }

    api.onDidActivePanelChange((panel) => {
      if (panel && !this.suppressActivation) this.recordActivation(panel)
    })

    api.onDidRemovePanel((panel) => {
      this.removePanel(panel.id)
    })
  }

  get isCycling(): boolean {
    return this.cycling !== null
  }

  focusPaneRecent(direction: 1 | -1): boolean {
    if (this.cycling && this.cycling.type === 'tab') {
      this.endCyclingSession()
    }

    if (!this.cycling) {
      const currentPaneId = getPaneId(this.api.activePanel)
      if (!currentPaneId) return false

      const frozenOrder = this.getPaneIdsInRecentOrder()
      if (frozenOrder.length <= 1) return false

      const index = frozenOrder.indexOf(currentPaneId)
      this.cycling = { type: 'pane', frozenOrder, index: index === -1 ? 0 : index }
      this.suppressActivation = true
      this.installKeyUpListener()
    }

    const { frozenOrder } = this.cycling
    this.cycling.index = (this.cycling.index + direction + frozenOrder.length) % frozenOrder.length
    const targetPaneId = frozenOrder[this.cycling.index]
    if (!targetPaneId) return false
    return this.focusPane(targetPaneId)
  }

  focusPaneLinear(direction: 1 | -1): boolean {
    const currentPaneId = getPaneId(this.api.activePanel)
    if (!currentPaneId) return false

    const paneIds = this.getPaneIdsInVisualOrder()
    const targetPaneId = cycleArray(paneIds, currentPaneId, direction)
    if (!targetPaneId) return false
    return this.focusPane(targetPaneId)
  }

  focusTabRecent(direction: 1 | -1): boolean {
    if (this.cycling && this.cycling.type === 'pane') {
      this.endCyclingSession()
    }

    if (!this.cycling) {
      const activePanel = this.api.activePanel
      const paneId = getPaneId(activePanel)
      if (!activePanel || !paneId) return false

      const panePanels = getPanePanels(activePanel)
      if (panePanels.length <= 1) return false

      const frozenOrder = this.getTabIdsInRecentOrder(paneId, panePanels)
      if (frozenOrder.length <= 1) return false

      const index = frozenOrder.indexOf(activePanel.id)
      this.cycling = { type: 'tab', frozenOrder, index: index === -1 ? 0 : index, paneId }
      this.suppressActivation = true
      this.installKeyUpListener()
    }

    const { frozenOrder } = this.cycling
    this.cycling.index = (this.cycling.index + direction + frozenOrder.length) % frozenOrder.length
    const targetPanelId = frozenOrder[this.cycling.index]
    if (!targetPanelId) return false
    return this.focusPanelById(targetPanelId)
  }

  focusTabLinear(direction: 1 | -1): boolean {
    const activePanel = this.api.activePanel
    if (!activePanel) return false

    const panePanels = getPanePanels(activePanel)
    const targetPanel = cycleArray(panePanels, activePanel, direction)
    if (!targetPanel) return false

    targetPanel.api.setActive()
    return true
  }

  endCyclingSession(): void {
    if (!this.cycling) return

    this.removeKeyUpListener()
    this.cycling = null
    this.suppressActivation = false

    // Commit the now-active panel into MRU history
    const activePanel = this.api.activePanel
    if (activePanel) {
      this.recordActivation(activePanel)
    }
  }

  dispose(): void {
    this.removeKeyUpListener()
  }

  private installKeyUpListener(): void {
    if (this.keyUpHandler) return

    this.keyUpHandler = (e: KeyboardEvent) => {
      // End cycling when any modifier key is released
      if (e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') {
        this.endCyclingSession()
      }
    }
    window.addEventListener('keyup', this.keyUpHandler, true)
  }

  private removeKeyUpListener(): void {
    if (this.keyUpHandler) {
      window.removeEventListener('keyup', this.keyUpHandler, true)
      this.keyUpHandler = null
    }
  }

  private ensurePane(panel: DockviewPanel): void {
    const paneId = getPaneId(panel)
    if (!paneId) return
    if (!this.tabHistoryByPane.has(paneId)) {
      const initial = getPanePanels(panel).map((entry) => entry.id)
      this.tabHistoryByPane.set(paneId, initial)
    }
  }

  private recordActivation(panel: DockviewPanel): void {
    const paneId = getPaneId(panel)
    if (!paneId) return

    this.ensurePane(panel)
    moveToFront(this.paneHistory, paneId)

    const tabHistory = this.tabHistoryByPane.get(paneId) ?? []
    moveToFront(tabHistory, panel.id)
    this.tabHistoryByPane.set(paneId, tabHistory)
  }

  private removePanel(panelId: string): void {
    for (const [paneId, tabHistory] of this.tabHistoryByPane.entries()) {
      const next = tabHistory.filter((id) => id !== panelId)
      if (next.length === 0) {
        this.tabHistoryByPane.delete(paneId)
        this.paneHistory = this.paneHistory.filter((id) => id !== paneId)
        continue
      }
      this.tabHistoryByPane.set(paneId, next)
    }
  }

  private focusPane(paneId: string): boolean {
    const panels = this.getPanelsForPane(paneId)
    if (panels.length === 0) return false

    const history = this.getTabIdsInRecentOrder(paneId, panels)
    const targetPanelId = history[0] ?? panels[0]?.id ?? null
    if (!targetPanelId) return false
    return this.focusPanelById(targetPanelId)
  }

  private focusPanelById(panelId: string): boolean {
    const panel = this.api.panels.find((entry) => entry.id === panelId)
    if (!panel) return false
    panel.api.setActive()
    return true
  }

  private getPaneIdsInRecentOrder(): string[] {
    const paneIds = new Set(this.getPaneIdsInVisualOrder())
    const recent = this.paneHistory.filter((paneId) => paneIds.has(paneId))
    const missing = [...paneIds].filter((paneId) => !recent.includes(paneId))
    return [...recent, ...missing]
  }

  private getPaneIdsInVisualOrder(): string[] {
    const paneIds: string[] = []
    for (const panel of this.api.panels) {
      const paneId = getPaneId(panel)
      if (!paneId || paneIds.includes(paneId)) continue
      paneIds.push(paneId)
    }
    return paneIds
  }

  private getPanelsForPane(paneId: string): DockviewPanel[] {
    return this.api.panels.filter((panel) => getPaneId(panel) === paneId)
  }

  private getTabIdsInRecentOrder(paneId: string, panePanels: DockviewPanel[]): string[] {
    const panelIds = panePanels.map((panel) => panel.id)
    const history = this.tabHistoryByPane.get(paneId) ?? []
    const recent = history.filter((panelId) => panelIds.includes(panelId))
    const missing = panelIds.filter((panelId) => !recent.includes(panelId))
    return [...recent, ...missing]
  }
}
