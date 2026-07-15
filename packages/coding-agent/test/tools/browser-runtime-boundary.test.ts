import { describe, expect, it } from "bun:test";
import { createBrowserRuntime } from "@oh-my-pi/pi-coding-agent/tools/browser/runtime";
import { JsRuntime } from "../../src/eval/js/shared/runtime";

function quietHooks(onToolCall?: () => void) {
	return {
		onText: (_chunk: string): void => {},
		onDisplay: (): void => {},
		callTool: async (): Promise<never> => {
			onToolCall?.();
			throw new Error("browser runtime reached the eval tool callback");
		},
	};
}

describe("browser.run runtime boundary", () => {
	it("does not expose or invoke eval tool, agent, workflow, filesystem, or environment bridges", async () => {
		const runtime = createBrowserRuntime(process.cwd(), "browser-boundary-disabled-bridges");
		let toolCalls = 0;
		try {
			expect(() => runtime.setRunScope({ tool: () => "forged" })).toThrow(
				"tool cannot be installed in a browser.run scope",
			);
			const result = await runtime.run(
				`const attempts = {
					tool: () => tool.read({ path: "package.json" }),
					completion: () => completion("hello"),
					output: () => output("child"),
					agent: () => agent("hello"),
					parallel: () => parallel([async () => 1]),
					pipeline: () => pipeline([1], async value => value),
					read: () => read("package.json"),
					write: () => write("blocked.txt", "blocked"),
					env: () => env("HOME"),
					log: () => log("blocked"),
					phase: () => phase("blocked"),
					budget: () => budget.total(),
					pool: () => __pool([1], async value => value),
					internalTool: () => __omp_call_tool__("read", { path: "package.json" }),
				};
				const outcomes = {};
				for (const [name, attempt] of Object.entries(attempts)) {
					try {
						await attempt();
						outcomes[name] = "called";
					} catch (error) {
						outcomes[name] = error instanceof TypeError ? "unavailable" : error?.name ?? "error";
					}
				}
				return outcomes;`,
				"browser-runtime-boundary.js",
				quietHooks(() => toolCalls++),
			);

			expect(result).toEqual({
				tool: "unavailable",
				completion: "unavailable",
				output: "unavailable",
				agent: "unavailable",
				parallel: "unavailable",
				pipeline: "unavailable",
				read: "unavailable",
				write: "unavailable",
				env: "unavailable",
				log: "unavailable",
				phase: "unavailable",
				budget: "unavailable",
				pool: "unavailable",
				internalTool: "unavailable",
			});
			expect(toolCalls).toBe(0);
		} finally {
			runtime.dispose();
		}
	});

	it("shadows ambient host module, filesystem, process, and environment entry points", async () => {
		const runtime = createBrowserRuntime(process.cwd(), "browser-boundary-host-globals");
		try {
			const result = await runtime.run(
				`return {
					Bun: typeof Bun,
					Deno: typeof Deno,
					process: typeof process,
					require: typeof require,
					module: typeof module,
					fs: typeof fs,
					createRequire: typeof createRequire,
					Function: typeof Function,
					eval: typeof eval,
					fetch: typeof fetch,
					Worker: typeof Worker,
					WebSocket: typeof WebSocket,
					globalBun: typeof globalThis.Bun,
					globalProcess: typeof globalThis.process,
					globalRequire: typeof globalThis.require,
					globalHelpers: typeof globalThis.__omp_helpers__,
					globalToolBridge: typeof globalThis.__omp_call_tool__,
				};`,
				"browser-runtime-host-globals.js",
				quietHooks(),
			);

			expect(result).toEqual({
				Bun: "undefined",
				Deno: "undefined",
				process: "undefined",
				require: "undefined",
				module: "undefined",
				fs: "undefined",
				createRequire: "undefined",
				Function: "undefined",
				eval: "undefined",
				fetch: "undefined",
				Worker: "undefined",
				WebSocket: "undefined",
				globalBun: "undefined",
				globalProcess: "undefined",
				globalRequire: "undefined",
				globalHelpers: "undefined",
				globalToolBridge: "undefined",
			});
			await expect(
				runtime.run('return await import("node:fs")', "browser-runtime-import.js", quietHooks()),
			).rejects.toThrow("dynamic import() is unavailable in browser.run");
			await expect(
				runtime.run('import * as fs from "node:fs"; return fs', "browser-runtime-static-import.js", quietHooks()),
			).rejects.toThrow("static import is unavailable in browser.run");
			await expect(
				runtime.run('return eval("process.env")', "browser-runtime-eval.js", quietHooks()),
			).rejects.toThrow("eval() is unavailable in browser.run");
			await expect(
				runtime.run("return globalThis.constructor", "browser-runtime-constructor.js", quietHooks()),
			).rejects.toThrow("constructor access is unavailable in browser.run");
		} finally {
			runtime.dispose();
		}
	});

	it("blocks computed and Reflect constructor escapes plus process builtin fs, network, and child-process variants", async () => {
		const runtime = createBrowserRuntime(process.cwd(), "browser-boundary-computed-constructor");
		const page = new Proxy(
			{ title: async (): Promise<string> => "Example" },
			{
				has: () => {
					throw new Error("host has trap");
				},
				ownKeys: () => {
					throw new Error("host ownKeys trap");
				},
				getOwnPropertyDescriptor: () => {
					throw new Error("host descriptor trap");
				},
			},
		);
		try {
			runtime.setRunScope({ page });
			const result = await runtime.run(
				`const key = ["con", "structor"].join("");
				const capture = async attempt => {
					try {
						const value = await attempt();
						return value === undefined ? "unavailable" : "escaped";
					} catch (error) {
						return error?.name ?? "blocked";
					}
				};
				const captureThrownConstructor = async operation => {
					try {
						operation();
						return "no-error";
					} catch (error) {
						return await capture(() => Reflect.get(Reflect.get(error, key), key)("return process")());
					}
				};
				return {
					sandboxComputed: await capture(() => (() => {})[key]("return process")()),
					sandboxReflect: await capture(() => Reflect.get(() => {}, key)("return process")()),
					hostComputed: typeof page.title[key],
					hostConcatenated: typeof page.title["con" + "structor"],
					hostReflect: typeof Reflect.get(page.title, key),
					hostPrototype: Object.getPrototypeOf(page),
					hostHasTrapError: await captureThrownConstructor(() => "anything" in page),
					hostOwnKeysTrapError: await captureThrownConstructor(() => Reflect.ownKeys(page)),
					hostDescriptorTrapError: await captureThrownConstructor(() =>
						Object.getOwnPropertyDescriptor(page, "anything")
					),
					processBuiltin: await capture(() => globalThis.process?.getBuiltinModule("node:fs")),
					fsViaConstructor: await capture(() => (() => {})[key](
						"return process.getBuiltinModule('node:fs')"
					)()),
					networkViaConstructor: await capture(() => Reflect.get(() => {}, key)(
						"return process.getBuiltinModule('node:http')"
					)()),
					childProcessViaConstructor: await capture(() => (() => {})[key](
						"return process.getBuiltinModule('node:child_process')"
					)()),
					directFetch: typeof fetch,
					directWebSocket: typeof WebSocket,
				};`,
				"browser-runtime-computed-constructor.js",
				quietHooks(),
			);

			expect(result).toEqual({
				sandboxComputed: "EvalError",
				sandboxReflect: "EvalError",
				hostComputed: "undefined",
				hostConcatenated: "undefined",
				hostReflect: "undefined",
				hostPrototype: null,
				hostHasTrapError: "EvalError",
				hostOwnKeysTrapError: "EvalError",
				hostDescriptorTrapError: "EvalError",
				processBuiltin: "unavailable",
				fsViaConstructor: "EvalError",
				networkViaConstructor: "EvalError",
				childProcessViaConstructor: "EvalError",
				directFetch: "undefined",
				directWebSocket: "undefined",
			});
		} finally {
			runtime.dispose();
		}
	});

	it("preserves page, tab, browser, display, print, assert, and wait operations", async () => {
		const runtime = createBrowserRuntime(process.cwd(), "browser-boundary-puppeteer");
		const calls: string[] = [];
		const displayed: unknown[] = [];
		const text: string[] = [];
		const page = {
			title: async (): Promise<string> => {
				calls.push("page.title");
				return "Example";
			},
			evaluate: async (fn: (value: number) => number, value: number): Promise<number> => {
				calls.push("page.evaluate");
				return fn(value);
			},
		};
		const tab = {
			click: async (selector: string): Promise<void> => {
				calls.push(`tab.click:${selector}`);
			},
			evaluate: async (fn: (value: number) => number, value: number): Promise<number> => {
				calls.push("tab.evaluate");
				return fn(value);
			},
		};
		const browser = {
			pages: async (): Promise<Array<typeof page>> => {
				calls.push("browser.pages");
				return [page];
			},
		};

		try {
			runtime.setRunScope({
				page,
				tab,
				browser,
				assert: (condition: unknown, message?: string): void => {
					if (!condition) throw new Error(message ?? "assertion failed");
				},
				wait: async (ms: number): Promise<void> => {
					calls.push(`wait:${ms}`);
				},
			});
			const result = await runtime.run(
				`const title = await page.title();
				const pageValue = await page.evaluate(value => value + 1, 20);
				const tabValue = await tab.evaluate(value => value * 2, 21);
				await tab.click("text/Continue");
				const pages = await browser.pages();
				await wait(0);
				assert(pages[0] === page, "page identity changed");
				display({ title, pageValue, tabValue });
				print("browser-ready");
				return { title, pageValue, tabValue, pageCount: pages.length };`,
				"browser-runtime-puppeteer.js",
				{
					onText: chunk => text.push(chunk),
					onDisplay: output => displayed.push(output),
				},
			);

			expect(result).toEqual({ title: "Example", pageValue: 21, tabValue: 42, pageCount: 1 });
			expect(calls).toEqual([
				"page.title",
				"page.evaluate",
				"tab.evaluate",
				"tab.click:text/Continue",
				"browser.pages",
				"wait:0",
			]);
			expect(displayed).toEqual([{ type: "json", data: { title: "Example", pageValue: 21, tabValue: 42 } }]);
			expect(text).toEqual(["browser-ready\n"]);
		} finally {
			runtime.dispose();
		}
	});

	it("cannot inherit bridges from a same-realm eval runtime and does not disable eval when it is reactivated", async () => {
		const evalRuntime = new JsRuntime({ initialCwd: process.cwd(), sessionId: "eval-neighbor" });
		const browserRuntime = createBrowserRuntime(process.cwd(), "browser-neighbor");
		try {
			expect(
				await evalRuntime.run("return [typeof tool, typeof read]", "eval-before-browser.js", quietHooks()),
			).toEqual(["object", "function"]);
			expect(
				await browserRuntime.run(
					"return [typeof tool, typeof read, typeof process, typeof Bun]",
					"browser-between-eval.js",
					quietHooks(),
				),
			).toEqual(["undefined", "undefined", "undefined", "undefined"]);
			expect(
				await evalRuntime.run("return [typeof tool, typeof read]", "eval-after-browser.js", quietHooks()),
			).toEqual(["object", "function"]);
		} finally {
			browserRuntime.dispose();
			evalRuntime.dispose();
		}
	});
});
