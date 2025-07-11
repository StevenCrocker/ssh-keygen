# Change Log

All notable changes to the "ssh-keygen" extension will be documented in this file.

## [1.1.0] - 2025-07-11

### Added

- **New command: Add/Update Passphrase for Existing Keys** - Easily modify passphrases on existing SSH keys
- **Enhanced passphrase management** - Choose between storing passphrases in plaintext or prompting on each connection
- **Improved key discovery** - Better detection and validation of existing SSH keys with automatic passphrase detection
- **Smart SFTP configuration updates** - Automatically syncs passphrase settings between SSH keys and SFTP configs

### Enhanced

- **Four distinct commands for complete SSH key lifecycle management:**
  - `SSHKEYGEN: Generate SSH Key Pair & Create or Update SFTP Config` - Complete workflow for new setups
  - `SSHKEYGEN: Generate SSH Key Pair Only` - Generate keys without SFTP configuration
  - `SSHKEYGEN: Create or Update SFTP Config Only` - Smart discovery of existing keys
  - `SSHKEYGEN: Add/Update Passphrase for Existing Keys` - Manage passphrases on existing keys
- Key validation process with automatic retry logic for passphrase-protected keys
- SFTP configuration management with proper passphrase property handling
- User experience with clearer messaging and better error handling

## [1.0.0] - 2025-07-11

### Added

- Initial release of SSH Key Generator extension
- **Three distinct commands for maximum flexibility:**
  - `SSHKEYGEN: Generate SSH Key Pair & Create or Update SFTP Config` - Complete workflow for new setups
  - `SSHKEYGEN: Generate SSH Key Pair Only` - Generate keys without SFTP configuration
  - `SSHKEYGEN: Create or Update SFTP Config Only` - Smart discovery of existing keys
- Support for ed25519 (recommended) and RSA key types (2048/4096 bits)
- Automatic key generation in workspace `.vscode` folder with naming convention `{hostname}-{username}-{keytype}`
- Smart validation that skips key generation if valid keys already exist
- Optional automatic creation and updating of `sftp.json` configuration file
- Compatible with VS Code's SFTP extension by Natizyskunk (generates proper sftp.json format utilizing your generated SSH Private Key)
- Smart prompting system that only asks for missing configuration details
- Option to copy generated public key to clipboard
- Cross-platform support with automatic ssh-keygen availability checking
- User-friendly error messages and installation guidance for missing dependencies

### Features

- Generate secure SSH key pairs for SFTP connections
- Seamless integration with existing SFTP workflows
- Flexible configuration options for different server setups
- Automatic workspace-specific key management
- Modular command structure allowing users to perform only the actions they need
