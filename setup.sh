#!/bin/bash

# Aether Auto-SaaS Setup Script
# This script helps you set up the autonomous system

echo "🚀 Aether Auto-SaaS - Setup Script"
echo "=================================="
echo ""

# Check if .env.local exists
if [ ! -f .env.local ]; then
    echo "📝 Creating .env.local from .env.example..."
    cp .env.example .env.local
    echo "✅ .env.local created. Please edit it with your API keys."
    echo ""
else
    echo "✅ .env.local already exists."
    echo ""
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install
echo ""

# Initialize Git repository
echo "🔄 Initializing Git repository..."
if [ ! -d .git ]; then
    git init
    git branch -M main
    echo "✅ Git repository initialized."
else
    echo "✅ Git repository already exists."
fi
echo ""

# Add GitHub remote
echo "Enter your GitHub repository URL (or press Enter to skip):"
read -r REPO_URL

if [ -n "$REPO_URL" ]; then
    git remote remove origin 2>/dev/null
    git remote add origin "$REPO_URL"
    echo "✅ GitHub remote added."
fi
echo ""

# Build the project
echo "🔨 Building the project..."
npm run build
echo ""

echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env.local with your API keys"
echo "2. Run 'npm run dev' to start the development server"
echo "3. Open http://localhost:3000 to see the dashboard"
echo "4. Click 'Trigger Evolution' to start the first autonomous cycle"
echo ""
echo "For deployment:"
echo "1. Run 'vercel deploy --prod' to deploy to Vercel"
echo "2. Add environment variables in Vercel dashboard"
echo "3. Enable cron jobs in Vercel settings"
echo ""
