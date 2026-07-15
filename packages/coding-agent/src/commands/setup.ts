/** Run Pi's interactive onboarding setup. */
import { Command } from "@oh-my-pi/pi-utils/cli";
import { parseArgs } from "../cli/args";
import { assertPiSetupPositionals } from "../cli/setup-policy";
import { runRootCommand } from "../main";

export interface OnboardingSetupDependencies {
	runRoot?: typeof runRootCommand;
	stdinIsTTY?: boolean;
	stdoutIsTTY?: boolean;
	writeStderr?: (text: string) => void;
	exit?: (code: number) => never;
}

export async function runOnboardingSetup(deps: OnboardingSetupDependencies = {}): Promise<void> {
	const stdinIsTTY = deps.stdinIsTTY ?? process.stdin.isTTY;
	const stdoutIsTTY = deps.stdoutIsTTY ?? process.stdout.isTTY;
	if (!stdinIsTTY || !stdoutIsTTY) {
		(deps.writeStderr ?? (text => process.stderr.write(text)))("pi setup requires an interactive TTY.\n");
		(deps.exit ?? process.exit)(1);
		return;
	}
	await (deps.runRoot ?? runRootCommand)(parseArgs([]), [], { forceSetupWizard: true });
}

export default class Setup extends Command {
	static description = "Run the interactive onboarding setup";

	async run(): Promise<void> {
		const { argv } = await this.parse(Setup);
		assertPiSetupPositionals(argv);
		await runOnboardingSetup();
	}
}
