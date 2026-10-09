const { app, BrowserWindow, ipcMain, Menu, dialog, shell, clipboard } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');
const pty = require('node-pty');

let mainWindow;
// El usuario ya confirmó cerrar la ventana con comandos en marcha
let closeConfirmed = false;
// El cierre de la ventana viene de salir de la aplicación (Cmd+Q / Archivo › Salir)
let quitting = false;

// Una pseudo-terminal (shell real) por pestaña: sessionId → { pty, shell, buffer, flushTimer }
const sessions = new Map();

// ---------- ajustes ----------

const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { defaultShell: null, restoreTabs: true };

function loadSettings() {
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')) };
  } catch (_error) {
    // Primera ejecución o archivo dañado: valores por defecto
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error('No se pudieron guardar los ajustes:', error);
  }
}

// ---------- shells disponibles ----------

// Las shells publican el directorio actual en cada prompt con la secuencia OSC 9;9 (la que usa
// Windows Terminal) u OSC 7. La app la usa para el título de la pestaña, para restaurar las
// pestañas en su directorio y para saber si hay un comando en marcha (sin prompt = ocupada).
const POWERSHELL_INIT = `
$global:__hypePrompt = $function:prompt
function global:prompt {
  $loc = $executionContext.SessionState.Path.CurrentLocation
  $out = ''
  if ($loc.Provider.Name -eq 'FileSystem') {
    $out = "$([char]27)]9;9;\`"$($loc.ProviderPath)\`"$([char]27)\\"
  }
  $out + (& $global:__hypePrompt)
}
`;

// Git Bash: ruta de Windows (cygpath) para que coincida con la del resto de shells
const GIT_BASH_PROMPT_COMMAND = 'printf "\\033]9;9;%s\\033\\\\" "$(cygpath -w "$PWD")"';
// bash en macOS/Linux: OSC 7 estándar (file://host/ruta)
const BASH_PROMPT_COMMAND = 'printf "\\033]7;file://%s%s\\033\\\\" "$HOSTNAME" "$PWD"';
// cmd: el prompt admite secuencias de escape con $E
const CMD_PROMPT = '$E]9;9;$P$E\\$P$G';

function findOnPath(exe) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir) {
      const file = path.join(dir, exe);
      if (fs.existsSync(file)) {
        return file;
      }
    }
  }
  return null;
}

const firstExisting = files => files.find(f => f && fs.existsSync(f)) || null;

// ¿Tiene WSL alguna distribución instalada? (wsl.exe existe en Windows aunque no haya ninguna)
function wslHasDistros(wslExe) {
  return new Promise(resolve => {
    execFile(wslExe, ['-l', '-q'], { encoding: 'buffer', timeout: 4000, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(false);
        return;
      }
      const text = stdout.toString('utf16le').replace(/\0/g, '');
      resolve(text.split(/\r?\n/).some(line => line.trim() !== ''));
    });
  });
}

async function detectShells() {
  const found = [];

  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    const programFiles = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432];

    found.push({
      id: 'powershell',
      name: 'Windows PowerShell',
      file: path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    });

    const pwsh = firstExisting([
      findOnPath('pwsh.exe'),
      ...programFiles.map(p => p && path.join(p, 'PowerShell', '7', 'pwsh.exe')),
    ]);
    if (pwsh) {
      found.push({ id: 'pwsh', name: 'PowerShell 7', file: pwsh });
    }

    found.push({
      id: 'cmd',
      name: 'Símbolo del sistema',
      file: process.env.ComSpec || path.join(systemRoot, 'System32', 'cmd.exe'),
    });

    const gitExe = findOnPath('git.exe');
    const gitBash = firstExisting([
      gitExe && path.join(path.dirname(path.dirname(gitExe)), 'bin', 'bash.exe'),
      ...programFiles.map(p => p && path.join(p, 'Git', 'bin', 'bash.exe')),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
    ]);
    if (gitBash) {
      found.push({ id: 'gitbash', name: 'Git Bash', file: gitBash });
    }

    const wsl = path.join(systemRoot, 'System32', 'wsl.exe');
    if (fs.existsSync(wsl) && (await wslHasDistros(wsl))) {
      found.push({ id: 'wsl', name: 'WSL', file: wsl });
    }
    return found.filter(s => fs.existsSync(s.file));
  }

  // macOS / Linux: la shell del usuario y las habituales de /etc/shells
  const candidates = [process.env.SHELL];
  try {
    candidates.push(
      ...fs
        .readFileSync('/etc/shells', 'utf8')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('/'))
    );
  } catch (_error) {
    candidates.push('/bin/zsh', '/bin/bash');
  }
  const seen = new Set();
  for (const file of candidates) {
    const name = file && path.basename(file);
    if (!name || seen.has(name) || !fs.existsSync(file)) {
      continue;
    }
    // La del usuario siempre; del resto, solo las shells interactivas habituales
    if (file !== process.env.SHELL && !['zsh', 'bash', 'fish'].includes(name)) {
      continue;
    }
    seen.add(name);
    found.push({ id: name, name, file });
  }
  if (found.length === 0) {
    found.push({ id: 'sh', name: 'sh', file: '/bin/sh' });
  }
  return found;
}

let shells = [];
const shellsReady = detectShells()
  .then(list => {
    shells = list;
  })
  .catch(error => {
    console.error('Error al detectar las shells:', error);
    shells = process.platform === 'win32' ? [] : [{ id: 'sh', name: 'sh', file: '/bin/sh' }];
  });

function defaultShell() {
  return shells.find(s => s.id === settings.defaultShell) || shells[0];
}

// Archivo, argumentos y variables con las que se lanza cada shell
function launchSpec(shellInfo) {
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'HYPE-Terminal' };
  let args = [];

  switch (shellInfo.id) {
    case 'powershell':
    case 'pwsh':
      args = ['-NoLogo', '-NoExit', '-EncodedCommand', Buffer.from(POWERSHELL_INIT, 'utf16le').toString('base64')];
      break;
    case 'cmd':
      env.PROMPT = CMD_PROMPT;
      break;
    case 'gitbash':
      // Shell de login como el acceso directo de Git Bash; CHERE_INVOKING evita que su perfil
      // cambie al home y respete el directorio de la pestaña
      args = ['--login', '-i'];
      env.CHERE_INVOKING = '1';
      env.PROMPT_COMMAND = GIT_BASH_PROMPT_COMMAND;
      break;
    case 'wsl':
      break;
    default:
      // En macOS los terminales abren shells de login (carga ~/.zprofile, PATH de Homebrew...)
      args = process.platform === 'darwin' ? ['-l'] : [];
      if (shellInfo.id === 'bash' && !env.PROMPT_COMMAND) {
        env.PROMPT_COMMAND = BASH_PROMPT_COMMAND;
      }
  }
  return { file: shellInfo.file, args, env };
}

// ---------- ventana y menú ----------

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
  buildMenu();

  // Al recargar (Ver › Recargar) las pestañas de la página anterior desaparecen: cerrar sus shells
  mainWindow.webContents.on('did-start-loading', closeAllSessions);

  // Antes de cerrar, preguntar si alguna pestaña tiene un comando en marcha
  mainWindow.on('close', event => {
    if (closeConfirmed || sessions.size === 0) {
      return;
    }
    event.preventDefault();
    confirmWindowClose();
  });

  mainWindow.on('closed', () => {
    closeAllSessions();
    mainWindow = null;
    closeConfirmed = false;
  });
}

async function confirmWindowClose() {
  const win = mainWindow;
  let busy = [];
  try {
    busy = await askRenderer('busy-tabs');
  } catch (_error) {
    // Si el renderer no responde, cerrar sin preguntar
  }
  if (!win || win.isDestroyed()) {
    return;
  }
  if (busy.length > 0) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      title: 'Cerrar HYPE Terminal',
      message:
        busy.length === 1
          ? `La pestaña «${busy[0]}» tiene un comando en marcha.`
          : `${busy.length} pestañas tienen comandos en marcha: ${busy.map(t => `«${t}»`).join(', ')}.`,
      detail: 'Si cierras, se terminarán.',
      buttons: ['Cerrar', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0) {
      quitting = false;
      return;
    }
  }
  closeConfirmed = true;
  if (quitting) {
    app.quit();
  } else {
    win.close();
  }
}

// Pregunta al renderer y espera su respuesta por un canal propio
let requestCounter = 0;
function askRenderer(channel) {
  return new Promise((resolve, reject) => {
    if (!mainWindow) {
      reject(new Error('Sin ventana'));
      return;
    }
    const replyChannel = `${channel}-reply-${++requestCounter}`;
    const timer = setTimeout(() => {
      ipcMain.removeAllListeners(replyChannel);
      reject(new Error('Sin respuesta del renderer'));
    }, 3000);
    ipcMain.once(replyChannel, (event, value) => {
      clearTimeout(timer);
      resolve(value);
    });
    mainWindow.webContents.send(channel, replyChannel);
  });
}

function buildMenu() {
  const defaultId = defaultShell()?.id;
  const shellItems = shells.map(s => ({ label: s.name, click: () => sendToWindow('new-tab', s.id) }));

  const menu = Menu.buildFromTemplate([
    {
      label: 'Archivo',
      submenu: [
        {
          label: 'Nueva Pestaña',
          accelerator: 'CmdOrCtrl+T',
          click: () => sendToWindow('new-tab'),
        },
        {
          label: 'Nueva Pestaña con',
          submenu: shellItems.length > 0 ? shellItems : [{ label: 'Buscando shells…', enabled: false }],
        },
        { type: 'separator' },
        {
          label: 'Shell por Defecto',
          submenu: shells.map(s => ({
            label: s.name,
            type: 'radio',
            checked: s.id === defaultId,
            click: () => {
              settings.defaultShell = s.id;
              saveSettings();
              buildMenu();
            },
          })),
        },
        {
          label: 'Restaurar Pestañas al Abrir',
          type: 'checkbox',
          checked: settings.restoreTabs,
          click: item => {
            settings.restoreTabs = item.checked;
            saveSettings();
          },
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
          // Ctrl también en macOS: Cmd+Tab es el selector de aplicaciones del sistema
          accelerator: 'Ctrl+Tab',
          click: () => sendToWindow('next-tab'),
        },
        {
          label: 'Pestaña Anterior',
          accelerator: 'Ctrl+Shift+Tab',
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

// ---------- pseudo-terminales ----------

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

function isDirectory(dir) {
  try {
    return typeof dir === 'string' && path.isAbsolute(dir) && fs.statSync(dir).isDirectory();
  } catch (_error) {
    return false;
  }
}

// Shells disponibles y ajustes que necesita el renderer al arrancar
ipcMain.handle('get-config', async () => {
  await shellsReady;
  buildMenu();
  return {
    shells: shells.map(({ id, name }) => ({ id, name })),
    defaultShell: defaultShell()?.id || null,
    restoreTabs: settings.restoreTabs,
    home: os.homedir(),
    platform: process.platform,
  };
});

// Crear la shell de una pestaña nueva
ipcMain.handle('pty-create', async (event, { sessionId, cols, rows, shellId, cwd }) => {
  await shellsReady;
  if (typeof sessionId !== 'string' || sessions.has(sessionId)) {
    return { ok: false, error: 'Sesión no válida' };
  }
  const shellInfo = shells.find(s => s.id === shellId) || defaultShell();
  if (!shellInfo) {
    return { ok: false, error: 'No se ha encontrado ninguna shell' };
  }
  const { file, args, env } = launchSpec(shellInfo);

  let proc;
  try {
    proc = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: validSize(cols) ? cols : 80,
      rows: validSize(rows) ? rows : 24,
      // Directorio restaurado si sigue existiendo; si no, la carpeta personal
      cwd: isDirectory(cwd) ? cwd : os.homedir(),
      env,
      // Windows: ConPTY incluido en node-pty (el de Windows Terminal) en lugar del del sistema;
      // además kill() no necesita lanzar un proceso auxiliar para listar los hijos de la consola
      useConptyDll: true,
    });
  } catch (error) {
    console.error('No se pudo iniciar la shell:', error);
    return { ok: false, error: `No se pudo iniciar ${shellInfo.name}: ${error.message}` };
  }

  const session = { pty: proc, shell: shellInfo, buffer: '', flushTimer: null };
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

  return { ok: true, shellId: shellInfo.id, shellName: shellInfo.name };
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

// En macOS y Linux, el proceso en primer plano de la terminal indica si hay un comando en marcha
// (para shells que no publican su prompt, como zsh). En Windows no hay forma fiable: null.
ipcMain.handle('pty-foreground-busy', (event, sessionId) => {
  const session = sessions.get(sessionId);
  if (!session || process.platform === 'win32') {
    return null;
  }
  try {
    return path.basename(session.pty.process) !== path.basename(session.shell.file);
  } catch (_error) {
    return null;
  }
});

ipcMain.handle('confirm-close-tab', async (event, title) => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Cerrar pestaña',
    message: `La pestaña «${title}» tiene un comando en marcha.`,
    detail: 'Si la cierras, se terminará.',
    buttons: ['Cerrar', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  return response === 0;
});

ipcMain.on('shell-menu', (event, { x, y }) => {
  if (!mainWindow) {
    return;
  }
  const defaultId = defaultShell()?.id;
  Menu.buildFromTemplate(
    shells.map(s => ({
      label: s.id === defaultId ? `${s.name} (por defecto)` : s.name,
      click: () => sendToWindow('new-tab', s.id),
    }))
  ).popup({ window: mainWindow, x: Math.round(x), y: Math.round(y) });
});

// Enlaces de la terminal: solo web, nunca rutas locales ni otros protocolos
ipcMain.on('open-external', (event, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    shell.openExternal(url);
  }
});

ipcMain.on('clipboard-copy', (event, text) => {
  if (typeof text === 'string') {
    clipboard.writeText(text);
  }
});

ipcMain.on('clipboard-paste', event => {
  event.sender.paste();
});

app.on('ready', () => {
  loadSettings();
  createWindow();
  shellsReady.then(buildMenu);
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('will-quit', closeAllSessions);

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
