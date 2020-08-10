import { ipcMain, screen, BrowserWindow } from 'electron'
import path from 'path'

function createPlayerWindow(w: any, h: any) {
  let { width, height } = screen.getPrimaryDisplay().workArea
  let ww, wh
  if (w > h) {
    ww = Math.floor(width / 2)
    wh = Math.floor((ww * h) / w)
  } else {
    wh = Math.floor(height / 2)
    ww = Math.floor((wh * w) / h)
  }
  let playerWindow = new BrowserWindow({
    x: width - ww,
    y: height - wh,
    width: ww,
    height: wh,
    minWidth: 160,
    minHeight: 120,
    // @ts-ignore
    icon: path.join(__static, 'icon.png'),
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      webSecurity: false
    },
    show: false
  })
  // @ts-ignore
  // playerWindow.setAspectRatio(w / h)
  if (process.platform !== 'darwin') {
    playerWindow.setMenuBarVisibility(false)
    playerWindow.autoHideMenuBar = true
    playerWindow.setMenu(null)
  }
  playerWindow.setBackgroundColor('#000000')
  return playerWindow
}

let playerWindow: any = null
let resizeObj: any = {}
let resizeInterval: any = null

export function initPlayer() {
  if (playerWindow) {
    playerWindow.close()
  }
  playerWindow = createPlayerWindow(360, 220)
  // ?thumb=${encodeURIComponent(args.thumb)}&url=${encodeURIComponent(args.url)}&type=${args.type}
  const params = `#player`
  if (process.env.WEBPACK_DEV_SERVER_URL) {
    playerWindow.loadURL(process.env.WEBPACK_DEV_SERVER_URL + params)
  } else {
    playerWindow.loadURL('app://./index.html' + params)
  }

  resizeInterval = setInterval(() => {
    const winSize = playerWindow.getSize()
    const { width, height } = resizeObj
    if (winSize[0] !== width || winSize[1] !== height) {
      if (width > 0 && height > 0) {
        playerWindow.setSize(width, height)
      }
    }
  }, 100)

  ipcMain.on('pinToggle', (event, pin) => {
    if (pin) {
      playerWindow.setAlwaysOnTop(true, 'floating', 1)
    } else {
      playerWindow.setAlwaysOnTop(false)
    }
  })

  ipcMain.on('closePlayer', (event, _) => {
    playerWindow.webContents.send('playRequestData', JSON.stringify({}))
    playerWindow.hide()
  })

  ipcMain.on('minimizePlayer', (event, _) => {
    playerWindow.minimize()
  })

  ipcMain.on('play', (event, args) => {
    playerWindow.webContents.send('playRequestData', JSON.stringify(args))
    playerWindow.show()
  })

  ipcMain.on('resize', (event, args) => {
    const { width, height } = args
    if (playerWindow) {
      playerWindow.setSize(width, height)
      resizeObj = { width, height }
      // for macOS
      playerWindow.setAspectRatio(width / height)
      clearInterval(resizeInterval)
    }
  })
}
