const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('terminal', {
  sendCommand: (command, sessionId) => {
    ipcRenderer.send('terminal-command', { command, sessionId });
  },
  onOutput: callback => {
    ipcRenderer.on('terminal-output', (event, data) => {
      callback(data.sessionId, data.output);
    });
  },
  onPrompt: callback => {
    ipcRenderer.on('terminal-prompt', (event, data) => {
      callback(data.sessionId, data.prompt);
    });
  },
  onClear: callback => {
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
    ipcRenderer.on('initial-session', (event, sessionId) => {
      callback(sessionId);
    });
  },
  onNewTab: callback => {
    ipcRenderer.on('new-tab', callback);
  },
  onCloseTab: callback => {
    ipcRenderer.on('close-tab', callback);
  },
  onNextTab: callback => {
    ipcRenderer.on('next-tab', callback);
  },
  onPrevTab: callback => {
    ipcRenderer.on('prev-tab', callback);
  },
  changeTheme: theme => {
    ipcRenderer.on('change-theme', (event, themeName) => {
      theme(themeName);
    });
  },

  showColorCustomizer: callback => {
    ipcRenderer.on('show-color-customizer', () => {
      callback();
    });
  },

  applyCustomColors: callback => {
    ipcRenderer.on('apply-custom-colors', (event, colors) => {
      callback(colors);
    });
  },

  setCustomColors: colors => {
    ipcRenderer.send('set-custom-colors', colors);
  },
});
