import { JsRuntime, type RuntimeHooks } from "../../eval/js/shared/runtime";

export type BrowserRuntimeHooks = Pick<RuntimeHooks, "onText" | "onDisplay">;

/**
 * Create the JavaScript host used by browser.run.
 *
 * Browser code gets the shared evaluator's parsing, console/display capture, and
 * run-scoped globals, but never installs the eval-only tool/helper bridges.
 */
export function createBrowserRuntime(initialCwd: string, sessionId: string): JsRuntime {
	return new JsRuntime({ initialCwd, sessionId, profile: "browser" });
}
