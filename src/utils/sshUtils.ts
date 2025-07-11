import { exec } from 'child_process';
import * as fs from 'fs';

export function getSSHKeygenInstallInstructions(): string {
	const platform = process.platform;

	switch (platform) {
		case 'win32':
			return `🪟 Windows Installation:
			
ssh-keygen is included with Windows 10/11 by default, but may need to be enabled:

1. Open Settings → Apps → Optional Features
2. Search for "OpenSSH Client" and install it
3. Or install Git for Windows (includes ssh-keygen): https://git-scm.com/download/win
4. Alternative: Install via Chocolatey: choco install openssh

After installation, restart VS Code and try again.`;

		case 'darwin':
			return `🍎 macOS Installation:
			
ssh-keygen should be pre-installed on macOS. If missing:

1. Install Xcode Command Line Tools:
   xcode-select --install

2. Or install via Homebrew:
   brew install openssh

3. Make sure /usr/bin is in your PATH

After installation, restart VS Code and try again.`;

		case 'linux':
			return `🐧 Linux Installation:

Install OpenSSH client using your package manager:

Ubuntu/Debian:    sudo apt install openssh-client
CentOS/RHEL:      sudo yum install openssh-clients
Fedora:           sudo dnf install openssh-clients
Arch:             sudo pacman -S openssh
openSUSE:         sudo zypper install openssh-clients

After installation, restart VS Code and try again.`;

		default:
			return `❓ Your platform (${platform}) is not specifically supported, but you can:

1. Install OpenSSH client package for your system
2. Ensure ssh-keygen is available in your PATH
3. Restart VS Code and try again

For help, visit: https://www.openssh.com/portable.html`;
	}
}

export async function checkSSHKeygenAvailability(): Promise<boolean> {
	try {
		await new Promise<void>((resolve, reject) => {
			// Use -V (version) instead of --help as it's more universally supported
			exec('ssh-keygen -V', (error, stdout, stderr) => {
				// On Windows, ssh-keygen might return version info in stderr instead of stdout
				// Also, some versions return exit code 1 even when working correctly
				if (stdout.includes('OpenSSH') || stderr.includes('OpenSSH') || stderr.includes('ssh-keygen')) {
					resolve();
				} else if (error && (error as any).code === 'ENOENT') {
					// Command not found
					reject(error);
				} else {
					// Command exists but might have returned non-zero exit code
					// This is common on Windows - ssh-keygen -V often returns exit code 1
					resolve();
				}
			});
		});
		return true;
	} catch (error) {
		return false;
	}
}

export async function validateSSHKeyPair(privateKeyPath: string, publicKeyPath: string, passphrase: string = ''): Promise<{ isValid: boolean; error?: string }> {
	try {
		// Check if files exist
		if (!fs.existsSync(privateKeyPath) || !fs.existsSync(publicKeyPath)) {
			return { isValid: false, error: 'Key files do not exist' };
		}

		// Read key contents
		const privateKeyContent = fs.readFileSync(privateKeyPath, 'utf-8');
		const publicKeyContent = fs.readFileSync(publicKeyPath, 'utf-8');

		// Basic validation checks
		const isValidPrivateKey = privateKeyContent.includes('-----BEGIN') && (privateKeyContent.includes('PRIVATE KEY-----') || privateKeyContent.includes('OPENSSH PRIVATE KEY-----'));

		const isValidPublicKey = publicKeyContent.trim().startsWith('ssh-') && (publicKeyContent.includes('ssh-ed25519') || publicKeyContent.includes('ssh-rsa'));

		if (!isValidPrivateKey || !isValidPublicKey) {
			return { isValid: false, error: 'Invalid key format' };
		}

		// Advanced validation: Check if private and public keys match
		// For encrypted keys, we need the passphrase
		const isEncrypted = privateKeyContent.includes('Proc-Type: 4,ENCRYPTED') || privateKeyContent.includes('DEK-Info:') || privateKeyContent.includes('ENCRYPTED');

		if (isEncrypted && !passphrase) {
			// For encrypted keys without passphrase, we can only do basic format validation
			return { isValid: true };
		}

		try {
			await new Promise<void>((resolve, reject) => {
				// Add timeout to prevent hanging
				const timeout = setTimeout(() => {
					reject(new Error('SSH key validation timed out'));
				}, 5000); // 5 second timeout

				const escapedPassphrase = passphrase.replace(/["\\]/g, '\\$&');
				const cmd = `ssh-keygen -y -P "${escapedPassphrase}" -f "${privateKeyPath}"`;

				const child = exec(cmd, (error, stdout, stderr) => {
					clearTimeout(timeout);
					if (error) {
						reject(new Error('Private key validation failed'));
					} else {
						const derivedPublicKey = stdout.trim();
						const existingPublicKey = publicKeyContent.trim();

						if (derivedPublicKey === existingPublicKey) {
							resolve();
						} else {
							reject(new Error('Private and public keys do not match'));
						}
					}
				});

				// Kill the process if it times out
				timeout.unref();
			});

			return { isValid: true };
		} catch (validationError: any) {
			return { isValid: false, error: validationError.message };
		}
	} catch (error: any) {
		return { isValid: false, error: `Error reading SSH keys: ${error.message}` };
	}
}

export async function generateSSHKey(keyType: string, rsaBits: string, privateKeyPath: string, passphrase: string = ''): Promise<void> {
	let sshKeygenCmd = '';

	// Escape passphrase for command line (handle quotes and special characters)
	const escapedPassphrase = passphrase.replace(/["\\]/g, '\\$&');

	if (keyType === 'ed25519') {
		sshKeygenCmd = `ssh-keygen -t ed25519 -f "${privateKeyPath}" -N "${escapedPassphrase}" -q`;
	} else if (keyType === 'rsa') {
		sshKeygenCmd = `ssh-keygen -t rsa -b ${rsaBits} -f "${privateKeyPath}" -N "${escapedPassphrase}" -q`;
	} else {
		throw new Error(`Unsupported key type: ${keyType}`);
	}

	return new Promise<void>((resolve, reject) => {
		exec(sshKeygenCmd, (error, stdout, stderr) => {
			if (error) {
				reject(error);
			} else {
				resolve();
			}
		});
	});
}

export async function verifySSHKeyPassphrase(privateKeyPath: string, passphrase: string): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		// Try to extract public key using the provided passphrase
		// If successful, the passphrase is correct
		const escapedPassphrase = passphrase.replace(/["\\]/g, '\\$&');
		const cmd = `ssh-keygen -y -P "${escapedPassphrase}" -f "${privateKeyPath}"`;

		exec(cmd, (error, stdout, stderr) => {
			if (error || stderr.includes('incorrect passphrase') || stderr.includes('bad decrypt')) {
				resolve(false);
			} else {
				resolve(true);
			}
		});
	});
}

export async function changeSSHKeyPassphrase(privateKeyPath: string, oldPassphrase: string, newPassphrase: string): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const escapedOldPassphrase = oldPassphrase.replace(/["\\]/g, '\\$&');
		const escapedNewPassphrase = newPassphrase.replace(/["\\]/g, '\\$&');

		// Use ssh-keygen -p to change passphrase
		const cmd = `ssh-keygen -p -P "${escapedOldPassphrase}" -N "${escapedNewPassphrase}" -f "${privateKeyPath}"`;

		exec(cmd, (error, stdout, stderr) => {
			if (error) {
				reject(error);
			} else {
				resolve();
			}
		});
	});
}

export async function checkSSHKeyHasPassphrase(privateKeyPath: string): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		// Try to extract public key with empty passphrase
		// If it fails, the key likely has a passphrase
		const cmd = `ssh-keygen -y -P "" -f "${privateKeyPath}"`;

		exec(cmd, (error, stdout, stderr) => {
			if (error || stderr.includes('incorrect passphrase') || stderr.includes('bad decrypt')) {
				resolve(true); // Key has passphrase
			} else {
				resolve(false); // Key has no passphrase
			}
		});
	});
}
