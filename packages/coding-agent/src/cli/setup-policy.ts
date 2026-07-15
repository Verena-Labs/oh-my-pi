/** Optional setup components exposed by the Pi CLI. */
export const PI_SETUP_COMPONENTS = [] as const;

/** Reject dormant upstream optional-component routes before onboarding starts. */
export function assertPiSetupPositionals(positionals: readonly string[]): void {
	if (positionals.length > 0) {
		throw new Error(`Unknown setup component: ${positionals[0]}. Pi setup only runs interactive onboarding.`);
	}
}
