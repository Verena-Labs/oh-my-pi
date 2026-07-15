/**
 * Public documentation shipped through `pi://`.
 *
 * The vendored docs tree also contains upstream implementation notes and
 * documentation for capabilities that this distribution disables. Keep this
 * list explicit so adding an upstream Markdown file cannot silently publish a
 * stale command, config path, protocol, or service through the Pi runtime.
 */
export const PI_DOC_FILENAMES = [
	"pi.md",
	"tui.md",
	"tools/ask.md",
	"tools/ast-edit.md",
	"tools/ast-grep.md",
	"tools/bash.md",
	"tools/browser.md",
	"tools/checkpoint.md",
	"tools/edit.md",
	"tools/generate_image.md",
	"tools/glob.md",
	"tools/grep.md",
	"tools/inspect_image.md",
	"tools/irc.md",
	"tools/job.md",
	"tools/launch.md",
	"tools/learn.md",
	"tools/lsp.md",
	"tools/memory_edit.md",
	"tools/read.md",
	"tools/recall.md",
	"tools/reflect.md",
	"tools/resolve.md",
	"tools/retain.md",
	"tools/rewind.md",
	"tools/search_tool_bm25.md",
	"tools/task.md",
	"tools/todo.md",
	"tools/web_search.md",
	"tools/write.md",
] as const;
