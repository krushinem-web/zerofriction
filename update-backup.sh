#!/bin/bash

# Update Backup Script for KrushFlow
# Run this anytime to sync the latest working files to backup/

echo "🔄 Updating backup folder..."

# Create backup directory if it doesn't exist
mkdir -p backup

# Copy core application files
echo "📦 Copying core files..."
cp package.json backup/
cp server.js backup/
cp index.html backup/
cp nixpacks.toml backup/
cp pnpm-lock.yaml backup/

# Copy configuration files
echo "⚙️  Copying config files..."
cp .env.example backup/.env.example 2>/dev/null || echo "⚠️  .env.example not found (optional)"
cp .npmrc backup/.npmrc 2>/dev/null || echo "⚠️  .npmrc not found (optional)"
cp .gitignore backup/.gitignore 2>/dev/null || echo "⚠️  .gitignore not found (optional)"
cp railway.toml backup/ 2>/dev/null || echo "⚠️  railway.toml not found (optional)"
cp README.md backup/ 2>/dev/null || echo "⚠️  README.md not found (optional)"
cp setup.bash backup/ 2>/dev/null || echo "⚠️  setup.bash not found (optional)"

# Copy assets
echo "🎨 Copying assets..."
cp logo.svg backup/ 2>/dev/null || echo "⚠️  logo.svg not found (optional)"
cp logo.png backup/ 2>/dev/null || echo "⚠️  logo.png not found (optional)"
cp live_count.svg backup/ 2>/dev/null || echo "⚠️  live_count.svg not found (optional)"
cp new_project.svg backup/ 2>/dev/null || echo "⚠️  new_project.svg not found (optional)"
cp voice_mapping.svg backup/ 2>/dev/null || echo "⚠️  voice_mapping.svg not found (optional)"

# Show summary
echo ""
echo "✅ Backup updated successfully!"
echo "📍 Location: $(pwd)/backup/"
echo "📊 Total files: $(ls -1 backup/ | wc -l)"
echo "💾 Total size: $(du -sh backup/ | cut -f1)"
echo ""
echo "Backup timestamp: $(date)" > backup/LAST_UPDATED.txt
