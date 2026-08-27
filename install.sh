#!/bin/bash
set -euo pipefail

DOTFILES_DIR="$HOME/dotfiles"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }
dry()  { echo -e "${BLUE}[DRY-RUN]${NC} would: $1"; }

run() {
  if $DRY_RUN; then
    dry "$*"
    return
  fi
  "$@"
}

if $DRY_RUN; then
  info "Running in dry-run mode, no changes will be made"
  echo ""
fi

if ! command -v brew &>/dev/null; then
  if $DRY_RUN; then
    dry "install Homebrew"
  else
    info "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi
fi

brew_before=$(mktemp)
{ brew list --formula 2>/dev/null; brew list --cask 2>/dev/null; } | sort > "$brew_before"

info "Updating Homebrew..."
run brew update

info "Installing Homebrew packages..."
run brew bundle --file="$DOTFILES_DIR/Brewfile"

brew_after=$(mktemp)
{ brew list --formula 2>/dev/null; brew list --cask 2>/dev/null; } | sort > "$brew_after"

brew_diff=$(diff "$brew_before" "$brew_after" || true)
if [ -n "$brew_diff" ]; then
  echo ""
  info "Brew changes:"
  added=$(diff "$brew_before" "$brew_after" | grep '^>' | sed 's/^> /  + /')
  removed=$(diff "$brew_before" "$brew_after" | grep '^<' | sed 's/^< /  - /')
  [ -n "$added" ] && echo -e "${GREEN}$added${NC}"
  [ -n "$removed" ] && echo -e "${RED}$removed${NC}"
  echo ""
else
  info "No brew package changes"
fi
rm -f "$brew_before" "$brew_after"

if [ ! -d "$HOME/.oh-my-zsh" ]; then
  if $DRY_RUN; then
    dry "install Oh My Zsh"
  else
    info "Installing Oh My Zsh..."
    sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended
  fi
fi

P10K_DIR="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/powerlevel10k"
if [ ! -d "$P10K_DIR" ]; then
  info "Installing Powerlevel10k..."
  run git clone --depth=1 https://github.com/romkatv/powerlevel10k.git "$P10K_DIR"
fi

ZSH_CUSTOM="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}"
if [ ! -d "$ZSH_CUSTOM/plugins/zsh-autosuggestions" ]; then
  info "Installing zsh-autosuggestions..."
  run git clone https://github.com/zsh-users/zsh-autosuggestions "$ZSH_CUSTOM/plugins/zsh-autosuggestions"
fi
if [ ! -d "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting" ]; then
  info "Installing zsh-syntax-highlighting..."
  run git clone https://github.com/zsh-users/zsh-syntax-highlighting "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting"
fi

if [ ! -d "$HOME/.tmux/plugins/tpm" ]; then
  info "Installing tmux plugin manager..."
  run git clone https://github.com/tmux-plugins/tpm "$HOME/.tmux/plugins/tpm"
fi

link() {
  local src="$1"
  local dest="$2"

  if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$src" ]; then
    return
  fi

  if $DRY_RUN; then
    dry "link $src -> $dest"
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

info "Creating symlinks..."
link "$DOTFILES_DIR/zsh/.zshrc" "$HOME/.zshrc"
link "$DOTFILES_DIR/git/.gitconfig" "$HOME/.gitconfig"
link "$DOTFILES_DIR/tmux/.tmux.conf" "$HOME/.tmux.conf"
link "$DOTFILES_DIR/gh/config.yml" "$HOME/.config/gh/config.yml"
link "$DOTFILES_DIR/cursor/settings.json" "$HOME/Library/Application Support/Cursor/User/settings.json"

link "$DOTFILES_DIR/caveman/config.json" "$HOME/.config/caveman/config.json"

link "$DOTFILES_DIR/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
link "$DOTFILES_DIR/claude/settings.json" "$HOME/.claude/settings.json"
link "$DOTFILES_DIR/claude/statusline-command.sh" "$HOME/.claude/statusline-command.sh"

for cmd in "$DOTFILES_DIR/claude/commands/"*; do
  link "$cmd" "$HOME/.claude/commands/$(basename "$cmd")"
done

for skill_dir in "$DOTFILES_DIR/claude/skills/"*/; do
  skill_name="$(basename "$skill_dir")"
  dest_dir="$HOME/.claude/skills/$skill_name"
  if [ -L "$dest_dir" ]; then
    info "Skipping $skill_name (symlink-managed: $dest_dir)"
    continue
  fi
  while IFS= read -r file; do
    link "$file" "$dest_dir/${file#"$skill_dir"}"
  done < <(find "$skill_dir" -type f)
done

if command -v claude &>/dev/null; then
  if jq -e '.plugins["caveman@caveman"]' "$HOME/.claude/plugins/installed_plugins.json" &>/dev/null; then
    info "Caveman already installed, skipping"
  else
    if $DRY_RUN; then
      dry "install caveman plugin"
    else
      info "Installing caveman..."
      curl -fsSL https://raw.githubusercontent.com/JuliusBrussee/caveman/main/install.sh | bash -s -- --only claude --non-interactive
    fi
  fi
fi

ok()   { echo -e "  ${GREEN}[✓]${NC} $1"; }
todo() { echo -e "  ${YELLOW}[!]${NC} $1"; }

echo ""
info "Installation complete!"
echo ""
echo "Post-install checklist:"
echo ""

if jq -e '.plugins["caveman@caveman"]' "$HOME/.claude/plugins/installed_plugins.json" &>/dev/null; then
  ok   "Caveman"
else
  todo "Caveman — not installed"
fi

if [ -f "$HOME/.p10k.zsh" ]; then
  ok   "Powerlevel10k"
else
  todo "Powerlevel10k — run 'p10k configure'"
fi

if ls "$HOME/.tmux/plugins/" 2>/dev/null | grep -qv "^tpm$"; then
  ok   "tmux plugins"
else
  todo "tmux plugins — open tmux and press 'prefix + I'"
fi

if [ -f "$HOME/.aws/config" ]; then
  ok   "AWS config"
else
  todo "AWS config — set up ~/.aws/config manually"
fi

if [ -f "$HOME/.ssh/config" ]; then
  ok   "SSH config"
else
  todo "SSH config — set up ~/.ssh/config manually"
fi

if command -v op &>/dev/null && op account list &>/dev/null 2>&1; then
  ok   "1Password CLI"
else
  todo "1Password CLI — run 'op signin' to connect your vault"
fi

echo ""
