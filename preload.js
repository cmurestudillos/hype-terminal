const { contextBridge, ipcRenderer } = require('electron');

// Registrar un único listener por canal (evita acumularlos si el renderer se vuelve a suscribir)
function listen(channel, callback) {
  ipcRenderer.removeAllListeners(channel);
  ipcRenderer.on(channel, (event, ...args) => callback(...args));
}

contextBridge.exposeInMainWorld('terminal', {
  platform: process.platform,

  // Shells disponibles y ajustes
  getConfig: () => ipcRenderer.invoke('get-config'),

  // Pseudo-terminal de cada pestaña
  createPty: (sessionId, cols, rows, shellId, cwd) =>
    ipcRenderer.invoke('pty-create', { sessionId, cols, rows, shellId, cwd }),
  write: (sessionId, data) => ipcRenderer.send('pty-write', { sessionId, data }),
  resize: (sessionId, cols, rows) => ipcRenderer.send('pty-resize', { sessionId, cols, rows }),
  kill: sessionId => ipcRenderer.send('pty-kill', sessionId),
  foregroundBusy: sessionId => ipcRenderer.invoke('pty-foreground-busy', sessionId),
  onData: callback => listen('pty-data', ({ sessionId, data }) => callback(sessionId, data)),
  onExit: callback => listen('pty-exit', ({ sessionId, exitCode }) => callback(sessionId, exitCode)),

  // Diálogos y menús nativos
  confirmCloseTab: title => ipcRenderer.invoke('confirm-close-tab', title),
  showShellMenu: (x, y) => ipcRenderer.send('shell-menu', { x, y }),
  showAppMenu: (x, y) => ipcRenderer.send('app-menu', { x, y }),
  setTitleBarColors: (color, symbolColor) => ipcRenderer.send('title-bar-colors', { color, symbolColor }),
  openExternal: url => ipcRenderer.send('open-external', url),

  // Copiar / pegar desde el clic derecho
  copyText: text => ipcRenderer.send('clipboard-copy', text),
  paste: () => ipcRenderer.send('clipboard-paste'),

  // Al cerrar la ventana, main pregunta qué pestañas tienen un comando en marcha
  onBusyQuery: callback =>
    listen('busy-tabs', async replyChannel => {
      if (/^busy-tabs-reply-\d+$/.test(replyChannel)) {
        ipcRenderer.send(replyChannel, await callback());
      }
    }),

  // Acciones del menú
  onNewTab: callback => listen('new-tab', callback),
  onCloseTab: callback => listen('close-tab', callback),
  onNextTab: callback => listen('next-tab', callback),
  onPrevTab: callback => listen('prev-tab', callback),
  onRenameTab: callback => listen('rename-tab', callback),
  onFind: callback => listen('find', callback),
  onFontSize: callback => listen('font-size', callback),
  changeTheme: callback => listen('change-theme', callback),
  showColorCustomizer: callback => listen('show-color-customizer', callback),
});
