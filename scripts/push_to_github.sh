#!/bin/bash

# KrushFlow GitHub Push Script
# This script safely pushes changes to the GitHub repository

set -e  # Exit on error

echo "=========================================="
echo "KrushFlow GitHub Push Script"
echo "=========================================="
echo ""

# Check if we're in a git repository
if [ ! -d .git ]; then
    echo "Error: Not a git repository. Please run this from the project root."
    exit 1
fi

# Get current branch
BRANCH=$(git branch --show-current)
echo "Current branch: $BRANCH"
echo ""

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    echo "You have uncommitted changes. Proceeding with commit..."
    echo ""
    
    # Show status
    echo "Git status:"
    git status --short
    echo ""
    
    # Get commit message (use argument or default)
    COMMIT_MSG="${1:-Update: master list edit/save + voice mapping recording display}"
    
    echo "Staging all changes..."
    git add -A
    echo ""
    
    echo "Committing with message: $COMMIT_MSG"
    git commit -m "$COMMIT_MSG"
    echo ""
else
    echo "No uncommitted changes detected."
    echo ""
fi

# Push to remote
echo "Pushing to origin/$BRANCH..."
git push origin "$BRANCH"
echo ""

echo "=========================================="
echo "✓ Successfully pushed to GitHub!"
echo "=========================================="
echo ""
echo "Repository: $(git remote get-url origin)"
echo "Branch: $BRANCH"
echo "Latest commit: $(git log -1 --oneline)"
