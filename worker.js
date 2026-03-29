// Helper: Generate a permanent token
function generateToken() { return 'OSXG-' + Math.random().toString(36).substring(2, 12).toUpperCase(); }

// Helper: Verify Discord Button Clicks (Ed25519 Signature)
function hexToUint8Array(hex) {
  return new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
}
async function verifyDiscordInteraction(request, publicKeyHex) {
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  if (!signature || !timestamp) return false;
  const body = await request.clone().text();
  try {
    const key = await crypto.subtle.importKey("raw", hexToUint8Array(publicKeyHex), { name: "NODE-ED25519", namedCurve: "NODE-ED25519" }, false, ["verify"]);
    return await crypto.subtle.verify("NODE-ED25519", key, hexToUint8Array(signature), new TextEncoder().encode(timestamp + body));
  } catch (e) { return false; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const CLIENT_ID = env.CLIENT_ID;
    const CLIENT_SECRET = env.CLIENT_SECRET;
    const REDIRECT_URI = env.REDIRECT_URI;
    const GUILD_ID = env.GUILD_ID;
    const WEBHOOK_URL = env.WEBHOOK_URL; 
    const DISCORD_PUBLIC_KEY = env.DISCORD_PUBLIC_KEY;

    // ================================================================
    // 1. DISCORD BUTTON INTERACTIONS (The Mailbox Inbox)
    // ================================================================
    if (method === "POST" && path === "/interactions") {
      const isValid = await verifyDiscordInteraction(request, DISCORD_PUBLIC_KEY);
      if (!isValid) return new Response("Bad request signature", { status: 401 });

      const interaction = await request.json();

      // Discord sends a Ping (Type 1) when you first save the URL in the portal
      if (interaction.type === 1) {
        return new Response(JSON.stringify({ type: 1 }), { headers: { "Content-Type": "application/json" } });
      }

      // Someone clicked a button! (Type 3)
      if (interaction.type === 3) {
        const customId = interaction.data.custom_id; // e.g., "join_123456789"
        
        if (customId.startsWith("join_")) {
          const targetRid = customId.split("_")[1];
          const clickerId = interaction.member ? interaction.member.user.id : interaction.user.id;

          // Save the invite for the Lua script to pick up (expires in 60 seconds)
          await env.OSXG_INVITES.put(clickerId, targetRid, { expirationTtl: 60 });

          // Send a private ephemeral message back to the user in Discord
          return new Response(JSON.stringify({
            type: 4,
            data: { content: "✅ Invite sent to GTA V! Please tab back into the game.", flags: 64 }
          }), { headers: { "Content-Type": "application/json" } });
        }
      }
      return new Response("Unknown interaction", { status: 400 });
    }

    // ================================================================
    // 2. OAUTH2 LOGIN FLOW (Unchanged)
    // ================================================================
    if (method === "GET" && path === "/login") {
      const auth_id = url.searchParams.get("auth_id");
      return Response.redirect(`https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds&state=${auth_id}`, 302);
    }

    if (method === "GET" && path === "/callback") {
      const code = url.searchParams.get("code");
      const auth_id = url.searchParams.get("state"); 
      if (!code) return new Response("Login failed.", { status: 400 });

      const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI })
      });
      const discordAccessToken = (await tokenRes.json()).access_token;

      const userData = await (await fetch("https://discord.com/api/users/@me", { headers: { "Authorization": `Bearer ${discordAccessToken}` } })).json();
      const guilds = await (await fetch("https://discord.com/api/users/@me/guilds", { headers: { "Authorization": `Bearer ${discordAccessToken}` } })).json();
      
      if (!guilds.some(g => g.id === GUILD_ID)) return new Response("Access Denied.", { status: 403 });

      const finalToken = generateToken();
      await env.OSXG_TOKENS.put(`AUTH_${auth_id}`, finalToken, { expirationTtl: 300 }); 
      await env.OSXG_TOKENS.put(finalToken, userData.id); 

      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>OSXG+ Authorized</title><style>body{margin:0;padding:0;background-color:#050505;background-image:radial-gradient(circle at 50% 0%,#1a1a2e 0%,#050505 80%);color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh}.container{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:50px 70px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,0.6);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}.logo{max-width:280px;margin-bottom:25px;filter:drop-shadow(0 0 10px rgba(255,255,255,0.2))}h1{margin:0 0 10px 0;font-size:2.2rem;background:linear-gradient(90deg,#ffffff,#a1a1aa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:1px}p{margin:0;color:#9ca3af;font-size:1.1rem}.success-icon{font-size:3rem;margin-bottom:15px}</style></head><body><div class="container"><img src="https://cdn.discordapp.com/attachments/1474754859726016534/1484002180003266732/sized_rules_osxg_banner_big_text.png?ex=69c6877b&is=69c535fb&hm=f68655c840e4d0beec819a75b101ea1fd9fee5c172e9d9d854a2a93956dd6f9f" alt="OSXG+" class="logo" onerror="this.style.display='none'"><div class="success-icon">✅</div><h1>Access Granted</h1><p>You can safely close this tab and return to GTA V.</p></div></body></html>`;
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }

    if (method === "GET" && path === "/auth/check") {
      const token = await env.OSXG_TOKENS.get(`AUTH_${url.searchParams.get("auth_id")}`);
      if (!token) return new Response("Waiting...", { status: 202 });
      return new Response(JSON.stringify({ token }), { headers: { "Content-Type": "application/json" } });
    }

    // ================================================================
    // 3. API ROUTES (Requires Token)
    // ================================================================
    const userToken = url.searchParams.get("token");
    if (path === "/sessions" || path === "/host" || path === "/invites/check") {
      if (!userToken) return new Response("Missing Token", { status: 400 });
      const discordId = await env.OSXG_TOKENS.get(userToken);
      if (!discordId) return new Response("Invalid Token", { status: 401 });

      // GET /sessions
      if (method === "GET" && path === "/sessions") {
        const sessions = await env.OSXG_SESSIONS.list();
        let activeSessions = [];
        for (const key of sessions.keys) {
          const sessionData = await env.OSXG_SESSIONS.get(key.name);
          if (sessionData) activeSessions.push(JSON.parse(sessionData));
        }
        return new Response(JSON.stringify(activeSessions), { headers: { "Content-Type": "application/json" } });
      }

      // POST /host (Added the Discord Button!)
      if (method === "POST" && path === "/host") {
        const { hostName, rid, sessionType } = await request.json();
        
        const existingSession = await env.OSXG_SESSIONS.get(rid.toString());
        
        // Expiration is 120 seconds. Client must ping /host periodically to keep it alive.
        await env.OSXG_SESSIONS.put(rid.toString(), JSON.stringify({ hostName, rid, sessionType, timestamp: Date.now() }), { expirationTtl: 120 });

        // Only send discord message if it's a completely newly hosted session
        if (!existingSession && WEBHOOK_URL) {
          await fetch(WEBHOOK_URL, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              embeds: [{
                title: "🟢 New OSXG+ Session!",
                description: `**Host:** ${hostName}\n**Type:** ${sessionType}\n**RID:** \`${rid}\``,
                color: 5763719
              }],
              components: [{ // This adds the physical button!
                type: 1,
                components: [{ type: 2, style: 3, label: "Join Session", custom_id: `join_${rid}`, emoji: { name: "🎮" } }]
              }]
            })
          });
        }
        return new Response("Session Hosted!", { status: 200 });
      }

      // POST /unhost (Proactively remove session from active list)
      if (method === "POST" && path === "/unhost") {
        const { rid } = await request.json();
        if (rid) {
            await env.OSXG_SESSIONS.delete(rid.toString());
        }
        return new Response("Session Unhosted", { status: 200 });
      }

      // GET /invites/check (The Mailman checking the Inbox)
      if (method === "GET" && path === "/invites/check") {
        const pendingRid = await env.OSXG_INVITES.get(discordId);
        if (pendingRid) {
          await env.OSXG_INVITES.delete(discordId); // Delete it so we don't join twice
          return new Response(JSON.stringify({ rid: pendingRid }), { headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ status: "empty" }), { headers: { "Content-Type": "application/json" } });
      }
    }

    return new Response("Not Found", { status: 404 });
  }
};