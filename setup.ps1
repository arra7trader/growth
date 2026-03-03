# Aether Auto-SaaS Setup Script (PowerShell)
# This script helps you set up the autonomous system

Write-Host "🚀 Aether Auto-SaaS - Setup Script" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

# Check if .env.local exists
if (-not (Test-Path .env.local)) {
    Write-Host "📝 Creating .env.local from .env.example..." -ForegroundColor Yellow
    Copy-Item .env.example .env.local
    Write-Host "✅ .env.local created. Please edit it with your API keys." -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host "✅ .env.local already exists." -ForegroundColor Green
    Write-Host ""
}

# Install dependencies
Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
npm install
Write-Host ""

# Initialize Git repository
Write-Host "🔄 Initializing Git repository..." -ForegroundColor Yellow
if (-not (Test-Path .git)) {
    git init
    git branch -M main
    Write-Host "✅ Git repository initialized." -ForegroundColor Green
} else {
    Write-Host "✅ Git repository already exists." -ForegroundColor Green
}
Write-Host ""

# Add GitHub remote
$REPO_URL = Read-Host "Enter your GitHub repository URL (or press Enter to skip)"

if ($REPO_URL) {
    git remote remove origin 2>$null
    git remote add origin $REPO_URL
    Write-Host "✅ GitHub remote added." -ForegroundColor Green
}
Write-Host ""

# Build the project
Write-Host "🔨 Building the project..." -ForegroundColor Yellow
npm run build
Write-Host ""

Write-Host "✅ Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Edit .env.local with your API keys"
Write-Host "2. Run 'npm run dev' to start the development server"
Write-Host "3. Open http://localhost:3000 to see the dashboard"
Write-Host "4. Click 'Trigger Evolution' to start the first autonomous cycle"
Write-Host ""
Write-Host "For deployment:" -ForegroundColor Cyan
Write-Host "1. Run 'vercel deploy --prod' to deploy to Vercel"
Write-Host "2. Add environment variables in Vercel dashboard"
Write-Host "3. Enable cron jobs in Vercel settings"
Write-Host ""
