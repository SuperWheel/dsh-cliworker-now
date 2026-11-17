# Read one generic Windows credential for the Host, read-only. The blob leaves this
# process only as base64 on stdout (a pipe owned by the Host); nothing is logged.
param([Parameter(Mandatory = $true)][string]$EncodedTarget)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CwnGenericCredential {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Credential {
    public uint Flags, Type;
    public string TargetName, Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist, AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias, UserName;
  }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool CredRead(string target, uint type, uint flags, out IntPtr value);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr value);
  public static string Read(string target) {
    IntPtr value;
    if (!CredRead(target, 1, 0, out value)) {
      if (Marshal.GetLastWin32Error() == 1168) return null;
      throw new Exception("Credential store unavailable");
    }
    byte[] bytes = null;
    try {
      var credential = (Credential)Marshal.PtrToStructure(value, typeof(Credential));
      if (credential.CredentialBlobSize > 65536) throw new Exception("Invalid credential");
      bytes = new byte[credential.CredentialBlobSize];
      Marshal.Copy(credential.CredentialBlob, bytes, 0, bytes.Length);
      return Convert.ToBase64String(bytes);
    } finally {
      if (bytes != null) Array.Clear(bytes, 0, bytes.Length);
      CredFree(value);
    }
  }
}
'@
  if ($EncodedTarget -notmatch '^[A-Za-z0-9_-]{1,1400}$') { throw 'Invalid target' }
  $encoded = $EncodedTarget.Replace('-', '+').Replace('_', '/')
  $encoded = $encoded.PadRight($encoded.Length + ((4 - $encoded.Length % 4) % 4), '=')
  $target = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
  $blob = [CwnGenericCredential]::Read($target)
  if ($null -eq $blob) { @{ state = 'missing' } | ConvertTo-Json -Compress; exit 0 }
  @{ state = 'found'; blob = $blob } | ConvertTo-Json -Compress
  $blob = $null
} catch {
  # Neither exception strings nor credential fragments cross the process boundary.
  @{ state = 'unavailable' } | ConvertTo-Json -Compress
  exit 1
}
