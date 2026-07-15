import * as path from "node:path";
import { AuthStorage } from "@oh-my-pi/pi-ai";
import { getAgentDbPath, getAgentDir, getConfigRootDir } from "@oh-my-pi/pi-utils";
import { resolveConfigValue } from "../config/resolve-config-value";

export interface AuthBrokerClientConfig {
	url: string;
	token: string;
}

interface DiscoverAuthStorageOptions {
	cachePath?: string;
	sourceLabel?: string;
}

/** Dormant OMP broker token path retained for internal CLI source compatibility. */
export function getAuthBrokerTokenFilePath(): string {
	return path.join(getConfigRootDir(), "auth-broker.token");
}

/**
 * Pi always uses its local credential database. The broker implementation is
 * retained in pi-ai for upstream compatibility, but environment variables,
 * config entries, and token files cannot activate it through this runtime.
 */
export function resolveAuthBrokerConfig(): Promise<AuthBrokerClientConfig | null> {
	return Promise.resolve(null);
}

/**
 * Create Pi's local, single-selection AuthStorage instance. Multiple stored
 * rows remain intact for migration and explicit account management, while
 * ordinary requests never rank or rotate through sibling credentials.
 *
 * Default `agentDir` is the current configured agent directory.
 */
export async function discoverAuthStorage(
	agentDir: string = getAgentDir(),
	options?: Omit<DiscoverAuthStorageOptions, "agentDir" | "configValueResolver">,
): Promise<AuthStorage> {
	const dbPath = getAgentDbPath(agentDir);
	const storage = await AuthStorage.create(dbPath, {
		configValueResolver: resolveConfigValue,
		singleCredential: true,
		sourceLabel: options?.sourceLabel ?? `local ${dbPath}`,
	});
	await storage.reload();
	return storage;
}
