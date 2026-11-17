#!/bin/sh

PI_PACKAGE="@earendil-works/pi-coding-agent"
PI_CMD="pi"
PI_INSTALLER_API_BASE="${PI_INSTALLER_API_BASE:-https://pi.dev/api/installer/releases}"
PI_MANAGED_INSTALL_MARKER="managed-install.json"
# Pi publishes npm-shrinkwrap.json, so the explicit installer/reinstaller can
# bypass npm's release-age gate without reopening transitive dependency ranges.
PI_NPM_INSTALL_MIN_AGE_ARG="--min-release-age=0"
PI_ESC=$(printf '\033')
PI_CR=$(printf '\r')
PI_ETX=$(printf '\003')
readonly PI_PACKAGE PI_CMD PI_INSTALLER_API_BASE PI_MANAGED_INSTALL_MARKER PI_NPM_INSTALL_MIN_AGE_ARG PI_ESC PI_CR PI_ETX

pi_installer_main() {
  set -eu

  check_file="${TMPDIR:-/tmp}/pi-installer-checks.$$"
  run_preflight_checks >"$check_file" &
  check_pid=$!

  pi_logo_animation

  if wait "$check_pid"; then
    check_status=0
  else
    check_status=$?
  fi

  printf '\033[1m  Pi Installer\033[0m\n\033[2m  There are many agent harnesses but this one is yours\033[0m\n\n'
  if [ "$check_status" -eq 0 ]; then
    cat "$check_file"
  fi
  rm -f "$check_file"

  if [ "$check_status" -ne 0 ]; then
    if ! install_node_npm_interactive; then
      exit "$check_status"
    fi

    check_file="${TMPDIR:-/tmp}/pi-installer-checks.$$"
    if run_preflight_checks >"$check_file"; then
      check_status=0
    else
      check_status=$?
    fi
    cat "$check_file"
    rm -f "$check_file"

    if [ "$check_status" -ne 0 ]; then
      exit "$check_status"
    fi
  fi

  PI_EXISTING_PATH=$(command -v "$PI_CMD" 2>/dev/null || true)
  export PI_EXISTING_PATH

  if pi_managed_install_enabled; then
    if ! ensure_managed_install_supported; then
      exit 1
    fi
    PI_MANAGED_INSTALL_DIR=$(select_managed_install_dir "$PI_EXISTING_PATH")
    PI_MANAGED_AGENT_DIR=${PI_MANAGED_INSTALL_DIR%/*}
    PI_MANAGED_BIN_DIR=$(select_managed_path_bin_dir "$PI_MANAGED_AGENT_DIR" "$PI_MANAGED_INSTALL_DIR" "$PI_EXISTING_PATH")
    PI_NPM_INSTALL_PREFIX=
    export PI_MANAGED_INSTALL_DIR PI_MANAGED_AGENT_DIR PI_MANAGED_BIN_DIR
  else
    if ! PI_NPM_INSTALL_PREFIX=$(select_npm_install_prefix); then
      exit 1
    fi
  fi
  export PI_NPM_INSTALL_PREFIX

  PI_LEGACY_NPM_MIGRATION=0
  if pi_managed_install_enabled && managed_install_root_for_command "$PI_EXISTING_PATH" >/dev/null 2>&1; then
    PI_NPM_UNINSTALL_PREFIX=
  else
    PI_NPM_UNINSTALL_PREFIX=$(select_npm_uninstall_prefix "$PI_EXISTING_PATH")
    if pi_managed_install_enabled && [ -n "$PI_EXISTING_PATH" ] && npm_package_is_installed_for_uninstall; then
      PI_LEGACY_NPM_MIGRATION=1
    fi
  fi
  export PI_NPM_UNINSTALL_PREFIX PI_LEGACY_NPM_MIGRATION

  choose_pi_action "$PI_EXISTING_PATH"
  case "$PI_INSTALL_ACTION" in
    uninstall)
      uninstall_pi_package
      printf '\nPi was uninstalled successfully.\n'
      exit 0
      ;;
    none)
      exit 0
      ;;
    migrate)
      if ! ensure_legacy_npm_pi_removable; then
        exit 1
      fi
      ;;
  esac

  install_pi_package
  if [ "$PI_INSTALL_ACTION" = migrate ]; then
    printf '\nPi was migrated to a managed installation successfully.\n'
  elif [ "$PI_INSTALL_ACTION" = reinstall ]; then
    printf '\nPi was reinstalled successfully.\n'
  else
    printf '\nPi was installed successfully.\n'
  fi
  if pi_managed_install_enabled; then
    printf '\nUpdate Pi later with: pi update\n'
  fi
  if installed_pi_is_first_on_path; then
    printf '\nRun it with: pi\n'
    if ! pi_managed_install_enabled && [ "${PI_NODE_INSTALLED_STANDALONE:-0}" = 1 ]; then
      printf 'If node is not found in your shell yet, add this to your shell profile:\n\n'
      printf '  export PATH="%s:$PATH"\n' "$PI_STANDALONE_NODE_BIN"
    fi
  else
    print_pi_not_on_path_message
  fi

  prompt_start_pi
}

# The installer runs as a child process and cannot change the calling shell's
# PATH, so offer to start the installed pi by its full path. This makes the
# first run work even when the shell still needs a restart to find pi.
prompt_start_pi() {
  start_pi_path=$(pi_installed_path)
  [ -n "$start_pi_path" ] && [ -x "$start_pi_path" ] || return 0
  [ -t 1 ] || return 0
  if ! ( : <>/dev/tty ) 2>/dev/null; then
    return 0
  fi

  exec 3<>/dev/tty
  printf '\nStart pi now? [Y/n] ' >&3
  if ! IFS= read -r answer <&3; then
    answer=n
  fi
  exec 3>&-
  case "$answer" in
    n|N|no|NO) return 0 ;;
  esac

  printf '\n'
  unset PI_EXISTING_PATH PI_MANAGED_INSTALL_DIR PI_MANAGED_AGENT_DIR PI_MANAGED_BIN_DIR PI_NPM_INSTALL_PREFIX PI_NPM_UNINSTALL_PREFIX PI_LEGACY_NPM_MIGRATION
  exec "$start_pi_path" </dev/tty
}

run_preflight_checks() {
  status=0

  if command -v node >/dev/null 2>&1; then
    node_version=$(node --version)
    if ! node -e 'const [maj,min,patch] = process.versions.node.split(".").map(Number); process.exit(maj > 22 || (maj === 22 && (min > 19 || (min === 19 && patch >= 0))) ? 0 : 1)' >/dev/null; then
      printf 'error: Pi requires Node.js 22.19.0 or newer. Found %s.\n' "$node_version"
      status=1
    fi
  else
    printf 'error: Node.js 22.19.0 or newer is required to install Pi.\n'
    status=1
  fi

  if ! command -v npm >/dev/null 2>&1; then
    printf 'error: npm is required to install Pi.\n'
    status=1
  fi

  if [ "$status" -ne 0 ]; then
    printf '\n'
  fi

  return "$status"
}

install_node_npm_interactive() {
  method=$(detect_node_install_method)
  case "$method" in
    homebrew) label="Homebrew" ;;
    apt) label="apt" ;;
    apk) label="apk" ;;
    standalone) label="standalone Node.js" ;;
  esac

  if ! ( : <>/dev/tty ) 2>/dev/null; then
    printf 'No terminal detected; install Node.js 22.19.0 or newer and npm, then run this installer again.\n'
    return 1
  fi
  exec 3<>/dev/tty

  printf 'Pi needs Node.js 22.19.0 or newer and npm. Install them now with %s? [Y/n] ' "$label" >&3
  if ! IFS= read -r answer <&3; then
    answer=
  fi
  exec 3>&-
  case "$answer" in
    n|N|no|NO) printf '\nInstall Node.js 22.19.0 or newer and npm, then run this installer again.\n'; return 1 ;;
    *) ;;
  esac

  install_node_npm "$method" "$label"
}

detect_node_install_method() {
  case "$(uname -s)" in
    Darwin)
      if command -v brew >/dev/null 2>&1; then
        printf 'homebrew'
      else
        printf 'standalone'
      fi
      ;;
    Linux)
      if command -v apt-cache >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1 && apt_node_candidate_is_new_enough; then
        printf 'apt'
      elif command -v apk >/dev/null 2>&1 && apk_node_candidate_is_new_enough; then
        printf 'apk'
      else
        printf 'standalone'
      fi
      ;;
    *)
      printf 'standalone'
      ;;
  esac
}

apt_node_candidate_is_new_enough() {
  version=$(apt-cache policy nodejs 2>/dev/null | awk '/Candidate:/ { print $2; exit }')
  [ -n "$version" ] && [ "$version" != "(none)" ] && node_version_string_is_new_enough "$version"
}

apk_node_candidate_is_new_enough() {
  version=$(apk search -x nodejs 2>/dev/null | awk -F- '/^nodejs-/ { print $2; exit }')
  [ -n "$version" ] && node_version_string_is_new_enough "$version"
}

node_version_string_is_new_enough() {
  version="${1#v}"
  case "$version" in
    [0-9]*) ;;
    *) return 1 ;;
  esac
  version="${version%%[!0-9.]*}"
  version_ifs=${IFS- }
  IFS=.
  set -- $version
  IFS=$version_ifs
  major="${1:-}"
  minor="${2:-0}"
  patch="${3:-0}"
  case "$major" in ''|*[!0-9]*) return 1 ;; esac
  case "$minor" in ''|*[!0-9]*) minor=0 ;; esac
  case "$patch" in ''|*[!0-9]*) patch=0 ;; esac

  [ "$major" -gt 22 ] && return 0
  [ "$major" -eq 22 ] && [ "$minor" -gt 19 ] && return 0
  [ "$major" -eq 22 ] && [ "$minor" -eq 19 ] && [ "$patch" -ge 0 ] && return 0
  return 1
}

install_node_npm() {
  method="$1"; label="$2"

  if [ -t 1 ] && [ "${TERM:-}" != "dumb" ]; then
    install_node_npm_with_progress "$method" "$label"
  else
    printf '\nInstalling Node.js and npm with %s...\n\n' "$label"
    run_node_install_method "$method"
    printf '\nNode.js and npm are installed.\n'
  fi

  if [ "$method" = standalone ]; then
    load_standalone_node
    PI_NODE_INSTALLED_STANDALONE=1
  fi
  hash -r
  printf '\n'
}

install_node_npm_with_progress() {
  method="$1"; label="$2"
  log_file="${TMPDIR:-/tmp}/pi-installer-node.$$"
  rm -f "$log_file"
  : >"$log_file"

  run_node_install_method "$method" >"$log_file" 2>&1 &
  install_pid=$!

  printf '\033[?25l'
  animate_node_install "$log_file" "$label" &
  progress_pid=$!
  trap 'kill "$install_pid" 2>/dev/null || true; finish_install_progress "$progress_pid"; exit 130' INT TERM

  if wait "$install_pid"; then
    status=0
  else
    status=$?
  fi

  finish_install_progress "$progress_pid"
  trap - INT TERM

  if [ "$status" -ne 0 ]; then
    printf '\033[31mNode.js installation failed.\033[0m\n\n'
    cat "$log_file"
    rm -f "$log_file"
    return "$status"
  fi

  rm -f "$log_file"
  if terminal_supports_unicode; then
    printf '  \033[32m✓\033[0m Node.js and npm install complete\n'
  else
    printf '  \033[32mok\033[0m Node.js and npm install complete\n'
  fi
}

run_node_install_method() {
  case "$1" in
    homebrew) install_node_with_homebrew ;;
    apt) install_node_with_apt ;;
    apk) install_node_with_apk ;;
    standalone) install_node_standalone ;;
  esac
}

install_node_with_homebrew() {
  if brew list node >/dev/null 2>&1; then
    brew upgrade node
  else
    brew install node
  fi
}

install_node_with_apt() {
  print_sudo_note
  if [ "${EUID:-$(id -u)}" -eq 0 ]; then
    apt-get update
    apt-get install -y nodejs npm
  else
    sudo sh -c 'apt-get update && apt-get install -y nodejs npm'
  fi
}

install_node_with_apk() {
  print_sudo_note
  run_with_sudo apk add --update-cache nodejs npm
}

install_node_standalone() {
  node_platform=$(detect_node_binary_platform) || {
    printf 'Unsupported operating system for automatic Node.js install: %s\n' "$(uname -s)"
    return 1
  }
  node_arch=$(detect_node_binary_arch) || {
    printf 'Unsupported CPU architecture for automatic Node.js install: %s\n' "$(uname -m)"
    return 1
  }
  node_dist_base="https://nodejs.org/dist/latest-v22.x"
  node_base_dir=$(node_standalone_base_dir)
  node_tmp_dir="${TMPDIR:-/tmp}/pi-node.$$"

  rm -rf "$node_tmp_dir"
  mkdir -p "$node_tmp_dir" "$node_base_dir"

  printf 'Resolving Node.js binary for %s-%s\n' "$node_platform" "$node_arch"
  curl -fsSL "$node_dist_base/SHASUMS256.txt" -o "$node_tmp_dir/SHASUMS256.txt"
  node_file=$(awk -v suffix="-$node_platform-$node_arch.tar.xz" '
    index($2, "node-v") == 1 && length($2) >= length(suffix) && substr($2, length($2) - length(suffix) + 1) == suffix { print $2; exit }
  ' "$node_tmp_dir/SHASUMS256.txt")
  if [ -z "$node_file" ]; then
    printf 'No Node.js binary is available for %s-%s.\n' "$node_platform" "$node_arch"
    rm -rf "$node_tmp_dir"
    return 1
  fi

  printf 'Downloading Node.js %s\n' "${node_file%.tar.xz}"
  curl -fsSL "$node_dist_base/$node_file" -o "$node_tmp_dir/$node_file"
  verify_node_standalone_download "$node_tmp_dir" "$node_file"
  ensure_node_standalone_extract_tools "$node_platform"

  node_dir="$node_base_dir/${node_file%.tar.xz}"
  rm -rf "$node_dir"
  printf 'Extracting Node.js to %s\n' "$node_dir"
  tar -xf "$node_tmp_dir/$node_file" -C "$node_base_dir"
  rm -f "$node_base_dir/current"
  ln -s "$node_dir" "$node_base_dir/current"
  rm -rf "$node_tmp_dir"
  printf 'Node.js installed at %s\n' "$node_dir"
}

verify_node_standalone_download() {
  checksum_dir="$1"
  checksum_file_name="$2"
  awk -v file="$checksum_file_name" '$2 == file { print }' "$checksum_dir/SHASUMS256.txt" > "$checksum_dir/SHASUMS256.selected"

  if command -v sha256sum >/dev/null 2>&1; then
    printf 'Verifying Node.js download\n'
    (cd "$checksum_dir" && sha256sum -c SHASUMS256.selected)
  elif command -v shasum >/dev/null 2>&1; then
    printf 'Verifying Node.js download\n'
    (cd "$checksum_dir" && shasum -a 256 -c SHASUMS256.selected)
  fi
}

ensure_node_standalone_extract_tools() {
  extract_platform="$1"

  if [ "$extract_platform" = linux ] && ! command -v xz >/dev/null 2>&1; then
    printf 'Installing xz-utils for Node.js archive extraction\n'
    print_sudo_note
    if command -v apt-get >/dev/null 2>&1; then
      run_with_sudo apt-get update
      run_with_sudo apt-get install -y xz-utils
    elif command -v apk >/dev/null 2>&1; then
      run_with_sudo apk add --update-cache xz
    else
      printf 'xz is required to extract Node.js. Install xz and run this installer again.\n'
      return 1
    fi
  fi
}

load_standalone_node() {
  PI_STANDALONE_NODE_BIN="$(node_standalone_base_dir)/current/bin"
  PATH="$PI_STANDALONE_NODE_BIN:$PATH"
  export PI_STANDALONE_NODE_BIN PATH
}

node_standalone_base_dir() {
  if [ -n "${XDG_DATA_HOME:-}" ]; then
    printf '%s/pi-node' "$XDG_DATA_HOME"
  else
    printf '%s/.local/share/pi-node' "$HOME"
  fi
}

detect_node_binary_platform() {
  case "$(uname -s)" in
    Darwin) printf 'darwin' ;;
    Linux) printf 'linux' ;;
    *) return 1 ;;
  esac
}

detect_node_binary_arch() {
  case "$(uname -m)" in
    x86_64|amd64) printf 'x64' ;;
    arm64|aarch64) printf 'arm64' ;;
    armv7l) printf 'armv7l' ;;
    ppc64le) printf 'ppc64le' ;;
    s390x) printf 's390x' ;;
    *) return 1 ;;
  esac
}

print_sudo_note() {
  if [ "${EUID:-$(id -u)}" -ne 0 ]; then
    printf 'This may ask for your sudo password.\n\n'
  fi
}

run_with_sudo() {
  if [ "${EUID:-$(id -u)}" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

select_npm_install_prefix() {
  npm_prefix=$(npm_global_prefix)
  if [ -n "$npm_prefix" ] && npm_prefix_supports_global_install "$npm_prefix"; then
    return 0
  fi

  if existing_global_pi_blocks_user_local_install "$npm_prefix"; then
    print_existing_global_pi_not_writable_message "$npm_prefix"
    return 1
  fi

  printf '%s/.local' "$HOME"
}

select_npm_uninstall_prefix() {
  existing_pi_path="$1"
  [ -n "$existing_pi_path" ] || return 0

  npm_prefix=$(npm_global_prefix)
  if [ -n "$npm_prefix" ] && [ "$existing_pi_path" = "$npm_prefix/bin/$PI_CMD" ]; then
    return 0
  fi

  if [ -n "${PI_NPM_INSTALL_PREFIX:-}" ] && [ "$existing_pi_path" = "$PI_NPM_INSTALL_PREFIX/bin/$PI_CMD" ]; then
    printf '%s' "$PI_NPM_INSTALL_PREFIX"
    return 0
  fi

  pi_bin_suffix="/bin/$PI_CMD"
  case "$existing_pi_path" in
    *"$pi_bin_suffix") printf '%s' "${existing_pi_path%$pi_bin_suffix}" ;;
  esac
}

npm_global_prefix() {
  npm prefix -g 2>/dev/null || npm config get prefix 2>/dev/null
}

npm_prefix_supports_global_install() {
  prefix="$1"
  path_is_writable_or_creatable "$prefix/lib/node_modules" && path_is_writable_or_creatable "$prefix/bin"
}

existing_global_pi_blocks_user_local_install() {
  npm_prefix="$1"
  [ -n "$npm_prefix" ] || return 1

  [ -e "$npm_prefix/bin/$PI_CMD" ]
}

print_existing_global_pi_not_writable_message() {
  npm_prefix="$1"
  existing_pi_path="$npm_prefix/bin/$PI_CMD"

  printf "npm's global directory is not writable: %s\n" "$npm_prefix" >&2
  printf 'Pi is already installed at: %s\n\n' "$existing_pi_path" >&2
  printf 'Installing another copy under %s/.local could leave your shell using the old global pi, so this installer stopped.\n\n' "$HOME" >&2
  printf 'Update or remove the existing global install first. If it was installed with npm, you can run:\n\n' >&2
  printf '  sudo npm install -g --ignore-scripts %s %s\n\n' "$PI_NPM_INSTALL_MIN_AGE_ARG" "$PI_PACKAGE" >&2
  printf 'or uninstall it first with:\n\n' >&2
  printf '  sudo npm uninstall -g %s\n\n' "$PI_PACKAGE" >&2
  printf 'Then run this installer again.\n' >&2
}

path_is_writable_or_creatable() {
  check_path="$1"
  while [ ! -e "$check_path" ]; do
    parent=${check_path%/*}
    if [ -z "$parent" ] || [ "$parent" = "$check_path" ]; then
      return 1
    fi
    check_path="$parent"
  done

  [ -d "$check_path" ] && [ -w "$check_path" ]
}

pi_install_bin_dir() {
  if pi_managed_install_enabled; then
    printf '%s' "$PI_MANAGED_BIN_DIR"
  elif [ -n "${PI_NPM_INSTALL_PREFIX:-}" ]; then
    printf '%s/bin' "$PI_NPM_INSTALL_PREFIX"
  else
    npm_prefix=$(npm_global_prefix)
    if [ -n "$npm_prefix" ]; then
      printf '%s/bin' "$npm_prefix"
    fi
  fi
}

pi_installed_path() {
  pi_bin_dir=$(pi_install_bin_dir)
  if [ -n "$pi_bin_dir" ]; then
    printf '%s/%s' "$pi_bin_dir" "$PI_CMD"
  fi
}

installed_pi_is_first_on_path() {
  installed_pi_path=$(pi_installed_path)
  [ -n "$installed_pi_path" ] || return 1

  active_pi_path=$(command -v "$PI_CMD" 2>/dev/null) || return 1
  [ "$active_pi_path" = "$installed_pi_path" ]
}

shell_config_file() {
  current_shell=$(basename "${SHELL:-sh}")
  case "$current_shell" in
    fish) printf '%s/.config/fish/config.fish' "$HOME" ;;
    zsh) printf '%s/.zshrc' "${ZDOTDIR:-$HOME}" ;;
    bash)
      if [ -f "$HOME/.bashrc" ]; then
        printf '%s/.bashrc' "$HOME"
      else
        printf '%s/.profile' "$HOME"
      fi
      ;;
    *) printf '%s/.profile' "$HOME" ;;
  esac
}

path_update_command() {
  bin_dir="$1"
  current_shell=$(basename "${SHELL:-sh}")
  if [ "$bin_dir" = "$HOME/.local/bin" ]; then
    bin_expr='$HOME/.local/bin'
  else
    bin_expr="$bin_dir"
  fi

  case "$current_shell" in
    fish) printf 'fish_add_path "%s"' "$bin_expr" ;;
    *) printf 'export PATH="%s:$PATH"' "$bin_expr" ;;
  esac
}

config_file_mentions_path() {
  config_file="$1"
  command="$2"

  [ -f "$config_file" ] || return 1
  grep -Fxq "$command" "$config_file"
}

prompt_add_path_to_profile() {
  bin_dir="$1"
  if ! ( : <>/dev/tty ) 2>/dev/null; then
    return 1
  fi

  config_file=$(shell_config_file)
  command=$(path_update_command "$bin_dir")

  if config_file_mentions_path "$config_file" "$command"; then
    printf 'A PATH update for %s already exists in %s.\n' "$bin_dir" "$config_file"
    return 0
  fi

  exec 3<>/dev/tty
  printf 'Add %s to your PATH in %s now? [Y/n] ' "$bin_dir" "$config_file" >&3
  if ! IFS= read -r answer <&3; then
    answer=
  fi
  exec 3>&-
  case "$answer" in
    n|N|no|NO) return 1 ;;
    *) ;;
  esac

  mkdir -p "${config_file%/*}"
  touch "$config_file"
  printf '\n# Pi\n%s\n' "$command" >> "$config_file"
  printf 'Added %s to %s.\n' "$bin_dir" "$config_file"
}

print_pi_not_on_path_message() {
  pi_bin_dir=$(pi_install_bin_dir)
  active_pi_path=$(command -v "$PI_CMD" 2>/dev/null || true)

  printf 'Pi was installed, but your shell is not using that install yet.\n'
  if [ -n "$active_pi_path" ]; then
    printf 'Your shell currently resolves pi to: %s\n' "$active_pi_path"
  fi

  if [ -n "$pi_bin_dir" ]; then
    prompt_add_path_to_profile "$pi_bin_dir" || true
    command=$(path_update_command "$pi_bin_dir")
    printf 'Restart your shell or run:\n\n'
    printf '  %s\n\n' "$command"
    printf 'Then run: pi\n'
  else
    printf "Check npm's global prefix with:\n\n"
    printf '  npm prefix -g\n\n'
    printf 'Then add its bin directory to your shell PATH.\n'
  fi
}

default_pi_action() {
  existing_pi_path="$1"

  if [ "$PI_LEGACY_NPM_MIGRATION" = 1 ]; then
    printf 'migrate'
  elif [ -n "$existing_pi_path" ]; then
    printf 'reinstall'
  else
    printf 'install'
  fi
}

choose_pi_action() {
  existing_pi_path="$1"

  if ! ( : <>/dev/tty ) 2>/dev/null; then
    print_pi_action_menu "$existing_pi_path"
    printf 'No terminal detected; continuing without confirmation.\n'
    PI_INSTALL_ACTION=$(default_pi_action "$existing_pi_path")
    print_pi_action_selection "$PI_INSTALL_ACTION"
    return 0
  fi

  exec 3<>/dev/tty
  trap 'exec 3>&-; trap - INT TERM; exit 130' INT TERM
  print_pi_action_menu "$existing_pi_path" >&3

  while :; do
    key=$(read_tty_key)

    case "$key" in
      ""|" "|"$PI_CR"|y|Y)
        PI_INSTALL_ACTION=$(default_pi_action "$existing_pi_path")
        break
        ;;
      u|U)
        if [ -n "$existing_pi_path" ]; then
          PI_INSTALL_ACTION=uninstall
          break
        fi
        ;;
      "$PI_ETX")
        exit 130
        ;;
      n|N|"$PI_ESC")
        PI_INSTALL_ACTION=none
        break
        ;;
    esac

    printf 'Please choose one of the listed keys.\n' >&3
  done

  print_pi_action_selection "$PI_INSTALL_ACTION" >&3
  exec 3>&-
  trap - INT TERM
}

print_pi_action_menu() {
  existing_pi_path="$1"

  reset=
  dim=
  bold=
  cyan=
  green=
  red=
  if [ -t 1 ] && [ "${TERM:-}" != "dumb" ]; then
    reset="${PI_ESC}[0m"
    dim="${PI_ESC}[2m"
    bold="${PI_ESC}[1m"
    cyan="${PI_ESC}[36m"
    green="${PI_ESC}[32m"
    red="${PI_ESC}[31m"
  fi

  if [ -n "$existing_pi_path" ]; then
    printf '%sPi is already installed at:%s\n\n' "$bold" "$reset"
    printf '  %s\n\n' "$existing_pi_path"
  fi

  if [ -n "${PI_NPM_INSTALL_PREFIX:-}" ]; then
    printf "npm's global directory is not writable; Pi will be installed under %s.\n\n" "$PI_NPM_INSTALL_PREFIX"
  fi

  if [ "$PI_LEGACY_NPM_MIGRATION" = 1 ]; then
    printf 'This Pi was installed with npm. Pi now uses a managed installation\n'
    printf 'that pins all dependencies and updates itself with: pi update\n\n'
    printf '%sMigration:%s\n\n  ' "$bold" "$reset"
  elif pi_managed_install_enabled; then
    if [ -n "$existing_pi_path" ]; then
      printf '%sReinstallation:%s\n\n  ' "$bold" "$reset"
    else
      printf '%sInstallation:%s\n\n  ' "$bold" "$reset"
    fi
  elif [ -n "$existing_pi_path" ]; then
    printf '%sReinstall command:%s\n\n  ' "$bold" "$reset"
  else
    printf '%sInstall command:%s\n\n  ' "$bold" "$reset"
  fi
  print_pi_install_command
  printf '\n\n'

  printf '%sChoose an action:%s\n\n' "$bold" "$reset"
  if [ "$PI_LEGACY_NPM_MIGRATION" = 1 ]; then
    printf '  %s%-4s%s %sMigrate Pi to a managed installation%s %s(default)%s\n' "$cyan" 'y' "$reset" "$green" "$reset" "$dim" "$reset"
    printf '  %s%-4s%s %sUninstall Pi%s\n' "$cyan" 'u' "$reset" "$red" "$reset"
  elif [ -n "$existing_pi_path" ]; then
    printf '  %s%-4s%s %sReinstall Pi%s %s(default)%s\n' "$cyan" 'y' "$reset" "$green" "$reset" "$dim" "$reset"
    printf '  %s%-4s%s %sUninstall Pi%s\n' "$cyan" 'u' "$reset" "$red" "$reset"
  else
    printf '  %s%-4s%s %sInstall Pi%s %s(default)%s\n' "$cyan" 'y' "$reset" "$green" "$reset" "$dim" "$reset"
  fi
  printf '  %s%-4s%s %sDo nothing%s\n' "$cyan" 'n' "$reset" "$dim" "$reset"
}

print_pi_action_selection() {
  case "$1" in
    install) message="Will install Pi." ;;
    reinstall) message="Will reinstall Pi." ;;
    migrate) message="Will migrate Pi to a managed installation." ;;
    uninstall) message="Will uninstall Pi." ;;
    none) message="Chose to do nothing. Exiting." ;;
  esac
  printf '\n%s\n\n' "$message"
}

restore_tty_state() {
  tty_state="$1"
  [ -n "$tty_state" ] || return 0
  stty "$tty_state" < /dev/tty 2>/dev/null || true
}

read_tty_key() {
  old_tty_state=$(stty -g < /dev/tty 2>/dev/null || true)
  trap 'restore_tty_state "$old_tty_state"; trap - INT TERM; exit 130' INT TERM
  stty -icanon -echo min 1 time 0 < /dev/tty 2>/dev/null || true
  if ! key=$(dd bs=1 count=1 2>/dev/null < /dev/tty); then
    key=
  fi
  restore_tty_state "$old_tty_state"
  trap - INT TERM
  printf '%s' "$key"
}

print_pi_install_command() {
  if [ "$PI_LEGACY_NPM_MIGRATION" = 1 ]; then
    printf 'Pi will install to %s/%s, then remove the npm package:\n  ' "$PI_MANAGED_BIN_DIR" "$PI_CMD"
    print_npm_uninstall_command
  elif pi_managed_install_enabled; then
    printf 'Pi will install to %s/%s' "$PI_MANAGED_BIN_DIR" "$PI_CMD"
  elif [ -n "${PI_NPM_INSTALL_PREFIX:-}" ]; then
    printf 'Using legacy self managed installation\n  npm install -g --ignore-scripts %s --prefix %s %s' "$PI_NPM_INSTALL_MIN_AGE_ARG" "$PI_NPM_INSTALL_PREFIX" "$PI_PACKAGE"
  else
    printf 'Using legacy self managed installation\n  npm install -g --ignore-scripts %s %s' "$PI_NPM_INSTALL_MIN_AGE_ARG" "$PI_PACKAGE"
  fi
}

pi_managed_install_enabled() {
  [ "${PI_LEGACY_INSTALL:-}" != 1 ]
}

ensure_managed_install_supported() {
  case "$(uname -s)" in
    Darwin|Linux) return 0 ;;
    *)
      printf 'Managed Pi installs currently support macOS and Linux only.\n' >&2
      return 1
      ;;
  esac
}

managed_install_marker_is_valid() {
  managed_root="$1"
  marker_path="$managed_root/$PI_MANAGED_INSTALL_MARKER"
  [ -f "$marker_path" ] || return 1

  node - "$marker_path" <<'NODE' >/dev/null 2>&1
const fs = require("node:fs");
const marker = JSON.parse(fs.readFileSync(process.argv[2], "utf8").replace(/^\uFEFF/, ""));
if (
	marker.kind !== "pi-managed-install" ||
	marker.schemaVersion !== 1 ||
	marker.layout !== "releases-v1"
) {
	process.exit(1);
}
NODE
}

managed_install_root_for_command() {
  managed_command_path="$1"
  [ -n "$managed_command_path" ] || return 1
  [ "${managed_command_path##*/}" = "$PI_CMD" ] || return 1

  managed_candidate=${managed_command_path%/*}
  if managed_install_marker_is_valid "$managed_candidate"; then
    printf '%s' "$managed_candidate"
    return 0
  fi

  if ! managed_resolved_command=$(node - "$managed_command_path" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
let resolved = path.resolve(process.argv[2]);
while (fs.lstatSync(resolved).isSymbolicLink()) {
	const target = fs.readlinkSync(resolved);
	resolved = path.resolve(path.dirname(resolved), target);
}
console.log(resolved);
NODE
  ); then
    return 1
  fi
  [ "${managed_resolved_command##*/}" = "$PI_CMD" ] || return 1
  managed_resolved_bin=${managed_resolved_command%/*}
  [ "${managed_resolved_bin##*/}" = bin ] || return 1
  managed_candidate=${managed_resolved_bin%/*}/install
  if managed_install_marker_is_valid "$managed_candidate"; then
    printf '%s' "$managed_candidate"
    return 0
  fi
  return 1
}

select_managed_install_dir() {
  existing_pi_path="$1"

  if [ -n "${PI_MANAGED_INSTALL_ROOT:-}" ]; then
    managed_candidate=${PI_MANAGED_INSTALL_ROOT%/}
    if managed_install_marker_is_valid "$managed_candidate"; then
      printf '%s' "$managed_candidate"
      return 0
    fi
  fi

  if managed_candidate=$(managed_install_root_for_command "$existing_pi_path"); then
    printf '%s' "$managed_candidate"
    return 0
  fi

  managed_agent_dir=${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}
  printf '%s/install' "${managed_agent_dir%/}"
}

select_managed_path_bin_dir() {
  managed_agent_dir="$1"
  managed_root="$2"
  existing_pi_path="$3"

  if [ -n "$existing_pi_path" ] && managed_existing_root=$(managed_install_root_for_command "$existing_pi_path") && [ "$managed_existing_root" = "$managed_root" ]; then
    managed_existing_bin=${existing_pi_path%/*}
    if [ "$managed_existing_bin" != "$managed_root" ]; then
      printf '%s' "$managed_existing_bin"
      return 0
    fi
  fi

  managed_path_ifs=${IFS- }
  IFS=:
  for managed_path_dir in ${PATH:-}; do
    IFS=$managed_path_ifs
    managed_path_dir=${managed_path_dir%/}
    case "$managed_path_dir" in
      "$managed_agent_dir/bin"|"$HOME/.local/bin"|"$HOME/bin"|"$HOME/.bin"|"$HOME/local/bin")
        if path_is_writable_or_creatable "$managed_path_dir" && managed_path_bin_dir_is_free "$managed_path_dir" "$managed_root"; then
          printf '%s' "$managed_path_dir"
          return 0
        fi
        ;;
    esac
    IFS=:
  done
  IFS=$managed_path_ifs

  # Homebrew's bin directory (/opt/homebrew/bin, Intel /usr/local/bin,
  # Linuxbrew) is user-writable and on PATH for most macOS developers, where
  # ~/.local/bin is not a default. Recognize it by the brew executable.
  IFS=:
  for managed_path_dir in ${PATH:-}; do
    IFS=$managed_path_ifs
    managed_path_dir=${managed_path_dir%/}
    if [ -n "$managed_path_dir" ] && [ -x "$managed_path_dir/brew" ] && [ -w "$managed_path_dir" ] && managed_path_bin_dir_is_free "$managed_path_dir" "$managed_root"; then
      printf '%s' "$managed_path_dir"
      return 0
    fi
    IFS=:
  done
  IFS=$managed_path_ifs

  printf '%s/bin' "$managed_agent_dir"
}

# A bin directory can host the managed entrypoint if it has no pi yet or its pi
# already belongs to this managed install. This keeps Pi from taking over a pi
# owned by something else, such as Homebrew's pi-coding-agent formula.
managed_path_bin_dir_is_free() {
  free_bin_dir="$1"
  free_managed_root="$2"

  if [ ! -e "$free_bin_dir/$PI_CMD" ] && [ ! -L "$free_bin_dir/$PI_CMD" ]; then
    return 0
  fi
  free_existing_root=$(managed_install_root_for_command "$free_bin_dir/$PI_CMD" 2>/dev/null) || return 1
  [ "$free_existing_root" = "$free_managed_root" ]
}

install_pi_package() {
  if [ -t 1 ] && [ "${TERM:-}" != "dumb" ]; then
    install_pi_package_with_progress
  else
    printf 'Installing Pi...\n\n'
    run_pi_install error
  fi
}

run_pi_install() {
  npm_loglevel="$1"
  if pi_managed_install_enabled; then
    run_managed_install_pi "$npm_loglevel"
  else
    run_npm_install_pi "$npm_loglevel"
  fi
}

run_npm_install_pi() {
  npm_loglevel="$1"
  if [ -n "${PI_NPM_INSTALL_PREFIX:-}" ]; then
    npm install -g --ignore-scripts "$PI_NPM_INSTALL_MIN_AGE_ARG" --prefix "$PI_NPM_INSTALL_PREFIX" --no-fund --no-audit "--loglevel=$npm_loglevel" --progress=false "$PI_PACKAGE"
  else
    npm install -g --ignore-scripts "$PI_NPM_INSTALL_MIN_AGE_ARG" --no-fund --no-audit "--loglevel=$npm_loglevel" --progress=false "$PI_PACKAGE"
  fi
}

download_installer_artifact() {
  url="$1"
  output="$2"
  label="$3"

  if ! command -v curl >/dev/null 2>&1; then
    printf 'curl is not available for the managed installer.\n' >&2
    return 1
  fi

  http_status=$(curl -L -sS -w '%{http_code}' -o "$output" "$url") || {
    rm -f "$output"
    printf 'Could not download %s from %s.\n' "$label" "$url" >&2
    return 1
  }

  if [ "$http_status" = 200 ]; then
    return 0
  fi

  rm -f "$output"
  printf 'Managed installer %s is unavailable at %s (HTTP %s).\n' "$label" "$url" "$http_status" >&2
  return 1
}

managed_install_release_version() {
  metadata_path="$1"

  node - "$metadata_path" <<'NODE'
const fs = require("node:fs");
const metadata = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const version = metadata.version;

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
	throw new Error("managed installer metadata has an invalid version");
}
console.log(version);
NODE
}

download_managed_install_artifacts() {
  managed_stage_dir="$1"

  printf 'Downloading managed installer release metadata\n' >&2
  download_installer_artifact "$PI_INSTALLER_API_BASE/latest" "$managed_stage_dir/metadata.json" "release metadata" || return 1

  if ! managed_version=$(managed_install_release_version "$managed_stage_dir/metadata.json"); then
    printf 'Managed installer release metadata is invalid.\n' >&2
    return 1
  fi

  printf 'Downloading managed installer package.json for Pi %s\n' "$managed_version" >&2
  download_installer_artifact "$PI_INSTALLER_API_BASE/$managed_version/package.json" "$managed_stage_dir/package.json" "package.json" || return 1

  printf 'Downloading managed installer package-lock.json for Pi %s\n' "$managed_version" >&2
  download_installer_artifact "$PI_INSTALLER_API_BASE/$managed_version/package-lock.json" "$managed_stage_dir/package-lock.json" "package-lock.json" || return 1

  validate_managed_install_artifacts "$managed_stage_dir/package.json" "$managed_stage_dir/package-lock.json" "$managed_version"
}

validate_managed_install_artifacts() {
  package_json_path="$1"
  package_lock_path="$2"
  managed_version="$3"

  node - "$package_json_path" "$package_lock_path" "$PI_PACKAGE" "$managed_version" <<'NODE'
const fs = require("node:fs");
const packageJson = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const packageLock = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const piPackage = process.argv[4];
const version = process.argv[5];
const root = packageLock.packages?.[""];
const piEntry = packageLock.packages?.[`node_modules/${piPackage}`];

if (packageJson.version !== version || packageJson.dependencies?.[piPackage] !== version) {
	throw new Error(`managed installer package.json must describe ${piPackage}@${version}`);
}
if (packageLock.lockfileVersion !== 3) {
	throw new Error("managed installer package-lock.json must use lockfileVersion 3");
}
if (packageLock.version !== version || root?.version !== version || root?.dependencies?.[piPackage] !== version) {
	throw new Error(`managed installer package-lock.json root must describe ${piPackage}@${version}`);
}
if (piEntry?.version !== version) {
	throw new Error(`managed installer package-lock.json does not include ${piPackage}@${version}`);
}
NODE
}

write_managed_install_marker() {
  managed_root="$1"
  managed_entrypoint_type="$2"
  managed_entrypoint_path="$3"
  marker_tmp="$managed_root/$PI_MANAGED_INSTALL_MARKER.tmp.$$"

  node - "$marker_tmp" "$managed_entrypoint_type" "$managed_entrypoint_path" <<'NODE'
const fs = require("node:fs");
const markerPath = process.argv[2];
const entrypointType = process.argv[3];
const entrypointPath = process.argv[4];
fs.writeFileSync(
	markerPath,
	`${JSON.stringify(
		{
			kind: "pi-managed-install",
			schemaVersion: 1,
			layout: "releases-v1",
			entrypoint: { type: entrypointType, path: entrypointPath },
		},
		null,
		2,
	)}\n`,
);
NODE
  mv -f "$marker_tmp" "$managed_root/$PI_MANAGED_INSTALL_MARKER"
}

managed_install_entrypoint_path() {
  managed_root="$1"

  node - "$managed_root/$PI_MANAGED_INSTALL_MARKER" <<'NODE'
const fs = require("node:fs");
const marker = JSON.parse(fs.readFileSync(process.argv[2], "utf8").replace(/^\uFEFF/, ""));
if (typeof marker.entrypoint?.path !== "string" || !marker.entrypoint.path) process.exit(1);
console.log(marker.entrypoint.path);
NODE
}

write_managed_install_launcher() {
  managed_agent_dir="$1"
  managed_launcher_dir="$managed_agent_dir/bin"
  managed_launcher="$managed_launcher_dir/$PI_CMD"
  launcher_tmp="$managed_launcher.tmp.$$"

  # Callers verified the managed marker, so an existing launcher is ours and is
  # rewritten to pick up launcher fixes on reinstall.
  if [ -e "$managed_launcher" ] && [ ! -f "$managed_launcher" ]; then
    return 1
  fi

  mkdir -p "$managed_launcher_dir"
  cat >"$launcher_tmp" <<'EOF'
#!/bin/sh
case "$0" in
  */*) pi_launcher="$0" ;;
  *) pi_launcher=$(command -v "$0") || exit 127 ;;
esac
while [ -L "$pi_launcher" ]; do
  pi_link=$(readlink "$pi_launcher") || exit 1
  case "$pi_link" in
    /*) pi_launcher="$pi_link" ;;
    *) pi_launcher=${pi_launcher%/*}/$pi_link ;;
  esac
done
pi_bin_dir=${pi_launcher%/*}
pi_agent_dir=${pi_bin_dir%/*}
pi_current_file=$pi_agent_dir/install/current-version
if ! IFS= read -r pi_current_version < "$pi_current_file"; then
  printf 'Could not read managed Pi version from %s.\n' "$pi_current_file" >&2
  exit 1
fi
case "$pi_current_version" in
  ""|.|..|*[!0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz._+-]*)
    printf 'Managed Pi version file is invalid: %s\n' "$pi_current_file" >&2
    exit 1
    ;;
esac
pi_release_dir=$pi_agent_dir/install/releases/$pi_current_version
pi_release_bin=$pi_release_dir/node_modules/.bin/pi
if [ ! -x "$pi_release_bin" ]; then
  printf 'Managed Pi executable is missing: %s\n' "$pi_release_bin" >&2
  exit 1
fi
# Node.js installed by the Pi installer is not added to shell profiles, so put
# it on PATH for pi's shebang and for child processes: npm in pi update and
# commands run through pi's bash tool.
pi_node_bin=${XDG_DATA_HOME:-$HOME/.local/share}/pi-node/current/bin
if [ -x "$pi_node_bin/node" ]; then
  PATH=$pi_node_bin:$PATH
  export PATH
fi
PI_MANAGED_INSTALL_ROOT=$pi_agent_dir/install
export PI_MANAGED_INSTALL_ROOT
exec "$pi_release_bin" "$@"
EOF
  chmod 755 "$launcher_tmp"
  mv -f "$launcher_tmp" "$managed_launcher"
}

write_managed_install_link() {
  managed_agent_dir="$1"
  managed_bin_dir="$2"
  managed_launcher="$managed_agent_dir/bin/$PI_CMD"
  managed_entrypoint="$managed_bin_dir/$PI_CMD"

  if [ "$managed_entrypoint" = "$managed_launcher" ]; then
    return 0
  fi
  mkdir -p "$managed_bin_dir"
  if [ -e "$managed_entrypoint" ] && [ ! -L "$managed_entrypoint" ]; then
    printf 'Refusing to replace the executable at %s.\n' "$managed_entrypoint" >&2
    return 1
  fi

  managed_link_target=$(node - "$managed_bin_dir" "$managed_launcher" <<'NODE'
const path = require("node:path");
console.log(path.relative(process.argv[2], process.argv[3]));
NODE
  )
  managed_link_tmp="$managed_bin_dir/.$PI_CMD.tmp.$$"
  rm -f "$managed_link_tmp"
  ln -s "$managed_link_target" "$managed_link_tmp"
  mv -f "$managed_link_tmp" "$managed_entrypoint"
}

write_managed_current_version() {
  managed_root="$1"
  managed_version="$2"
  current_tmp="$managed_root/current-version.tmp.$$"

  printf '%s\n' "$managed_version" >"$current_tmp"
  mv -f "$current_tmp" "$managed_root/current-version"
}

print_npm_uninstall_command() {
  if [ -n "${PI_NPM_UNINSTALL_PREFIX:-}" ]; then
    printf 'npm uninstall -g --prefix %s %s' "$PI_NPM_UNINSTALL_PREFIX" "$PI_PACKAGE"
  else
    printf 'npm uninstall -g %s' "$PI_PACKAGE"
  fi
}

ensure_legacy_npm_pi_removable() {
  legacy_prefix=${PI_NPM_UNINSTALL_PREFIX:-$(npm_global_prefix)}
  if [ -n "$legacy_prefix" ] && npm_prefix_supports_global_install "$legacy_prefix"; then
    return 0
  fi

  printf "npm's global directory is not writable, so the npm-installed Pi at %s cannot be removed.\n" "$PI_EXISTING_PATH" >&2
  printf 'Remove it first with sudo, then run this installer again:\n\n  sudo ' >&2
  print_npm_uninstall_command >&2
  printf '\n' >&2
  return 1
}

remove_legacy_npm_pi() {
  npm_loglevel="$1"

  printf 'Removing npm-installed Pi\n' >&2
  run_npm_uninstall_pi "$npm_loglevel" || return
  hash -r
  if [ -e "$PI_EXISTING_PATH" ] || [ -L "$PI_EXISTING_PATH" ]; then
    printf 'npm uninstall finished, but pi is still present at %s.\n' "$PI_EXISTING_PATH" >&2
    return 1
  fi
}

run_managed_install_pi() {
  npm_loglevel="$1"
  managed_root="$PI_MANAGED_INSTALL_DIR"

  if [ "$PI_INSTALL_ACTION" != migrate ] && [ -n "${PI_EXISTING_PATH:-}" ]; then
    if ! managed_existing_root=$(managed_install_root_for_command "$PI_EXISTING_PATH") || [ "$managed_existing_root" != "$managed_root" ]; then
      printf 'Managed install refused to replace Pi at %s. Uninstall it first.\n' "$PI_EXISTING_PATH" >&2
      return 1
    fi
  fi
  if [ -e "$managed_root/$PI_MANAGED_INSTALL_MARKER" ] && ! managed_install_marker_is_valid "$managed_root"; then
    printf 'The managed install marker at %s is invalid.\n' "$managed_root/$PI_MANAGED_INSTALL_MARKER" >&2
    return 1
  fi
  managed_launcher="$PI_MANAGED_AGENT_DIR/bin/$PI_CMD"
  if { [ -e "$managed_launcher" ] || [ -L "$managed_launcher" ]; } && ! managed_install_marker_is_valid "$managed_root"; then
    printf 'Refusing to replace the unrecognized executable at %s.\n' "$managed_launcher" >&2
    return 1
  fi

  mkdir -p "$managed_root/staging" "$managed_root/releases"
  managed_stage_dir="$managed_root/staging/install-$$-$(date +%s)"
  rm -rf "$managed_stage_dir"
  mkdir -p "$managed_stage_dir"

  if ! download_managed_install_artifacts "$managed_stage_dir"; then
    rm -rf "$managed_stage_dir"
    return 1
  fi

  printf 'Installing managed Pi dependencies\n' >&2
  if (cd "$managed_stage_dir" && npm ci --ignore-scripts "$PI_NPM_INSTALL_MIN_AGE_ARG" --omit=dev --include=optional --no-fund --no-audit "--loglevel=$npm_loglevel" --progress=false); then
    managed_status=0
  else
    managed_status=$?
  fi
  if [ "$managed_status" -ne 0 ]; then
    rm -rf "$managed_stage_dir"
    return "$managed_status"
  fi

  managed_staged_bin="$managed_stage_dir/node_modules/.bin/$PI_CMD"
  if [ ! -x "$managed_staged_bin" ]; then
    printf 'Managed Pi executable was not created by npm ci.\n' >&2
    rm -rf "$managed_stage_dir"
    return 1
  fi

  printf 'Verifying managed Pi %s\n' "$managed_version" >&2
  if managed_installed_version=$("$managed_staged_bin" --version); then
    managed_status=0
  else
    managed_status=$?
  fi
  if [ "$managed_status" -ne 0 ]; then
    rm -rf "$managed_stage_dir"
    return "$managed_status"
  fi
  if [ "$managed_installed_version" != "$managed_version" ]; then
    printf 'Managed Pi smoke test returned version %s; expected %s.\n' "$managed_installed_version" "$managed_version" >&2
    rm -rf "$managed_stage_dir"
    return 1
  fi

  managed_release_dir="$managed_root/releases/$managed_version"
  printf 'Activating managed Pi %s\n' "$managed_version" >&2
  if [ -d "$managed_release_dir" ]; then
    rm -rf "$managed_stage_dir"
  elif ! mv "$managed_stage_dir" "$managed_release_dir"; then
    rm -rf "$managed_stage_dir"
    return 1
  fi

  # Remove the npm-installed Pi only after the managed release is verified, so a
  # failed download or npm ci leaves the existing installation working.
  if [ "$PI_INSTALL_ACTION" = migrate ]; then
    remove_legacy_npm_pi "$npm_loglevel" || return
  fi

  if [ "$PI_MANAGED_BIN_DIR/$PI_CMD" = "$PI_MANAGED_AGENT_DIR/bin/$PI_CMD" ]; then
    managed_entrypoint_type=script
  else
    managed_entrypoint_type=symlink
  fi
  write_managed_install_marker "$managed_root" "$managed_entrypoint_type" "$PI_MANAGED_BIN_DIR/$PI_CMD"
  write_managed_install_launcher "$PI_MANAGED_AGENT_DIR"
  write_managed_install_link "$PI_MANAGED_AGENT_DIR" "$PI_MANAGED_BIN_DIR"
  write_managed_current_version "$managed_root" "$managed_version"
  hash -r
  printf 'Managed Pi install complete\n' >&2
}

uninstall_pi_package() {
  if managed_uninstall_root=$(managed_install_root_for_command "$PI_EXISTING_PATH"); then
    printf 'Uninstalling managed Pi...\n\n'
    managed_uninstall_agent=${managed_uninstall_root%/*}
    managed_uninstall_launcher="$managed_uninstall_agent/bin/$PI_CMD"
    managed_uninstall_entrypoint=$(managed_install_entrypoint_path "$managed_uninstall_root" 2>/dev/null || true)
    if [ -n "$managed_uninstall_entrypoint" ] && [ "$managed_uninstall_entrypoint" != "$managed_uninstall_launcher" ] && [ -L "$managed_uninstall_entrypoint" ]; then
      rm -f "$managed_uninstall_entrypoint"
    fi
    if [ "$PI_EXISTING_PATH" != "$managed_uninstall_launcher" ] && [ -L "$PI_EXISTING_PATH" ]; then
      rm -f "$PI_EXISTING_PATH"
    fi
    rm -f "$managed_uninstall_launcher"
    rm -rf "$managed_uninstall_root"
    hash -r
    if [ -e "$PI_EXISTING_PATH" ] || [ -L "$PI_EXISTING_PATH" ]; then
      printf '\nManaged uninstall finished, but pi is still present at:\n\n  %s\n' "$PI_EXISTING_PATH" >&2
      return 1
    fi
    return 0
  fi

  if ! npm_package_is_installed_for_uninstall; then
    printf 'I found pi at:\n\n  %s\n\n' "$PI_EXISTING_PATH" >&2
    printf 'but npm does not show %s installed there.\n' "$PI_PACKAGE" >&2
    printf 'Nothing was removed.\n' >&2
    return 1
  fi

  printf 'Uninstalling Pi...\n\n'
  run_npm_uninstall_pi error
  hash -r

  if [ -e "$PI_EXISTING_PATH" ] || [ -L "$PI_EXISTING_PATH" ]; then
    printf '\nnpm uninstall finished, but pi is still present at:\n\n  %s\n' "$PI_EXISTING_PATH" >&2
    return 1
  fi
}

npm_package_is_installed_for_uninstall() {
  if [ -n "${PI_NPM_UNINSTALL_PREFIX:-}" ]; then
    npm ls -g --prefix "$PI_NPM_UNINSTALL_PREFIX" --depth=0 "$PI_PACKAGE" >/dev/null 2>&1
  else
    npm ls -g --depth=0 "$PI_PACKAGE" >/dev/null 2>&1
  fi
}

run_npm_uninstall_pi() {
  npm_loglevel="$1"
  if [ -n "${PI_NPM_UNINSTALL_PREFIX:-}" ]; then
    npm uninstall -g --prefix "$PI_NPM_UNINSTALL_PREFIX" --no-fund --no-audit "--loglevel=$npm_loglevel" --progress=false "$PI_PACKAGE"
  else
    npm uninstall -g --no-fund --no-audit "--loglevel=$npm_loglevel" --progress=false "$PI_PACKAGE"
  fi
}

install_pi_package_with_progress() {
  log_file="${TMPDIR:-/tmp}/pi-installer-npm.$$"
  rm -f "$log_file"
  : >"$log_file"

  run_pi_install verbose >"$log_file" 2>&1 &
  npm_pid=$!

  printf '\033[?25l'
  animate_npm_install "$log_file" &
  progress_pid=$!
  trap 'kill "$npm_pid" 2>/dev/null || true; finish_install_progress "$progress_pid"; exit 130' INT TERM

  if wait "$npm_pid"; then
    status=0
  else
    status=$?
  fi

  finish_install_progress "$progress_pid"
  trap - INT TERM

  if [ "$status" -ne 0 ]; then
    printf '\033[31mInstallation failed.\033[0m\n\n'
    cat "$log_file"
    rm -f "$log_file"
    return "$status"
  fi

  rm -f "$log_file"
  if terminal_supports_unicode; then
    printf '  \033[32m✓\033[0m install complete\n'
  else
    printf '  \033[32mok\033[0m install complete\n'
  fi
}

finish_install_progress() {
  progress_pid="$1"

  kill "$progress_pid" 2>/dev/null || true
  wait "$progress_pid" 2>/dev/null || true
  printf '\r\033[K\033[?25h'
}

terminal_supports_unicode() {
  locale="${LC_ALL:-${LC_CTYPE:-${LANG:-}}}"

  case "$locale" in
    *UTF-8*|*utf-8*|*UTF8*|*utf8*) return 0 ;;
  esac

  case "${TERM_PROGRAM:-}" in
    Apple_Terminal|iTerm.app|vscode|WezTerm) return 0 ;;
  esac

  return 1
}

spinner_frame() {
  frame_step="$1"
  frame_count="$2"

  if [ "$frame_count" -eq 10 ]; then
    case $((frame_step % 10)) in
      0) printf '⠋' ;;
      1) printf '⠙' ;;
      2) printf '⠹' ;;
      3) printf '⠸' ;;
      4) printf '⠼' ;;
      5) printf '⠴' ;;
      6) printf '⠦' ;;
      7) printf '⠧' ;;
      8) printf '⠇' ;;
      *) printf '⠏' ;;
    esac
  else
    case $((frame_step % 4)) in
      0) printf '-' ;;
      1) printf '\\' ;;
      2) printf '|' ;;
      *) printf '/' ;;
    esac
  fi
}

animate_npm_install() {
  log_file="$1"

  if terminal_supports_unicode; then
    full="█"
    empty="░"
    frame_count=10
  else
    full="#"
    empty="-"
    frame_count=4
  fi

  step=0
  if pi_managed_install_enabled; then
    label="starting managed install"
  else
    label="starting npm install"
  fi
  while :; do
    frame=$(spinner_frame "$step" "$frame_count")
    if [ $((step % 5)) -eq 0 ]; then
      label=$(npm_install_progress_label "$log_file" "$label")
    fi
    draw_install_progress "$step" "$frame" "$label" "$full" "$empty"
    step=$((step + 1))
    sleep 0.08
  done
}

animate_node_install() {
  log_file="$1"
  method_label="$2"

  if terminal_supports_unicode; then
    full="█"
    empty="░"
    frame_count=10
  else
    full="#"
    empty="-"
    frame_count=4
  fi

  step=0
  label="starting ${method_label} install"
  while :; do
    frame=$(spinner_frame "$step" "$frame_count")
    if [ $((step % 5)) -eq 0 ]; then
      label=$(node_install_progress_label "$log_file" "$label")
    fi
    draw_install_progress "$step" "$frame" "$label" "$full" "$empty" "Installing Node.js"
    step=$((step + 1))
    sleep 0.08
  done
}

node_install_progress_label() {
  log_file="$1"
  label="$2"

  while IFS= read -r line; do
    line=${line##*"$PI_CR"}
    case "$line" in
      "") ;;
      Resolving\ Node.js*) label="resolving Node.js binary" ;;
      Downloading\ Node.js*) label="$line" ;;
      Verifying\ Node.js*) label="verifying download" ;;
      Installing\ xz-utils*) label="installing xz-utils" ;;
      Extracting\ Node.js*) label="extracting Node.js" ;;
      Node.js\ installed*) label="Node.js installed" ;;
      Hit:*|Get:*|Ign:*) label="updating package lists" ;;
      Reading\ package\ lists*) label="reading package lists" ;;
      Building\ dependency\ tree*) label="resolving dependencies" ;;
      The\ following\ NEW\ packages*) label="installing dependencies" ;;
      Need\ to\ get*|Fetched\ *) label="$line" ;;
      Selecting\ previously\ unselected\ package*) label="selecting packages" ;;
      Preparing\ to\ unpack*) label="preparing packages" ;;
      Unpacking\ *|Setting\ up\ *) label="$line" ;;
      fetch\ *) label="fetching packages" ;;
      *Installing\ nodejs*) label="$line" ;;
      OK:\ *) label="$line" ;;
      ==\>\ Downloading*) label="downloading packages" ;;
      ==\>\ Installing*|==\>\ Upgrading*) label="$line" ;;
      ==\>\ Pouring*) label="installing package" ;;
      *already\ installed*) label="$line" ;;
    esac
  done < "$log_file"

  if [ "${#label}" -gt 64 ]; then
    label=$(printf '%.61s...' "$label")
  fi
  printf '%s' "$label"
}

npm_install_progress_label() {
  log_file="$1"
  label="$2"
  metadata_cache_count=0
  metadata_fetch_count=0
  tarball_cache_count=0
  tarball_fetch_count=0

  while IFS= read -r line; do
    line=${line%"$PI_CR"}
    case "$line" in
      Downloading\ managed\ installer\ release\ metadata*)
        label="resolving managed release"
        ;;
      Downloading\ managed\ installer\ package.json*)
        label="fetching managed package manifest"
        ;;
      Downloading\ managed\ installer\ package-lock.json*)
        label="fetching managed package lock"
        ;;
      Installing\ managed\ Pi\ dependencies*)
        label="installing managed dependencies"
        ;;
      Verifying\ managed\ Pi*)
        label="verifying managed package"
        ;;
      Activating\ managed\ Pi*)
        label="activating managed package"
        ;;
      Removing\ npm-installed\ Pi*)
        label="removing npm-installed package"
        ;;
      Managed\ Pi\ install\ complete*)
        label="managed install complete"
        ;;
      npm\ verbose\ title\ npm\ install*|npm\ verbose\ title\ npm\ ci*)
        label="resolving packages"
        ;;
      npm\ http\ fetch\ GET\ *https://registry.npmjs.org/*.tgz*)
        tarball_fetch_count=$((tarball_fetch_count + 1))
        label="fetching tarballs (${tarball_fetch_count})"
        ;;
      npm\ http\ cache\ *@https://registry.npmjs.org/*.tgz*)
        tarball_cache_count=$((tarball_cache_count + 1))
        if [ "$tarball_fetch_count" -gt 0 ]; then
          label="fetching tarballs (${tarball_fetch_count})"
        else
          label="checking tarballs (${tarball_cache_count})"
        fi
        ;;
      npm\ http\ fetch\ GET\ *https://registry.npmjs.org/*)
        metadata_fetch_count=$((metadata_fetch_count + 1))
        label="fetching package metadata (${metadata_fetch_count})"
        ;;
      npm\ http\ cache\ https://registry.npmjs.org/*)
        metadata_cache_count=$((metadata_cache_count + 1))
        if [ "$metadata_fetch_count" -gt 0 ]; then
          label="fetching package metadata (${metadata_fetch_count})"
        else
          label="checking cached metadata (${metadata_cache_count})"
        fi
        ;;
      npm\ info\ run\ *)
        rest=${line#npm info run }
        package=${rest%% *}
        rest=${rest#* }
        script=${rest%% *}
        package=${package%@*}
        case "$line" in
          *\{\ code:*) label="finished ${script} for ${package}" ;;
          *) label="running ${script} for ${package}" ;;
        esac
        ;;
      changed\ *|added\ *|removed\ *|updated\ *|up\ to\ date\ *)
        label="$line"
        ;;
    esac
  done < "$log_file"

  printf '%s' "$label"
}

draw_install_progress() {
  step="$1"; frame="$2"; label="$3"; full="$4"; empty="$5"; title="${6:-Installing Pi}"

  reset="${PI_ESC}[0m"
  dim="${PI_ESC}[2m"
  coral="${PI_ESC}[38;2;240;144;130m"
  blue="${PI_ESC}[38;2;77;154;191m"
  gold="${PI_ESC}[38;2;241;190;88m"
  turquoise="${PI_ESC}[38;2;131;204;210m"
  bold="${PI_ESC}[1m"

  width=28
  trail=8
  head=$((step % (width + trail)))
  bar=""

  i=0
  while [ "$i" -lt "$width" ]; do
    age=$((head - i))
    if [ "$age" -ge 0 ] && [ "$age" -lt "$trail" ]; then
      case "$age" in
        0|1) cell="${gold}${full}${reset}" ;;
        2|3) cell="${coral}${full}${reset}" ;;
        4|5) cell="${blue}${full}${reset}" ;;
        *) cell="${turquoise}${full}${reset}" ;;
      esac
    else
      cell="${dim}${empty}${reset}"
    fi
    bar="${bar}${cell}"
    i=$((i + 1))
  done

  printf '\r\033[K  %s%s%s %s %s%s%s %s' "$turquoise" "$frame" "$reset" "$bar" "$bold" "$title" "$reset" "$label"
}

pi_logo_animation() {
  if [ ! -t 1 ] || [ "${TERM:-}" = "dumb" ]; then
    print_static_logo
    return
  fi

  esc="${PI_ESC}["
  reset="${PI_ESC}[0m"
  hide="${esc}?25l"
  show="${esc}?25h"
  clear="${esc}H"

  trap 'printf "%s%s\n" "$reset" "$show"; trap - INT TERM; exit 130' INT TERM
  printf '%s%s' "$hide" "${esc}2J${esc}H"

  for y in 0 1 2 3; do draw_logo_frame "$clear" "$reset" 0 left 2 "$y" 0 0; sleep 0.075; done
  for y in 0 1 2; do draw_logo_frame "$clear" "$reset" 1 top 2 "$y" 0 0; sleep 0.075; done
  for y in 0 1 2 3 4; do draw_logo_frame "$clear" "$reset" 2 right 5 "$y" 0 0; sleep 0.075; done

  draw_logo_frame "$clear" "$reset" 3 none 0 0 0 0; sleep 0.25
  draw_logo_frame "$clear" "$reset" 3 none 0 0 1 0; sleep 0.08
  draw_logo_frame "$clear" "$reset" 3 none 0 0 0 0; sleep 0.08
  draw_logo_frame "$clear" "$reset" 3 none 0 0 1 0; sleep 0.08
  draw_logo_frame "$clear" "$reset" 4 none 0 0 0 0; sleep 0.10
  draw_logo_frame "$clear" "$reset" 5 none 0 0 0 0; sleep 0.45
  draw_logo_frame "$clear" "$reset" 5 none 0 0 0 1; sleep 0.12
  draw_logo_frame "$clear" "$reset" 5 none 0 0 0 0; sleep 0.12
  draw_logo_frame "$clear" "$reset" 5 none 0 0 0 1; sleep 0.45

  printf '%s%s\n' "$reset" "$show"
  trap - INT TERM
}

draw_logo_frame() {
  clear="$1"; reset="$2"; phase="$3"; active="$4"; ax="$5"; ay="$6"; flash="$7"; white="$8"

  left=0
  top=0

  panel_cell="${reset}  "
  coral_cell="${PI_ESC}[38;2;240;144;130m██"
  blue_cell="${PI_ESC}[38;2;77;154;191m██"
  gold_cell="${PI_ESC}[38;2;241;190;88m██"
  turquoise_cell="${PI_ESC}[38;2;131;204;210m██"
  white_cell="${PI_ESC}[39m██"
  flash_cell="${PI_ESC}[38;2;255;255;255m██"

  pad=$(repeat_space "$left")
  clear_cell="$panel_cell"
  frame="$clear"
  i=0
  while [ "$i" -lt "$top" ]; do frame="${frame}\n"; i=$((i + 1)); done

  for y in 0 1 2 3 4 5 6 7 8; do
    frame="${frame}${pad}"
    for x in 1 2 3 4 5 6 7 8; do
      set_logo_cell_color "$phase" "$active" "$ax" "$ay" "$flash" "$white" "$y" "$x"
      case "$LOGO_COLOR" in
        coral) cell="$coral_cell" ;;
        blue) cell="$blue_cell" ;;
        gold) cell="$gold_cell" ;;
        turquoise) cell="$turquoise_cell" ;;
        white) cell="$white_cell" ;;
        flash) cell="$flash_cell" ;;
        *) cell="$clear_cell" ;;
      esac
      frame="${frame}${cell}"
    done
    frame="${frame}${reset}\n"
  done
  printf '%b' "$frame" 2>/dev/null || true
}

set_logo_cell_color() {
  phase="$1"; active="$2"; ax="$3"; ay="$4"; flash="$5"; white="$6"; y="$7"; x="$8"

  if [ "$white" = 1 ]; then
    if in_cells "$y" "$x" "3,2 3,3 3,4 4,2 4,4 5,2 5,3 5,5 6,2 6,5"; then LOGO_COLOR=white; else LOGO_COLOR=panel; fi
    return
  fi
  if [ "$flash" = 1 ] && [ "$y" = 6 ] && [ "$x" -ge 1 ] && [ "$x" -le 6 ]; then LOGO_COLOR=flash; return; fi

  case "$active" in
    left)  if in_piece "$y" "$x" "$ay" "$ax" "0,0 1,0 1,1 2,0"; then LOGO_COLOR=blue; return; fi ;;
    top)   if in_piece "$y" "$x" "$ay" "$ax" "0,0 0,1 0,2 1,2"; then LOGO_COLOR=coral; return; fi ;;
    right) if in_piece "$y" "$x" "$ay" "$ax" "0,0 1,0 2,0 2,1"; then LOGO_COLOR=gold; return; fi ;;
  esac

  if [ "$phase" = 4 ]; then
    if in_cells "$y" "$x" "2,2 2,3 2,4 3,4"; then LOGO_COLOR=coral; return; fi
    if in_cells "$y" "$x" "3,2 4,2 4,3 5,2"; then LOGO_COLOR=blue; return; fi
    if in_cells "$y" "$x" "4,5 5,5"; then LOGO_COLOR=gold; return; fi
    LOGO_COLOR=panel; return
  fi

  if [ "$phase" -ge 5 ]; then
    if in_cells "$y" "$x" "3,2 3,3 3,4 4,4"; then LOGO_COLOR=coral; return; fi
    if in_cells "$y" "$x" "4,2 5,2 5,3 6,2"; then LOGO_COLOR=blue; return; fi
    if in_cells "$y" "$x" "5,5 6,5"; then LOGO_COLOR=gold; return; fi
    LOGO_COLOR=panel; return
  fi

  if [ "$phase" -le 3 ] && in_cells "$y" "$x" "6,1 6,2 6,3 6,4"; then LOGO_COLOR=turquoise; return; fi
  if [ "$phase" -ge 2 ] && in_cells "$y" "$x" "2,2 2,3 2,4 3,4"; then LOGO_COLOR=coral; return; fi
  if [ "$phase" -ge 1 ] && in_cells "$y" "$x" "3,2 4,2 4,3 5,2"; then LOGO_COLOR=blue; return; fi
  if [ "$phase" -ge 3 ] && in_cells "$y" "$x" "4,5 5,5 6,5 6,6"; then LOGO_COLOR=gold; return; fi

  LOGO_COLOR=panel
}

in_piece() {
  y="$1"; x="$2"; py="$3"; px="$4"; cells="$5"
  for item in $cells; do
    dy=${item%,*}; dx=${item#*,}
    [ "$y" -eq $((py + dy)) ] && [ "$x" -eq $((px + dx)) ] && return 0
  done
  return 1
}

in_cells() {
  y="$1"; x="$2"; shift 2
  for item in $1; do
    [ "$item" = "$y,$x" ] && return 0
  done
  return 1
}

repeat_space() {
  count="$1"; out=""
  while [ "$count" -gt 0 ]; do out=" $out"; count=$((count - 1)); done
  printf '%s' "$out"
}

print_static_logo() {
  cat <<'EOF'

  ██████
  ██  ██
  ████  ██
  ██    ██

EOF
}

pi_installer_main "$@"
