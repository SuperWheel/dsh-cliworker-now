// RECORDED stable text from isolated macOS 200×60 captures on 2026-11-07.
// Paths, ports and query values below are SIMULATED; no authorization was submitted.
// Evidence: openspec/changes/add-new-cli-graphical-login/capture-2026-11-07.md.
export const codebuddyTrustRecorded = [
  'Do you trust the files in this folder?', '/private/tmp/SIMULATED',
  'CodeBuddy Code may read, write, or execute files contained in this directory. This can pose security risks, so only use files and bash commands from trusted sources.',
  '> 1. Trust folder only (SIMULATED)', '2. Trust parent folder (tmp/**)',
  '3. Trust folder and all subdirectories (SIMULATED/**)', '4. No, exit (escape)',
  'Enter to confirm • Esc to exit',
].join('\r\n')
export const traePersonalRecorded = [
  'Opening personal sign-in in your browser. If your browser did not open, visit:', '',
  'https://www.trae.cn/authorization?state=SIMULATED', '',
  'After signing in on another machine, paste the final 127.0.0.1 callback URL to verify automatically. If typing manually, press Enter to verify. Input is hidden on terminals.',
  'Paste callback URL to verify automatically:',
].join('\r\n')
export const traeEnterpriseRecorded = [
  'Starting TRAE CLI ToB enterprise SSO login server on http://localhost:12345.',
  'If your browser did not open, navigate to this URL to authenticate:',
  'https://console.enterprise.trae.cn/authorization?state=SIMULATED',
  'After signing in on another machine, copy the final 127.0.0.1 callback URL, paste it here to verify automatically. If typing manually, press Enter to verify. Input is hidden on terminals.',
  'Paste callback URL to verify automatically:',
].join('\r\n')
export const traePatRecorded = '--with-trae-pat expects TRAECLI_PERSONAL_ACCESS_TOKEN or PAT on stdin. Try `export TRAECLI_PERSONAL_ACCESS_TOKEN=...` then `/SIMULATED/traecli login --with-trae-pat`.'
export const traeSignedOutRecorded = 'Not logged in\r\n'

// Follow-up capture: empty project inside throwaway HOME; user-authorized folder
// trust only. ESC from the initial menu reached this blank editor. Banner model,
// paths and tips omitted: they are variable and are not readiness markers.
export const codebuddyEditorRecorded = 'CodeBuddy Code v2.181.0\r\n────────────────\r\n>  \r\n────────────────\r\nclaude-sonnet-5 high · ← for agents · ? for shortcuts'
export const codebuddySitesRecorded = [
  'Select login method:', '', '❯ Log in via Chinese Site', '',
  '  Log in via International Site', '', '  Log in via Enterprise Domain', '',
  '  Log in via iOA (Tencent only)', '', '(Use ↑↓ to select, Enter to login)',
].join('\r\n')
// Arrow-down redraw was recorded; reconstructing it as a full VT clear below is
// SIMULATED. Tests also replay the recorded cursor-based redraw fixture.
export const codebuddyInternationalRecorded = codebuddySitesRecorded
  .replace('❯ Log in via Chinese Site', '  Log in via Chinese Site')
  .replace('  Log in via International Site', '❯ Log in via International Site')
export const codebuddyChinaBrowserRecorded = [
  "Browser didn't open? Use the url below to sign in: (Copied link to clipboard)", '',
  'https://copilot.tencent.com/login?platform=SIMULATED&state=SIMULATED&version=SIMULATED', '',
  '✸ Waiting for auth... (Press ESC to cancel)',
].join('\r\n')
export const codebuddyIntlBrowserRecorded = codebuddyChinaBrowserRecorded.replace('copilot.tencent.com', 'www.codebuddy.ai')
export const codebuddyEnterpriseRecorded = 'Custom Endpoint\r\nEnter your custom endpoint address\r\n\r\nEnter to save · Esc to cancel'
export const codebuddyIoaRecorded = codebuddyChinaBrowserRecorded.replace('&version=SIMULATED', '&version=SIMULATED&ioa=SIMULATED')
export const codebuddyCancelledRecorded = 'Failed to login. Press esc to return to login'
// C6: one Enter submitted /logout and displayed exactly the same site menu.
export const codebuddyLogoutRecorded = codebuddySitesRecorded
