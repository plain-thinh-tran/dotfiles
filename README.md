# Thinh's Dotfiles

Configuration files and setup scripts for a macOS development environment focused on TypeScript/Node.js development at Plain.

## What's Included

- **zsh** - Oh My Zsh with Powerlevel10k, zsh-autosuggestions, zsh-syntax-highlighting, zoxide, fzf, and more
- **git** - Global git configuration
- **tmux** - tmux config with TPM plugins (resurrect, continuum, yank, etc.)
- **gh** - GitHub CLI configuration
- **cursor** - Cursor editor settings
- **claude** - Claude Code configuration: CLAUDE.md, settings, statusline, slash commands, and skills
- **Brewfile** - Homebrew packages and casks

## Quick Start

```bash
git clone <repo-url> ~/dotfiles
cd ~/dotfiles
./install.sh
```

The install script will:
1. Install Homebrew (if not present)
2. Install all packages from the Brewfile
3. Install Oh My Zsh, Powerlevel10k, and zsh plugins
4. Install tmux plugin manager (TPM)
5. Create symlinks for all config files (backing up existing ones)

## Manual Setup

After running `install.sh`, these need manual configuration:

- **AWS** - Set up `~/.aws/config` with your SSO profiles (devlocal, prod-uk, etc.)
- **SSH** - Set up `~/.ssh/config` and SSH keys
- **NVM** - Install via `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/HEAD/install.sh | bash`
- **pnpm** - Install via `corepack enable && corepack prepare pnpm@latest --activate`
- **Plain Toolbox** - Clone and set up `~/workspace/toolbox` for the datadog Claude skill symlink
- **Powerlevel10k** - Run `p10k configure` to set up the prompt theme
- **tmux plugins** - Open tmux and press `prefix + I` to install plugins

## What's NOT Included

These files contain secrets or machine-specific configuration and are intentionally excluded:

- `~/.aws/config` and `~/.aws/credentials` - AWS SSO profiles and credentials
- `~/.ssh/` - SSH keys and config
- `~/.npmrc` - npm registry tokens
- `~/.claude/memory/` - Personal learning notes (session-specific)
- `~/.claude/hooks/` - Managed by peon-ping brew package
- Environment variables with API keys (DD_API_KEY, DD_APP_KEY, CIRCLECI_TOKEN, etc.)

## Skills Managed Externally

Some Claude skills are not included because they are managed by external tools:

- **peon-ping-config** and **peon-ping-toggle** - Installed via `brew install peon-ping`
- **datadog** - Symlinked from Plain Toolbox (`~/workspace/toolbox/src/claude-skills/datadog`)
