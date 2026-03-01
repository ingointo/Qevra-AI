import { app, BrowserWindow, ipcMain, globalShortcut } from 'electron'
import path from 'node:path'
import store from './store'
import type { PortalAutomator } from './automation/PortalAutomator'

interface Credentials { username: string; password: string }

process.env.APP_ROOT = path.join(__dirname, '..')
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

// Set app name — shows in Dock tooltip, taskbar, About panel
app.setName('Qevra AI')

let win: BrowserWindow | null
let activeAutomator: PortalAutomator | null = null

// ── Auto-updater ──────────────────────────────────────────────────────────
// Only run in packaged production builds (not during `npm run dev`)
function setupAutoUpdater() {
  if (VITE_DEV_SERVER_URL) return // skip in development

  import('electron-updater').then(({ autoUpdater }) => {
    autoUpdater.autoDownload = true        // download silently in background
    autoUpdater.autoInstallOnAppQuit = true // install when user quits

    autoUpdater.on('update-available', (info) => {
      win?.webContents.send('update-available', info.version)
    })

    autoUpdater.on('update-downloaded', () => {
      win?.webContents.send('update-downloaded')
    })

    autoUpdater.on('error', (err: Error) => {
      console.error('[UPDATER]', err.message)
    })

    // Check for updates (5 second delay so window is ready)
    setTimeout(() => autoUpdater.checkForUpdates(), 5000)
  }).catch((err: Error) => {
    console.error('[UPDATER] Failed to load:', err.message)
  })
}

// IPC: user clicks "Restart & Update" in the UI
ipcMain.on('install-update', () => {
  import('electron-updater').then(({ autoUpdater }) => {
    autoUpdater.quitAndInstall()
  }).catch(() => { })
})

// ── IPC handlers (registered ONCE, not inside createWindow) ──────────────
ipcMain.handle('save-credentials', (_, creds) => {
  store.set('credentials', creds)
  return true
})

ipcMain.handle('get-credentials', () => store.get('credentials'))

ipcMain.handle('start-automation', async () => {
  if (activeAutomator) return false // already running
  const creds = store.get('credentials') as Credentials | undefined
  if (!creds?.username || !creds?.password) {
    win?.webContents.send('automation-log', 'Error: No credentials. Please save them in Settings.')
    return false
  }
  const { PortalAutomator } = await import('./automation/PortalAutomator')
  activeAutomator = new PortalAutomator(
    (msg: string) => {
      console.log('[AUTOMATION]', msg)
      win?.webContents.send('automation-log', msg)
    },
    (schedule: import('./automation/PortalAutomator').ClassSchedule[]) => win?.webContents.send('schedule-update', schedule)
  )
  const result = await activeAutomator.run(creds.username, creds.password)
  activeAutomator = null
  return result
})

ipcMain.handle('stop-automation', () => {
  if (activeAutomator) {
    activeAutomator.stop()
    activeAutomator = null
  }
  return true
})

// ── Window ────────────────────────────────────────────────────────────────
function createWindow() {
  const iconPath = path.join(process.env.VITE_PUBLIC!, 'logo.png')
  win = new BrowserWindow({
    width: 480,
    height: 720,
    minWidth: 400,
    minHeight: 600,
    icon: iconPath,
    title: 'Qevra AI',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  // Set macOS Dock icon explicitly during development
  if (process.platform === 'darwin') {
    app.dock?.setIcon(iconPath)
  }

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  // Forward renderer console to terminal for debugging
  win.webContents.on('console-message', (_e, _lvl, message) => {
    console.log(`[RENDERER] ${message}`)
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.whenReady().then(() => {
  createWindow()
  setupAutoUpdater()

  // Cmd+Shift+I (Mac) / Ctrl+Shift+I (Win/Linux) or F12 to toggle DevTools
  const shortcut = process.platform === 'darwin' ? 'Command+Shift+I' : 'Control+Shift+I'
  globalShortcut.register(shortcut, () => {
    win?.webContents.toggleDevTools()
  })
  globalShortcut.register('F12', () => {
    win?.webContents.toggleDevTools()
  })
})
