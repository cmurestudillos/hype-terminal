const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');
const fs = require('fs');

let mainWindow;
let sessions = {};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile('index.html');

  // Crear menú para cambio de temas
  const menu = Menu.buildFromTemplate([
    {
      label: 'Archivo',
      submenu: [
        {
          label: 'Nueva Pestaña',
          accelerator: 'CmdOrCtrl+T',
          click: () => mainWindow.webContents.send('new-tab'),
        },
        { type: 'separator' },
        { role: 'quit', label: 'Salir' },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
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
              click: () => mainWindow.webContents.send('change-theme', 'dark'),
            },
            {
              label: 'Claro',
              click: () => mainWindow.webContents.send('change-theme', 'light'),
            },
            {
              label: 'Monokai',
              click: () => mainWindow.webContents.send('change-theme', 'monokai'),
            },
            {
              label: 'Solarized',
              click: () => mainWindow.webContents.send('change-theme', 'solarized'),
            },
            {
              label: 'Retro',
              click: () => mainWindow.webContents.send('change-theme', 'retro'),
            },
            {
              label: 'Hacker',
              click: () => mainWindow.webContents.send('change-theme', 'hacker'),
            },
          ],
        },
        {
          label: 'Personalizar Colores...',
          click: () => {
            // Enviar evento para mostrar el personalizador de colores
            mainWindow.webContents.send('show-color-customizer');
          },
        },
      ],
    },
    {
      label: 'Pestañas',
      submenu: [
        {
          label: 'Nueva Pestaña',
          accelerator: 'CmdOrCtrl+T',
          click: () => mainWindow.webContents.send('new-tab'),
        },
        {
          label: 'Cerrar Pestaña',
          accelerator: 'CmdOrCtrl+W',
          click: () => mainWindow.webContents.send('close-tab'),
        },
        { type: 'separator' },
        {
          label: 'Pestaña Siguiente',
          accelerator: 'CmdOrCtrl+Tab',
          click: () => mainWindow.webContents.send('next-tab'),
        },
        {
          label: 'Pestaña Anterior',
          accelerator: 'CmdOrCtrl+Shift+Tab',
          click: () => mainWindow.webContents.send('prev-tab'),
        },
      ],
    },
  ]);

  Menu.setApplicationMenu(menu);

  // Registrar manejador para cambio de color personalizado
  ipcMain.on('set-custom-colors', (event, colors) => {
    // Guardar colores en localStorage (se hace en el frontend)
    mainWindow.webContents.send('apply-custom-colors', colors);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Crear la primera sesión automáticamente al iniciar
  const initialSessionId = generateSessionId();
  sessions[initialSessionId] = {
    directory: os.homedir(),
    history: [],
  };

  // Enviar el prompt inicial después de un breve retraso
  setTimeout(() => {
    sendPromptForSession(initialSessionId);
    mainWindow.webContents.send('initial-session', initialSessionId);
  }, 500);
}

// Función para generar un ID de sesión único
function generateSessionId() {
  return 'session-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
}

// Registrar eventos para la gestión de sesiones
ipcMain.on('create-session', (event, sessionId) => {
  sessions[sessionId] = {
    directory: os.homedir(),
    history: [],
  };
  sendPromptForSession(sessionId);
});

ipcMain.on('switch-session', (event, sessionId) => {
  // Simplemente asegurarse de que el prompt está actualizado
  if (sessions[sessionId]) {
    sendPromptForSession(sessionId);
  }
});

ipcMain.on('close-session', (event, sessionId) => {
  if (sessions[sessionId]) {
    delete sessions[sessionId];
  }
});

// Recibir comandos del renderer, ahora con sesiones
ipcMain.on('terminal-command', (event, { command, sessionId }) => {
  // Verificar que la sesión existe
  if (!sessions[sessionId]) {
    console.error(`Sesión ${sessionId} no encontrada`);
    return;
  }

  // Guardar comando en el historial de la sesión
  sessions[sessionId].history.push(command);

  // Obtener el directorio actual de la sesión
  const currentDirectory = sessions[sessionId].directory;

  // Manejar cambio de directorio especialmente
  if (command.trim().startsWith('cd ')) {
    const targetDir = command.trim().substring(3);

    try {
      // Manejar rutas relativas y absolutas
      let newDir;
      if (targetDir.startsWith('/') || (process.platform === 'win32' && targetDir.match(/^[A-Z]:\\/i))) {
        // Ruta absoluta
        newDir = targetDir;
      } else if (targetDir === '..') {
        // Directorio padre
        newDir = path.dirname(currentDirectory);
      } else if (targetDir === '~' || targetDir === '') {
        // Directorio home
        newDir = os.homedir();
      } else {
        // Ruta relativa
        newDir = path.join(currentDirectory, targetDir);
      }

      // Verificar si el directorio existe
      if (fs.existsSync(newDir)) {
        sessions[sessionId].directory = newDir;
        mainWindow.webContents.send('terminal-output', { sessionId, output: `Directorio cambiado a: ${newDir}` });
      } else {
        mainWindow.webContents.send('terminal-output', {
          sessionId,
          output: `Error: No existe el directorio: ${newDir}`,
        });
      }

      // Actualizar prompt después del cambio de directorio
      sendPromptForSession(sessionId);
      return;
    } catch (error) {
      mainWindow.webContents.send('terminal-output', {
        sessionId,
        output: `Error al cambiar directorio: ${error.message}`,
      });
      sendPromptForSession(sessionId);
      return;
    }
  }

  // Manejar comando clear especialmente
  if (command.trim() === 'clear' || command.trim() === 'cls') {
    mainWindow.webContents.send('terminal-clear', { sessionId });
    sendPromptForSession(sessionId);
    return;
  }

  // Para comandos pwd o dir, mostrar el directorio actual directamente
  if (command.trim() === 'pwd' || (process.platform === 'win32' && command.trim() === 'cd')) {
    mainWindow.webContents.send('terminal-output', { sessionId, output: currentDirectory });
    sendPromptForSession(sessionId);
    return;
  }

  // Para otros comandos, usar exec como antes
  const shellCmd =
    process.platform === 'win32'
      ? { cmd: 'powershell.exe', args: ['-Command', command] }
      : { cmd: 'bash', args: ['-c', command] };

  // Ejecutar el comando en el directorio actual de la sesión
  const childProcess = exec(
    `${shellCmd.cmd} ${shellCmd.args.join(' ')}`,
    { cwd: currentDirectory, env: process.env },
    (error, stdout, stderr) => {
      if (error) {
        console.error(`Error al ejecutar comando: ${error}`);
        mainWindow.webContents.send('terminal-output', { sessionId, output: `Error: ${error.message}\r\n` });
      }

      if (stdout) {
        mainWindow.webContents.send('terminal-output', { sessionId, output: stdout });
      }

      if (stderr) {
        console.error(`Error estándar: ${stderr}`);
        mainWindow.webContents.send('terminal-output', { sessionId, output: stderr });
      }

      // Actualizar el prompt para el siguiente comando
      sendPromptForSession(sessionId);
    }
  );
});

// Función para enviar el prompt de una sesión específica
function sendPromptForSession(sessionId) {
  if (!sessions[sessionId]) return;

  const sessionDir = sessions[sessionId].directory;
  const displayDir = sessionDir.replace(os.homedir(), '~');
  const prompt =
    process.platform === 'win32' ? `PS ${displayDir}> ` : `${os.userInfo().username}@${os.hostname()}:${displayDir}$ `;

  mainWindow.webContents.send('terminal-prompt', { sessionId, prompt });
}

// Configurar el autocompletado para manejar sesiones
ipcMain.handle('terminal-autocomplete', async (event, { partial, sessionId }) => {
  try {
    // Verificar que la sesión existe
    if (!sessions[sessionId]) {
      console.error(`Sesión ${sessionId} no encontrada para autocompletar`);
      return [];
    }

    // Obtener el directorio actual de la sesión
    const currentDirectory = sessions[sessionId].directory;

    // Si comienza con cd, intentamos completar directorios
    if (partial.startsWith('cd ')) {
      const pathToComplete = partial.substring(3);
      return await getDirectoryCompletions(pathToComplete, currentDirectory);
    }

    // Si no es cd, completamos con los comandos comunes o archivos/directorios
    // Primero, intentar completar archivos/directorios en el directorio actual
    const fileCompletions = await getFileCompletions(partial, currentDirectory);
    if (fileCompletions.length > 0) {
      return fileCompletions;
    }

    // Si no hay coincidencias, ofrecer comandos comunes que coincidan
    const commonCommands = ['ls', 'cd', 'pwd', 'echo', 'cat', 'grep', 'mkdir', 'rm', 'mv', 'cp', 'clear'];
    return commonCommands.filter(cmd => cmd.startsWith(partial));
  } catch (error) {
    console.error('Error en autocompletado:', error);
    return [];
  }
});

// Función para obtener completaciones de directorios
async function getDirectoryCompletions(pathToComplete, currentDirectory) {
  try {
    const { promisify } = require('util');
    const readdir = promisify(fs.readdir);
    const stat = promisify(fs.stat);

    // Determinar la ruta base y el patrón a completar
    let basePath, pattern;
    if (pathToComplete.includes('/') || (process.platform === 'win32' && pathToComplete.includes('\\'))) {
      const separator = process.platform === 'win32' ? '\\' : '/';
      const lastSepIndex = Math.max(
        pathToComplete.lastIndexOf('/'),
        process.platform === 'win32' ? pathToComplete.lastIndexOf('\\') : -1
      );
      basePath = pathToComplete.substring(0, lastSepIndex + 1);
      pattern = pathToComplete.substring(lastSepIndex + 1);

      // Manejar rutas absolutas y relativas
      if (!path.isAbsolute(basePath)) {
        basePath = path.join(currentDirectory, basePath);
      }
    } else {
      basePath = currentDirectory;
      pattern = pathToComplete;
    }

    // Si es una tilde, expandir al home
    if (basePath.startsWith('~')) {
      basePath = basePath.replace(/^~/, os.homedir());
    }

    // Listar directorios y filtrar por el patrón
    let entries;
    try {
      entries = await readdir(basePath);
    } catch (error) {
      // Si no se puede leer el directorio, devolver una lista vacía
      return [];
    }

    // Filtrar por el patrón y solo incluir directorios
    const completions = [];
    for (const entry of entries) {
      if (entry.startsWith(pattern)) {
        try {
          const fullPath = path.join(basePath, entry);
          const stats = await stat(fullPath);
          if (stats.isDirectory()) {
            completions.push(`cd ${entry}${path.sep}`); // Añadir separador de path al final
          }
        } catch (error) {
          // Ignorar entradas que no se pueden stat
        }
      }
    }

    return completions;
  } catch (error) {
    console.error('Error al completar directorios:', error);
    return [];
  }
}

// Función para obtener completaciones de archivos y directorios
async function getFileCompletions(partial, currentDirectory) {
  try {
    const { promisify } = require('util');
    const readdir = promisify(fs.readdir);

    // Lista de archivos y directorios
    let entries;
    try {
      entries = await readdir(currentDirectory);
    } catch (error) {
      return [];
    }

    // Filtrar por el patrón
    return entries.filter(entry => entry.startsWith(partial)).map(entry => entry);
  } catch (error) {
    console.error('Error al completar archivos:', error);
    return [];
  }
}

app.on('ready', createWindow);

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
