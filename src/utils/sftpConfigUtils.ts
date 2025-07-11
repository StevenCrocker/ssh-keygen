import * as fs from 'fs';

export interface SftpConfig {
	name?: string;
	host?: string;
	username?: string;
	remotePath?: string;
	privateKeyPath?: string;
	passphrase?: string | boolean;
	protocol?: string;
	port?: number;
	uploadOnSave?: boolean;
	ignore?: string[];
	[key: string]: any; // Allow other properties
}

export function readSftpConfig(sftpConfigPath: string): { configs: SftpConfig[]; isArray: boolean } {
	if (!fs.existsSync(sftpConfigPath)) {
		return { configs: [], isArray: true };
	}

	try {
		const fileContent = fs.readFileSync(sftpConfigPath, 'utf-8').trim();

		// Handle empty or whitespace-only files
		if (!fileContent) {
			return { configs: [], isArray: true };
		}

		const parsedConfig = JSON.parse(fileContent);

		if (Array.isArray(parsedConfig)) {
			return { configs: parsedConfig, isArray: true };
		} else {
			return { configs: [parsedConfig], isArray: false };
		}
	} catch (error) {
		// If JSON parsing fails, treat it like a missing file and start fresh
		return { configs: [], isArray: true };
	}
}

export function createDefaultSftpConfig(host: string, username: string, remotePath: string, privateKeyFile: string, passphraseOption?: 'plaintext' | 'prompt' | 'remove', passphrase?: string): SftpConfig {
	const config: SftpConfig = {
		name: host,
		host: host,
		username: username,
		remotePath: remotePath,
		privateKeyPath: `./.vscode/${privateKeyFile}`,
		protocol: 'sftp',
		port: 22,
		uploadOnSave: false,
		ignore: ['**/.vscode', '**/.cache', '**/.git', '**/.gitignore', '**/.env*', '**/.DS_Store', '**/*.md', '**/node_modules', '**/package-lock.json', '**/package.json', '**/yarn.lock', '**/webpack.config.js', '**/webpack.entry.js', '**/.babelrc', '**/tsconfig.json', '**/.eslintrc*', '**/.prettierrc*']
	};

	// Handle passphrase based on storage option
	if (passphraseOption === 'plaintext' && passphrase && passphrase.trim() !== '') {
		config.passphrase = passphrase;
	} else if (passphraseOption === 'prompt') {
		config.passphrase = true; // Set to true to prompt for passphrase
	}
	// For 'remove' option, we simply don't set the passphrase property (same as default behavior)

	return config;
}

export function updateSftpConfig(config: SftpConfig, host: string, username: string, remotePath: string, privateKeyFile: string, passphraseOption?: 'plaintext' | 'prompt' | 'remove', passphrase?: string): SftpConfig {
	// Create a new config object to avoid mutating the original
	const newConfig: SftpConfig = { ...config };

	// Set the name if it doesn't exist (use host as default)
	if (!newConfig.name) {
		newConfig.name = host;
	}

	newConfig.host = host;
	newConfig.username = username;
	newConfig.remotePath = remotePath;
	newConfig.privateKeyPath = `./.vscode/${privateKeyFile}`;
	newConfig.protocol = 'sftp';
	newConfig.port = 22;

	// Handle passphrase based on storage option
	if (passphraseOption === 'plaintext' && passphrase && passphrase.trim() !== '') {
		newConfig.passphrase = passphrase;
	} else if (passphraseOption === 'prompt') {
		newConfig.passphrase = true; // Set to true to prompt for passphrase
	} else if (passphraseOption === 'remove') {
		// Explicit signal to remove passphrase
		delete newConfig.passphrase;
	} else if (passphraseOption === 'plaintext' && (!passphrase || passphrase.trim() === '')) {
		// If plaintext option with empty passphrase, remove the field
		delete newConfig.passphrase;
	} else if (passphraseOption === undefined && passphrase === '') {
		// If no passphrase option specified and passphrase is empty, remove it
		delete newConfig.passphrase;
	}
	// If passphraseOption is undefined, preserve existing passphrase setting

	// Set uploadOnSave to false if it doesn't exist
	if (newConfig.uploadOnSave === undefined) {
		newConfig.uploadOnSave = false;
	}

	// Add ignore patterns if they don't exist
	if (!newConfig.ignore) {
		newConfig.ignore = ['**/.vscode', '**/.cache', '**/.git', '**/.gitignore', '**/.env*', '**/.DS_Store', '**/*.md', '**/node_modules', '**/package-lock.json', '**/package.json', '**/yarn.lock', '**/webpack.config.js', '**/webpack.entry.js', '**/.babelrc', '**/tsconfig.json', '**/.eslintrc*', '**/.prettierrc*'];
	}

	return newConfig;
}

export function writeSftpConfig(sftpConfigPath: string, configs: SftpConfig[], isArray: boolean, configIndex: number, updatedConfig: SftpConfig): void {
	let finalConfig: any;

	if (isArray) {
		if (configs.length > 0) {
			// Simply replace the config at the specified index
			configs[configIndex] = updatedConfig;
		} else {
			configs.push(updatedConfig);
		}
		finalConfig = configs;
	} else {
		finalConfig = updatedConfig;
	}

	fs.writeFileSync(sftpConfigPath, JSON.stringify(finalConfig, null, 2));
}
