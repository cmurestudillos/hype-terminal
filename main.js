const { app, BrowserWindow, ipcMain, Menu, dialog, shell, clipboard } = require('electron');
const path = require('path');
const os = require('os');
const pty = require('node-pty');

let mainWindow;

// Una pseudo-terminal (shell real) por pestaña: sessionId → { pty, buffer, flushTimer }
const sessions = new Map();

// PowerShell: envolver el prompt del usuario para que publique el directorio actual como título
// de la ventana (ConPTY lo traduce a la secuencia OSC que xterm.js recibe con onTitleChange).
// El home se abrevia con ~ solo si es prefijo real de la ruta.
const POWERSHELL_INIT = `
$global:__hypePrompt = $function:prompt
function global:prompt {
  $loc = $executionContext.SessionState.Path.CurrentLocation
  $p = if ($loc.ProviderPath) { $loc.ProviderPath } else { $loc.Path }
  if ($HOME -and $p.StartsWith($HOME, [StringComparison]::OrdinalIgnoreCase) -and
      ($p.Length -eq $HOME.Length -or $p[$HOME.Length] -eq '\\')) {
    $p = '~' + $p.Substring($HOME.Length)
  }
  $Host.UI.RawUI.WindowTitle = $p
  & $global:__hypePrompt
}
`;

// Bash: mismo título con el directorio actual. zsh y otras shells no tienen este hook: la pestaña
// muestra "Terminal N" salvo que su configuración publique el título (p. ej. oh-my-zsh)
const BASH_PROMPT_COMMAND = 'printf "\\033]0;%s\\007" "${PWD/#$HOME/\\~}"';

function shellCommand() {
  if (process.platform === 'win32') {
    const encoded = Buffer.from(POWERSHELL_INIT, 'utf16le').toString('base64');
    return { file: 'powershell.exe', args: ['-NoLogo', '-NoExit', '-EncodedCommand', encoded] };
  }
  const file = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  // En macOS los terminales abren shells de login (carga ~/.zprofile, PATH de Homebrew...)
  return { file, args: process.platform === 'darwin' ? ['-l'] : [] };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    title: 'HYPE Terminal',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile('index.html');

  // Crear menú de la aplicación
  const menu = Menu.buildFromTemplate([
    {
      label: 'Archivo',
      submenu: [
        {
          label: 'Nueva Pestaña',
          accelerator: 'CmdOrCtrl+T',
          click: () => sendToWindow('new-tab'),
        },
        { type: 'separator' },
        { role: 'quit', label: 'Salir' },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' },
        { type: 'separator' },
        {
          label: 'Buscar...',
          accelerator: 'CmdOrCtrl+F',
          click: () => sendToWindow('find'),
        },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'reload', label: 'Recargar' },
        { role: 'toggledevtools', label: 'Herramientas de Desarrollo' },
        { type: 'separator' },
        {
          label: 'Temas',
          submenu: [
            {
              label: 'Oscuro (Default)',
              click: () => sendToWindow('change-theme', 'dark'),
            },
            {
              label: 'Claro',
              click: () => sendToWindow('change-theme', 'light'),
            },
            {
              label: 'Monokai',
              click: () => sendToWindow('change-theme', 'monokai'),
            },
            {
              label: 'Solarized',
              click: () => sendToWindow('change-theme', 'solarized'),
            },
            {
              label: 'Retro',
              click: () => sendToWindow('change-theme', 'retro'),
            },
            {
              label: 'Hacker',
              click: () => sendToWindow('change-theme', 'hacker'),
            },
          ],
        },
        {
          label: 'Personalizar Colores...',
          click: () => sendToWindow('show-color-customizer'),
        },
        { type: 'separator' },
        {
          label: 'Aumentar Texto',
          accelerator: 'CmdOrCtrl+=',
          click: () => sendToWindow('font-size', 1),
        },
        {
          label: 'Reducir Texto',
          accelerator: 'CmdOrCtrl+-',
          click: () => sendToWindow('font-size', -1),
        },
        {
          label: 'Tamaño de Texto Normal',
          accelerator: 'CmdOrCtrl+0',
          click: () => sendToWindow('font-size', 0),
        },
      ],
    },
    {
      label: 'Pestañas',
      submenu: [
        {
          label: 'Nueva Pestaña',
          accelerator: 'CmdOrCtrl+T',
          click: () => sendToWindow('new-tab'),
        },
        {
          label: 'Cerrar Pestaña',
          accelerator: 'CmdOrCtrl+W',
          click: () => sendToWindow('close-tab'),
        },
        {
          label: 'Renombrar Pestaña',
          accelerator: 'F2',
          click: () => sendToWindow('rename-tab'),
        },
        { type: 'separator' },
        {
          label: 'Pestaña Siguiente',
          accelerator: 'CmdOrCtrl+Tab',
          click: () => sendToWindow('next-tab'),
        },
        {
          label: 'Pestaña Anterior',
          accelerator: 'CmdOrCtrl+Shift+Tab',
          click: () => sendToWindow('prev-tab'),
        },
      ],
    },
    {
      label: 'Ayuda',
      submenu: [
        {
          label: 'Sitio web',
          click: () => shell.openExternal('https://cmurestudillos.github.io/hype-terminal/'),
        },
        {
          label: 'Reportar un problema',
          click: () => shell.openExternal('https://github.com/cmurestudillos/hype-terminal/issues'),
        },
        { type: 'separator' },
        { label: 'Acerca de HYPE Terminal', click: showAbout },
      ],
    },
  ]);

  Menu.setApplicationMenu(menu);

  // Al recargar (Ver › Recargar) las pestañas de la página anterior desaparecen: cerrar sus shells
  mainWindow.webContents.on('did-start-loading', closeAllSessions);

  mainWindow.on('closed', () => {
    closeAllSessions();
    mainWindow = null;
  });
}

function showAbout() {
  const options = {
    type: 'info',
    title: 'Acerca de HYPE Terminal',
    message: `HYPE Terminal ${app.getVersion()}`,
    detail: [
      `Electron ${process.versions.electron}`,
      `Chromium ${process.versions.chrome}`,
      `Node.js ${process.versions.node}`,
      '',
      'Licencia MIT · Carlos Mur',
      'https://github.com/cmurestudillos/hype-terminal',
    ].join('\n'),
    buttons: ['Aceptar'],
  };
  if (mainWindow) {
    dialog.showMessageBox(mainWindow, options);
  } else {
    dialog.showMessageBox(options);
  }
}

// Enviar un evento a la ventana si sigue abierta (en macOS el menú existe sin ventana)
function sendToWindow(channel, ...args) {
  if (mainWindow) {
    mainWindow.webContents.send(channel, ...args);
  }
}

// La salida de la shell llega en muchos trozos pequeños: agruparlos reduce los mensajes IPC
function queueOutput(sessionId, session, data) {
  session.buffer += data;
  if (!session.flushTimer) {
    session.flushTimer = setTimeout(() => {
      session.flushTimer = null;
      const output = session.buffer;
      session.buffer = '';
      sendToWindow('pty-data', { sessionId, data: output });
    }, 5);
  }
}

function closeSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    return;
  }
  sessions.delete(sessionId);
  clearTimeout(session.flushTimer);
  try {
    session.pty.kill();
  } catch (_error) {
    // La shell ya había terminado
  }
}

function closeAllSessions() {
  [...sessions.keys()].forEach(closeSession);
}

const validSize = n => Number.isInteger(n) && n > 0 && n < 1000;

// Crear la shell de una pestaña nueva
ipcMain.handle('pty-create', (event, { sessionId, cols, rows }) => {
  if (typeof sessionId !== 'string' || sessions.has(sessionId)) {
    return { ok: false, error: 'Sesión no válida' };
  }
  const { file, args } = shellCommand();
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'HYPE-Terminal' };
  if (path.basename(file) === 'bash' && !env.PROMPT_COMMAND) {
    env.PROMPT_COMMAND = BASH_PROMPT_COMMAND;
  }

  let proc;
  try {
    proc = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: validSize(cols) ? cols : 80,
      rows: validSize(rows) ? rows : 24,
      cwd: os.homedir(),
      env,
      // Windows: ConPTY incluido en node-pty (el de Windows Terminal) en lugar del del sistema;
      // además kill() no necesita lanzar un proceso auxiliar para listar los hijos de la consola
      useConptyDll: true,
    });
  } catch (error) {
    console.error('No se pudo iniciar la shell:', error);
    return { ok: false, error: `No se pudo iniciar ${file}: ${error.message}` };
  }

  const session = { pty: proc, buffer: '', flushTimer: null };
  sessions.set(sessionId, session);

  proc.onData(data => queueOutput(sessionId, session, data));
  proc.onExit(({ exitCode }) => {
    // Enviar lo que quede pendiente antes de avisar del cierre
    if (session.flushTimer) {
      clearTimeout(session.flushTimer);
      session.flushTimer = null;
      sendToWindow('pty-data', { sessionId, data: session.buffer });
    }
    if (sessions.get(sessionId) === session) {
      sessions.delete(sessionId);
      sendToWindow('pty-exit', { sessionId, exitCode });
    }
  });

  return { ok: true, shell: path.basename(file) };
});

ipcMain.on('pty-write', (event, { sessionId, data }) => {
  const session = sessions.get(sessionId);
  if (session && typeof data === 'string') {
    session.pty.write(data);
  }
});

ipcMain.on('pty-resize', (event, { sessionId, cols, rows }) => {
  const session = sessions.get(sessionId);
  if (session && validSize(cols) && validSize(rows)) {
    try {
      session.pty.resize(cols, rows);
    } catch (_error) {
      // La shell terminó entre medias
    }
  }
});

ipcMain.on('pty-kill', (event, sessionId) => {
  closeSession(sessionId);
});

ipcMain.on('clipboard-copy', (event, text) => {
  if (typeof text === 'string') {
    clipboard.writeText(text);
  }
});

ipcMain.on('clipboard-paste', event => {
  event.sender.paste();
});

app.on('ready', createWindow);

app.on('before-quit', closeAllSessions);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
