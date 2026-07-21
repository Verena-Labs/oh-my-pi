import * as vm from "node:vm";

import browserPrelude from "./browser-prelude.txt" with { type: "text" };

const BLOCKED_HOST_KEYS = new Set<PropertyKey>([
	"constructor",
	"prototype",
	"__proto__",
	"caller",
	"callee",
	"arguments",
]);

const SERIALIZED_CALLBACK_METHODS = new Set<PropertyKey>([
	"evaluate",
	"evaluateHandle",
	"evaluateOnNewDocument",
	"$eval",
	"$$eval",
	"waitForFunction",
]);

const UNAVAILABLE_AMBIENT_GLOBALS = [
	"tool",
	"completion",
	"output",
	"agent",
	"parallel",
	"pipeline",
	"log",
	"phase",
	"budget",
	"__pool",
	"read",
	"write",
	"env",
	"__omp_session__",
	"__omp_helpers__",
	"__omp_call_tool__",
	"__omp_emit_status__",
	"__omp_import__",
	"__omp_import_from__",
	"__omp_get_require__",
	"__omp_get_filename__",
	"__omp_get_dirname__",
	"Bun",
	"Deno",
	"process",
	"require",
	"module",
	"fs",
	"createRequire",
	"fetch",
	"Worker",
	"SharedWorker",
	"WebSocket",
	"EventSource",
	"importScripts",
	"Buffer",
] as const;

type HostFunction = (...args: unknown[]) => unknown;
type HostConstructor = new (...args: never[]) => object;
type Invocation = { receiver?: object; key?: PropertyKey; constructable?: boolean };

function constructableCapabilityTarget(): void {}

export interface BrowserRealmHost {
	log(level: string, ...args: unknown[]): void;
	table(...args: unknown[]): void;
	display(value: unknown): void;
	setFinalExpression(value: unknown): void;
}

/**
 * Recursive membrane around host-side Puppeteer/browser capabilities.
 *
 * The sandbox never receives a raw host object or function. Every property,
 * method result, promise fulfillment, callback argument, and thrown error is
 * wrapped before crossing into the VM realm. Constructor/prototype/caller
 * access is denied for both direct and computed property lookup.
 */
class BrowserCapabilityMembrane {
	#hostToProxy = new WeakMap<object, object>();
	#proxyToHost = new WeakMap<object, object>();
	#sandboxValues = new WeakSet<object>();
	#sandboxCallbackToHost = new WeakMap<object, HostFunction>();
	#sandboxErrorToHost = new WeakMap<object, unknown>();
	#makeSandboxError: (name: string, message: string, stack?: string) => object;

	constructor(makeSandboxError: (name: string, message: string, stack?: string) => object) {
		this.#makeSandboxError = makeSandboxError;
	}

	wrapConstructor(value: HostConstructor): unknown {
		return this.#wrapObject(value, { constructable: true });
	}

	wrap(value: unknown, invocation?: Invocation): unknown {
		if ((typeof value !== "object" || value === null) && typeof value !== "function") return value;
		const objectValue = value as object;
		if (this.#proxyToHost.has(objectValue) || this.#sandboxValues.has(objectValue)) return value;
		if (typeof value !== "function") {
			const cached = this.#hostToProxy.get(objectValue);
			if (cached) return cached;
			if (this.#isPromiseLike(value)) return this.#wrapPromise(value);
		}
		return this.#wrapObject(objectValue, invocation);
	}

	toHostError(error: unknown): unknown {
		if ((typeof error === "object" && error !== null) || typeof error === "function") {
			const objectError = error as object;
			const original = this.#sandboxErrorToHost.get(objectError) ?? this.#proxyToHost.get(objectError);
			if (original instanceof Error) return original;
			const record = error as { name?: unknown; message?: unknown; stack?: unknown };
			const hostError = new Error(typeof record.message === "string" ? record.message : String(error));
			if (typeof record.name === "string") hostError.name = record.name;
			if (typeof record.stack === "string") hostError.stack = record.stack;
			return hostError;
		}
		return error instanceof Error ? error : new Error(String(error));
	}

	#wrapObject(hostValue: object, invocation?: Invocation): object {
		const callable = typeof hostValue === "function";
		const target: object = callable
			? invocation?.constructable
				? constructableCapabilityTarget.bind(undefined)
				: (..._args: unknown[]): unknown => undefined
			: Array.isArray(hostValue)
				? []
				: Object.create(null);
		const handler: ProxyHandler<object> = {
			get: (_target, key) => {
				if (BLOCKED_HOST_KEYS.has(key)) return undefined;
				try {
					const result = Reflect.get(hostValue, key, hostValue);
					return this.wrap(result, typeof result === "function" ? { receiver: hostValue, key } : undefined);
				} catch (error) {
					throw this.#toSandboxError(error);
				}
			},
			has: (_target, key) => {
				if (BLOCKED_HOST_KEYS.has(key)) return false;
				try {
					return Reflect.has(hostValue, key);
				} catch (error) {
					throw this.#toSandboxError(error);
				}
			},
			getPrototypeOf: () => null,
			set: (_target, key, value) => {
				if (BLOCKED_HOST_KEYS.has(key)) return false;
				try {
					return Reflect.set(hostValue, key, this.#unwrapArgument(value, key), hostValue);
				} catch (error) {
					throw this.#toSandboxError(error);
				}
			},
			defineProperty: () => false,
			deleteProperty: (_target, key) => {
				if (BLOCKED_HOST_KEYS.has(key)) return false;
				try {
					return Reflect.deleteProperty(hostValue, key);
				} catch (error) {
					throw this.#toSandboxError(error);
				}
			},
			setPrototypeOf: () => false,
			preventExtensions: () => false,
			ownKeys: () => {
				try {
					const keys = Reflect.ownKeys(hostValue).filter(key => !BLOCKED_HOST_KEYS.has(key));
					for (const key of Reflect.ownKeys(target)) {
						const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
						if (descriptor?.configurable === false && !keys.includes(key)) keys.push(key);
					}
					return keys;
				} catch (error) {
					throw this.#toSandboxError(error);
				}
			},
			getOwnPropertyDescriptor: (_target, key) => {
				if (BLOCKED_HOST_KEYS.has(key)) return undefined;
				const targetDescriptor = Reflect.getOwnPropertyDescriptor(target, key);
				if (targetDescriptor?.configurable === false) return targetDescriptor;
				try {
					const descriptor = Reflect.getOwnPropertyDescriptor(hostValue, key);
					if (!descriptor) return undefined;
					const value = this.wrap(Reflect.get(hostValue, key, hostValue));
					return { configurable: true, enumerable: descriptor.enumerable ?? false, writable: false, value };
				} catch (error) {
					throw this.#toSandboxError(error);
				}
			},
		};
		if (callable) {
			const hostFunction = hostValue as HostFunction;
			handler.apply = (_target, thisArg, args) => {
				const receiver = invocation?.receiver ?? this.#unwrapReceiver(thisArg);
				const unwrappedArgs = args.map(arg => this.#unwrapArgument(arg, invocation?.key));
				try {
					return this.wrap(Reflect.apply(hostFunction, receiver, unwrappedArgs));
				} catch (error) {
					throw this.#toSandboxError(error);
				}
			};
			handler.construct = invocation?.constructable
				? (_target, args) => {
						try {
							const unwrappedArgs = args.map(arg => this.#unwrapArgument(arg));
							return this.wrap(Reflect.construct(hostFunction, unwrappedArgs)) as object;
						} catch (error) {
							throw this.#toSandboxError(error);
						}
					}
				: () => {
						throw this.#toSandboxError(new TypeError("Host constructors are unavailable in browser.run"));
					};
		}

		const proxy = new Proxy(target, handler);
		this.#proxyToHost.set(proxy, hostValue);
		if (!callable) this.#hostToProxy.set(hostValue, proxy);
		return proxy;
	}

	#wrapPromise(promise: object): object {
		const cached = this.#hostToProxy.get(promise);
		if (cached) return cached;
		const thenable = Object.create(null) as { then?: HostFunction };
		// biome-ignore lint/suspicious/noThenProperty: await needs this deliberate cross-realm thenable membrane.
		thenable.then = (resolve, reject) =>
			Promise.resolve(promise).then(
				value => Reflect.apply(resolve as HostFunction, undefined, [this.wrap(value)]),
				error => Reflect.apply(reject as HostFunction, undefined, [this.#toSandboxError(error)]),
			);
		const proxy = this.#wrapObject(thenable);
		this.#hostToProxy.set(promise, proxy);
		return proxy;
	}

	#unwrapReceiver(value: unknown): unknown {
		if ((typeof value !== "object" || value === null) && typeof value !== "function") return value;
		return this.#proxyToHost.get(value as object) ?? value;
	}

	#unwrapArgument(value: unknown, callKey?: PropertyKey): unknown {
		if ((typeof value !== "object" || value === null) && typeof value !== "function") return value;
		const objectValue = value as object;
		const hostValue = this.#proxyToHost.get(objectValue);
		if (hostValue) return hostValue;
		this.#sandboxValues.add(objectValue);
		if (typeof value !== "function") return value;
		if (callKey === "then" || (callKey !== undefined && SERIALIZED_CALLBACK_METHODS.has(callKey))) return value;
		return this.#wrapSandboxCallback(value as HostFunction);
	}

	#wrapSandboxCallback(callback: HostFunction): HostFunction {
		const cached = this.#sandboxCallbackToHost.get(callback);
		if (cached) return cached;
		const wrapped = (...args: unknown[]): unknown => {
			try {
				const result = Reflect.apply(
					callback,
					this.wrap(undefined),
					args.map(arg => this.wrap(arg)),
				);
				if (this.#isPromiseLike(result)) {
					return Promise.resolve(result).then(
						value => this.#unwrapArgument(value),
						error => {
							throw this.toHostError(error);
						},
					);
				}
				return this.#unwrapArgument(result);
			} catch (error) {
				throw this.toHostError(error);
			}
		};
		this.#sandboxCallbackToHost.set(callback, wrapped);
		return wrapped;
	}

	#toSandboxError(error: unknown): unknown {
		if ((typeof error === "object" && error !== null) || typeof error === "function") {
			const objectError = error as object;
			if (this.#sandboxValues.has(objectError) || this.#proxyToHost.has(objectError)) return error;
		}
		const record = error as { name?: unknown; message?: unknown; stack?: unknown };
		const name = typeof record?.name === "string" ? record.name : "Error";
		const message = typeof record?.message === "string" ? record.message : String(error);
		const stack = typeof record?.stack === "string" ? record.stack : undefined;
		const sandboxError = this.#makeSandboxError(name, message, stack);
		this.#sandboxValues.add(sandboxError);
		this.#sandboxErrorToHost.set(sandboxError, error);
		return sandboxError;
	}

	#isPromiseLike(value: unknown): value is object {
		if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
		try {
			return typeof Reflect.get(value as object, "then", value) === "function";
		} catch {
			return false;
		}
	}
}

/** Persistent, code-generation-disabled VM realm used exclusively by browser.run. */
export class BrowserRealm {
	#context: vm.Context;
	#membrane: BrowserCapabilityMembrane;
	#disposed = false;

	constructor(host: BrowserRealmHost) {
		const sandbox = Object.create(null) as Record<string, unknown>;
		for (const key of UNAVAILABLE_AMBIENT_GLOBALS) sandbox[key] = undefined;
		sandbox.Function = undefined;
		sandbox.eval = undefined;
		this.#context = vm.createContext(sandbox, {
			name: "Pi browser.run",
			codeGeneration: { strings: false, wasm: false },
		});
		const makeSandboxError = vm.runInContext(
			`(name, message, stack) => {
				const error = new Error(message);
				error.name = name;
				if (stack) error.stack = stack;
				return error;
			}`,
			this.#context,
		) as (name: string, message: string, stack?: string) => object;
		this.#membrane = new BrowserCapabilityMembrane(makeSandboxError);
		sandbox.URL = this.#membrane.wrapConstructor(URL);
		sandbox.__omp_log__ = this.#membrane.wrap(host.log);
		sandbox.__omp_table__ = this.#membrane.wrap(host.table);
		sandbox.__omp_display__ = this.#membrane.wrap(host.display);
		sandbox.__omp_set_final_expr__ = this.#membrane.wrap(host.setFinalExpression);
		vm.runInContext(browserPrelude, this.#context, { filename: "browser-prelude.js" });
	}

	setScope(scope: Record<string, unknown>): void {
		if (this.#disposed) throw new Error("Cannot set scope on a disposed browser runtime");
		for (const [key, value] of Object.entries(scope)) {
			(this.#context as Record<string, unknown>)[key] = this.#membrane.wrap(value);
		}
	}

	run(source: string, filename?: string, timeoutMs?: number): unknown {
		if (this.#disposed) throw new Error("Cannot run code on a disposed browser runtime");
		try {
			const script = new vm.Script(source, filename ? { filename } : undefined);
			const options =
				typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0
					? { timeout: Math.max(1, Math.trunc(timeoutMs)) }
					: undefined;
			return script.runInContext(this.#context, options);
		} catch (error) {
			throw this.#membrane.toHostError(error);
		}
	}

	toHostError(error: unknown): unknown {
		return this.#membrane.toHostError(error);
	}

	dispose(): void {
		this.#disposed = true;
	}
}
