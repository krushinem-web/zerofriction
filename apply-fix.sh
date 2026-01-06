#!/bin/bash

# KrushFlow Build Fix - One-Command Solution
# This script fixes the Railway build failure by removing npm lock file conflicts

set -e

echo "🔧 KrushFlow Build Fix - Starting..."
echo ""

# Step 1: Remove package-lock.json if it exists
echo "Step 1/4: Removing package-lock.json..."
if [ -f "package-lock.json" ]; then
    git rm package-lock.json 2>/dev/null || rm package-lock.json
    echo "✅ package-lock.json removed"
else
    echo "✅ package-lock.json not found (already clean)"
fi
echo ""

# Step 2: Create/update .gitignore
echo "Step 2/4: Updating .gitignore..."
if ! grep -q "package-lock.json" .gitignore 2>/dev/null; then
    echo "" >> .gitignore
    echo "# Package manager - use ONLY pnpm-lock.yaml" >> .gitignore
    echo "package-lock.json" >> .gitignore
    echo "✅ .gitignore updated"
else
    echo "✅ .gitignore already configured"
fi
echo ""

# Step 3: Create .npmrc
echo "Step 3/4: Creating .npmrc configuration..."
cat > .npmrc << 'EOF'
# Force clean installs (no cache)
cache=false

# Prevent package-lock.json generation
package-lock=false

# Use exact versions
save-exact=true

# Strict engine validation
engine-strict=true

# Disable progress bar for cleaner CI logs
progress=false
EOF
echo "✅ .npmrc created"
echo ""

# Step 4: Git commit and push
echo "Step 4/4: Committing changes..."
git add .gitignore .npmrc
git commit -m "Fix: Remove npm lock file conflicts - use pnpm only" 2>/dev/null || echo "⚠️  No changes to commit (already applied)"
echo ""

echo "🎉 BUILD FIX COMPLETE!"
echo ""
echo "Next steps:"
echo "1. Run: git push origin main"
echo "2. Watch Railway automatically redeploy"
echo "3. Build should complete successfully in ~60 seconds"
echo ""
echo "If the build still fails, check DEPLOYMENT_FIX.md for detailed troubleshooting."
