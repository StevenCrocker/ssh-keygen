import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { readSftpConfig, SftpConfig, updateSftpConfig, writeSftpConfig } from './utils/sftpConfigUtils';
import { checkSSHKeygenAvailability, generateSSHKey, getSSHKeygenInstallInstructions, validateSSHKeyPair } from './utils/sshUtils';
import { askToCopyToClipboard, askToUpdateSftpJson, promptForHost, promptForHostnameOnly, promptForRemotePath, promptForUsername, selectConfiguration, selectKeyType } from './utils/userPrompts';

export function activate(context: vscode.ExtensionContext) {
	const disposable = vscode.commands.registerCommand('extension.generateSshKeyAndConfig', async () => {
		const wsFolders = vscode.workspace.workspaceFolders;
		if (!wsFolders) {
			vscode.window.showErrorMessage('Please open a workspace first.');
			return;
		}

		// Check if ssh-keygen is available
		const sshKeygenAvailable = await checkSSHKeygenAvailability();
		if (!sshKeygenAvailable) {
			const installInstructions = getSSHKeygenInstallInstructions();
			const action = await vscode.window.showErrorMessage('ssh-keygen is not installed or not found in PATH. This tool is required to generate SSH keys.', 'Show Installation Instructions');

			if (action === 'Show Installation Instructions') {
				vscode.window.showInformationMessage(installInstructions, { modal: true });
			}
			return;
		}

		const root = wsFolders[0].uri.fsPath;
		const vscodeDir = path.join(root, '.vscode');
		if (!fs.existsSync(vscodeDir)) {
			fs.mkdirSync(vscodeDir);
		}

		// 1️⃣ Ask for key type (with RSA size options)
		const keySelection = await selectKeyType();
		if (!keySelection) {
			vscode.window.showInformationMessage('Operation cancelled.');
			return;
		}
		const { keyType, rsaBits } = keySelection;

		// 2️⃣ Ask if they want to create/update sftp.json
		const shouldUpdateSftp = await askToUpdateSftpJson();
		if (shouldUpdateSftp === null) {
			vscode.window.showInformationMessage('Operation cancelled.');
			return;
		}

		const sftpConfigPath = path.join(vscodeDir, 'sftp.json');
		let sftpConfig: SftpConfig = {};
		let configIndex = 0;
		let host = '';
		let username = '';
		let remotePath = '';

		if (shouldUpdateSftp) {
			// 3️⃣ Handle existing sftp.json
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

			// 4️⃣ Prompt for missing required fields
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
		} else {
			// Ask for hostname anyway, for naming
			const hostResult = await promptForHostnameOnly();
			if (!hostResult) {
				vscode.window.showErrorMessage('Hostname is required.');
				return;
			}
			host = hostResult;
		}

		// 5️⃣ Build file paths with naming
		const safeHost = host.replace(/[^\w.-]/g, '_');
		const privateKeyFile = `${safeHost}-${keyType}`;
		const publicKeyFile = `${safeHost}-${keyType}.pub`;

		const privateKeyPath = path.join(vscodeDir, privateKeyFile);
		const publicKeyPath = path.join(vscodeDir, publicKeyFile);

		// 6️⃣ Generate the key (only if it doesn't exist or is invalid)
		const validation = await validateSSHKeyPair(privateKeyPath, publicKeyPath);

		if (validation.isValid) {
			vscode.window.showInformationMessage(`Valid matching SSH key pair found: ${privateKeyFile} and ${publicKeyFile}. Skipping key generation.`);
		} else {
			if (validation.error) {
				vscode.window.showWarningMessage(`SSH key validation failed: ${validation.error}. Regenerating keys...`);
			}

			vscode.window.showInformationMessage(`Generating ${keyType} key...`);
			try {
				await generateSSHKey(keyType, rsaBits, privateKeyPath);
				vscode.window.showInformationMessage('SSH key pair generated successfully!');
			} catch (error: any) {
				vscode.window.showErrorMessage(`Error generating SSH key: ${error.message || error}`);
				return;
			}
		}

		// 7️⃣ Update sftp.json if needed
		if (shouldUpdateSftp) {
			try {
				const { configs, isArray } = readSftpConfig(sftpConfigPath);
				const updatedConfig = updateSftpConfig(sftpConfig, host, username, remotePath, privateKeyFile);

				writeSftpConfig(sftpConfigPath, configs, isArray, configIndex, updatedConfig);
				vscode.window.showInformationMessage('.vscode/sftp.json updated successfully!');
			} catch (error: any) {
				vscode.window.showErrorMessage(`Failed to write sftp.json: ${error.message || error}`);
			}
		}

		// 8️⃣ Ask if they want to copy public key to clipboard
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

		// 9️⃣ Final message
		vscode.window.showInformationMessage(`✅ All done! Your SSH keys are saved in .vscode/${privateKeyFile} (private) and .vscode/${publicKeyFile} (public).`);
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {}
