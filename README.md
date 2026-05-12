# HYPE Terminal

Una moderna aplicación de terminal multiplataforma construida con Electron que combina la potencia de los terminales nativos con una interfaz personalizable y amigable.

## Características

- **Múltiples pestañas** — Trabaja con varias sesiones de terminal simultáneamente
- **Output en tiempo real** — Streaming de stdout/stderr sin esperar a que el comando termine
- **Historial de comandos** — Navega por comandos anteriores con las flechas ↑ ↓
- **Autocompletado inteligente** — Completa comandos y rutas con la tecla Tab
- **Temas personalizables** — Elige entre 6 temas preconfigurados o crea el tuyo
- **Multiplataforma** — Compatible con Windows, macOS y Linux

## Requisitos

- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/) 11+

## Instalación

```bash
# Clonar el repositorio
git clone https://github.com/cmurestudillos/hype-terminal.git

# Entrar al directorio
cd hype-terminal

# Instalar dependencias
pnpm install

# Iniciar la aplicación
pnpm start
```

## Atajos de teclado

| Atajo | Acción |
|---|---|
| `Ctrl+T` | Nueva pestaña |
| `Ctrl+W` | Cerrar pestaña actual |
| `Ctrl+Tab` | Siguiente pestaña |
| `Ctrl+Shift+Tab` | Pestaña anterior |
| `Tab` | Autocompletar comando o ruta |
| `↑ / ↓` | Navegar por el historial de comandos |

## Temas

Cambia de tema desde el menú **Ver > Temas**:

- Oscuro (predeterminado)
- Claro
- Monokai
- Solarized
- Retro
- Hacker

También puedes personalizar completamente los colores desde **Ver > Personalizar Colores**.

## Desarrollo

```bash
# Ejecutar la aplicación
pnpm start

# Lint
pnpm lint
pnpm lint:fix

# Formatear código
pnpm format

# Empaquetar para distribución
pnpm package:win    # Windows
pnpm package:mac    # macOS
pnpm package:linux  # Linux
```

## Próximas funcionalidades

- Divisiones de pantalla (split-pane)
- Búsqueda en el output del terminal
- Integración con Git en el prompt
- Comandos personalizados y macros

## Contribuir

1. Haz fork del repositorio
2. Crea una rama para tu funcionalidad (`git checkout -b feature/amazing-feature`)
3. Haz commit de tus cambios (`git commit -m 'feat: add amazing feature'`)
4. Haz push a la rama (`git push origin feature/amazing-feature`)
5. Abre un Pull Request

## Licencia

Este proyecto está licenciado bajo la Licencia MIT.
