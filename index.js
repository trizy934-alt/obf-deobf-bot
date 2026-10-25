const http = require('http');
const port = process.env.PORT || 10000;

// فتح بورت وهمي عشان Render يقبل البوت
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running');
}).listen(port, '0.0.0.0', () => {
    console.log(`Web server listening on port ${port}`);
});

require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('fengari');

const TOKEN = process.env.DISCORD_TOKEN;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
    console.log(`[BOT] Logged in as ${client.user.tag}`);
    
    const commands = [
        new SlashCommandBuilder()
            .setName('deobfuscate')
            .setDescription('فك تشفير سكربت Luau (Moonsec/Matcha/Luraph)')
            .addStringOption(opt => 
                opt.setName('code').setDescription('الصق الكود المشفر (اختياري لو رفعت ملف)').setRequired(false)
            )
            .addAttachmentOption(opt => 
                opt.setName('file').setDescription('ارفع ملف .lua أو .txt أو .deobf').setRequired(false)
            )
    ];

    await client.application.commands.set(commands);
    console.log('[BOT] Commands registered.');
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'deobfuscate') return;

    await interaction.deferReply();

    let codeInput = "";
    const textOption = interaction.options.getString('code');
    const fileOption = interaction.options.getAttachment('file');

    if (fileOption) {
        try {
            const res = await fetch(fileOption.url);
            codeInput = await res.text();
        } catch (e) {
            return interaction.editReply('❌ فشل تحميل الملف: ' + e.message);
        }
    } else if (textOption) {
        codeInput = textOption;
    }

    if (!codeInput || !codeInput.trim()) {
        return interaction.editReply('❌ الرجاء إدخال كود أو رفع ملف.');
    }

    const result = executeLua(codeInput);

    if (!result) {
        return interaction.editReply('❌ فشل فك التشفير. قد يكون السكربت محمي بشكل معقد.');
    }

    if (result.length > 1900) {
        const buffer = Buffer.from(result, 'utf-8');
        await interaction.editReply({
            content: '✅ تم فك التشفير بنجاح! الكود طويل جداً، خده في ملف:',
            files: [new AttachmentBuilder(buffer, { name: 'deobfuscated.lua' })]
        });
    } else {
        const embed = new EmbedBuilder()
            .setTitle('✅ Decryption Successful')
            .setDescription('```lua\n' + result + '\n```')
            .setColor('#00ffcc');
        await interaction.editReply({ embeds: [embed] });
    }
});

function executeLua(code) {
    try {
        const L = lauxlib.luaL_newstate();
        lualib.luaL_openlibs(L);

        const setupLua = `
            game = { GetService = function(self, name) return { GetPlayers = function() return {} end, LocalPlayer = {} } end }
            workspace = { GetDescendants = function() return {} end }
            Instance = { new = function(c) return { Name = "Fake", IsA = function() return true end, Destroy = function() end, GetChildren = function() return {} end } end }
            Vector3 = { new = function() return {} end }
            CFrame = { new = function() return {} end }
            Color3 = { new = function() return {} end, fromRGB = function() return {} end }
            UDim2 = { new = function() return {} end }
            Enum = { Material = { SmoothPlastic = 1 } }
            syn = { protect_gui = function() end }
            getgc = function() return {} end
            hookmetamethod = function() return function() end end
            getnamecallmethod = function() return "" end
            checkcaller = function() return true end
            warn = function(msg) print("[WARN] " .. tostring(msg)) end
            getfenv = function() return _G end
            setfenv = function() end

            _captured = nil
            loadstring = function(code)
                _captured = code
                return function() end
            end
        `;

        if (lauxlib.luaL_dostring(L, to_luastring(setupLua)) !== lua.LUA_OK) {
            console.error("Setup Error:", to_jsstring(lua.lua_tostring(L, -1)));
            return null;
        }

        const status = lauxlib.luaL_dostring(L, to_luastring(code));
        if (status !== lua.LUA_OK) {
            console.error("Lua Exec Error:", to_jsstring(lua.lua_tostring(L, -1)));
        }

        lua.lua_getglobal(L, to_luastring("_captured"));
        let captured = null;
        if (lua.lua_isstring(L, -1)) {
            captured = to_jsstring(lua.lua_tostring(L, -1));
        }

        lua.lua_close(L);
        return captured;
    } catch (e) {
        console.error("Fengari Crash:", e);
        return null;
    }
}

client.login(TOKEN);
