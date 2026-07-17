# Seccomp Profile Documentation

## Overview

`seccomp-default.json` is a **Seccomp (Secure Computing Mode) configuration file** used to restrict the system calls (syscalls) available to processes inside containers. It is an important component of the container security mechanism.

## What is Seccomp?

**Seccomp (Secure Computing Mode)** is a Linux kernel security feature that allows processes to enter a "restricted mode" where they can only execute specific system calls. If a process attempts to call a system call that is not allowed, the kernel terminates the process.

### How It Works

```
Container process executes a system call
    |
    v
Kernel checks the seccomp profile
    |
    v
Is the system call in the allow list?
    |-- Yes --> Execute the system call
    +-- No  --> Return error or terminate process (per configuration)
```

## seccomp-default.json File Structure

### 1. Basic Structure

```json
{
  "defaultAction": "SCMP_ACT_ERRNO",  // Default action: deny and return error
  "architectures": [...],              // Supported architectures
  "syscalls": [...]                    // Allowed system call list
}
```

### 2. Key Field Descriptions

#### `defaultAction: "SCMP_ACT_ERRNO"`

- **Meaning**: For system calls not explicitly allowed, the default action is to return an error (errno)
- **Effect**: Whitelist mode - only explicitly listed system calls are allowed
- **Security level**: High (denies all unlisted calls by default)

#### `architectures`

Supported CPU architectures:
- `SCMP_ARCH_X86_64` - x86_64 (Intel/AMD 64-bit)
- `SCMP_ARCH_X86` - x86 (32-bit)
- `SCMP_ARCH_AARCH64` - ARM 64-bit (used on Hailo platform)
- `SCMP_ARCH_ARM` - ARM 32-bit

#### `syscalls`

List of allowed system calls, containing approximately 200+ common system calls, such as:
- File operations: `read`, `write`, `open`, `close`, `stat`, `mkdir`, `unlink`
- Network operations: `socket`, `bind`, `listen`, `accept`, `connect`, `send`, `recv`
- Process operations: `fork`, `execve`, `exit`, `waitpid`, `kill`
- Memory operations: `mmap`, `munmap`, `mprotect`, `brk`
- Signal handling: `rt_sigaction`, `rt_sigprocmask`, `rt_sigreturn`
- Time operations: `clock_gettime`, `nanosleep`, `gettimeofday`

### 3. Blocked System Calls

Since `defaultAction: "SCMP_ACT_ERRNO"`, the following dangerous system calls are blocked:

- `mount` / `umount` - Mount file systems
- `swapon` / `swapoff` - Swap partition operations
- `reboot` - Reboot the system
- `kexec_load` - Load a new kernel
- `init_module` / `delete_module` - Kernel module operations
- `iopl` / `ioperm` - Direct I/O port access
- `ptrace` - Process tracing (partially restricted)
- `keyctl` - Key management
- `add_key` / `request_key` - Key operations

## Usage in This Project

### Configuration Location

**Configuration file path**:
```
configs/security/seccomp-default.json
```

**References in code**:
```go
// platform/app-manager/security/sandbox.go
cfg.SeccompProfile = "seccomp-default.json"  // Default value

// platform/app-manager/server/server.go
// Validate seccomp profile exists
security.ValidateSeccompProfile(s.config.Security.SeccompProfile)
```

### Current Implementation Status

**Note**: The loading of the seccomp profile in the current codebase is **not yet fully implemented**:

```go
// platform/app-manager/containerd/runtime.go
if containerConfig.SeccompProfile != "" {
    // Note: containerd/oci doesn't directly support seccomp profile loading
    // This would need to be handled via a custom spec option or post-processing
    // For now, we'll use a default seccomp profile
    logger.Info("Seccomp profile specified: %s (implementation pending)", 
                containerConfig.SeccompProfile)
}
```

**This means**:
- The configuration file exists and has been validated
- The configuration path is passed through to the container configuration
- The actual loading and application of the seccomp profile is pending implementation

### How to Implement Seccomp Profile Loading

To actually apply the seccomp profile, the following is needed:

1. **Read the JSON file**:
```go
import "github.com/opencontainers/runtime-spec/specs-go"

profileData, err := os.ReadFile(seccompProfilePath)
var seccompProfile specs.LinuxSeccomp
json.Unmarshal(profileData, &seccompProfile)
```

2. **Apply to OCI Spec**:
```go
// Requires a custom SpecOpts or direct spec modification
opts = append(opts, func(_ context.Context, _ oci.Client, _ *containers.Container, s *oci.Spec) error {
    s.Linux.Seccomp = &seccompProfile
    return nil
})
```

## Security Benefits

### 1. Reduce Attack Surface

By restricting available system calls, even if a container is compromised, attackers cannot:
- Mount new file systems
- Load kernel modules
- Directly access hardware I/O
- Execute other dangerous operations

### 2. Defense in Depth

Seccomp is one layer in a **multi-layer security defense**:

```
Application-level permission control (manifest.permissions)
    |
    v
Container isolation (namespaces)
    |
    v
Capability restrictions (capabilities)
    |
    v
System call filtering (seccomp) <-- This file
    |
    v
Resource limits (cgroups)
```

### 3. Integration with Project Security Design

In the NE503 platform, seccomp complements other security mechanisms:

- **Read-only rootfs**: Prevents modification of system files
- **Capabilities restriction**: Dangerous permissions like `CAP_SYS_ADMIN` have been removed
- **Namespace isolation**: Process, network, and file system isolation
- **Seccomp filtering**: Restricts system calls (this file)

## Practical Effects

### Allowed Operations

```python
# These operations will be allowed (in the allow list)
file = open("/app/data.txt", "r")      # open, read
data = file.read()                      # read
socket.connect(("api.example.com", 80)) # socket, connect
time.sleep(1)                          # nanosleep
```

### Blocked Operations

```python
# These operations will be blocked (not in the allow list)
os.system("mount /dev/sda1 /mnt")      # mount - blocked
os.system("reboot")                     # reboot - blocked
# Attempted calls will be terminated or return an error
```

## Configuration Recommendations

### For the Hailo Platform

Since this is an embedded system, you may need to:

1. **Keep current configuration**: Use the default seccomp profile for basic security
2. **Adjust per application needs**: If an application requires specific system calls:
   - Modify `seccomp-default.json` to add the needed system calls
   - Or create an application-specific seccomp profile

### Custom Seccomp Profile

If stricter restrictions are needed, create a new profile:

```json
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "architectures": ["SCMP_ARCH_AARCH64"],
  "syscalls": [
    {
      "names": [
        "read", "write", "open", "close",  // Only allow the most basic operations
        "exit", "exit_group"
      ],
      "action": "SCMP_ACT_ALLOW"
    }
  ]
}
```

## Verification and Testing

### Check if Seccomp is Active

```bash
# Check seccomp status inside a container
cat /proc/self/status | grep Seccomp
# Output: Seccomp: 2  (2 indicates seccomp filter is enabled)

# Try a blocked system call (will fail)
strace -e mount mount /dev/sda1 /mnt
# Error: mount: Operation not permitted (seccomp blocked)
```

### Test Specific System Calls

```bash
# Test inside a container
# If seccomp is active, the following commands will fail:
mount  # Should be blocked
reboot # Should be blocked
```

## Summary

The role of `seccomp-default.json`:

1. **Defines a system call whitelist**: Approximately 200+ common system calls
2. **Denies all other system calls by default**: Provides a high security level
3. **Supports multiple architectures**: x86_64 and ARM64 (including Hailo)
4. **Current status**: Configuration file is ready, but loading functionality is pending implementation

**Security value**:
- Even if a container is compromised, attackers cannot execute dangerous system calls
- Reduces the attack surface and improves overall security
- Works with capabilities, namespaces, and other mechanisms to form a multi-layer defense

**Next steps**:
- Implement actual loading and application of the seccomp profile
- Adjust the allowed system call list based on application needs
- Test and verify that seccomp works correctly