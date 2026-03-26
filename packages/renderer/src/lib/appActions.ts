export interface OpenFileOpts {
  line?: number
  column?: number
}

export interface AppActions {
  openFile: (filePath: string, opts?: OpenFileOpts) => void
  openUrl: (url: string) => void
}

let actions: AppActions | null = null

export function registerAppActions(a: AppActions): void {
  actions = a
}

export function getAppActions(): AppActions | null {
  return actions
}
