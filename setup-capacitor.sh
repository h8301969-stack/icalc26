#!/bin/bash
set -e

echo "🚀 iCalc Capacitor Setup"
echo "========================"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Step 1: Install dependencies
echo -e "\n${BLUE}1️⃣  Installing npm dependencies...${NC}"
npm install

# Step 2: Build web app
echo -e "\n${BLUE}2️⃣  Building web app...${NC}"
npm run build

# Step 3: Initialize Capacitor (if not already done)
if [ ! -f "capacitor.config.ts" ]; then
  echo -e "\n${BLUE}3️⃣  Initializing Capacitor...${NC}"
  npx cap init --web-dir dist
fi

# Step 4: Add Android
if [ ! -d "android" ]; then
  echo -e "\n${BLUE}4️⃣  Adding Android platform...${NC}"
  npx cap add android
else
  echo -e "\n${BLUE}4️⃣  Android platform already exists, syncing...${NC}"
  npx cap sync android
fi

# Step 5: Add iOS (macOS only)
if [[ "$OSTYPE" == "darwin"* ]]; then
  if [ ! -d "ios" ]; then
    echo -e "\n${BLUE}5️⃣  Adding iOS platform...${NC}"
    npx cap add ios
  else
    echo -e "\n${BLUE}5️⃣  iOS platform already exists, syncing...${NC}"
    npx cap sync ios
  fi
fi

echo -e "\n${GREEN}✅ Setup complete!${NC}"
echo ""
echo "Next steps:"
echo "  • iOS: npm run mobile:ios"
echo "  • Android: npm run mobile:android"
echo "  • Read MOBILE_DEPLOYMENT.md for store submission"
echo ""
