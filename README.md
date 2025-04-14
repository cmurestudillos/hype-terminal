## HYPE Terminal
Una moderna aplicación de terminal multiplataforma construida con Electron que combina la potencia de los terminales nativos con una interfaz personalizable y amigable.

# Características
- Múltiples pestañas: Trabaja con varias sesiones de terminal simultáneamente
- Temas personalizables: Elige entre temas preconfigurados o crea el tuyo propio
- Autocompletado inteligente: Completa comandos y rutas con la tecla Tab
- Interfaz moderna: Diseño limpio y funcional con pestañas redimensionables
- Multiplataforma: Compatible con Windows, macOS y Linux
- Navegación mejorada: Cambio de directorios intuitivo con actualización del título de la pestaña

# Instalación
Node.js
npm (normalmente viene con Node.js)

# Pasos para instalar
bash# Clonar el repositorio
git clone https://github.com/cmurestudillos/hype-terminal.git

# Entrar al directorio
cd hype-terminal

# Instalar dependencias
npm install

# Iniciar la aplicación
npm start

# Uso
Atajos de teclado:

- Ctrl+T: Nueva pestaña
- Ctrl+W: Cerrar pestaña actual
- Ctrl+Tab: Siguiente pestaña
- Ctrl+Shift+Tab: Pestaña anterior
- Tab: Autocompletar comando o ruta
- Flecha arriba/abajo: Navegar por el historial de comandos (próximamente)

# Temas
Puedes cambiar entre los siguientes temas predefinidos:

- Oscuro (predeterminado)
- Claro
- Monokai
- Solarized
- Retro
- Hacker

También puedes personalizar completamente los colores desde el menú Ver > Personalizar Colores.

# Desarrollo
bash# Ejecutar en modo desarrollo con recargas automáticas
npm run dev

# Compilar para la plataforma actual
npm run build

# Compilar para todas las plataformas
npm run build-all

# Próximas funcionalidades

- Comandos personalizados y macros
- Mejoras en el historial de comandos
- Búsqueda en terminal
- Divisiones de pantalla
- Integración con Git

# Contribuir
Las contribuciones son bienvenidas. Por favor, sigue estos pasos:

1. Haz fork del repositorio
2. Crea una rama para tu funcionalidad (git checkout -b feature/amazing-feature)
3. Haz commit de tus cambios (git commit -m 'Add some amazing feature')
4. Haz push a la rama (git push origin feature/amazing-feature)
5. Abre un Pull Request

# Licencia
Este proyecto está licenciado bajo la Licencia MIT - ver el archivo LICENSE para más detalles.