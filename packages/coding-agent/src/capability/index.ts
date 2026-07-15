/**
 * Capability Registry
 *
 * Central registry for capabilities and providers. Provides the main API for:
 * - Defining capabilities (what we're looking for)
 * - Registering providers (where to find it)
 * - Loading items for a capability across all providers
 */
import { AsyncLocalStorage } from "node:async_hooks";
import * as os from "node:os";
import * as path from "node:path";
import { getProjectDir, logger } from "@oh-my-pi/pi-utils";

import type { Settings } from "../config/settings";
import { clearCache as clearFsCache, findRepoRoot, cacheStats as fsCacheStats, invalidate as invalidateFs } from "./fs";
import type {
	Capability,
	CapabilityInfo,
	CapabilityResult,
	LoadContext,
	LoadOptions,
	Provider,
	ProviderInfo,
	SourceMeta,
} from "./types";

// =============================================================================
// Registry State
// =============================================================================

/** Registry of all capabilities */
const capabilities = new Map<string, Capability<unknown>>();

/** OMP capability implementations retained for rebasing but absent from Pi's
 * public discovery and loading surface. Providers may still register against
 * these definitions during module initialization; no caller can enumerate or
 * load them. */
const PI_DISABLED_CAPABILITY_IDS: ReadonlySet<string> = new Set(["rules"]);

function isPiDisabledCapability(capabilityId: string): boolean {
	return PI_DISABLED_CAPABILITY_IDS.has(capabilityId);
}

/** Reverse index: provider ID -> capability IDs it's registered for */
const providerCapabilities = new Map<string, Set<string>>();

/** Provider display metadata (shared across capabilities) */
const providerMeta = new Map<string, { displayName: string; description: string }>();

/** Disabled providers (by ID) */
const disabledProviders = new Set<string>();

/** Settings manager for persistence (if set) */
let settings: Settings | null = null;

/**
 * Request-local read view used while a reload discovers files against
 * uncommitted candidate settings. Mutations intentionally bypass this view and
 * continue to update only the committed process-global registry.
 */
interface CapabilityReadView {
	readonly settings: Settings;
	readonly disabledProviders: ReadonlySet<string>;
}

const capabilityReadScope = new AsyncLocalStorage<CapabilityReadView>();

function getCapabilityReadSettings(): Settings | null {
	return capabilityReadScope.getStore()?.settings ?? settings;
}

function getCapabilityReadDisabledProviders(): ReadonlySet<string> {
	return capabilityReadScope.getStore()?.disabledProviders ?? disabledProviders;
}

/**
 * Run host-owned capability discovery against a Settings snapshot without
 * exposing that uncommitted policy to concurrent sessions. Callers must leave
 * the scope before importing or executing user modules, because async work
 * spawned by a callback inherits its AsyncLocalStorage context.
 */
export function runWithCapabilitySettings<T>(activeSettings: Settings, callback: () => T): T {
	return capabilityReadScope.run(
		{
			settings: activeSettings,
			disabledProviders: new Set(activeSettings.get("disabledProviders")),
		},
		callback,
	);
}

// =============================================================================
// Registration API
// =============================================================================

/**
 * Define a new capability.
 */
export function defineCapability<T>(def: Omit<Capability<T>, "providers">): Capability<T> {
	if (capabilities.has(def.id)) {
		throw new Error(`Capability "${def.id}" is already defined`);
	}
	const capability: Capability<T> = { ...def, providers: [] };
	capabilities.set(def.id, capability as Capability<unknown>);
	return capability;
}

/**
 * Register a provider for a capability.
 */
export function registerProvider<T>(capabilityId: string, provider: Provider<T>): void {
	const capability = capabilities.get(capabilityId);
	if (!capability) {
		throw new Error(`Unknown capability: "${capabilityId}". Define it first with defineCapability().`);
	}

	// Store provider metadata (for cross-capability display)
	if (!providerMeta.has(provider.id)) {
		providerMeta.set(provider.id, {
			displayName: provider.displayName,
			description: provider.description,
		});
	}

	// Track which capabilities this provider is registered for
	if (!providerCapabilities.has(provider.id)) {
		providerCapabilities.set(provider.id, new Set());
	}
	providerCapabilities.get(provider.id)!.add(capabilityId);

	// Insert in priority order (highest first)
	const providers = capability.providers as Provider<T>[];
	const idx = providers.findIndex(p => p.priority < provider.priority);
	if (idx === -1) {
		providers.push(provider);
	} else {
		providers.splice(idx, 0, provider);
	}
}

// =============================================================================
// Loading API
// =============================================================================

/**
 * Async loading logic shared by loadCapability().
 */
async function loadImpl<T>(
	capability: Capability<T>,
	providers: Provider<T>[],
	ctx: LoadContext,
	options: LoadOptions,
): Promise<CapabilityResult<T>> {
	const allItems: Array<T & { _source: SourceMeta; _shadowed?: boolean }> = [];
	const allWarnings: string[] = [];
	const contributingProviders: string[] = [];
	const readSettings = getCapabilityReadSettings();
	const disabledExtensionIds = options.includeDisabled
		? new Set<string>()
		: new Set<string>(options.disabledExtensions ?? readSettings?.get("disabledExtensions") ?? []);

	const results = await Promise.all(
		providers.map(async provider => {
			try {
				const result = await logger.time(
					`capability:${capability.id}:${provider.id}`,
					provider.load.bind(provider),
					ctx,
				);
				return { provider, result };
			} catch (error) {
				logger.debug(`capability:${capability.id}:${provider.id}:error`);
				return { provider, error };
			}
		}),
	);

	for (const entry of results) {
		const { provider } = entry;
		if ("error" in entry) {
			allWarnings.push(`[${provider.displayName}] Failed to load: ${entry.error}`);
			continue;
		}

		const result = entry.result;
		if (!result) continue;

		if (result.warnings) {
			allWarnings.push(...result.warnings.map(w => `[${provider.displayName}] ${w}`));
		}

		let contributedItemCount = 0;
		for (const item of result.items) {
			const itemWithSource = item as T & { _source: SourceMeta };
			if (!itemWithSource._source) {
				allWarnings.push(`[${provider.displayName}] Item missing _source metadata, skipping`);
				continue;
			}

			const extensionId = capability.toExtensionId?.(itemWithSource);
			if (extensionId && disabledExtensionIds.has(extensionId)) {
				continue;
			}

			itemWithSource._source.providerName = provider.displayName;
			allItems.push(itemWithSource as T & { _source: SourceMeta; _shadowed?: boolean });
			contributedItemCount += 1;
		}

		if (contributedItemCount > 0) {
			contributingProviders.push(provider.id);
		}
	}

	// Deduplicate by key (first wins = highest priority)
	const seen = new Map<string, number>();
	const deduped: Array<T & { _source: SourceMeta }> = [];

	for (let i = 0; i < allItems.length; i++) {
		const item = allItems[i];
		const key = capability.key(item);

		if (key === undefined) {
			deduped.push(item);
		} else if (!seen.has(key)) {
			seen.set(key, i);
			deduped.push(item);
		} else {
			item._shadowed = true;
		}
	}

	// Validate items (only non-shadowed items)
	if (capability.validate && !options.includeInvalid) {
		for (let i = deduped.length - 1; i >= 0; i--) {
			const error = capability.validate(deduped[i]);
			if (error) {
				const source = deduped[i]._source;
				allWarnings.push(
					`[${source?.providerName ?? "unknown"}] Invalid item at ${source?.path ?? "unknown"}: ${error}`,
				);
				deduped.splice(i, 1);
			}
		}
	}

	return {
		items: deduped,
		all: allItems,
		warnings: allWarnings,
		providers: contributingProviders,
	};
}

/**
 * Filter providers based on options and disabled state.
 */
function filterProviders<T>(capability: Capability<T>, options: LoadOptions): Provider<T>[] {
	const readDisabledProviders = getCapabilityReadDisabledProviders();
	let providers = (capability.providers as Provider<T>[]).filter(p => !readDisabledProviders.has(p.id));

	if (options.providers) {
		const allowed = new Set(options.providers);
		providers = providers.filter(p => allowed.has(p.id));
	}
	if (options.excludeProviders) {
		const excluded = new Set(options.excludeProviders);
		providers = providers.filter(p => !excluded.has(p.id));
	}

	return providers;
}

/**
 * Load a capability by ID.
 */
export async function loadCapability<T>(capabilityId: string, options: LoadOptions = {}): Promise<CapabilityResult<T>> {
	if (isPiDisabledCapability(capabilityId)) {
		throw new Error(`Unknown capability: "${capabilityId}"`);
	}
	const capability = capabilities.get(capabilityId) as Capability<T> | undefined;
	if (!capability) {
		throw new Error(`Unknown capability: "${capabilityId}"`);
	}

	const cwd = options.cwd ?? getProjectDir();
	const home = os.homedir();
	const repoRoot = await findRepoRoot(cwd);
	const ctx: LoadContext = { cwd, home, repoRoot };
	const providers = filterProviders(capability, options);

	return await loadImpl(capability, providers, ctx, options);
}

// =============================================================================
// Provider Enable/Disable API
// =============================================================================

/**
 * Initialize capability system with settings manager for persistence.
 * Call this once on startup to enable persistent provider state.
 */
export function initializeWithSettings(activeSettings: Settings): void {
	settings = activeSettings;
	// Load disabled providers from settings
	const disabled = settings.get("disabledProviders");
	disabledProviders.clear();
	for (const id of disabled) {
		disabledProviders.add(id);
	}
}

/**
 * Persist current disabled providers to settings.
 */
function persistDisabledProviders(): void {
	if (settings) {
		settings.set("disabledProviders", Array.from(disabledProviders));
	}
}

/**
 * Disable a provider globally (across all capabilities).
 */
export function disableProvider(providerId: string): void {
	disabledProviders.add(providerId);
	persistDisabledProviders();
}

/**
 * Enable a previously disabled provider.
 */
export function enableProvider(providerId: string): void {
	disabledProviders.delete(providerId);
	persistDisabledProviders();
}

/**
 * Check if a provider is enabled.
 */
export function isProviderEnabled(providerId: string): boolean {
	return !getCapabilityReadDisabledProviders().has(providerId);
}

/**
 * Get list of all disabled provider IDs.
 */
export function getDisabledProviders(): string[] {
	return Array.from(getCapabilityReadDisabledProviders());
}

/**
 * Set disabled providers from a list (replaces current set).
 */
export function setDisabledProviders(providerIds: string[]): void {
	disabledProviders.clear();
	for (const id of providerIds) {
		disabledProviders.add(id);
	}
	persistDisabledProviders();
}

// =============================================================================
// Introspection API
// =============================================================================

/**
 * Get a capability definition (for introspection).
 */
export function getCapability<T>(id: string): Capability<T> | undefined {
	if (isPiDisabledCapability(id)) return undefined;
	return capabilities.get(id) as Capability<T> | undefined;
}

/**
 * List all registered capability IDs.
 */
export function listCapabilities(): string[] {
	return Array.from(capabilities.keys()).filter(id => !isPiDisabledCapability(id));
}

/**
 * Get capability info for UI display.
 */
export function getCapabilityInfo(capabilityId: string): CapabilityInfo | undefined {
	if (isPiDisabledCapability(capabilityId)) return undefined;
	const capability = capabilities.get(capabilityId);
	if (!capability) return undefined;

	const readDisabledProviders = getCapabilityReadDisabledProviders();
	return {
		id: capability.id,
		displayName: capability.displayName,
		description: capability.description,
		providers: capability.providers.map(p => ({
			id: p.id,
			displayName: p.displayName,
			description: p.description,
			priority: p.priority,
			enabled: !readDisabledProviders.has(p.id),
		})),
	};
}

/**
 * Get all capabilities info for UI display.
 */
export function getAllCapabilitiesInfo(): CapabilityInfo[] {
	return listCapabilities().map(id => getCapabilityInfo(id)!);
}

/**
 * Get provider info for UI display.
 */
export function getProviderInfo(providerId: string): ProviderInfo | undefined {
	const meta = providerMeta.get(providerId);
	const caps = providerCapabilities.get(providerId);
	if (!meta || !caps) return undefined;
	const publicCapabilities = Array.from(caps).filter(capabilityId => !isPiDisabledCapability(capabilityId));
	if (publicCapabilities.length === 0) return undefined;

	// Find priority from first capability's provider list
	let priority = 0;
	for (const capId of publicCapabilities) {
		const cap = capabilities.get(capId);
		const provider = cap?.providers.find(p => p.id === providerId);
		if (provider) {
			priority = provider.priority;
			break;
		}
	}

	return {
		id: providerId,
		displayName: meta.displayName,
		description: meta.description,
		priority,
		capabilities: publicCapabilities,
		enabled: !getCapabilityReadDisabledProviders().has(providerId),
	};
}

/**
 * Get all providers info for UI display (deduplicated across capabilities).
 */
export function getAllProvidersInfo(): ProviderInfo[] {
	const providers: ProviderInfo[] = [];

	for (const providerId of providerMeta.keys()) {
		const info = getProviderInfo(providerId);
		if (info) {
			providers.push(info);
		}
	}

	// Sort by priority (highest first)
	providers.sort((a, b) => b.priority - a.priority);

	return providers;
}

// =============================================================================
// Cache Management
// =============================================================================

/**
 * Reset all caches. Call after chdir or filesystem changes.
 */
export function reset(): void {
	clearFsCache();
}

/**
 * Invalidate cache for a specific path.
 * @param filePath - Absolute or relative path to invalidate
 */
export function invalidate(filePath: string, cwd?: string): void {
	const resolved = cwd ? path.resolve(cwd, filePath) : filePath;
	invalidateFs(resolved);
}

/**
 * Get cache stats for diagnostics.
 */
export function cacheStats(): { content: number; dir: number } {
	return fsCacheStats();
}

// =============================================================================
// Re-exports
// =============================================================================

export type * from "./types";
