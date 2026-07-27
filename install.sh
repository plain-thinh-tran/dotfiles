#!/bin/bash
set -euo pipefail

# Canonical dotfiles location. Hardcoded so symlinks always point here,
# even when install.sh is run from a Conductor workspace or another clone.
DOTFILES_DIR="/Users/thinhtran/dotfiles"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Install Homebrew
if ! command -v brew &>/dev/null; then
  info "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# Install packages from Brewfile
info "Updating Homebrew..."
brew update

info "Installing Homebrew packages..."
brew bundle --file="$DOTFILES_DIR/Brewfile"

# Install Oh My Zsh
if [ ! -d "$HOME/.oh-my-zsh" ]; then
  info "Installing Oh My Zsh..."
  sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended
fi

# Install Powerlevel10k
P10K_DIR="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/powerlevel10k"
if [ ! -d "$P10K_DIR" ]; then
  info "Installing Powerlevel10k..."
  git clone --depth=1 https://github.com/romkatv/powerlevel10k.git "$P10K_DIR"
fi

# Install zsh plugins
ZSH_CUSTOM="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}"
if [ ! -d "$ZSH_CUSTOM/plugins/zsh-autosuggestions" ]; then
  info "Installing zsh-autosuggestions..."
  git clone https://github.com/zsh-users/zsh-autosuggestions "$ZSH_CUSTOM/plugins/zsh-autosuggestions"
fi
if [ ! -d "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting" ]; then
  info "Installing zsh-syntax-highlighting..."
  git clone https://github.com/zsh-users/zsh-syntax-highlighting "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting"
fi

# Install tmux plugin manager
if [ ! -d "$HOME/.tmux/plugins/tpm" ]; then
  info "Installing tmux plugin manager..."
  git clone https://github.com/tmux-plugins/tpm "$HOME/.tmux/plugins/tpm"
fi

# Symlink function
link() {
  local src="$1"
  local dest="$2"

  if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$src" ]; then
    return
  fi

  if [ -e "$dest" ] || [ -L "$dest" ]; then
    warn "Backing up existing $dest to ${dest}.backup"
    mv "$dest" "${dest}.backup"
  fi

  mkdir -p "$(dirname "$dest")"
  ln -sf "$src" "$dest"
  info "Linked $src -> $dest"
}

# Symlink config files
info "Creating symlinks..."
link "$DOTFILES_DIR/zsh/.zshrc" "$HOME/.zshrc"
link "$DOTFILES_DIR/git/.gitconfig" "$HOME/.gitconfig"
link "$DOTFILES_DIR/tmux/.tmux.conf" "$HOME/.tmux.conf"
link "$DOTFILES_DIR/gh/config.yml" "$HOME/.config/gh/config.yml"
link "$DOTFILES_DIR/cursor/settings.json" "$HOME/Library/Application Support/Cursor/User/settings.json"

# Claude config - symlink individual files (not the whole directory)
link "$DOTFILES_DIR/caveman/config.json" "$HOME/.config/caveman/config.json"

link "$DOTFILES_DIR/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
link "$DOTFILES_DIR/claude/settings.json" "$HOME/.claude/settings.json"
link "$DOTFILES_DIR/claude/statusline-command.sh" "$HOME/.claude/statusline-command.sh"

# Claude commands
for cmd in "$DOTFILES_DIR/claude/commands/"*; do
  link "$cmd" "$HOME/.claude/commands/$(basename "$cmd")"
done

# Claude skills (excluding symlink-managed ones)
for skill_dir in "$DOTFILES_DIR/claude/skills/"*/; do
  skill_name="$(basename "$skill_dir")"
  dest_dir="$HOME/.claude/skills/$skill_name"
  # Skip symlink-managed skills: if the dest is already a directory symlink
  # (e.g. it points back into this repo), linking files into it would resolve
  # through the symlink and overwrite the source with a self-referential link.
  if [ -L "$dest_dir" ]; then
    info "Skipping $skill_name (symlink-managed: $dest_dir)"
    continue
  fi
  # link every file, preserving subdirectories (e.g. scripts/preview.sh)
  while IFS= read -r file; do
    link "$file" "$dest_dir/${file#"$skill_dir"}"
  done < <(find "$skill_dir" -type f)
done

# Install caveman (Claude Code plugin for token compression)
if command -v claude &>/dev/null; then
  if jq -e '.plugins["caveman@caveman"]' "$HOME/.claude/plugins/installed_plugins.json" &>/dev/null; then
    info "Caveman already installed, skipping"
  else
    info "Installing caveman..."
    curl -fsSL https://raw.githubusercontent.com/JuliusBrussee/caveman/main/install.sh | bash -s -- --only claude --non-interactive
  fi
fi

ok()   { echo -e "  ${GREEN}[✓]${NC} $1"; }
todo() { echo -e "  ${YELLOW}[!]${NC} $1"; }

echo ""
info "Installation complete!"
echo ""
echo "Post-install checklist:"
echo ""

# Caveman
if jq -e '.plugins["caveman@caveman"]' "$HOME/.claude/plugins/installed_plugins.json" &>/dev/null; then
  ok   "Caveman"
else
  todo "Caveman — not installed"
fi

# p10k
if [ -f "$HOME/.p10k.zsh" ]; then
  ok   "Powerlevel10k"
else
  todo "Powerlevel10k — run 'p10k configure'"
fi

# tmux plugins (installed alongside tpm in ~/.tmux/plugins/)
if ls "$HOME/.tmux/plugins/" 2>/dev/null | grep -qv "^tpm$"; then
  ok   "tmux plugins"
else
  todo "tmux plugins — open tmux and press 'prefix + I'"
fi

# AWS config
if [ -f "$HOME/.aws/config" ]; then
  ok   "AWS config"
else
  todo "AWS config — set up ~/.aws/config manually"
fi

# SSH config
if [ -f "$HOME/.ssh/config" ]; then
  ok   "SSH config"
else
  todo "SSH config — set up ~/.ssh/config manually"
fi

echo ""
