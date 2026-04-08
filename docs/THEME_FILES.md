# Theme Files

aIDE loads custom themes from JSON files in the app themes folder.

## Location

- Open the folder from:
  - Settings > Workbench > Appearance > `Open Themes Folder`
  - Command palette: `Open Themes Folder`
- Drop one or more `.json` files into that folder.
- Reload themes from:
  - Settings > Workbench > Appearance > `Reload Themes`
  - Command palette: `Reload Themes`

## Required Structure

Each file must be valid JSON and contain one theme object.

Required fields:

- `id`: unique string id for the theme
- `label`: human-readable name shown in the UI
- `appearance`: must be `"dark"` or `"light"`
- `tokens`: object whose keys are CSS custom properties beginning with `--`

Optional fields:

- `description`
- `author`

## Minimal Example

```json
{
  "id": "my-dark-theme",
  "label": "My Dark Theme",
  "appearance": "dark",
  "tokens": {
    "--bg-base": "#14161a",
    "--text-primary": "#d7dae0",
    "--accent": "#6aa0ff"
  }
}
```

## Full Example

```json
{
  "id": "forest-night",
  "label": "Forest Night",
  "appearance": "dark",
  "description": "Muted green-tinted dark theme.",
  "author": "You",
  "tokens": {
    "--bg-base": "#1a1f1c",
    "--bg-elevated": "#151916",
    "--bg-sunken": "#111512",
    "--bg-overlay": "#101411",
    "--bg-active-tab": "#1a1f1c",
    "--bg-inactive-tab": "#171b18",
    "--bg-hover": "rgba(255, 255, 255, 0.05)",
    "--bg-selection": "rgba(98, 160, 120, 0.18)",
    "--bg-info": "rgba(98, 160, 120, 0.12)",
    "--bg-info-hover": "rgba(98, 160, 120, 0.22)",
    "--text-primary": "#d7dae0",
    "--text-secondary": "#9aa39c",
    "--text-muted": "#68706a",
    "--text-selected": "#ffffff",
    "--text-info": "#74b7ff",
    "--text-success": "#89c779",
    "--text-warning": "#d8b36a",
    "--text-error": "#e57c73",
    "--border-base": "#0e120f",
    "--border-subtle": "#283028",
    "--accent": "#62a078",
    "--accent-rgb": "98, 160, 120",
    "--text-on-accent": "#ffffff",
    "--syntax-keyword": "#c792ea",
    "--syntax-fn": "#82aaff",
    "--syntax-string": "#a5d6a7",
    "--syntax-number": "#f7c873",
    "--syntax-comment": "#5f6b66",
    "--syntax-tag": "#f07178",
    "--syntax-attr": "#7cc7ff",
    "--merge-delete-bg": "rgba(240, 113, 120, 0.14)",
    "--merge-delete-gutter": "#f07178",
    "--merge-insert-bg": "rgba(165, 214, 167, 0.14)",
    "--merge-insert-gutter": "#a5d6a7",
    "--merge-char-insert": "rgba(165, 214, 167, 0.24)",
    "--merge-char-delete": "rgba(240, 113, 120, 0.24)"
  }
}
```

## Supported Tokens

These are the tokens the built-in themes define and the custom theme system expects.

Backgrounds:

- `--bg-base`
- `--bg-elevated`
- `--bg-sunken`
- `--bg-overlay`
- `--bg-active-tab`
- `--bg-inactive-tab`
- `--bg-hover`
- `--bg-selection`
- `--bg-info`
- `--bg-info-hover`

Text:

- `--text-primary`
- `--text-secondary`
- `--text-muted`
- `--text-selected`
- `--text-info`
- `--text-success`
- `--text-warning`
- `--text-error`
- `--text-on-accent`

Borders and accent:

- `--border-base`
- `--border-subtle`
- `--accent`
- `--accent-rgb`

Syntax:

- `--syntax-keyword`
- `--syntax-fn`
- `--syntax-string`
- `--syntax-number`
- `--syntax-comment`
- `--syntax-tag`
- `--syntax-attr`

Inline diff:

- `--merge-delete-bg`
- `--merge-delete-gutter`
- `--merge-insert-bg`
- `--merge-insert-gutter`
- `--merge-char-insert`
- `--merge-char-delete`

## Important Rules

- `id` must be unique across all installed themes.
- `appearance` controls whether the theme can be chosen as the default dark or default light theme.
- Token keys must start with `--`.
- Token values must be strings.
- Only `.json` files are loaded.
- Invalid or malformed theme files are ignored.

## Fallback Behavior

- If a token is missing, aIDE fills it from the built-in fallback theme of the same appearance.
- If the active theme no longer exists, aIDE falls back to the configured default dark theme.
- If a configured default dark/light theme no longer exists, aIDE falls back to the built-in `one-dark` or `one-light` theme.

## Notes

- The theme toggle switches between the configured default dark and default light themes, not between fixed built-in themes.
- Built-in themes use the same manifest shape as custom themes.
