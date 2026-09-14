# AgentCy (Agent Assistant PWA)

A sleek, lightweight, mobile-first Progressive Web App (PWA) that connects family members to their dedicated Hermes AI agent profiles without heavy server overhead.

- **Frontend:** Hosted on Cloudflare Pages (`https://agentcy.pages.dev`).
- **Backend:** Hermes Agent profile bridge running on your VPS (`systemd: agentcy-bridge.service`).
- **Multi-User:** Isolated sessions, separate memories, and custom personas per family member (`IamMom`, `Brother`, `Sister`).
- **Voice Support:** Native browser Speech-to-Text dictation & Web Speech Text-to-Speech playback.

---

## Cloudflare Pages Deployment (One-Time Setup)

1. In the [Cloudflare Dashboard](https://dash.cloudflare.com/):
   - Go to **Workers & Pages** $\rightarrow$ **Create Application** $\rightarrow$ **Pages** $\rightarrow$ **Connect to Git**.
   - Select repository **`xyvdev/agentcy`**.
2. **Build Settings:**
   - **Framework preset:** `None`
   - **Build output directory:** `public`
   - **Root directory:** `/` (default)
3. **Environment Variables (Optional):**
   - `VPS_BACKEND_URL`: `http://168.138.75.255/api/agentcy` (default fallback already configured in `functions/api/[[path]].js`).
4. Click **Save and Deploy**.
5. Custom Domain (Optional):
   - Add your custom domain (e.g. `agentcy.pages.dev` or `ai.yourdomain.com`) in the Pages project settings.

---

## Adding a New Family Member

To add Brother or Sister in the future:
1. **Clone a profile on the VPS:**
   ```bash
   hermes profile create brother --clone-from mom
   ```
2. **Add credentials to `/root/agentcy-bridge/users.json`:**
   ```json
   "Brother": {
     "display_name": "Alex",
     "profile": "brother",
     "password_hash": "<SHA256_OF_agentcy_salt_2026:PASSWORD>"
   }
   ```
3. Restart the bridge service:
   ```bash
   systemctl restart agentcy-bridge.service
   ```
4. Brother can immediately log in on `https://agentcy.pages.dev` with his username and password!
