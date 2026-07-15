# Pi

Pi is a terminal coding agent launched with the `pi` command.

## State and project configuration

- User configuration and runtime state live under `~/.pi`.
- Project-local configuration lives under `.pi` in the project tree.
- `PI_CODING_AGENT_DIR` may point a development or test run at an isolated Pi
  agent directory.

## Extensions and plugins

Pi loads normal Pi extensions and supports locally managed plugins and
Claude-compatible marketplace catalogs. Use `pi plugin --help` for the shell
interface or `/plugins` and `/marketplace` in an interactive session.

## Embedded documentation

Use `pi read pi://` to list the documentation shipped by the active executable,
or read a page directly, for example `pi read pi://tools/ask.md`.
