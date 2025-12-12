# Per-User Sandbox Implementation Plan

## Problem

The current mom sandbox is shared by all Slack users. This creates security issues:
- User A's credentials/tokens are accessible to User B
- A malicious user could ask mom to list all users and their tokens
- Skills and tools created by one user can be accessed by others

## Solution

Implement per user+channel Docker containers with proper isolation:
- Each user+channel combination gets its own container
- User credentials are isolated (other users physically cannot access them)
- Containers auto-stop after 15 minutes of inactivity

## Directory Structure

### Host (data directory)

```
./data/
├── MEMORY.md                        # Global memory (read-only in containers)
├── skills/                          # Admin-managed skills (read-only in containers)
│   └── gmail/
│       ├── gmail.js
│       └── SKILL.md
├── users/
│   └── U12345/                      # Per-user isolated data
│       ├── home/                    # HOME directory (~/.config, etc.)
│       ├── skills/                  # User's own skills
│       └── MEMORY.md                # User-specific memory
├── channels/
│   └── C67890/                      # Channel data (read-only in containers)
│       ├── log.jsonl
│       ├── context.jsonl
│       ├── attachments/
│       └── MEMORY.md
└── workspaces/                      # Per user+channel scratch directories
    └── U12345-C67890/
        └── scratch/
```

### Container Mounts (for user U12345 in channel C67890)

| Container Path | Host Path | Mode |
|----------------|-----------|------|
| `/workspace/user/` | `./data/users/U12345/` | read-write |
| `/workspace/skills/` | `./data/skills/` | read-only |
| `/workspace/channel/` | `./data/channels/C67890/` | read-only |
| `/workspace/MEMORY.md` | `./data/MEMORY.md` | read-only |
| `/workspace/scratch/` | `./data/workspaces/U12345-C67890/scratch/` | read-write |

`HOME` is set to `/workspace/user/home/`

## Container Naming

```
mom-U12345-C67890    # User U12345 in channel C67890
mom-U12345-D11111    # User U12345 in DM D11111
```

## CLI Usage

```bash
mom --sandbox=docker:per-user ./data
```

## Implementation Status

### Completed

1. **`src/user-sandbox.ts`** (NEW)
   - `PerUserSandboxManager` class
   - Container creation with proper volume mounts
   - 15-minute idle timeout with auto-stop
   - Container lifecycle management
   - Graceful shutdown (stopAll)

2. **`src/sandbox.ts`** (MODIFIED)
   - Added `docker-per-user` sandbox type
   - Added `createPerUserExecutor()` function
   - Added `PerUserDockerExecutor` class that touches manager on each exec

3. **`src/main.ts`** (MODIFIED)
   - Parse `--sandbox=docker:per-user` argument
   - Create `PerUserSandboxManager` instance
   - Added `getPerUserState()` for user+channel state management
   - Added `isPerUserRunning()` helper
   - Updated handler to use per-user state when in per-user mode
   - Added graceful shutdown handling (SIGINT/SIGTERM)

4. **`src/slack.ts`** (MODIFIED)
   - Updated `MomHandler` interface to accept optional `userId` parameter
   - Pass `userId` to `isRunning()` and `handleStop()`

5. **`src/agent.ts`** (PARTIALLY MODIFIED)
   - Added `buildPerUserSystemPrompt()` function
   - Added `getPerUserMemory()` function
   - Added imports for per-user types

### Remaining Work

1. **`src/agent.ts`** - Add `getOrCreatePerUserRunner()` function
   - Similar to `getOrCreateRunner()` but:
     - Uses `createPerUserExecutor()` instead of `createExecutor()`
     - Uses `buildPerUserSystemPrompt()` instead of `buildSystemPrompt()`
     - Uses `getPerUserMemory()` instead of `getMemory()`
     - Cache key is `userId-channelId` instead of just `channelId`
     - Context directory is different (per-user+channel)

2. **`src/store.ts`** - Update paths for per-user mode
   - Channel logs should go to `./data/channels/<channelId>/`
   - May need to handle attachments path changes

3. **`src/context.ts`** - Review if changes needed for per-user context management

4. **Testing**
   - Test container creation/destruction
   - Test idle timeout
   - Test isolation (user A cannot access user B's data)
   - Test graceful shutdown
   - Test concurrent users in same channel

5. **Documentation**
   - Update README.md with new `--sandbox=docker:per-user` option
   - Document the security model
   - Document directory structure changes

## Security Model

- **User credentials isolated**: Each user's HOME is in their own directory, mounted only to their containers
- **Channel data read-only**: Users can read channel history but not modify it
- **Global skills read-only**: Admin-managed skills cannot be modified by users
- **User skills isolated**: Each user has their own skills directory
- **No cross-user access**: Containers only mount the current user's data

## Configuration

| Setting | Value | Notes |
|---------|-------|-------|
| Idle timeout | 15 minutes | Container stops after inactivity |
| Base image | alpine:latest | Same as regular docker mode |
| Memory limit | 512MB | Per container |
| CPU limit | 1 core | Per container |

## Edge Cases

1. **User switches channels**: New container created for new user+channel combo
2. **Container startup latency**: ~1-2s on first interaction (acceptable)
3. **Concurrent requests**: Queue per user+channel (existing pattern)
4. **Container already exists but stopped**: Remove and recreate

## Future Considerations

- Container resource limits could be configurable
- Could add container health checks
- Could add metrics/monitoring for container usage
- Migration path from single-container to per-user mode
