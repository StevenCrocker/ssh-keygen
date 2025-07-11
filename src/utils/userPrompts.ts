import * as vscode from 'vscode';
import { SftpConfig } from './sftpConfigUtils';

export async function selectKeyType(): Promise<{ keyType: string; rsaBits: string } | null> {
	const keyTypeSelection = await vscode.window.showQuickPick(['ed25519 (recommended)', 'rsa 2048', 'rsa 4096'], { placeHolder: 'Select SSH Key Type' });

	if (!keyTypeSelection) {
		return null;
	}

	let keyType = '';
	let rsaBits = '';

	if (keyTypeSelection.startsWith('ed25519')) {
		keyType = 'ed25519';
	} else if (keyTypeSelection.startsWith('rsa')) {
		keyType = 'rsa';
		rsaBits = keyTypeSelection.split(' ')[1];
	}

	return { keyType, rsaBits };
}

export async function askToUpdateSftpJson(): Promise<boolean | null> {
	const answer = await vscode.window.showQuickPick(['Yes', 'No'], { placeHolder: 'Do you want to create/update .vscode/sftp.json automatically?' });

	if (!answer) {
		return null; // User cancelled
	}

	return answer === 'Yes';
}

export async function selectConfiguration(configs: SftpConfig[]): Promise<number | null> {
	if (configs.length <= 1) {
		return 0; // Use first (or only) configuration
	}

	const configOptions = configs.map((config, index) => {
		const name = config.name || `Configuration ${index + 1}`;
		const host = config.host || 'No host';
		return `${name} (${host})`;
	});

	const selectedConfig = await vscode.window.showQuickPick(configOptions, {
		placeHolder: 'Multiple configurations found. Select which one to update:'
	});

	if (!selectedConfig) {
		return null; // User cancelled
	}

	return configOptions.indexOf(selectedConfig);
}

export async function promptForHost(existingHost?: string): Promise<string | null> {
	if (existingHost && existingHost.trim() !== '') {
		return existingHost;
	}

	return (
		(await vscode.window.showInputBox({
			prompt: 'Enter SSH host (e.g. example.com)',
			ignoreFocusOut: true
		})) || null
	);
}

export async function promptForUsername(existingUsername?: string): Promise<string | null> {
	if (existingUsername && existingUsername.trim() !== '') {
		return existingUsername;
	}

	return (
		(await vscode.window.showInputBox({
			prompt: 'Enter SSH username',
			ignoreFocusOut: true
		})) || null
	);
}

export async function promptForRemotePath(existingRemotePath?: string): Promise<string> {
	return (
		existingRemotePath ??
		(await vscode.window.showInputBox({
			prompt: 'Remote path (blank for root)',
			ignoreFocusOut: true,
			value: ''
		})) ??
		''
	);
}

export async function promptForHostnameOnly(): Promise<string | null> {
	return (
		(await vscode.window.showInputBox({
			prompt: 'Enter hostname (for naming the key files)',
			ignoreFocusOut: true
		})) || null
	);
}

export async function askToCopyToClipboard(): Promise<boolean | null> {
	const answer = await vscode.window.showQuickPick(['Yes', 'No'], { placeHolder: 'Do you want to copy the public key to your clipboard?' });

	if (!answer) {
		return null; // User cancelled
	}

	return answer === 'Yes';
}

export async function promptForPassphrase(): Promise<string | null> {
	const passphrase = await vscode.window.showInputBox({
		prompt: 'Enter passphrase for SSH key (leave empty for no passphrase)',
		ignoreFocusOut: true,
		password: true,
		value: ''
	});

	// Return null if user cancelled, empty string if they want no passphrase
	return passphrase !== undefined ? passphrase : null;
}

export async function promptForPassphraseStorage(): Promise<'plaintext' | 'prompt' | null> {
	const choice = await vscode.window.showQuickPick(
		[
			{ label: 'Store as plaintext in sftp.json', description: 'Convenient but less secure', value: 'plaintext' },
			{ label: 'Prompt for passphrase on connect', description: 'More secure but requires input each time', value: 'prompt' }
		],
		{
			placeHolder: 'How would you like to handle the passphrase in sftp.json?',
			ignoreFocusOut: true
		}
	);

	return choice ? (choice.value as 'plaintext' | 'prompt') : null;
}

export async function promptForCurrentPassphrase(): Promise<string | null> {
	const passphrase = await vscode.window.showInputBox({
		prompt: 'Enter current passphrase to verify',
		ignoreFocusOut: true,
		password: true,
		value: ''
	});

	return passphrase !== undefined ? passphrase : null;
}

export async function promptForNewPassphrase(): Promise<string | null> {
	const passphrase = await vscode.window.showInputBox({
		prompt: 'Enter new passphrase (leave empty to remove passphrase)',
		ignoreFocusOut: true,
		password: true,
		value: ''
	});

	return passphrase !== undefined ? passphrase : null;
}
