const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('terminal', {
  sendCommand: (command, sessionId) => {
    ipcRenderer.send('terminal-command', { command, sessionId });
  },
  onOutput: callback => {
    ipcRenderer.removeAllListeners('terminal-output');
    ipcRenderer.on('terminal-output', (event, data) => {
      callback(data.sessionId, data.output);
    });
  },
  onPrompt: callback => {
    ipcRenderer.removeAllListeners('terminal-prompt');
    ipcRenderer.on('terminal-prompt', (event, data) => {
      callback(data.sessionId, data.prompt);
    });
  },
  onClear: callback => {
    ipcRenderer.removeAllListeners('terminal-clear');
    ipcRenderer.on('terminal-clear', (event, data) => {
      callback(data.sessionId);
    });
  },
  getCompletions: (partial, sessionId) => {
    return ipcRenderer.invoke('terminal-autocomplete', { partial, sessionId });
  },
  createSession: sessionId => {
    ipcRenderer.send('create-session', sessionId);
  },
  switchSession: sessionId => {
    ipcRenderer.send('switch-session', sessionId);
  },
  closeSession: sessionId => {
    ipcRenderer.send('close-session', sessionId);
  },
  onInitialSession: callback => {
    ipcRenderer.once('initial-session', (event, sessionId) => {
      callback(sessionId);
    });
  },
  onNewTab: callback => {
    ipcRenderer.removeAllListeners('new-tab');
    ipcRenderer.on('new-tab', callback);
  },
  onCloseTab: callback => {
    ipcRenderer.removeAllListeners('close-tab');
    ipcRenderer.on('close-tab', callback);
  },
  onNextTab: callback => {
    ipcRenderer.removeAllListeners('next-tab');
    ipcRenderer.on('next-tab', callback);
  },
  onPrevTab: callback => {
    ipcRenderer.removeAllListeners('prev-tab');
    ipcRenderer.on('prev-tab', callback);
  },
  changeTheme: callback => {
    ipcRenderer.removeAllListeners('change-theme');
    ipcRenderer.on('change-theme', (event, themeName) => {
      callback(themeName);
    });
  },
  showColorCustomizer: callback => {
    ipcRenderer.removeAllListeners('show-color-customizer');
    ipcRenderer.on('show-color-customizer', () => {
      callback();
    });
  },
  applyCustomColors: callback => {
    ipcRenderer.removeAllListeners('apply-custom-colors');
    ipcRenderer.on('apply-custom-colors', (event, colors) => {
      callback(colors);
    });
  },
  setCustomColors: colors => {
    ipcRenderer.send('set-custom-colors', colors);
  },
});
