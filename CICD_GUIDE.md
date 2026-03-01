# Qevra AI — Complete GitHub Setup & Release Guide

## Step 1: Create a GitHub Account
1. Go to **[github.com](https://github.com)** → click **Sign up**
2. Enter your email, create a username and password
3. Verify your email — done!

---

## Step 2: Install Git on your Mac
Open **Terminal** and run:
```bash
git --version
```
If not installed, macOS will prompt you to install it. Click **Install**.

---

## Step 3: Configure Git with your identity
```bash
git config --global user.name "Your Name"
git config --global user.email "your@email.com"
```

---

## Step 4: Create a new repo on GitHub
1. Go to **[github.com/new](https://github.com/new)**
2. Repository name: `qevra-ai`
3. Set to **Private** (only you) or **Public** (anyone can see code)
4. ❌ Do NOT check "Add README" or anything else
5. Click **Create repository**

---

## Step 5: Update your username in the app config
Open `electron-builder.json5` and replace `YOUR_GITHUB_USERNAME`:
```json5
"publish": {
  "provider": "github",
  "owner": "your-actual-github-username",  // ← change this
  "repo": "qevra-ai"
}
```

---

## Step 6: Push your code to GitHub

In **Terminal**, go to your project folder and run these commands **one by one**:

```bash
cd /Users/vishnumohan/Desktop/Auto-Hand

# Initialize git
git init

# Stage all files
git add .

# First commit
git commit -m "feat: Qevra AI v1.0.0"

# Point to your GitHub repo (replace YOUR_USERNAME)
git remote add origin https://github.com/YOUR_USERNAME/qevra-ai.git

# Push to GitHub
git branch -M main
git push -u origin main
```

✅ Your code is now on GitHub!

---

## Step 7: Create a Personal Access Token (needed for releases)

GitHub Actions needs permission to create releases:

1. Go to **[github.com/settings/tokens](https://github.com/settings/tokens)**
2. Click **Generate new token (classic)**
3. Name: `QEVRA_AI_RELEASE`
4. Expiration: **No expiration**
5. Check ✅ **repo** (all sub-options)
6. Click **Generate token**
7. **Copy the token** (you only see it once!)

Now add it to your repo:
1. Go to your repo → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `GH_TOKEN`
4. Value: paste your token
5. Click **Add secret**

---

## Step 8: Release your first build 🚀

Every time you want to release a new version:

```bash
# 1. Make sure all your changes are committed
git add .
git commit -m "fix: something improved"

# 2. Tag the version (must match package.json version)
git tag v1.0.0

# 3. Push code + tag
git push origin main --tags
```

GitHub Actions will automatically:
- ✅ Build `.dmg` for **Mac**
- ✅ Build `.exe` installer for **Windows**
- ✅ Build `.AppImage` for **Linux**
- ✅ Create a **GitHub Release** page with all files

---

## Step 9: Share with everyone

After the build finishes (~5-10 minutes), go to:
```
https://github.com/YOUR_USERNAME/qevra-ai/releases/latest
```

Share this link with anyone. They click and download the right file:
- **Mac users** → download `.dmg` → drag app to Applications
- **Windows users** → download `.exe` → run installer

> ⚠️ **Mac security warning:** First time opening, right-click the app → **Open** → **Open anyway**. This is normal for apps without a paid Apple certificate.

---

## Step 10: Releasing future updates

When you make changes and want to push an update:

```bash
# 1. Update version in package.json (e.g. 1.0.0 → 1.1.0)
# 2. Commit, tag, and push:
git add .
git commit -m "feat: new feature added"
git tag v1.1.0
git push origin main --tags
```

Users who already have the app installed will **automatically** see the update banner inside the app and can click **Restart & Install** — no manual download needed!

---

## Quick Reference

| Command | What it does |
|---|---|
| `npm run dev` | Start the app in development mode |
| `npm run build` | Build the app locally |
| `npm run lint` | Check for code errors |
| `npm run clean` | Delete all build folders |
| `git tag vX.X.X && git push origin main --tags` | Trigger a new release |
