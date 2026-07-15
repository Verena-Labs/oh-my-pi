import { ProcessTerminal, TUI } from "@oh-my-pi/pi-tui";
import { SessionSelectorComponent } from "../modes/components/session-selector";
import type { SessionInfo } from "../session/session-listing";

/**
 * Show the TUI session selector and return the selected session, or null if
 * cancelled. Rendered as a fullscreen overlay on the terminal's alternate
 * screen, so the current-project list scrolls and rows are clickable with the
 * mouse.
 */
export async function selectSession(sessions: SessionInfo[]): Promise<SessionInfo | null> {
	const { promise, resolve } = Promise.withResolvers<SessionInfo | null>();
	const ui = new TUI(new ProcessTerminal());
	let resolved = false;

	const showSelector = () => {
		const selector = new SessionSelectorComponent(
			sessions,
			(session: SessionInfo) => {
				if (!resolved) {
					resolved = true;
					ui.stop();
					resolve(session);
				}
			},
			() => {
				if (!resolved) {
					resolved = true;
					ui.stop();
					resolve(null);
				}
			},
			() => {
				if (!resolved) {
					resolved = true;
					ui.stop();
					process.exit(0);
				}
			},
			{
				getTerminalRows: () => ui.terminal.rows,
				fillHeight: true,
			},
		);
		return selector;
	};

	const selector = showSelector();
	selector.setOnRequestRender(() => ui.requestRender());
	// Present as a fullscreen overlay so the picker borrows the terminal's
	// alternate screen buffer (vim/less idiom): the list scrolls and rows are
	// clickable via the mouse tracking the overlay enables for its lifetime.
	// Anchored top-left at full size so a mouse row maps directly to a rendered
	// line (the overlay paints from screen row 0).
	ui.showOverlay(selector, {
		anchor: "top-left",
		width: "100%",
		maxHeight: "100%",
		margin: 0,
		fullscreen: true,
	});
	ui.setFocus(selector);
	ui.start();
	return promise;
}
