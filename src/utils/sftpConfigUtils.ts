import * as fs from 'fs';

export interface SftpConfig {
	name?: string;
	host?: string;
	username?: string;
	remotePath?: string;
	privateKeyPath?: string;
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

export function createDefaultSftpConfig(host: string, username: string, remotePath: string, privateKeyFile: string): SftpConfig {
	return {
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
}

export function updateSftpConfig(config: SftpConfig, host: string, username: string, remotePath: string, privateKeyFile: string): SftpConfig {
	// Set the name if it doesn't exist (use host as default)
	if (!config.name) {
		config.name = host;
	}

	config.host = host;
	config.username = username;
	config.remotePath = remotePath;
	config.privateKeyPath = `./.vscode/${privateKeyFile}`;
	config.protocol = 'sftp';
	config.port = 22;

	// Set uploadOnSave to false if it doesn't exist
	if (config.uploadOnSave === undefined) {
		config.uploadOnSave = false;
	}

	// Add ignore patterns if they don't exist
	if (!config.ignore) {
		config.ignore = ['**/.vscode', '**/.cache', '**/.git', '**/.gitignore', '**/.env*', '**/.DS_Store', '**/*.md', '**/node_modules', '**/package-lock.json', '**/package.json', '**/yarn.lock', '**/webpack.config.js', '**/webpack.entry.js', '**/.babelrc', '**/tsconfig.json', '**/.eslintrc*', '**/.prettierrc*'];
	}

	return config;
}

export function writeSftpConfig(sftpConfigPath: string, configs: SftpConfig[], isArray: boolean, configIndex: number, updatedConfig: SftpConfig): void {
	let finalConfig: any;

	if (isArray) {
		if (configs.length > 0) {
			configs[configIndex] = { ...configs[configIndex], ...updatedConfig };
		} else {
			configs.push(updatedConfig);
		}
		finalConfig = configs;
	} else {
		finalConfig = updatedConfig;
	}

	fs.writeFileSync(sftpConfigPath, JSON.stringify(finalConfig, null, 2));
}
