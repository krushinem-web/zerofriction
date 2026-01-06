# Railway pnpm Configuration Fix

## Summary

Added Railway-specific configuration files to force pnpm usage and prevent npm build failures.

## Problem

Railway was attempting to use npm to install dependencies despite the project being configured for pnpm. This caused build failures because:

1. Railway's default behavior is to use npm if it detects a `package.json`
2. The `packageManager` field in `package.json` is not always respected by Railway's build system
3. Railway needs explicit configuration to use pnpm via Nixpacks

## Solution

Created two configuration files to force Railway to use pnpm:

### 1. nixpacks.toml

**Purpose:** Explicitly tells Railway's Nixpacks build system to use pnpm

**Location:** `/nixpacks.toml` (project root)

**Content:**
```toml
[phases.setup]
nixPkgs = ["nodejs", "pnpm"]

[phases.install]
cmds = ["pnpm install --frozen-lockfile"]

[phases.build]
cmds = []

[start]
cmd = "node server.js"
```

**Explanation:**
- `phases.setup` - Installs Node.js and pnpm in the build environment
- `phases.install` - Runs `pnpm install --frozen-lockfile` to install dependencies
  - `--frozen-lockfile` ensures the exact versions from `pnpm-lock.yaml` are used
  - Prevents any package.json/lock file mismatches
- `phases.build` - Empty because this is a Node.js server with no build step
- `start` - Defines the command to start the application

### 2. .npmrc

**Purpose:** Enforces engine-strict mode to prevent npm from being used

**Location:** `/.npmrc` (project root)

**Content:**
```
# Force pnpm usage
engine-strict=true
```

**Explanation:**
- `engine-strict=true` - Makes npm respect the `engines` field in package.json
- Combined with `"engines": { "pnpm": ">=10.0.0" }` in package.json, this prevents npm from running

## How It Works

1. Railway detects `nixpacks.toml` and uses it as the build configuration
2. Nixpacks installs pnpm in the build environment
3. Dependencies are installed using `pnpm install --frozen-lockfile`
4. The existing `pnpm-lock.yaml` ensures consistent dependency versions
5. `.npmrc` provides additional protection against npm usage
6. Application starts with `node server.js`

## Files Modified/Created

1. **nixpacks.toml** (NEW) - Railway build configuration
2. **.npmrc** (NEW) - npm configuration to enforce engine-strict
3. **BUILD_AND_MOBILE_FIX.md** (NEW) - Documentation of previous fixes

## Existing Configuration (Already in Place)

From previous fix commit `a85a4af`:
- ✅ `package.json` - Contains `"packageManager": "pnpm@10.27.0"`
- ✅ `package.json` - Contains `"engines": { "pnpm": ">=10.0.0" }`
- ✅ `.gitignore` - Contains `node_modules/`
- ✅ `pnpm-lock.yaml` - Already committed and tracked

## Expected Behavior

After this fix, Railway will:
1. ✅ Use pnpm instead of npm for dependency installation
2. ✅ Install exact dependency versions from pnpm-lock.yaml
3. ✅ Complete the build successfully
4. ✅ Start the application with `node server.js`

## Deployment

**Commit:** `e23db9f` - "fix: add Railway pnpm configuration (nixpacks.toml + .npmrc)"

**Branch:** `main`

**Status:** Pushed to GitHub

Railway will automatically detect the new commit and trigger a new deployment. The build should now succeed.

## Verification

To verify the fix worked:
1. Check Railway deployment logs
2. Look for "Using pnpm" or similar messages in the build phase
3. Verify `pnpm install --frozen-lockfile` runs successfully
4. Confirm deployment status changes to "ACTIVE"

## Alternative Approaches (Not Used)

We did NOT use these approaches because they are less reliable:

1. ❌ **Railway Settings UI** - Manually setting build command in Railway dashboard
   - Reason: Settings can be overridden or lost; configuration-as-code is more reliable
   
2. ❌ **railway.toml** - Railway's legacy configuration format
   - Reason: `nixpacks.toml` is the modern, recommended approach
   
3. ❌ **Procfile** - Heroku-style configuration
   - Reason: Railway uses Nixpacks, not Heroku buildpacks

## References

- [Railway Nixpacks Documentation](https://nixpacks.com/)
- [pnpm Frozen Lockfile](https://pnpm.io/cli/install#--frozen-lockfile)
- [npm engine-strict](https://docs.npmjs.com/cli/v9/using-npm/config#engine-strict)
