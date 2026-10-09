const { contextBridge, ipcRenderer } = require('electron');

// Registrar un único listener por canal (evita acumularlos si el renderer se vuelve a suscribir)
function listen(channel, callback) {
  ipcRenderer.removeAllListeners(channel);
  ipcRenderer.on(channel, (event, ...args) => callback(...args));
}

contextBridge.exposeInMainWorld('terminal', {
  // Pseudo-terminal de cada pestaña
  createPty: (sessionId, cols, rows) => ipcRenderer.invoke('pty-create', { sessionId, cols, rows }),
  write: (sessionId, data) => ipcRenderer.send('pty-write', { sessionId, data }),
  resize: (sessionId, cols, rows) => ipcRenderer.send('pty-resize', { sessionId, cols, rows }),
  kill: sessionId => ipcRenderer.send('pty-kill', sessionId),
  onData: callback => listen('pty-data', ({ sessionId, data }) => callback(sessionId, data)),
  onExit: callback => listen('pty-exit', ({ sessionId, exitCode }) => callback(sessionId, exitCode)),
  // Copiar / pegar desde el clic derecho
  copyText: text => ipcRenderer.send('clipboard-copy', text),
  paste: () => ipcRenderer.send('clipboard-paste'),

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
