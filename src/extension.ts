import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { readSftpConfig, SftpConfig, updateSftpConfig, writeSftpConfig } from './utils/sftpConfigUtils';
import { changeSSHKeyPassphrase, checkSSHKeygenAvailability, checkSSHKeyHasPassphrase, generateSSHKey, getSSHKeygenInstallInstructions, validateSSHKeyPair, verifySSHKeyPassphrase } from './utils/sshUtils';
import { askToCopyToClipboard, promptForCurrentPassphrase, promptForHost, promptForHostnameOnly, promptForNewPassphrase, promptForPassphrase, promptForPassphraseStorage, promptForRemotePath, promptForUsername, selectConfiguration, selectKeyType } from './utils/userPrompts';

// Global logging functions (set in activate)
let log: (message: string) => void;
let showInfo: (message: string, ...items: string[]) => Thenable<string | undefined>;
let showWarning: (message: string, ...items: string[]) => Thenable<string | undefined>;
let showError: (message: string, ...items: string[]) => Thenable<string | undefined>;

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

async function discoverSSHKeys(vscodeDir: string, log?: (message: string) => void): Promise<Array<{ privateKeyFile: string; publicKeyFile: string; hostname: string; username: string; keyType: string; isValid: boolean }>> {
	const keyPairs: Array<{ privateKeyFile: string; publicKeyFile: string; hostname: string; username: string; keyType: string; isValid: boolean }> = [];

	if (!fs.existsSync(vscodeDir)) {
		return keyPairs;
	}

	const files = fs.readdirSync(vscodeDir);
	const publicKeyFiles = files.filter((file) => file.endsWith('.pub'));

	if (publicKeyFiles.length > 0) {
		log?.(`Scanning for SSH keys - found ${publicKeyFiles.length} public key file(s)`);
	}

	// Try to read SFTP config to get passphrases for validation
	const sftpConfigPath = path.join(vscodeDir, 'sftp.json');
	let sftpConfigs: any[] = [];
	try {
		const { configs } = readSftpConfig(sftpConfigPath);
		sftpConfigs = configs;
		if (configs.length > 0) {
			log?.(`Found SFTP configuration with ${configs.length} profile(s)`);
		}
	} catch (error) {
		// Silent - not important for user to know
	}

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

				// Try to find passphrase for this key from SFTP config
				let passphrase = '';
				for (const config of sftpConfigs) {
					if (config.privateKeyPath && config.privateKeyPath.includes(privateFile)) {
						if (typeof config.passphrase === 'string' && config.passphrase.trim() !== '') {
							passphrase = config.passphrase;
							break;
						}
					}
				}

				// Validate the key pair - try with stored passphrase first, then without
				let validation = await validateSSHKeyPair(privateKeyPath, publicKeyPath, passphrase);

				// If validation failed with stored passphrase, try without passphrase
				if (!validation.isValid && passphrase) {
					const validationWithoutPassphrase = await validateSSHKeyPair(privateKeyPath, publicKeyPath, '');
					if (validationWithoutPassphrase.isValid) {
						validation = validationWithoutPassphrase;
						// Key doesn't actually need the stored passphrase
					}
				}

				keyPairs.push({
					privateKeyFile: privateFile,
					publicKeyFile: pubFile,
					hostname,
					username,
					keyType,
					isValid: validation.isValid
				});

				if (validation.isValid) {
					log?.(`✓ Valid SSH key: ${privateFile}`);
				} else {
					log?.(`✗ Invalid SSH key: ${privateFile} - ${validation.error || 'validation failed'}`);
				}
			}
		}
	}

	if (keyPairs.length > 0) {
		log?.(`SSH key discovery complete - found ${keyPairs.length} key pair(s)`);
	}
	return keyPairs;
}

async function generateSSHKeyPair(vscodeDir: string, keyType: string, rsaBits: string | undefined, host: string, username: string, passphrase: string = '', forceRegenerate: boolean = false): Promise<{ privateKeyPath: string; publicKeyPath: string; privateKeyFile: string; publicKeyFile: string } | null> {
	// Build file paths with new naming format: {hostname}-{username}-{keytype}
	const safeHost = host.replace(/[^\w.-]/g, '_');
	const safeUsername = username.replace(/[^\w.-]/g, '_');

	const privateKeyFile = `${safeHost}-${safeUsername}-${keyType}`;
	const publicKeyFile = `${safeHost}-${safeUsername}-${keyType}.pub`;

	const privateKeyPath = path.join(vscodeDir, privateKeyFile);
	const publicKeyPath = path.join(vscodeDir, publicKeyFile);

	// If forceRegenerate is true, skip validation and always generate new keys
	if (!forceRegenerate) {
		// Generate the key (only if it doesn't exist or is invalid)
		const privateKeyExists = fs.existsSync(privateKeyPath);
		const publicKeyExists = fs.existsSync(publicKeyPath);

		if (privateKeyExists && publicKeyExists) {
			// Keys exist, validate them
			const validation = await validateSSHKeyPair(privateKeyPath, publicKeyPath, passphrase);

			if (validation.isValid) {
				showInfo(`Valid matching SSH key pair found: ${privateKeyFile} and ${publicKeyFile}. Skipping key generation.`);
				return { privateKeyPath, publicKeyPath, privateKeyFile, publicKeyFile };
			} else {
				// Keys exist but are invalid
				showWarning(`Existing SSH key pair is invalid: ${validation.error}. Regenerating keys...`);
			}
		}
	}

	// Generate new keys (either they don't exist, are invalid, or forceRegenerate is true)

	// If forcing regeneration, delete existing files first
	if (forceRegenerate) {
		if (fs.existsSync(privateKeyPath)) {
			fs.unlinkSync(privateKeyPath);
			//showInfo(`Deleted existing private key: ${privateKeyFile}`);
		}
		if (fs.existsSync(publicKeyPath)) {
			fs.unlinkSync(publicKeyPath);
			//showInfo(`Deleted existing public key: ${publicKeyFile}`);
		}
	}

	const passphraseMsg = passphrase ? ' with passphrase' : '';
	showInfo(`Generating ${keyType} key${passphraseMsg}...`);
	try {
		const rsaBitsStr = rsaBits || '2048';
		await generateSSHKey(keyType, rsaBitsStr, privateKeyPath, passphrase);
		showInfo('SSH key pair generated successfully!');
	} catch (error: any) {
		showError(`Error generating SSH key: ${error.message || error}`);
		return null;
	}

	return { privateKeyPath, publicKeyPath, privateKeyFile, publicKeyFile };
}

async function updateSftpConfiguration(vscodeDir: string, host: string, username: string, remotePath: string, privateKeyFile: string, passphraseOption?: 'plaintext' | 'prompt' | 'remove', passphrase?: string, existingConfig?: SftpConfig, configIndex: number = 0): Promise<void> {
	const sftpConfigPath = path.join(vscodeDir, 'sftp.json');

	try {
		const { configs, isArray } = readSftpConfig(sftpConfigPath);
		const updatedConfig = updateSftpConfig(existingConfig || {}, host, username, remotePath, privateKeyFile, passphraseOption, passphrase);

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

		showInfo('.vscode/sftp.json updated successfully!');
	} catch (error: any) {
		showError(`Failed to write sftp.json: ${error.message || error}`);
		throw error;
	}
}

async function offerClipboardCopy(publicKeyPath: string): Promise<void> {
	const shouldCopyToClipboard = await askToCopyToClipboard();

	if (shouldCopyToClipboard === true) {
		try {
			const pubKey = fs.readFileSync(publicKeyPath, 'utf-8');
			await vscode.env.clipboard.writeText(pubKey);
			showInfo('Public key copied to clipboard!');
		} catch (error: any) {
			showError(`Failed to copy to clipboard: ${error.message || error}`);
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
	// Create output channel for logging
	const outputChannel = vscode.window.createOutputChannel('SSH Key Generator');

	// Helper function to log messages
	function logInternal(message: string) {
		const timestamp = new Date().toISOString();
		outputChannel.appendLine(`[${timestamp}] ${message}`);
	}

	// Set global logging functions
	log = logInternal;
	showInfo = showInfoInternal;
	showWarning = showWarningInternal;
	showError = showErrorInternal;

	// Helper functions to log and show messages simultaneously
	function showInfoInternal(message: string, ...items: string[]) {
		log(`INFO: ${message}`);
		return vscode.window.showInformationMessage(message, ...items);
	}

	function showWarningInternal(message: string, ...items: string[]) {
		log(`WARNING: ${message}`);
		return vscode.window.showWarningMessage(message, ...items);
	}

	function showErrorInternal(message: string, ...items: string[]) {
		log(`ERROR: ${message}`);
		return vscode.window.showErrorMessage(message, ...items);
	}

	// Command 1: Generate SSH Key Pair & Update SFTP Config (original functionality)
	const generateKeyAndConfigCommand = vscode.commands.registerCommand('extension.generateSshKeyAndConfig', async () => {
		const workspace = await ensureWorkspaceAndSSHKeygen();
		if (!workspace) {
			return;
		}

		// 1️⃣ Ask for key type
		const keySelection = await selectKeyType();
		if (!keySelection) {
			showInfo('Operation cancelled.');
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
					showInfo('Operation cancelled.');
					return;
				}

				sftpConfig = configs[configIndex];
				const configName = sftpConfig.name || `Configuration ${configIndex + 1}`;
				showInfo(`Using "${configName}" configuration. Reusing values where available.`);
			}
		} catch (error) {
			showWarning('Invalid sftp.json detected. Will recreate.');
			sftpConfig = {};
		}

		// 3️⃣ Prompt for required fields
		const hostResult = await promptForHost(sftpConfig.host);
		if (!hostResult) {
			showError('Host is required.');
			return;
		}
		host = hostResult;

		const usernameResult = await promptForUsername(sftpConfig.username);
		if (!usernameResult) {
			showError('Username is required.');
			return;
		}
		username = usernameResult;

		// 4️⃣ Prompt for passphrase
		const passphrase = await promptForPassphrase();
		if (passphrase === null) {
			showInfo('Operation cancelled.');
			return;
		}

		// 5️⃣ If passphrase is provided, ask how to store it
		let passphraseOption: 'plaintext' | 'prompt' | 'remove' | undefined;
		if (passphrase && passphrase.trim() !== '') {
			const storageChoice = await promptForPassphraseStorage();
			if (storageChoice === null) {
				showInfo('Operation cancelled.');
				return;
			}
			passphraseOption = storageChoice;
		} else {
			// No passphrase - explicitly remove any existing passphrase from config
			passphraseOption = 'remove';
		}

		// 6️⃣ Prompt for remote path
		remotePath = await promptForRemotePath(sftpConfig.remotePath);

		// 7️⃣ Generate SSH keys (force regeneration for this command)
		const keyResult = await generateSSHKeyPair(workspace.vscodeDir, keyType, rsaBits, host, username, passphrase, true);
		if (!keyResult) {
			return;
		}

		// 8️⃣ Update sftp.json
		try {
			await updateSftpConfiguration(workspace.vscodeDir, host, username, remotePath, keyResult.privateKeyFile, passphraseOption, passphrase, sftpConfig, configIndex);
		} catch (error) {
			return; // Error already shown in updateSftpConfiguration
		}

		// 9️⃣ Ask if they want to copy public key to clipboard
		await offerClipboardCopy(keyResult.publicKeyPath);

		// 🔟 Final message
		showInfo(`✅ All done! Your SSH keys are saved in .vscode/${keyResult.privateKeyFile} (private) and .vscode/${keyResult.publicKeyFile} (public).`);
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
			showInfo('Operation cancelled.');
			return;
		}
		const { keyType, rsaBits } = keySelection;

		// 2️⃣ Ask for hostname for naming
		const host = await promptForHostnameOnly();
		if (!host) {
			showError('Hostname is required for key naming.');
			return;
		}

		// 3️⃣ Ask for username (required for new naming format)
		const username = await vscode.window.showInputBox({
			prompt: 'Enter username for key naming',
			placeHolder: 'e.g., root, admin, username',
			ignoreFocusOut: true
		});

		if (!username) {
			showError('Username is required for key naming.');
			return;
		}

		// 4️⃣ Prompt for passphrase
		const passphrase = await promptForPassphrase();
		if (passphrase === null) {
			showInfo('Operation cancelled.');
			return;
		}

		// 5️⃣ Generate SSH keys (force regeneration for key-only command)
		const keyResult = await generateSSHKeyPair(workspace.vscodeDir, keyType, rsaBits, host, username, passphrase, true);
		if (!keyResult) {
			return;
		}

		// 6️⃣ Ask if they want to copy public key to clipboard
		await offerClipboardCopy(keyResult.publicKeyPath);

		// 7️⃣ Final message
		showInfo(`✅ SSH key pair generated! Keys saved as .vscode/${keyResult.privateKeyFile} (private) and .vscode/${keyResult.publicKeyFile} (public).`);
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
			showError('No SSH key pairs found in .vscode folder. Please generate keys first or use the "Generate SSH Key Pair & Update SFTP Config" command.');
			return;
		}

		// 2️⃣ Auto-select if only one key pair, otherwise let user choose
		let selectedKey;

		if (discoveredKeys.length === 1) {
			// Auto-select the only key pair found
			selectedKey = { keyData: discoveredKeys[0] };
			showInfo(`Using SSH key: ${discoveredKeys[0].privateKeyFile} ${discoveredKeys[0].isValid ? '✅' : '❌'}`);
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
				showInfo('Operation cancelled.');
				return;
			}
		}

		const keyData = selectedKey.keyData;

		// 3️⃣ If key is invalid, try to validate with passphrase prompts
		let validationPassphrase = '';
		if (!keyData.isValid) {
			const privateKeyPath = path.join(workspace.vscodeDir, keyData.privateKeyFile);
			const publicKeyPath = path.join(workspace.vscodeDir, keyData.publicKeyFile);

			// Try up to 3 times to get the correct passphrase
			let attempts = 0;
			let isValidWithPassphrase = false;

			while (attempts < 3 && !isValidWithPassphrase) {
				attempts++;
				const passphraseAttempt = await vscode.window.showInputBox({
					prompt: `Enter passphrase to validate SSH Key (attempt ${attempts}/3):`,
					placeHolder: 'Enter passphrase (leave empty if no passphrase)',
					password: true,
					ignoreFocusOut: true
				});

				if (passphraseAttempt === undefined) {
					showInfo('Operation cancelled.');
					return;
				}

				// Validate with this passphrase
				const validation = await validateSSHKeyPair(privateKeyPath, publicKeyPath, passphraseAttempt);
				if (validation.isValid) {
					isValidWithPassphrase = true;
					validationPassphrase = passphraseAttempt;
					showInfo('SSH key validated successfully with passphrase!');
					// Update the keyData to reflect it's now valid
					keyData.isValid = true;
					break;
				} else {
					if (attempts < 3) {
						showWarning(`Incorrect passphrase. Please try again. (${validation.error || 'validation failed'})`);
					}
				}
			}

			// If we couldn't validate after 3 attempts, offer to continue anyway
			if (!isValidWithPassphrase) {
				const action = await showWarning(`Could not validate SSH key after 3 attempts. The key may be corrupted or the passphrase is incorrect. Continue anyway?`, 'Continue Anyway', 'Cancel');

				if (action !== 'Continue Anyway') {
					showInfo('Operation cancelled.');
					return;
				}
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
					showInfo('Operation cancelled.');
					return;
				}

				sftpConfig = configs[configIndex];
				const configName = sftpConfig.name || `Configuration ${configIndex + 1}`;
				showInfo(`Updating "${configName}" configuration with auto-discovered values.`);
			}
		} catch (error) {
			showWarning('Invalid sftp.json detected. Will recreate.');
			sftpConfig = {};
		}

		// 5️⃣ Use discovered hostname, prompt for missing username/remotePath
		const host = keyData.hostname;

		// Use discovered username or prompt if not available
		let username = keyData.username;
		if (!username) {
			const usernameResult = await promptForUsername(sftpConfig.username);
			if (!usernameResult) {
				showError('Username is required.');
				return;
			}
			username = usernameResult;
		} else {
			showInfo(`Using username from key filename: ${username}`);
		}

		const remotePath = await promptForRemotePath(sftpConfig.remotePath);

		// 6️⃣ Handle passphrase for SFTP config
		let passphraseOption: 'plaintext' | 'prompt' | 'remove' | undefined;
		let passphraseValue: string | undefined;

		// If we validated with a passphrase, use it and ask how to store it
		if (validationPassphrase) {
			const passphraseChoice = await vscode.window.showQuickPick(
				[
					{ label: 'Store passphrase in config (plaintext)', description: 'Passphrase will be stored in plaintext in the config file', value: 'store' },
					{ label: 'Prompt for passphrase when connecting', description: 'More secure but requires entering passphrase each time', value: 'prompt' }
				],
				{
					placeHolder: 'How would you like to handle the passphrase?',
					ignoreFocusOut: true
				}
			);

			if (!passphraseChoice) {
				showInfo('Operation cancelled.');
				return;
			}

			if (passphraseChoice.value === 'store') {
				passphraseValue = validationPassphrase;
				passphraseOption = 'plaintext';
			} else {
				passphraseOption = 'prompt';
			}
		} else {
			// Key is already valid - we need to check if it actually has a passphrase
			const privateKeyPath = path.join(workspace.vscodeDir, keyData.privateKeyFile);
			const publicKeyPath = path.join(workspace.vscodeDir, keyData.publicKeyFile);

			// First check if the key can be validated without a passphrase
			const validationWithoutPassphrase = await validateSSHKeyPair(privateKeyPath, publicKeyPath, '');

			if (validationWithoutPassphrase.isValid) {
				// Key doesn't need a passphrase - remove any existing passphrase from config
				passphraseOption = 'remove';
				passphraseValue = undefined;
			} else {
				// Key needs a passphrase - try to find it from existing config or ask user
				// Try to find passphrase in existing SFTP config
				let foundPassphrase = '';
				const sftpConfigPath = path.join(workspace.vscodeDir, 'sftp.json');

				try {
					const { configs } = readSftpConfig(sftpConfigPath);
					for (const config of configs) {
						if (config.privateKeyPath && config.privateKeyPath.includes(keyData.privateKeyFile)) {
							if (typeof config.passphrase === 'string' && config.passphrase.trim() !== '') {
								foundPassphrase = config.passphrase;
								break;
							}
						}
					}
				} catch (error) {
					// Silent
				}

				if (foundPassphrase) {
					// We have a stored passphrase - ask how to store it
					const passphraseChoice = await vscode.window.showQuickPick(
						[
							{ label: 'Store passphrase in config (plaintext)', description: 'Passphrase will be stored in plaintext in the config file', value: 'store' },
							{ label: 'Prompt for passphrase when connecting', description: 'More secure but requires entering passphrase each time', value: 'prompt' }
						],
						{
							placeHolder: 'This key has a passphrase. How would you like to handle it?',
							ignoreFocusOut: true
						}
					);

					if (!passphraseChoice) {
						showInfo('Operation cancelled.');
						return;
					}

					if (passphraseChoice.value === 'store') {
						passphraseValue = foundPassphrase;
						passphraseOption = 'plaintext';
					} else {
						passphraseOption = 'prompt';
					}
				} else {
					// Key needs passphrase but we don't have it stored - prompt for it
					const enteredPassphrase = await vscode.window.showInputBox({
						prompt: 'This key requires a passphrase. Enter the passphrase:',
						placeHolder: 'Enter passphrase',
						password: true,
						ignoreFocusOut: true
					});

					if (enteredPassphrase === undefined) {
						showInfo('Operation cancelled.');
						return;
					}

					// Verify the passphrase works
					const validation = await validateSSHKeyPair(privateKeyPath, publicKeyPath, enteredPassphrase);
					if (!validation.isValid) {
						showError('Incorrect passphrase provided.');
						return;
					}

					// Ask how to store it
					const passphraseChoice = await vscode.window.showQuickPick(
						[
							{ label: 'Store passphrase in config (plaintext)', description: 'Passphrase will be stored in plaintext in the config file', value: 'store' },
							{ label: 'Prompt for passphrase when connecting', description: 'More secure but requires entering passphrase each time', value: 'prompt' }
						],
						{
							placeHolder: 'How would you like to handle the passphrase?',
							ignoreFocusOut: true
						}
					);

					if (!passphraseChoice) {
						showInfo('Operation cancelled.');
						return;
					}

					if (passphraseChoice.value === 'store') {
						passphraseValue = enteredPassphrase;
						passphraseOption = 'plaintext';
					} else {
						passphraseOption = 'prompt';
					}
				}
			}
		}

		// 7️⃣ Update sftp.json
		try {
			await updateSftpConfiguration(workspace.vscodeDir, host, username, remotePath, keyData.privateKeyFile, passphraseOption, passphraseValue, sftpConfig, configIndex);
			showInfo(`✅ SFTP configuration updated successfully using ${keyData.privateKeyFile}!`);
		} catch (error) {
			// Error already shown in updateSftpConfiguration
		}
	});

	// Command 4: Add/Update Passphrase
	const changePassphraseCommand = vscode.commands.registerCommand('extension.changePassphrase', async () => {
		try {
			log('Passphrase change operation started');

			// Check if workspace is open
			const wsFolders = vscode.workspace.workspaceFolders;
			if (!wsFolders) {
				showError('Please open a workspace first.');
				return;
			}

			// Check if ssh-keygen is available
			const sshKeygenAvailable = await checkSSHKeygenAvailability();
			if (!sshKeygenAvailable) {
				showError('ssh-keygen is not available.');
				return;
			}

			const root = wsFolders[0].uri.fsPath;
			const vscodeDir = path.join(root, '.vscode');

			if (!fs.existsSync(vscodeDir)) {
				try {
					fs.mkdirSync(vscodeDir);
				} catch (error: any) {
					showError(`Failed to create .vscode directory: ${error.message}`);
					return;
				}
			}

			const workspace = { root, vscodeDir };

			// 1️⃣ Discover existing SSH keys in .vscode folder
			const discoveredKeys = await discoverSSHKeys(workspace.vscodeDir, log);

			if (discoveredKeys.length === 0) {
				showError('No SSH keys found in .vscode folder. Generate keys first using one of the other commands.');
				return;
			}

			// 2️⃣ Show key selection UI
			let selectedKey: any;

			if (discoveredKeys.length === 1) {
				const keyData = discoveredKeys[0];
				selectedKey = { keyData };
				showInfo(`Using SSH key: ${keyData.privateKeyFile} ${keyData.isValid ? '✅' : '❌'}`);
			} else {
				const keyOptions = discoveredKeys.map((keyData) => ({
					label: `${keyData.privateKeyFile}`,
					description: `${keyData.hostname}@${keyData.username} (${keyData.keyType}) ${keyData.isValid ? '✅' : '❌'}`,
					keyData
				}));

				selectedKey = await vscode.window.showQuickPick(keyOptions, {
					placeHolder: 'Select an SSH key to change passphrase for',
					ignoreFocusOut: true
				});

				if (!selectedKey) {
					showInfo('Operation cancelled.');
					return;
				}
			}

			const keyData = selectedKey.keyData;
			const privateKeyPath = path.join(workspace.vscodeDir, keyData.privateKeyFile);
			const publicKeyPath = path.join(workspace.vscodeDir, keyData.publicKeyFile);

			log(`Selected SSH key: ${keyData.privateKeyFile}`);

			// 3️⃣ If key is invalid, try to validate with passphrase prompts
			let validationPassphrase = '';
			if (!keyData.isValid) {
				// Try up to 3 times to get the correct passphrase
				let attempts = 0;
				let isValidWithPassphrase = false;

				while (attempts < 3 && !isValidWithPassphrase) {
					attempts++;
					const passphraseAttempt = await vscode.window.showInputBox({
						prompt: `Enter current passphrase to validate (attempt ${attempts}/3):`,
						placeHolder: 'Enter current passphrase (leave empty if no passphrase)',
						password: true,
						ignoreFocusOut: true
					});

					if (passphraseAttempt === undefined) {
						showInfo('Operation cancelled.');
						return;
					}

					// Validate with this passphrase
					const validation = await validateSSHKeyPair(privateKeyPath, publicKeyPath, passphraseAttempt);
					if (validation.isValid) {
						isValidWithPassphrase = true;
						validationPassphrase = passphraseAttempt;
						showInfo('SSH key validated successfully with passphrase!');
						// Update the keyData to reflect it's now valid
						keyData.isValid = true;
						break;
					} else {
						if (attempts < 3) {
							showWarning(`Incorrect passphrase. Please try again. (${validation.error || 'validation failed'})`);
						}
					}
				}

				// If we couldn't validate after 3 attempts, offer to continue anyway
				if (!isValidWithPassphrase) {
					const action = await showWarning(`Could not validate SSH key after 3 attempts. The key may be corrupted or the passphrase is incorrect. Continue anyway?`, 'Continue Anyway', 'Cancel');

					if (action !== 'Continue Anyway') {
						showInfo('Operation cancelled.');
						return;
					}
				}
			}

			// 4️⃣ Check if key currently has a passphrase
			const hasPassphrase = await checkSSHKeyHasPassphrase(privateKeyPath);
			let currentPassphrase = '';

			// If we already validated with a passphrase, use that
			if (validationPassphrase) {
				currentPassphrase = validationPassphrase;
				//showInfo('Using passphrase from validation step.');
			} else if (hasPassphrase) {
				// 5️⃣ If key has passphrase, try to get it from SFTP config first, then prompt
				// Try to find passphrase in existing SFTP config
				const sftpConfigPath = path.join(workspace.vscodeDir, 'sftp.json');
				let foundStoredPassphrase = false;

				try {
					const { configs } = readSftpConfig(sftpConfigPath);

					// Look for a config that uses this private key file and has passphrase info
					for (const config of configs) {
						if (config.privateKeyPath && config.privateKeyPath.includes(keyData.privateKeyFile)) {
							if (typeof config.passphrase === 'string' && config.passphrase.trim() !== '') {
								currentPassphrase = config.passphrase;
								foundStoredPassphrase = true;

								// Verify the stored passphrase is correct
								const isValid = await verifySSHKeyPassphrase(privateKeyPath, currentPassphrase);
								if (isValid) {
									showInfo('Using passphrase from SFTP configuration.');
									log('Using stored passphrase from SFTP configuration');
									break;
								} else {
									foundStoredPassphrase = false;
									currentPassphrase = '';
								}
							} else if (config.passphrase === true) {
								showInfo('SFTP configuration shows this key has a passphrase (prompt on connect).');
								// We still need to prompt for the current passphrase since we can't get it from config
								break;
							}
						}
					}
				} catch (error: any) {
					// Silent - not important for user to know
				}

				// If no valid stored passphrase found, prompt user
				if (!foundStoredPassphrase) {
					showInfo('This SSH key currently has a passphrase.');
					const currentPassphraseInput = await promptForCurrentPassphrase();
					if (currentPassphraseInput === null) {
						showInfo('Operation cancelled.');
						return;
					}
					currentPassphrase = currentPassphraseInput;

					// Verify current passphrase
					const isValid = await verifySSHKeyPassphrase(privateKeyPath, currentPassphrase);
					if (!isValid) {
						showError('Current passphrase is incorrect.');
						return;
					}
				}
			} else {
				showInfo('This SSH key currently has no passphrase.');
			}

			// 6️⃣ Ask for new passphrase
			const newPassphrase = await promptForNewPassphrase();
			if (newPassphrase === null) {
				showInfo('Operation cancelled.');
				return;
			}

			// 7️⃣ Change the passphrase
			try {
				await changeSSHKeyPassphrase(privateKeyPath, currentPassphrase, newPassphrase);

				// 8️⃣ Update SFTP config if it exists and uses this key
				const sftpConfigPath = path.join(workspace.vscodeDir, 'sftp.json');
				try {
					const { configs, isArray } = readSftpConfig(sftpConfigPath);
					let configUpdated = false;

					for (let i = 0; i < configs.length; i++) {
						const config = configs[i];
						if (config.privateKeyPath && config.privateKeyPath.includes(keyData.privateKeyFile)) {
							if (newPassphrase.trim() === '') {
								// Passphrase removed - remove from SFTP config
								const updatedConfig = updateSftpConfig(config, config.host!, config.username!, config.remotePath!, keyData.privateKeyFile, 'remove', undefined);
								writeSftpConfig(sftpConfigPath, configs, isArray, i, updatedConfig);
								configUpdated = true;
								log('Removed passphrase from SFTP configuration');
							} else {
								// Passphrase changed - ask user how to store it
								const storageChoice = await vscode.window.showQuickPick(
									[
										{ label: 'Store as plaintext', value: 'plaintext' },
										{ label: 'Prompt on connect', value: 'prompt' } //,
										//{ label: 'Do not update SFTP config', value: 'skip' }
									],
									{
										placeHolder: 'How should the new passphrase be stored in SFTP configuration?',
										ignoreFocusOut: true
									}
								);

								if (storageChoice && storageChoice.value !== 'skip') {
									const passphraseToStore = storageChoice.value === 'plaintext' ? newPassphrase : undefined;
									const updatedConfig = updateSftpConfig(config, config.host!, config.username!, config.remotePath!, keyData.privateKeyFile, storageChoice.value as 'plaintext' | 'prompt' | 'remove', passphraseToStore);
									writeSftpConfig(sftpConfigPath, configs, isArray, i, updatedConfig);
									configUpdated = true;
									log(`Updated SFTP configuration with ${storageChoice.value} passphrase option`);
								}
							}
							break;
						}
					}

					if (configUpdated) {
						// Try to trigger SFTP extension to reload configuration
						await triggerSftpReload(sftpConfigPath);
					}
				} catch (sftpError: any) {
					// Don't fail the whole operation if SFTP config update fails
				}

				if (newPassphrase.trim() === '') {
					showInfo('✅ Passphrase removed successfully from SSH key!');
					log('Successfully removed passphrase from SSH key');
				} else {
					showInfo('✅ Passphrase updated successfully for SSH key!');
					log('Successfully updated SSH key passphrase');
				}
			} catch (error: any) {
				showError(`Error changing passphrase: ${error.message || error}`);
				log(`Failed to change passphrase: ${error.message || error}`);
			}
		} catch (commandError: any) {
			showError(`Command error: ${commandError.message || commandError}`);
			log(`Command error: ${commandError.message || commandError}`);
		}
	});

	context.subscriptions.push(generateKeyAndConfigCommand, generateKeyOnlyCommand, updateConfigOnlyCommand, changePassphraseCommand);
}

export function deactivate() {}
