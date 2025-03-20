document.addEventListener('DOMContentLoaded', () => {
  // Referencias a elementos del DOM
  const tabsContainer = document.getElementById('tabs');
  const terminalsContainer = document.getElementById('terminals-container');
  const newTabButton = document.getElementById('new-tab-button');

  // Elementos para personalización de colores
  const colorCustomizer = document.getElementById('color-customizer');
  const backgroundColorInput = document.getElementById('background-color');
  const textColorInput = document.getElementById('text-color');
  const promptColorInput = document.getElementById('prompt-color');
  const selectionColorInput = document.getElementById('selection-color');
  const applyColorsButton = document.getElementById('apply-colors');
  const cancelColorsButton = document.getElementById('cancel-colors');

  // Cargar tema guardado
  loadSavedTheme();

  // Estado de la aplicación
  let tabs = [];
  let activeTab = null;

  // Inicializar con la primera sesión
  window.terminal.onInitialSession(sessionId => {
    createNewTab(sessionId);
  });

  // Manejar eventos de terminal
  window.terminal.onOutput((sessionId, data) => {
    appendToOutput(sessionId, data);
  });

  window.terminal.onPrompt((sessionId, prompt) => {
    updatePrompt(sessionId, prompt);
  });

  window.terminal.onClear(sessionId => {
    clearTerminal(sessionId);
  });

  // Manejar eventos de pestañas
  window.terminal.onNewTab(() => {
    handleNewTab();
  });

  window.terminal.onCloseTab(() => {
    if (activeTab) {
      closeTab(activeTab.id);
    }
  });

  window.terminal.onNextTab(() => {
    switchToNextTab();
  });

  window.terminal.onPrevTab(() => {
    switchToPrevTab();
  });

  // Event listener para el botón de nueva pestaña
  newTabButton.addEventListener('click', handleNewTab);

  // Funciones para manejar pestañas
  function handleNewTab() {
    const sessionId = 'session-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    createNewTab(sessionId);
    window.terminal.createSession(sessionId);
  }

  function createNewTab(sessionId) {
    const tabNumber = tabs.length + 1;
    const tabId = 'tab-' + sessionId;

    // Crear elemento de pestaña
    const tabElement = document.createElement('div');
    tabElement.className = 'tab';
    tabElement.id = tabId;
    tabElement.innerHTML = `
      <span class="tab-title">Terminal ${tabNumber}</span>
      <span class="tab-close" title="Cerrar pestaña">×</span>
    `;
    tabsContainer.appendChild(tabElement);

    // Crear instancia de terminal
    const terminalInstance = document.createElement('div');
    terminalInstance.className = 'terminal-instance';
    terminalInstance.id = 'terminal-' + sessionId;
    terminalInstance.innerHTML = `
      <div class="terminal-output" id="output-${sessionId}"></div>
      <div class="terminal-input-container">
        <span class="terminal-prompt" id="prompt-${sessionId}"></span>
        <input type="text" class="terminal-input" id="input-${sessionId}" autofocus>
      </div>
    `;
    terminalsContainer.appendChild(terminalInstance);

    // Añadir mensaje de bienvenida
    appendToOutput(sessionId, 'Bienvenid@ a HYPE Terminal ...');

    // Configurar event listeners para la terminal
    const inputElement = document.getElementById(`input-${sessionId}`);

    // Para almacenar las sugerencias de autocompletado
    let completions = [];
    let completionIndex = -1;
    let originalInput = '';

    inputElement.addEventListener('keydown', async event => {
      if (event.key === 'Enter') {
        const command = inputElement.value;

        // Añadir comando a la salida
        const promptElement = document.getElementById(`prompt-${sessionId}`);
        appendToOutput(sessionId, `${promptElement.textContent}${command}`);

        // Enviar comando al proceso principal
        if (command.trim()) {
          window.terminal.sendCommand(command, sessionId);
        } else {
          // Si no hay comando, simplemente muestra el prompt nuevamente
          window.terminal.sendCommand('echo ""', sessionId);
        }

        // Limpiar el input y las sugerencias
        inputElement.value = '';
        completions = [];
        completionIndex = -1;
      } else if (event.key === 'Tab') {
        // Prevenir que el Tab cambie el foco
        event.preventDefault();

        // Si es la primera vez que presiona Tab, obtener sugerencias
        if (completions.length === 0) {
          originalInput = inputElement.value;
          completions = await window.terminal.getCompletions(originalInput, sessionId);
          completionIndex = 0;

          if (completions.length === 0) {
            // No hay sugerencias
            return;
          }

          // Si solo hay una sugerencia, usarla directamente
          if (completions.length === 1) {
            inputElement.value = completions[0];
            return;
          }

          // Si hay múltiples, mostrar la primera y listar todas
          inputElement.value = completions[completionIndex];

          // Mostrar todas las sugerencias
          appendToOutput(sessionId, '\nSugerencias:');
          completions.forEach(comp => appendToOutput(sessionId, `  ${comp}`));
        } else {
          // Si ya tiene sugerencias, rotar entre ellas
          completionIndex = (completionIndex + 1) % completions.length;
          inputElement.value = completions[completionIndex];
        }
      } else {
        // Cualquier otra tecla reinicia las sugerencias
        completions = [];
        completionIndex = -1;
      }
    });

    // Agregar event listeners para la pestaña
    tabElement.addEventListener('click', e => {
      // Ignorar si se hizo clic en el botón de cerrar
      if (e.target.classList.contains('tab-close')) return;

      // Activar esta pestaña
      activateTab(sessionId);
    });

    const closeButton = tabElement.querySelector('.tab-close');
    closeButton.addEventListener('click', e => {
      e.stopPropagation();
      closeTab(sessionId);
    });

    // Añadir a la lista de pestañas
    tabs.push({
      id: sessionId,
      element: tabElement,
      terminal: terminalInstance,
      title: `Terminal ${tabNumber}`,
    });

    // Activar esta pestaña
    activateTab(sessionId);
  }

  function activateTab(sessionId) {
    // Desactivar pestaña actual
    if (activeTab) {
      activeTab.element.classList.remove('active');
      activeTab.terminal.classList.remove('active');
    }

    // Encontrar y activar la nueva pestaña
    const tab = tabs.find(t => t.id === sessionId);
    if (tab) {
      tab.element.classList.add('active');
      tab.terminal.classList.add('active');
      activeTab = tab;

      // Enfocar el input
      const inputElement = document.getElementById(`input-${sessionId}`);
      inputElement.focus();

      // Informar al proceso principal
      window.terminal.switchSession(sessionId);
    }
  }

  function closeTab(sessionId) {
    const tabIndex = tabs.findIndex(t => t.id === sessionId);
    if (tabIndex === -1) return;

    // Remover elementos del DOM
    tabs[tabIndex].element.remove();
    tabs[tabIndex].terminal.remove();

    // Informar al proceso principal
    window.terminal.closeSession(sessionId);

    // Remover de la lista
    tabs.splice(tabIndex, 1);

    // Si era la pestaña activa, activar otra
    if (activeTab && activeTab.id === sessionId) {
      if (tabs.length > 0) {
        // Activar la pestaña anterior o la siguiente
        const newIndex = Math.min(tabIndex, tabs.length - 1);
        activateTab(tabs[newIndex].id);
      } else {
        // No hay más pestañas, crear una nueva
        handleNewTab();
      }
    }
  }

  function switchToNextTab() {
    if (tabs.length <= 1) return;

    const currentIndex = tabs.findIndex(t => t.id === activeTab.id);
    const nextIndex = (currentIndex + 1) % tabs.length;
    activateTab(tabs[nextIndex].id);
  }

  function switchToPrevTab() {
    if (tabs.length <= 1) return;

    const currentIndex = tabs.findIndex(t => t.id === activeTab.id);
    const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    activateTab(tabs[prevIndex].id);
  }

  // Funciones para manejar la salida de la terminal
  function appendToOutput(sessionId, text) {
    const outputElement = document.getElementById(`output-${sessionId}`);
    if (!outputElement) return;

    const line = document.createElement('div');
    line.textContent = text;
    outputElement.appendChild(line);

    // Hacer scroll hacia abajo
    outputElement.scrollTop = outputElement.scrollHeight;
  }

  function updatePrompt(sessionId, prompt) {
    const promptElement = document.getElementById(`prompt-${sessionId}`);
    if (!promptElement) return;

    promptElement.textContent = prompt;

    // Enfocar el input
    if (activeTab && activeTab.id === sessionId) {
      const inputElement = document.getElementById(`input-${sessionId}`);
      inputElement.focus();
    }

    // Actualizar el título de la pestaña con el directorio actual
    updateTabTitle(sessionId, prompt);
  }

  function updateTabTitle(sessionId, prompt) {
    // Extraer el directorio actual del prompt
    let dirName = 'Terminal';

    // Intentar extraer el directorio del prompt
    if (prompt) {
      const matches = prompt.match(/[^:]+:([^$>]+)/);
      if (matches && matches[1]) {
        dirName = matches[1].trim();
        // Si es muy largo, obtener solo el último segmento
        if (dirName.length > 15) {
          const parts = dirName.split('/');
          dirName = parts[parts.length - 1] || parts[parts.length - 2] || dirName;
        }
      }
    }

    // Actualizar el título en el objeto y en el DOM
    const tab = tabs.find(t => t.id === sessionId);
    if (tab) {
      tab.title = dirName;
      const titleElement = tab.element.querySelector('.tab-title');
      titleElement.textContent = dirName;
    }
  }

  function clearTerminal(sessionId) {
    const outputElement = document.getElementById(`output-${sessionId}`);
    if (!outputElement) return;

    outputElement.innerHTML = '';
  }

  // Funciones para temas y personalización

  // Cambiar a un tema predefinido
  function changeTheme(themeName) {
    // Primero remover todas las clases de tema
    document.body.classList.remove(
      'theme-dark',
      'theme-light',
      'theme-monokai',
      'theme-solarized',
      'theme-retro',
      'theme-hacker'
    );

    // Si no es "dark" (default), añadir la clase adecuada
    if (themeName !== 'dark') {
      document.body.classList.add(`theme-${themeName}`);
    }

    // Guardar preferencia
    localStorage.setItem('terminal-theme', themeName);

    // Actualizar los campos del personalizador con los colores actuales
    updateColorInputs();
  }

  // Cargar tema guardado
  function loadSavedTheme() {
    const savedTheme = localStorage.getItem('terminal-theme');
    if (savedTheme) {
      changeTheme(savedTheme);
    }

    // Verificar si hay colores personalizados guardados
    const customColors = localStorage.getItem('terminal-custom-colors');
    if (customColors) {
      applyCustomColors(JSON.parse(customColors));
    }
  }

  // Actualizar los inputs de color con los valores actuales de CSS
  function updateColorInputs() {
    const computedStyle = getComputedStyle(document.documentElement);
    backgroundColorInput.value = rgbToHex(computedStyle.getPropertyValue('--background-color').trim());
    textColorInput.value = rgbToHex(computedStyle.getPropertyValue('--text-color').trim());
    promptColorInput.value = rgbToHex(computedStyle.getPropertyValue('--prompt-color').trim());
    selectionColorInput.value = rgbToHex(computedStyle.getPropertyValue('--selection-color').trim());
  }

  // Convertir valor RGB a Hex para los inputs de color
  function rgbToHex(rgb) {
    // Si ya es un color hex, devolverlo
    if (rgb.startsWith('#')) return rgb;

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

  // Aplicar colores personalizados
  function applyCustomColors(colors) {
    document.documentElement.style.setProperty('--background-color', colors.background);
    document.documentElement.style.setProperty('--text-color', colors.text);
    document.documentElement.style.setProperty('--prompt-color', colors.prompt);
    document.documentElement.style.setProperty('--selection-color', colors.selection);

    // Guardar en localStorage
    localStorage.setItem('terminal-custom-colors', JSON.stringify(colors));
  }

  // Mostrar el personalizador de colores
  function showColorCustomizer() {
    updateColorInputs();
    colorCustomizer.style.display = 'block';
  }

  // Escuchar eventos de los botones del personalizador
  applyColorsButton.addEventListener('click', () => {
    const colors = {
      background: backgroundColorInput.value,
      text: textColorInput.value,
      prompt: promptColorInput.value,
      selection: selectionColorInput.value,
    };

    applyCustomColors(colors);
    colorCustomizer.style.display = 'none';

    // Remover todas las clases de tema
    document.body.classList.remove(
      'theme-dark',
      'theme-light',
      'theme-monokai',
      'theme-solarized',
      'theme-retro',
      'theme-hacker'
    );

    // Guardar como tema personalizado
    localStorage.setItem('terminal-theme', 'custom');
  });

  cancelColorsButton.addEventListener('click', () => {
    colorCustomizer.style.display = 'none';
  });

  // Escuchar eventos del proceso principal
  window.terminal.changeTheme(themeName => {
    changeTheme(themeName);
  });

  window.terminal.showColorCustomizer(() => {
    showColorCustomizer();
  });

  window.terminal.applyCustomColors(colors => {
    applyCustomColors(colors);
  });
});
