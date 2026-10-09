document.addEventListener('DOMContentLoaded', () => {
  const { Terminal } = window;
  const { FitAddon } = window.FitAddon;
  const { SearchAddon } = window.SearchAddon;
  const isMac = navigator.platform.toUpperCase().includes('MAC');

  // Referencias a elementos del DOM
  const tabsContainer = document.getElementById('tabs');
  const terminalsContainer = document.getElementById('terminals-container');
  const newTabButton = document.getElementById('new-tab-button');

  // Barra de búsqueda (Ctrl+F)
  const searchBar = document.getElementById('search-bar');
  const searchInput = document.getElementById('search-input');
  const searchCount = document.getElementById('search-count');

  // Elementos para personalización de colores
  const colorCustomizer = document.getElementById('color-customizer');
  const backgroundColorInput = document.getElementById('background-color');
  const textColorInput = document.getElementById('text-color');
  const promptColorInput = document.getElementById('prompt-color');
  const selectionColorInput = document.getElementById('selection-color');
  const applyColorsButton = document.getElementById('apply-colors');
  const cancelColorsButton = document.getElementById('cancel-colors');

  const THEMES = ['dark', 'light', 'monokai', 'solarized', 'retro', 'hacker'];
  const CUSTOM_PROPERTIES = ['--background-color', '--text-color', '--prompt-color', '--selection-color'];

  // Colores ANSI por tema (los que no aparecen usan la paleta por defecto de xterm.js).
  // En el tema claro los "blancos" y amarillos brillantes se oscurecen: PowerShell los usa
  // para números y comandos y sobre fondo claro no se leerían.
  const ANSI_PALETTES = {
    light: {
      black: '#383a42',
      red: '#e45649',
      green: '#50a14f',
      yellow: '#c18401',
      blue: '#0184bc',
      magenta: '#a626a4',
      cyan: '#0997b3',
      white: '#6b6e76',
      brightBlack: '#8a8d94',
      brightRed: '#c4372a',
      brightGreen: '#3e8e3e',
      brightYellow: '#986801',
      brightBlue: '#2f6fd0',
      brightMagenta: '#a626a4',
      brightCyan: '#0e7c8a',
      brightWhite: '#202227',
    },
    monokai: {
      black: '#272822',
      red: '#f92672',
      green: '#a6e22e',
      yellow: '#f4bf75',
      blue: '#66d9ef',
      magenta: '#ae81ff',
      cyan: '#a1efe4',
      white: '#f8f8f2',
      brightBlack: '#75715e',
      brightRed: '#f92672',
      brightGreen: '#a6e22e',
      brightYellow: '#e6db74',
      brightBlue: '#66d9ef',
      brightMagenta: '#ae81ff',
      brightCyan: '#a1efe4',
      brightWhite: '#f9f8f5',
    },
    solarized: {
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#657b83',
      brightRed: '#cb4b16',
      brightGreen: '#a4b81c',
      brightYellow: '#d6a400',
      brightBlue: '#4fa3e0',
      brightMagenta: '#6c71c4',
      brightCyan: '#3cc0b5',
      brightWhite: '#fdf6e3',
    },
  };

  const FONT_SIZE_DEFAULT = 14;
  let fontSize = clampFontSize(Number(localStorage.getItem('terminal-font-size')) || FONT_SIZE_DEFAULT);

  // Estado de la aplicación
  let tabs = [];
  let activeTab = null;
  let currentThemeName = 'dark';

  // Cargar tema guardado
  loadSavedTheme();

  // Salida y fin de cada shell
  window.terminal.onData((sessionId, data) => {
    const tab = findTab(sessionId);
    if (tab) {
      tab.term.write(data);
    }
  });

  window.terminal.onExit((sessionId, exitCode) => {
    const tab = findTab(sessionId);
    if (!tab) {
      return;
    }
    tab.exited = true;
    // Si la shell muere nada más arrancar no se cierra la pestaña (evita un bucle de pestañas
    // nuevas que también fallan) y se deja el motivo a la vista
    if (Date.now() - tab.createdAt < 1500) {
      tab.term.write(`\r\n\x1b[31m[La shell terminó al iniciarse (código ${exitCode})]\x1b[0m\r\n`);
      return;
    }
    // "exit" en la shell cierra la pestaña, como en cualquier terminal
    closeTab(sessionId);
  });

  // Manejar eventos del menú
  window.terminal.onNewTab(() => handleNewTab());
  window.terminal.onCloseTab(() => {
    if (activeTab) {
      closeTab(activeTab.id);
    }
  });
  window.terminal.onNextTab(() => switchToNextTab());
  window.terminal.onPrevTab(() => switchToPrevTab());
  window.terminal.onRenameTab(() => {
    if (activeTab) {
      startRenameTab(activeTab.id);
    }
  });
  window.terminal.onFind(() => openSearch());
  window.terminal.onFontSize(delta => setFontSize(delta === 0 ? FONT_SIZE_DEFAULT : fontSize + delta));
  window.terminal.changeTheme(themeName => changeTheme(themeName));
  window.terminal.showColorCustomizer(() => showColorCustomizer());

  // Event listener para el botón de nueva pestaña
  newTabButton.addEventListener('click', () => handleNewTab());

  // Ajustar la terminal visible al tamaño de la ventana
  let fitPending = false;
  new ResizeObserver(() => {
    if (fitPending) {
      return;
    }
    fitPending = true;
    requestAnimationFrame(() => {
      fitPending = false;
      fitActiveTab();
    });
  }).observe(terminalsContainer);

  // Primera pestaña
  handleNewTab();

  // Funciones para manejar pestañas
  function findTab(sessionId) {
    return tabs.find(t => t.id === sessionId);
  }

  function handleNewTab() {
    const sessionId = 'session-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    createNewTab(sessionId);
  }

  async function createNewTab(sessionId) {
    const tabNumber = tabs.length + 1;

    // Crear elemento de pestaña
    const tabElement = document.createElement('div');
    tabElement.className = 'tab';
    tabElement.id = 'tab-' + sessionId;
    tabElement.innerHTML = `
      <span class="tab-title">Terminal ${tabNumber}</span>
      <span class="tab-close" title="Cerrar pestaña">×</span>
    `;
    tabsContainer.appendChild(tabElement);

    // Crear instancia de terminal
    const terminalInstance = document.createElement('div');
    terminalInstance.className = 'terminal-instance';
    terminalInstance.id = 'terminal-' + sessionId;
    terminalsContainer.appendChild(terminalInstance);

    const term = new Terminal({
      fontFamily: "'Cascadia Mono', 'Cascadia Code', Consolas, Menlo, 'DejaVu Sans Mono', 'Courier New', monospace",
      fontSize,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      theme: buildXtermTheme(),
    });
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);

    const tab = {
      id: sessionId,
      element: tabElement,
      terminal: terminalInstance,
      term,
      fitAddon,
      searchAddon,
      title: `Terminal ${tabNumber}`,
      // Nombre puesto por el usuario; si es null, el título sigue al directorio actual
      customTitle: null,
      createdAt: Date.now(),
      exited: false,
    };
    tabs.push(tab);

    // Activar antes de abrir: xterm necesita el contenedor visible para medir filas y columnas
    activateTab(sessionId);
    term.open(terminalInstance);
    fitAddon.fit();
    if (activeTab === tab) {
      term.focus();
    }

    term.attachCustomKeyEventHandler(event => handleTerminalKey(tab, event));
    term.onData(data => window.terminal.write(sessionId, data));
    term.onResize(({ cols, rows }) => window.terminal.resize(sessionId, cols, rows));
    term.onTitleChange(title => updateTabTitle(sessionId, title));
    searchAddon.onDidChangeResults(({ resultIndex, resultCount }) => {
      if (activeTab === tab) {
        updateSearchCount(resultIndex, resultCount);
      }
    });

    // Clic derecho: copiar si hay selección, si no pegar (como en Windows Terminal)
    terminalInstance.addEventListener('contextmenu', event => {
      event.preventDefault();
      term.focus();
      if (term.hasSelection()) {
        window.terminal.copyText(term.getSelection());
        term.clearSelection();
      } else {
        window.terminal.paste();
      }
    });

    // Agregar event listeners para la pestaña
    tabElement.addEventListener('click', e => {
      // Ignorar si se hizo clic en el botón de cerrar o en el campo de renombrar
      if (e.target.classList.contains('tab-close') || e.target.classList.contains('tab-rename')) {
        return;
      }
      activateTab(sessionId);
    });

    // Doble clic para renombrar la pestaña
    tabElement.addEventListener('dblclick', e => {
      if (!e.target.classList.contains('tab-close')) {
        startRenameTab(sessionId);
      }
    });

    tabElement.querySelector('.tab-close').addEventListener('click', e => {
      e.stopPropagation();
      closeTab(sessionId);
    });

    const result = await window.terminal.createPty(sessionId, term.cols, term.rows);
    if (!result.ok) {
      tab.exited = true;
      term.write(`\x1b[31m${result.error}\x1b[0m\r\n`);
    }
  }

  // Atajos que no deben llegar a la shell: los gestiona el menú de la aplicación
  function handleTerminalKey(tab, event) {
    if (event.type !== 'keydown') {
      return true;
    }
    const key = event.key.toLowerCase();

    if (event.key === 'F2') {
      return false;
    }
    if (isMac || !event.ctrlKey || event.altKey) {
      // En macOS los atajos van con Cmd y xterm.js no los intercepta
      return true;
    }
    // Ctrl+C con texto seleccionado copia; sin selección llega a la shell como interrupción
    if (key === 'c' && !event.shiftKey) {
      return !tab.term.hasSelection();
    }
    // Ctrl+V pega; Ctrl+T/W/F/Tab y el zoom son atajos del menú
    if (['v', 't', 'w', 'f', 'tab', '=', '+', '-', '0'].includes(key)) {
      return false;
    }
    return true;
  }

  function activateTab(sessionId) {
    // Desactivar pestaña actual
    if (activeTab) {
      activeTab.element.classList.remove('active');
      activeTab.terminal.classList.remove('active');
    }

    // Encontrar y activar la nueva pestaña
    const tab = findTab(sessionId);
    if (tab) {
      tab.element.classList.add('active');
      tab.terminal.classList.add('active');
      tab.element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      activeTab = tab;
      closeSearch(false);
      fitActiveTab();
      tab.term.focus();
    }
  }

  function fitActiveTab() {
    if (activeTab && activeTab.term.element) {
      activeTab.fitAddon.fit();
    }
  }

  function closeTab(sessionId) {
    const tabIndex = tabs.findIndex(t => t.id === sessionId);
    if (tabIndex === -1) {
      return;
    }
    const tab = tabs[tabIndex];

    // Cerrar la shell y liberar la terminal
    if (!tab.exited) {
      window.terminal.kill(sessionId);
    }
    tab.term.dispose();
    tab.element.remove();
    tab.terminal.remove();
    tabs.splice(tabIndex, 1);

    // Si era la pestaña activa, activar otra
    if (activeTab && activeTab.id === sessionId) {
      activeTab = null;
      if (tabs.length > 0) {
        activateTab(tabs[Math.min(tabIndex, tabs.length - 1)].id);
      } else {
        // No hay más pestañas, crear una nueva
        handleNewTab();
      }
    }
  }

  function switchToNextTab() {
    if (tabs.length <= 1) {
      return;
    }
    const currentIndex = tabs.findIndex(t => t.id === activeTab.id);
    activateTab(tabs[(currentIndex + 1) % tabs.length].id);
  }

  function switchToPrevTab() {
    if (tabs.length <= 1) {
      return;
    }
    const currentIndex = tabs.findIndex(t => t.id === activeTab.id);
    activateTab(tabs[(currentIndex - 1 + tabs.length) % tabs.length].id);
  }

  // El título lo publica la shell (en PowerShell y bash, el directorio actual)
  function updateTabTitle(sessionId, title) {
    const tab = findTab(sessionId);
    if (!tab || !title) {
      return;
    }
    let dirName = title.trim();
    if (dirName.length > 20) {
      const parts = dirName.split(/[\\/]/);
      dirName = parts.filter(p => p.length > 0).pop() || dirName;
    }
    tab.title = dirName;
    tab.fullTitle = title.trim();
    renderTabTitle(tab);
  }

  function renderTabTitle(tab) {
    const titleElement = tab.element.querySelector('.tab-title');
    const fullTitle = tab.fullTitle || tab.title;
    titleElement.textContent = tab.customTitle || tab.title;
    titleElement.title = tab.customTitle ? `${tab.customTitle} — ${fullTitle}` : fullTitle;
  }

  // Renombrar una pestaña: Enter guarda, Escape cancela; un nombre vacío vuelve al título automático
  function startRenameTab(sessionId) {
    const tab = findTab(sessionId);
    if (!tab || tab.element.querySelector('.tab-rename')) {
      return;
    }
    const titleElement = tab.element.querySelector('.tab-title');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tab-rename';
    input.maxLength = 40;
    input.value = tab.customTitle || tab.title;
    input.setAttribute('aria-label', 'Nombre de la pestaña');
    titleElement.hidden = true;
    tab.element.insertBefore(input, titleElement);
    input.focus();
    input.select();

    let finished = false;
    const finish = save => {
      if (finished) {
        return;
      }
      finished = true;
      if (save) {
        tab.customTitle = input.value.trim() || null;
      }
      input.remove();
      titleElement.hidden = false;
      renderTabTitle(tab);
      if (activeTab === tab) {
        tab.term.focus();
      }
    };

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  }

  // Búsqueda en la salida de la pestaña activa
  function searchOptions(incremental = false) {
    const style = getComputedStyle(document.body);
    const accent = style.getPropertyValue('--prompt-color').trim();
    return {
      incremental,
      decorations: {
        matchBackground: rgbToHex(style.getPropertyValue('--selection-color').trim()),
        activeMatchBackground: rgbToHex(accent),
        matchOverviewRuler: rgbToHex(accent),
        activeMatchColorOverviewRuler: rgbToHex(accent),
      },
    };
  }

  function openSearch() {
    if (!activeTab) {
      return;
    }
    searchBar.hidden = false;
    const selection = activeTab.term.getSelection();
    if (selection && !selection.includes('\n')) {
      searchInput.value = selection;
    }
    searchInput.focus();
    searchInput.select();
    if (searchInput.value) {
      activeTab.searchAddon.findNext(searchInput.value, searchOptions(true));
    }
  }

  function closeSearch(focusTerminal = true) {
    if (searchBar.hidden) {
      return;
    }
    searchBar.hidden = true;
    searchCount.textContent = '';
    tabs.forEach(t => t.searchAddon.clearDecorations());
    if (focusTerminal && activeTab) {
      activeTab.term.focus();
    }
  }

  function findInActiveTab(backwards = false) {
    if (!activeTab || !searchInput.value) {
      searchCount.textContent = '';
      return;
    }
    const found = backwards
      ? activeTab.searchAddon.findPrevious(searchInput.value, searchOptions())
      : activeTab.searchAddon.findNext(searchInput.value, searchOptions());
    if (!found) {
      searchCount.textContent = 'Sin resultados';
    }
  }

  function updateSearchCount(resultIndex, resultCount) {
    if (!searchInput.value) {
      searchCount.textContent = '';
    } else if (resultCount === 0) {
      searchCount.textContent = 'Sin resultados';
    } else if (resultIndex >= 0) {
      searchCount.textContent = `${resultIndex + 1} de ${resultCount}`;
    } else {
      searchCount.textContent = `${resultCount}+`;
    }
  }

  searchInput.addEventListener('input', () => {
    if (activeTab && searchInput.value) {
      activeTab.searchAddon.findNext(searchInput.value, searchOptions(true));
    } else {
      activeTab?.searchAddon.clearDecorations();
      searchCount.textContent = '';
    }
  });
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      findInActiveTab(e.shiftKey);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSearch();
    }
  });
  document.getElementById('search-prev').addEventListener('click', () => findInActiveTab(true));
  document.getElementById('search-next').addEventListener('click', () => findInActiveTab(false));
  document.getElementById('search-close').addEventListener('click', () => closeSearch());

  // Tamaño del texto (Ctrl + / Ctrl - / Ctrl 0)
  function clampFontSize(size) {
    return Math.min(32, Math.max(8, size));
  }

  function setFontSize(size) {
    fontSize = clampFontSize(size);
    localStorage.setItem('terminal-font-size', String(fontSize));
    tabs.forEach(t => {
      t.term.options.fontSize = fontSize;
    });
    fitActiveTab();
  }

  // Funciones para temas y personalización

  // Tema de xterm.js a partir de las variables CSS del tema activo (o de los colores personalizados)
  function buildXtermTheme() {
    const style = getComputedStyle(document.body);
    const background = rgbToHex(style.getPropertyValue('--background-color').trim());
    return {
      background,
      foreground: rgbToHex(style.getPropertyValue('--text-color').trim()),
      cursor: rgbToHex(style.getPropertyValue('--prompt-color').trim()),
      cursorAccent: background,
      selectionBackground: rgbToHex(style.getPropertyValue('--selection-color').trim()),
      ...(ANSI_PALETTES[currentThemeName] || {}),
    };
  }

  function refreshTerminalThemes() {
    const theme = buildXtermTheme();
    tabs.forEach(t => {
      t.term.options.theme = theme;
    });
  }

  // Cambiar a un tema predefinido
  function changeTheme(themeName) {
    // Primero remover todas las clases de tema
    document.body.classList.remove(...THEMES.map(t => `theme-${t}`));

    // Si no es "dark" (default), añadir la clase adecuada
    if (THEMES.includes(themeName) && themeName !== 'dark') {
      document.body.classList.add(`theme-${themeName}`);
    }
    currentThemeName = THEMES.includes(themeName) ? themeName : 'dark';

    // Un tema predefinido descarta los colores personalizados: si no, al elegir
    // "Oscuro" se seguían viendo los colores personalizados
    clearCustomColors();

    // Guardar preferencia
    localStorage.setItem('terminal-theme', themeName);

    // Actualizar los campos del personalizador y las terminales con los colores actuales
    updateColorInputs();
    refreshTerminalThemes();
  }

  // Cargar tema guardado
  function loadSavedTheme() {
    const savedTheme = localStorage.getItem('terminal-theme');
    const customColors = localStorage.getItem('terminal-custom-colors');

    if (savedTheme === 'custom' && customColors) {
      try {
        applyCustomColors(JSON.parse(customColors));
      } catch (_e) {
        localStorage.removeItem('terminal-custom-colors');
      }
    } else if (THEMES.includes(savedTheme)) {
      changeTheme(savedTheme);
    }
  }

  // Quitar los colores personalizados aplicados y guardados
  function clearCustomColors() {
    CUSTOM_PROPERTIES.forEach(prop => document.documentElement.style.removeProperty(prop));
    localStorage.removeItem('terminal-custom-colors');
  }

  // Actualizar los inputs de color con los valores actuales de CSS
  function updateColorInputs() {
    // Los temas definen sus variables en <body>: leerlas de ahí y no de <html>
    const computedStyle = getComputedStyle(document.body);
    backgroundColorInput.value = rgbToHex(computedStyle.getPropertyValue('--background-color').trim());
    textColorInput.value = rgbToHex(computedStyle.getPropertyValue('--text-color').trim());
    promptColorInput.value = rgbToHex(computedStyle.getPropertyValue('--prompt-color').trim());
    selectionColorInput.value = rgbToHex(computedStyle.getPropertyValue('--selection-color').trim());
  }

  // Convertir valor RGB a Hex para los inputs de color
  function rgbToHex(rgb) {
    // Si ya es un color hex, devolverlo (expandiendo #0f0 → #00ff00, que el input de color no acepta)
    if (/^#[0-9a-f]{3}$/i.test(rgb)) {
      return '#' + [...rgb.slice(1)].map(c => c + c).join('');
    }
    if (rgb.startsWith('#')) {
      return rgb;
    }

    // Extraer valores RGB
    const rgbMatch = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0');
      const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0');
      const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    }

    // Valor por defecto
    return '#000000';
  }

  // Aplicar colores personalizados (sobre la base del tema oscuro)
  function applyCustomColors(colors) {
    document.body.classList.remove(...THEMES.map(t => `theme-${t}`));
    currentThemeName = 'dark';
    document.documentElement.style.setProperty('--background-color', colors.background);
    document.documentElement.style.setProperty('--text-color', colors.text);
    document.documentElement.style.setProperty('--prompt-color', colors.prompt);
    document.documentElement.style.setProperty('--selection-color', colors.selection);

    // Guardar en localStorage
    localStorage.setItem('terminal-custom-colors', JSON.stringify(colors));
    localStorage.setItem('terminal-theme', 'custom');
    refreshTerminalThemes();
  }

  // Mostrar el personalizador de colores
  function showColorCustomizer() {
    updateColorInputs();
    colorCustomizer.style.display = 'block';
  }

  function hideColorCustomizer() {
    colorCustomizer.style.display = 'none';
    activeTab?.term.focus();
  }

  // Escuchar eventos de los botones del personalizador
  applyColorsButton.addEventListener('click', () => {
    applyCustomColors({
      background: backgroundColorInput.value,
      text: textColorInput.value,
      prompt: promptColorInput.value,
      selection: selectionColorInput.value,
    });
    hideColorCustomizer();
  });

  cancelColorsButton.addEventListener('click', hideColorCustomizer);
});
