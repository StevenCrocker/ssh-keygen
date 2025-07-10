# 🗝️ sftp-ssh-generator

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/i/scrocker.sftp-ssh-generator)](https://marketplace.visualstudio.com/items?itemName=scrocker.sftp-ssh-generator)
[![Version](https://img.shields.io/visual-studio-marketplace/v/scrocker.sftp-ssh-generator)](https://marketplace.visualstudio.com/items?itemName=scrocker.sftp-ssh-generator)
[![Rating](https://img.shields.io/visual-studio-marketplace/stars/scrocker.sftp-ssh-generator)](https://marketplace.visualstudio.com/items?itemName=scrocker.sftp-ssh-generator)
[![License](https://img.shields.io/github/license/Stevencrocker/sftp-ssh-generator)](https://github.com/Stevencrocker/sftp-ssh-generator/blob/main/LICENSE)
[![Buy Me a Coffee](https://img.shields.io/badge/☕-Buy%20Me%20a%20Coffee-orange)](https://buymeacoffee.com/scrocker)

---

A simple, friendly VS Code extension to generate SSH key pairs in your workspace's `.vscode` folder and optionally create/update your `sftp.json` config for you.

✨ Perfect for easily setting up VS Code's [SFTP extension](https://marketplace.visualstudio.com/items?itemName=Natizyskunk.sftp).

---

## 🚀 Features

✅ Generate **ed25519** (recommended) or **RSA** (2048/4096) keys  
✅ Saves keys in `.vscode/{hostname}-{keytype}-private/public`  
✅ Optional automatic `sftp.json` generation/update  
✅ Only prompts for missing info  
✅ Option to copy the public key to your clipboard immediately  
✅ User-friendly and flexible for any SFTP workflow

---

## 🌴 Installation

Install from the [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=scrocker.sftp-ssh-generator).

Or search in VS Code:

```
SFTP SSH Generator by scrocker
```

---

## 🅥 Usage

1. Open the \*_Command Palette_) (`Ctrl+Shift+P` or `Cmd+Shift+P`).
2. Run:

```
> SFTP SSH Generator: Generate SSH Key and (Optional) sftp.json
```

3. Follow the prompts:

- Choose key type (ed25519, RSA 2048, RSA 4096)
- Choose whether to create/update sftp.json
- Enter only required fields (host, username, optional remote path)
- Optionally copy your public key to clipboard immediately

`𝐠.Vscode/{hostname}-{keytype}-private

```

```

.vscode/{hostname}-{keytype}-public

````

❤ Your sftp.json will be updated with:

```{
  "host": "your-host",
  "username": "your-user",
  "remotePath": "",
  "privateKeyPath": "./.vscode/your-key",
  "protocol": "sftp",
  "port": 22
}
````

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

- [VS Code SFTP Extension](https://marketplace.visualstudio.com/items?itemName=Natizyskunk.sftp)
