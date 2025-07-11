# 🗝️ ssh-keygen

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/i/scrocker.ssh-keygen)](https://marketplace.visualstudio.com/items?itemName=scrocker.ssh-keygen)
[![Version](https://img.shields.io/visual-studio-marketplace/v/scrocker.ssh-keygen)](https://marketplace.visualstudio.com/items?itemName=scrocker.ssh-keygen)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/scrocker.ssh-keygen)](https://marketplace.visualstudio.com/items?itemName=scrocker.ssh-keygen)
[![License](https://img.shields.io/github/license/StevenCrocker/ssh-keygen)](https://github.com/StevenCrocker/ssh-keygen/blob/main/LICENSE)
[![Buy Me a Coffee](https://img.shields.io/badge/☕-Buy%20Me%20a%20Coffee-orange)](https://buymeacoffee.com/scrocker)

---

A simple, friendly VS Code extension to generate SSH key pairs in your workspace's `.vscode` folder.

✨ Compatible with VS Code's [SFTP extension by Natizyskunk](https://marketplace.visualstudio.com/items?itemName=Natizyskunk.sftp) (generates proper sftp.json format utilizing your generated SSH Private Key).

---

## 🚀 Features

- ✅ **Four intelligent commands** to fit any workflow
- ✅ Generate **ed25519** (recommended) or **RSA** (2048/4096) keys
- ✅ **Consistent naming**: `{hostname}-{username}-{keytype}` format for organization
- ✅ **Smart validation** that skips key generation if valid keys already exist
- ✅ Automatic `sftp.json` generation/update when needed
- ✅ Only prompts for missing information to streamline the process
- ✅ Option to copy the public key to your clipboard for immediate use
- ✅ User-friendly and flexible for any SFTP workflow
- ✅ Cross-platform support with helpful installation guidance

---

## 🌴 Installation

Install from the [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=scrocker.ssh-keygen).

Or search in VS Code:

```
SSH Key Generator by scrocker
```

---

## 🅥 Usage

1. Open the **Command Palette** (`Ctrl+Shift+P` or `Cmd+Shift+P`).
2. Choose one of four commands based on your needs:

### 🔧 **Complete Setup** (Recommended for new projects)

```
> SSHKEYGEN: Generate SSH Key Pair & Create or Update SFTP Config
```

- Choose key type (ed25519, RSA 2048, RSA 4096)
- Prompts for host, username, and optional remote path (only if not already in existing sftp.json)
- Automatically generates keys AND creates or updates sftp.json
- Perfect for setting up a new SFTP connection

### 🗝️ **Keys Only** (For flexibility)

```
> SSHKEYGEN: Generate SSH Key Pair Only
```

- Choose key type (ed25519, RSA 2048, RSA 4096)
- Enter hostname and username for smart naming
- Generates keys without touching sftp.json
- Great for Git, other servers, or manual SFTP setup

### ⚙️ **Config Only** (Smart Discovery)

```
> SSHKEYGEN: Create or Update SFTP Config Only
```

- **Finds existing SSH keys** in `.vscode` folder that use the `{hostname}-{username}-{keytype}` format
- **Reads hostname and username** from key filenames automatically
- **Validates key pairs** and shows status in selection list
- **Only prompts for missing information** (usually just remote path)
- Perfect when you already have keys or want to reconfigure

### 🔐 **Passphrase Management** (For existing keys)

```
> SSHKEYGEN: Add/Update Passphrase for Existing Keys
```

- **Discovers existing SSH keys** in your workspace
- **Add, change, or remove passphrases** on existing keys
- **Choose storage method**: store in config (plaintext) or prompt on each connection
- **Automatically updates SFTP configuration** to match passphrase settings
- Perfect for enhancing security or changing authentication methods

3. Follow the prompts and optionally copy your public key to clipboard when done!

**Note:** This extension generates keys locally and updates configuration files - it never attempts to connect to remote servers.

---

## ❤ Support

If you find this extension helpful, consider buying me a coffee!

[![Buy Me A Coffee](https://img.shields.io/badge/scrocker-Buy%20Me%20a%20Coffee-orange)](https://buymeacoffee.com/scrocker)

---

## 🌴 Contributing

Issues and pull requests are welcome!

1. Fork this repo
2. Clone and install dependencies
3. Make your changes
4. Submit a PR

---

## 🗝️ License

@MIT(LICENSE)

---

## 💑 Related

- [SFTP Extension by Natizyskunk](https://marketplace.visualstudio.com/items?itemName=Natizyskunk.sftp)
