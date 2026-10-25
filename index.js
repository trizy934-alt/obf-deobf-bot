require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
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
                opt.setName('code').setDescription('الصق الكود المشفر').setRequired(true)
            )
    ];

    await client.application.commands.set(commands);
    console.log('[BOT] Commands registered.');
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'deobfuscate') return;

    await interaction.deferReply();

    const codeInput = interaction.options.getString('code');
    if (!codeInput.trim()) return interaction.editReply('❌ الكود فارغ.');

    // تشغيل محرك Lua
    const result = executeLua(codeInput);

    if (!result) {
        return interaction.editReply('❌ فشل فك التشفير. قد يكون السكربت محمي بشكل معقد.');
    }

    // عرض النتيجة
    if (result.length > 1900) {
        const buffer = Buffer.from(result, 'utf-8');
        await interaction.editReply({
            content: '✅ تم فك التشفير بنجاح! الكود طويل جداً، خده في ملف:',
            files: [{ attachment: buffer, name: 'deobfuscated.lua' }]
        });
    } else {
        const embed = new EmbedBuilder()
            .setTitle('✅ Decryption Successful')
            .setDescription('```lua\n' + result + '\n```')
            .setColor('#00ffcc');
        await interaction.editReply({ embeds: [embed] });
    }
});

// محرك Lua (Fengari)
function executeLua(code) {
    try {
        const L = lauxlib.luaL_newstate();
        lualib.luaL_openlibs(L);

        // تجهيز بيئة Roblox الوهمية
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

            -- The Trap
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

        // تشغيل الكود المشفر
        const status = lauxlib.luaL_dostring(L, to_luastring(code));
        if (status !== lua.LUA_OK) {
            console.error("Lua Exec Error:", to_jsstring(lua.lua_tostring(L, -1)));
        }

        // استخراج الكود
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
