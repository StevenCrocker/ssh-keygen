import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { readSftpConfig, SftpConfig, updateSftpConfig, writeSftpConfig } from './utils/sftpConfigUtils';
import { checkSSHKeygenAvailability, generateSSHKey, getSSHKeygenInstallInstructions, validateSSHKeyPair } from './utils/sshUtils';
import { askToCopyToClipboard, promptForHost, promptForHostnameOnly, promptForRemotePath, promptForUsername, selectConfiguration, selectKeyType } from './utils/userPrompts';

// Common helper functions
async function ensureWorkspaceAndSSHKeygen(): Promise<{ root: string; vscodeDir: string } | null> {
	const wsFolders = vscode.workspace.workspaceFolders;
	if (!wsFolders) {
		vscode.window.showErrorMessage('Please open a workspace first.');
		return null;
	}

	// Check if ssh-keygen is available
	const sshKeygenAvailable = await checkSSHKeygenAvailability();
	if (!sshKeygenAvailable) {
		const installInstructions = getSSHKeygenInstallInstructions();
		const action = await vscode.window.showErrorMessage('ssh-keygen is not installed or not found in PATH. This tool is required to generate SSH keys.', 'Show Installation Instructions');

		if (action === 'Show Installation Instructions') {
			vscode.window.showInformationMessage(installInstructions, { modal: true });
		}
		return null;
	}

	const root = wsFolders[0].uri.fsPath;
	const vscodeDir = path.join(root, '.vscode');
	if (!fs.existsSync(vscodeDir)) {
		fs.mkdirSync(vscodeDir);
	}

	return { root, vscodeDir };
}

async function discoverSSHKeys(vscodeDir: string): Promise<Array<{ privateKeyFile: string; publicKeyFile: string; hostname: string; username: string; keyType: string; isValid: boolean }>> {
	const keyPairs: Array<{ privateKeyFile: string; publicKeyFile: string; hostname: string; username: string; keyType: string; isValid: boolean }> = [];

	if (!fs.existsSync(vscodeDir)) {
		return keyPairs;
	}

	const files = fs.readdirSync(vscodeDir);
	const publicKeyFiles = files.filter((file) => file.endsWith('.pub'));

	for (const pubFile of publicKeyFiles) {
		const privateFile = pubFile.slice(0, -4); // Remove .pub extension
		const privateKeyPath = path.join(vscodeDir, privateFile);
		const publicKeyPath = path.join(vscodeDir, pubFile);

		// Check if private key exists
		if (fs.existsSync(privateKeyPath)) {
			// Parse filename format: {hostname}-{username}-{keytype}
			const parts = privateFile.split('-');

			if (parts.length >= 3) {
				const hostname = parts[0];
				const keyType = parts[parts.length - 1];
				const username = parts.slice(1, -1).join('-'); // Everything between hostname and keytype

				// Validate the key pair
				const validation = await validateSSHKeyPair(privateKeyPath, publicKeyPath);

				keyPairs.push({
					privateKeyFile: privateFile,
					publicKeyFile: pubFile,
					hostname,
					username,
					keyType,
					isValid: validation.isValid
				});
			}
		}
	}

	return keyPairs;
}

async function generateSSHKeyPair(vscodeDir: string, keyType: string, rsaBits: string | undefined, host: string, username: string): Promise<{ privateKeyPath: string; publicKeyPath: string; privateKeyFile: string; publicKeyFile: string } | null> {
	// Build file paths with new naming format: {hostname}-{username}-{keytype}
	const safeHost = host.replace(/[^\w.-]/g, '_');
	const safeUsername = username.replace(/[^\w.-]/g, '_');

	const privateKeyFile = `${safeHost}-${safeUsername}-${keyType}`;
	const publicKeyFile = `${safeHost}-${safeUsername}-${keyType}.pub`;

	const privateKeyPath = path.join(vscodeDir, privateKeyFile);
	const publicKeyPath = path.join(vscodeDir, publicKeyFile);

	// Generate the key (only if it doesn't exist or is invalid)
	const validation = await validateSSHKeyPair(privateKeyPath, publicKeyPath);

	if (validation.isValid) {
		vscode.window.showInformationMessage(`Valid matching SSH key pair found: ${privateKeyFile} and ${publicKeyFile}. Skipping key generation.`);
	} else {
		if (validation.error) {
			vscode.window.showWarningMessage(`SSH key validation failed: ${validation.error}. Regenerating keys...`);
		}

		vscode.window.showInformationMessage(`Generating ${keyType} key...`);
		try {
			const rsaBitsStr = rsaBits || '2048';
			await generateSSHKey(keyType, rsaBitsStr, privateKeyPath);
			vscode.window.showInformationMessage('SSH key pair generated successfully!');
		} catch (error: any) {
			vscode.window.showErrorMessage(`Error generating SSH key: ${error.message || error}`);
			return null;
		}
	}

	return { privateKeyPath, publicKeyPath, privateKeyFile, publicKeyFile };
}

async function updateSftpConfiguration(vscodeDir: string, host: string, username: string, remotePath: string, privateKeyFile: string, existingConfig?: SftpConfig, configIndex: number = 0): Promise<void> {
	const sftpConfigPath = path.join(vscodeDir, 'sftp.json');

	try {
		const { configs, isArray } = readSftpConfig(sftpConfigPath);
		const updatedConfig = updateSftpConfig(existingConfig || {}, host, username, remotePath, privateKeyFile);

		// Check if the original file was invalid/corrupted by seeing if we got empty configs when file exists
		const wasFileCorrupted = fs.existsSync(sftpConfigPath) && configs.length === 0;

		if (wasFileCorrupted) {
			// Delete the corrupted file first to trigger SFTP extension file watchers
			fs.unlinkSync(sftpConfigPath);
			// Wait a moment for file watchers to detect the deletion
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		writeSftpConfig(sftpConfigPath, configs, isArray, configIndex, updatedConfig);

		// Try to trigger SFTP extension to reload configuration
		await triggerSftpReload(sftpConfigPath, wasFileCorrupted);

		vscode.window.showInformationMessage('.vscode/sftp.json updated successfully!');
	} catch (error: any) {
		vscode.window.showErrorMessage(`Failed to write sftp.json: ${error.message || error}`);
		throw error;
	}
}

async function offerClipboardCopy(publicKeyPath: string): Promise<void> {
	const shouldCopyToClipboard = await askToCopyToClipboard();

	if (shouldCopyToClipboard === true) {
		try {
			const pubKey = fs.readFileSync(publicKeyPath, 'utf-8');
			await vscode.env.clipboard.writeText(pubKey);
			vscode.window.showInformationMessage('Public key copied to clipboard!');
		} catch (error: any) {
			vscode.window.showErrorMessage(`Failed to copy to clipboard: ${error.message || error}`);
		}
	}
}

async function triggerSftpReload(sftpConfigPath: string, wasFileCorrupted: boolean = false): Promise<void> {
	try {
		await vscode.commands.executeCommand('sftp.remoteExplorer.refresh');
		if (fs.existsSync(sftpConfigPath)) {
			fs.utimesSync(sftpConfigPath, new Date(), new Date());
		}
	} catch {}
}

export function activate(context: vscode.ExtensionContext) {
	// Command 1: Generate SSH Key Pair & Update SFTP Config (original functionality)
	const generateKeyAndConfigCommand = vscode.commands.registerCommand('extension.generateSshKeyAndConfig', async () => {
		const workspace = await ensureWorkspaceAndSSHKeygen();
		if (!workspace) {
			return;
		}

		// 1️⃣ Ask for key type
		const keySelection = await selectKeyType();
		if (!keySelection) {
			vscode.window.showInformationMessage('Operation cancelled.');
			return;
		}
		const { keyType, rsaBits } = keySelection;

		// 2️⃣ Handle existing sftp.json and get configuration details
		const sftpConfigPath = path.join(workspace.vscodeDir, 'sftp.json');
		let sftpConfig: SftpConfig = {};
		let configIndex = 0;
		let host = '';
		let username = '';
		let remotePath = '';

		try {
			const { configs, isArray } = readSftpConfig(sftpConfigPath);

			if (configs.length > 0) {
				configIndex = (await selectConfiguration(configs)) ?? 0;
				if (configIndex === null) {
					vscode.window.showInformationMessage('Operation cancelled.');
					return;
				}

				sftpConfig = configs[configIndex];
				const configName = sftpConfig.name || `Configuration ${configIndex + 1}`;
				vscode.window.showInformationMessage(`Using "${configName}" configuration. Reusing values where available.`);
			}
		} catch (error) {
			vscode.window.showWarningMessage('Invalid sftp.json detected. Will recreate.');
			sftpConfig = {};
		}

		// 3️⃣ Prompt for required fields
		const hostResult = await promptForHost(sftpConfig.host);
		if (!hostResult) {
			vscode.window.showErrorMessage('Host is required.');
			return;
		}
		host = hostResult;

		const usernameResult = await promptForUsername(sftpConfig.username);
		if (!usernameResult) {
			vscode.window.showErrorMessage('Username is required.');
			return;
		}
		username = usernameResult;

		remotePath = await promptForRemotePath(sftpConfig.remotePath);

		// 4️⃣ Generate SSH keys
		const keyResult = await generateSSHKeyPair(workspace.vscodeDir, keyType, rsaBits, host, username);
		if (!keyResult) {
			return;
		}

		// 5️⃣ Update sftp.json
		try {
			await updateSftpConfiguration(workspace.vscodeDir, host, username, remotePath, keyResult.privateKeyFile, sftpConfig, configIndex);
		} catch (error) {
			return; // Error already shown in updateSftpConfiguration
		}

		// 6️⃣ Ask if they want to copy public key to clipboard
		await offerClipboardCopy(keyResult.publicKeyPath);

		// 7️⃣ Final message
		vscode.window.showInformationMessage(`✅ All done! Your SSH keys are saved in .vscode/${keyResult.privateKeyFile} (private) and .vscode/${keyResult.publicKeyFile} (public).`);
	});

	// Command 2: Generate SSH Key Pair Only
	const generateKeyOnlyCommand = vscode.commands.registerCommand('extension.generateSshKeyOnly', async () => {
		const workspace = await ensureWorkspaceAndSSHKeygen();
		if (!workspace) {
			return;
		}

		// 1️⃣ Ask for key type
		const keySelection = await selectKeyType();
		if (!keySelection) {
			vscode.window.showInformationMessage('Operation cancelled.');
			return;
		}
		const { keyType, rsaBits } = keySelection;

		// 2️⃣ Ask for hostname for naming
		const host = await promptForHostnameOnly();
		if (!host) {
			vscode.window.showErrorMessage('Hostname is required for key naming.');
			return;
		}

		// 3️⃣ Ask for username (required for new naming format)
		const username = await vscode.window.showInputBox({
			prompt: 'Enter username for key naming',
			placeHolder: 'e.g., root, admin, username',
			ignoreFocusOut: true
		});

		if (!username) {
			vscode.window.showErrorMessage('Username is required for key naming.');
			return;
		}

		// 4️⃣ Generate SSH keys
		const keyResult = await generateSSHKeyPair(workspace.vscodeDir, keyType, rsaBits, host, username);
		if (!keyResult) {
			return;
		}

		// 5️⃣ Ask if they want to copy public key to clipboard
		await offerClipboardCopy(keyResult.publicKeyPath);

		// 6️⃣ Final message
		vscode.window.showInformationMessage(`✅ SSH key pair generated! Keys saved as .vscode/${keyResult.privateKeyFile} (private) and .vscode/${keyResult.publicKeyFile} (public).`);
	});

	// Command 3: Update SFTP Config Only (Smart Discovery)
	const updateConfigOnlyCommand = vscode.commands.registerCommand('extension.updateSftpConfigOnly', async () => {
		const workspace = await ensureWorkspaceAndSSHKeygen();
		if (!workspace) {
			return;
		}

		// 1️⃣ Discover existing SSH keys in .vscode folder
		const discoveredKeys = await discoverSSHKeys(workspace.vscodeDir);

		if (discoveredKeys.length === 0) {
			vscode.window.showErrorMessage('No SSH key pairs found in .vscode folder. Please generate keys first or use the "Generate SSH Key Pair & Update SFTP Config" command.');
			return;
		}

		// 2️⃣ Auto-select if only one key pair, otherwise let user choose
		let selectedKey;

		if (discoveredKeys.length === 1) {
			// Auto-select the only key pair found
			selectedKey = { keyData: discoveredKeys[0] };
			vscode.window.showInformationMessage(`Using SSH key: ${discoveredKeys[0].privateKeyFile} ${discoveredKeys[0].isValid ? '✅' : '❌'}`);
		} else {
			// Multiple keys found, let user choose
			const keyOptions = discoveredKeys.map((key) => ({
				label: `${key.privateKeyFile} ${key.isValid ? '✅' : '❌'}`,
				description: `Type: ${key.keyType}`,
				detail: key.isValid ? 'Valid key pair' : 'Invalid or corrupted key pair',
				keyData: key
			}));

			selectedKey = await vscode.window.showQuickPick(keyOptions, {
				placeHolder: 'Select an SSH key pair to use for SFTP configuration',
				ignoreFocusOut: true
			});

			if (!selectedKey) {
				vscode.window.showInformationMessage('Operation cancelled.');
				return;
			}
		}

		const keyData = selectedKey.keyData;

		// 3️⃣ Warn about invalid keys but allow continuation
		if (!keyData.isValid) {
			const action = await vscode.window.showWarningMessage(`The selected SSH key pair appears to be invalid or corrupted. This may result in a broken SFTP configuration.`, 'Continue Anyway', 'Cancel');

			if (action !== 'Continue Anyway') {
				vscode.window.showInformationMessage('Operation cancelled.');
				return;
			}
		}

		// 4️⃣ Handle existing sftp.json
		const sftpConfigPath = path.join(workspace.vscodeDir, 'sftp.json');
		let sftpConfig: SftpConfig = {};
		let configIndex = 0;

		try {
			const { configs, isArray } = readSftpConfig(sftpConfigPath);

			if (configs.length > 0) {
				configIndex = (await selectConfiguration(configs)) ?? 0;
				if (configIndex === null) {
					vscode.window.showInformationMessage('Operation cancelled.');
					return;
				}

				sftpConfig = configs[configIndex];
				const configName = sftpConfig.name || `Configuration ${configIndex + 1}`;
				vscode.window.showInformationMessage(`Updating "${configName}" configuration with auto-discovered values.`);
			}
		} catch (error) {
			vscode.window.showWarningMessage('Invalid sftp.json detected. Will recreate.');
			sftpConfig = {};
		}

		// 5️⃣ Use discovered hostname, prompt for missing username/remotePath
		const host = keyData.hostname;

		// Use discovered username or prompt if not available
		let username = keyData.username;
		if (!username) {
			const usernameResult = await promptForUsername(sftpConfig.username);
			if (!usernameResult) {
				vscode.window.showErrorMessage('Username is required.');
				return;
			}
			username = usernameResult;
		} else {
			vscode.window.showInformationMessage(`Using username from key filename: ${username}`);
		}

		const remotePath = await promptForRemotePath(sftpConfig.remotePath);

		// 6️⃣ Update sftp.json
		try {
			await updateSftpConfiguration(workspace.vscodeDir, host, username, remotePath, keyData.privateKeyFile, sftpConfig, configIndex);
			vscode.window.showInformationMessage(`✅ SFTP configuration updated successfully using ${keyData.privateKeyFile}!`);
		} catch (error) {
			// Error already shown in updateSftpConfiguration
		}
	});

	context.subscriptions.push(generateKeyAndConfigCommand, generateKeyOnlyCommand, updateConfigOnlyCommand);
}

export function deactivate() {}
